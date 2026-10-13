import { DEFAULT_TRUSTED_MINTS } from '@/lib/constants'
import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

function selectedMintLocator(page: import('@playwright/test').Page, mintUrl: string) {
	return page.locator('span[title]').filter({ hasText: mintUrl }).locator('..').locator('button[title="Remove mint"]')
}

function unselectedMintLocator(page: import('@playwright/test').Page, mintUrl: string) {
	return page.locator('button').filter({ has: page.locator(`span[title="${mintUrl}"]`) })
}

/**
 * Opens Create Auction, moves to the Auction tab and opens Advanced. Later
 * tabs unlock only once the Name tab's required fields are filled.
 */
async function openAuctionTab(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: /create.*auction/i }).click()
	await page.getByPlaceholder(/rare print run/i).fill('E2E mint state auction')
	await page.getByPlaceholder(/describe the item/i).fill('E2E mint state auction description')
	await page.getByRole('button', { name: /^next$/i }).click()
	await expect(page.getByRole('tab', { name: /auction/i })).toHaveAttribute('data-state', 'active', { timeout: 10_000 })
	// Trusted Mints lives in the collapsed Advanced section.
	await page.getByRole('button', { name: /^advanced$/i }).click()
	await expect(page.getByText('Trusted Mints')).toBeVisible({ timeout: 5_000 })
}

test.describe('Auction Mint State', () => {
	test('trusted mints initialize with available mints', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await openAuctionTab(merchantPage)

		for (const mint of DEFAULT_TRUSTED_MINTS) {
			await expect(merchantPage.locator(`span[title="${mint}"]`)).toBeVisible({ timeout: 10_000 })
		}
	})

	test('user can remove a mint and the form stays valid', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await openAuctionTab(merchantPage)

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })

		const initialCount = await removeButtons.count()

		await removeButtons.first().click()

		const afterCount = await removeButtons.count()
		expect(afterCount).toBe(initialCount - 1)

		await expect(merchantPage.getByTitle('At least one mint is required').or(merchantPage.getByTitle('Remove mint')).first()).toBeVisible()
	})

	test('user can re-add a previously removed mint via unselected list', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await openAuctionTab(merchantPage)

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })

		const firstSelectedRow = removeButtons.first().locator('..')
		const removedMintSpan = firstSelectedRow.locator('span[title]')
		const removedMintUrl = (await removedMintSpan.getAttribute('title')) ?? ''

		await removeButtons.first().click()

		await expect(selectedMintLocator(merchantPage, removedMintUrl)).not.toBeVisible()

		const addMintButton = unselectedMintLocator(merchantPage, removedMintUrl)
		await expect(addMintButton).toBeVisible({ timeout: 10_000 })
		await addMintButton.click()

		await expect(selectedMintLocator(merchantPage, removedMintUrl)).toBeVisible({ timeout: 10_000 })
	})
})
