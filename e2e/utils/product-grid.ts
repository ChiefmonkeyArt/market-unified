import { expect, type Locator, type Page } from '@playwright/test'
import { getTagValue, queryRelayEvents } from './relay-query'

/**
 * The /products grid shows one page and a "Load More Products" button. Seeded
 * products fall off the first page once earlier specs have published their own
 * products, so a test that looks a seeded product up by name must page through.
 */
export async function revealProductCard(page: Page, name: string, maxPages = 20): Promise<Locator> {
	const cards = page.locator('[data-testid="product-card"]')
	const card = cards.filter({ hasText: name })
	await expect(cards.first()).toBeVisible({ timeout: 15_000 })
	const loadMore = page.getByRole('button', { name: /load more products/i })
	for (let i = 0; i < maxPages && (await card.count()) === 0; i++) {
		if (!(await loadMore.isVisible().catch(() => false))) {
			await page.waitForTimeout(500)
			continue
		}
		const before = await cards.count()
		await loadMore.click()
		await expect.poll(() => cards.count(), { timeout: 10_000 }).toBeGreaterThan(before)
	}
	await expect(card.first()).toBeVisible({ timeout: 15_000 })
	return card.first()
}

/** Header cart button (the badge text is the total quantity). */
export function cartButton(page: Page): Locator {
	return page.getByRole('button').filter({ has: page.locator('.i-basket') })
}

export async function cartBadgeCount(page: Page): Promise<number> {
	const text =
		(await cartButton(page)
			.innerText()
			.catch(() => '')) ?? ''
	return Number(text.replace(/\D/g, '') || '0')
}

/**
 * Clicks "Add to Cart" on a card and waits until the badge has gone up. Adding
 * is async (the store fetches the product event and shipping first), so the
 * button label is not a reliable signal.
 */
export async function addCardToCart(page: Page, card: Locator): Promise<void> {
	const before = await cartBadgeCount(page)
	await card.getByRole('button', { name: /add to cart/i }).click()
	await expect.poll(() => cartBadgeCount(page), { timeout: 15_000 }).toBeGreaterThan(before)
}

/**
 * Adds a seeded product to the cart from its own page, found by title on the
 * relay. Use this when the test is about checkout, not browsing: paging the
 * grid gets slow once a full run has published many products.
 */
export async function addSeededProductToCartDirect(page: Page, title: string): Promise<void> {
	const events = await queryRelayEvents({ kinds: [30402] })
	// Other specs publish products with the same title; the seeded one has the
	// title's slug as its d-tag (e.g. 'bitcoin-e-book'), so prefer that.
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
	const matches = events.filter((event) => getTagValue(event, 'title') === title).sort((a, b) => b.created_at - a.created_at)
	const product = matches.find((event) => getTagValue(event, 'd') === slug) ?? matches[0]
	if (!product) throw new Error(`addSeededProductToCartDirect: no product titled "${title}" on the relay`)
	await page.goto(`/products/${product.id}`)
	await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })
	await page
		.getByRole('button', { name: /^add to cart$/i })
		.first()
		.click()
	// Adding here opens the cart drawer; the item showing in it is the signal
	// (the header badge sits behind the drawer's overlay).
	const cart = page.getByRole('dialog', { name: /your cart/i })
	await expect(cart.getByText(title).first()).toBeVisible({ timeout: 15_000 })
}
