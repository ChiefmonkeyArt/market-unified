import { expect, type Page } from '@playwright/test'

/**
 * Shipping is chosen per item on the checkout page's shipping step; the cart
 * drawer only says "Select shipping at checkout" (upstream 15260b7f keeps the
 * drawer compact). These helpers drive that flow.
 */

/** Opens checkout from the cart drawer and waits for the shipping step. */
export async function checkoutFromCartDrawer(page: Page): Promise<void> {
	const cartDialog = page.getByRole('dialog', { name: /your cart/i })
	const checkoutButton = cartDialog.getByRole('button', { name: /^checkout$/i })
	await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
	await checkoutButton.click()
	await expect(page.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 30_000 })
}

/**
 * Picks `option` for every item that still has no shipping method on the
 * checkout page (none if all are already set). Returns how many selectors were set.
 */
export async function selectShippingOnCheckout(page: Page, option: RegExp): Promise<number> {
	const triggers = page.getByText('Select shipping method')
	// A persisted cart can arrive with every method already chosen; wait for
	// the shipping step, then pick only what is still unset.
	await expect(page.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 15_000 })
	await expect(triggers.or(page.getByText(/^Shipping cost:/)).first()).toBeVisible({ timeout: 15_000 })
	const count = await triggers.count()
	for (let i = 0; i < count; i++) {
		await triggers.first().click()
		const choice = page.getByRole('option', { name: option })
		await expect(choice).toBeVisible({ timeout: 5_000 })
		await choice.click()
		await expect(page.getByText('Select shipping method')).toHaveCount(count - i - 1, { timeout: 5_000 })
	}
	return count
}

/**
 * Product form shipping tab: make sure at least one shipping option is
 * attached. Waits for options to load, then either adds the first available
 * one or quick-creates Digital Delivery (which attaches itself).
 */
export async function ensureProductShippingAttached(page: Page): Promise<void> {
	const selected = page.getByText('Selected Shipping Options')
	const addButton = page.getByRole('button', { name: /^add$/i }).first()
	const quickCreate = page.getByRole('button', { name: /Digital Delivery/i })
	await expect(selected.or(addButton).or(quickCreate).first()).toBeVisible({ timeout: 15_000 })
	if (await selected.isVisible()) return
	if (await addButton.isVisible()) {
		await addButton.click()
	} else {
		await quickCreate.click()
	}
	// Quick-create publishes the option first, so allow for the relay round trip.
	await expect(selected).toBeVisible({ timeout: 20_000 })
}
