import { describe, expect, test } from 'bun:test'
import {
	addProductToCollectionSelection,
	createCollectionEditDraft,
	removeProductFromCollectionSelection,
} from './collectionWorkflow'

describe('seller collection workflow', () => {
	test('projects existing event tags into the editable collection draft', () => {
		const draft = createCollectionEditDraft({
			pubkey: 'seller',
			content: 'Details',
			tags: [
				['d', 'summer'],
				['title', 'Summer picks'],
				['summary', 'Warm weather'],
				['image', 'https://example.test/header.png'],
				['a', '30402:seller:shirt'],
				['shipping_option', '30406:seller:standard:option', '5'],
			],
		})
		expect(draft).toEqual({
			editingCollectionId: 'summer',
			name: 'Summer picks',
			summary: 'Warm weather',
			description: 'Details',
			headerImageUrl: 'https://example.test/header.png',
			selectedProducts: ['30402:seller:shirt'],
			shippings: [{ shipping: { id: '30406:seller:standard:option', name: 'Shipping Option (standard)' }, extraCost: '5' }],
		})
	})

	test('preserves collection product selection append and remove semantics', () => {
		const selection = addProductToCollectionSelection(['30402:seller:shirt'], '30402:seller:shirt')
		expect(selection).toEqual(['30402:seller:shirt', '30402:seller:shirt'])
		expect(removeProductFromCollectionSelection(selection, '30402:seller:shirt')).toEqual([])
	})
})
