import { expect, type Locator, type Page } from '@playwright/test'

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
