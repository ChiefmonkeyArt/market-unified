import { test, expect } from '../fixtures'
import { checkoutFromCartDrawer, selectShippingOnCheckout } from '../utils/checkout-shipping'

test.use({ scenario: 'merchant' })

test.describe('Buyer Purchase Flow', () => {
	test('buyer adds two products to cart and totals are correct', async ({ buyerPage }) => {
		test.setTimeout(60_000)

		await buyerPage.goto('/products')

		// Wait for seeded products to load from relay
		const walletCard = buyerPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		const tshirtCard = buyerPage.locator('[data-testid="product-card"]').filter({ hasText: 'Nostr T-Shirt' })

		await expect(walletCard).toBeVisible({ timeout: 15_000 })
		await expect(tshirtCard).toBeVisible()

		// Add Bitcoin Hardware Wallet (50,000 SATS) to cart
		await walletCard.getByRole('button', { name: /Add to Cart/i }).click()
		// Wait for confirmation before adding next product
		await expect(walletCard.getByRole('button', { name: /Add/i })).toBeVisible()

		// Add Nostr T-Shirt (15,000 SATS) to cart
		await tshirtCard.getByRole('button', { name: /Add to Cart/i }).click()
		await expect(tshirtCard.getByRole('button', { name: /Add/i })).toBeVisible()

		// Verify cart badge shows 2 items
		const cartBadge = buyerPage.locator('header').locator('span').filter({ hasText: '2' })
		await expect(cartBadge).toBeVisible({ timeout: 5_000 })

		// Open cart drawer
		await buyerPage
			.getByRole('button')
			.filter({ has: buyerPage.locator('.i-basket') })
			.click()

		// The drawer defers shipping to checkout; pick it on the checkout page.
		await expect(buyerPage.getByText(/Select shipping at checkout for 2 items/)).toBeVisible({ timeout: 10_000 })
		await checkoutFromCartDrawer(buyerPage)

		// Select "Worldwide Standard" shipping (5,000 sats) for each item
		await selectShippingOnCheckout(buyerPage, /Worldwide Standard/)

		// Wait for totals to update after shipping selection
		// Subtotal: 50,000 + 15,000 = 65,000 sat
		// Shipping: 5,000 × 2 products = 10,000 sat (shipping cost applies per product)
		// Total: 75,000 sat
		await expect(buyerPage.getByText('65,000 sat').first()).toBeVisible({ timeout: 10_000 })
		await expect(buyerPage.getByText('10,000 sat').first()).toBeVisible()
		await expect(buyerPage.getByText('75,000 sat').first()).toBeVisible()

		// Verify V4V payment breakdown (merchant seeded with 10% V4V)
		// V4V applies to product subtotal only (65,000 sats), not shipping
		// Community Share: 10% of 65,000 = 6,500 sat
		// Merchant: 90% of 65,000 + 10,000 shipping = 68,500 sat
		await expect(buyerPage.getByText('Payment Breakdown')).toBeVisible()
		await expect(buyerPage.getByText(/Community Share/)).toBeVisible()
		await expect(buyerPage.getByText('6,500 sat')).toBeVisible()
		await expect(buyerPage.getByText('68,500 sat')).toBeVisible()

		// The shipping-step warning clears once every item has a method
		await expect(buyerPage.getByText(/please select shipping for/i)).toHaveCount(0)
	})
})
