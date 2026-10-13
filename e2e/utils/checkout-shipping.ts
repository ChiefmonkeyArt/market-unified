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
 * checkout page. Returns how many selectors were set.
 */
export async function selectShippingOnCheckout(page: Page, option: RegExp): Promise<number> {
	const triggers = page.getByText('Select shipping method')
	await expect(triggers.first()).toBeVisible({ timeout: 15_000 })
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
