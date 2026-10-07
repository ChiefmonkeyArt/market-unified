import { describe, expect, test } from 'bun:test'
import {
	buildShippingOptionEventData,
	prepareShippingOptionForPublish,
	validateShippingForm,
	type ShippingOptionFormInput,
} from './shippingWorkflow'

const baseForm: ShippingOptionFormInput = {
	title: 'Standard',
	description: 'Usually arrives soon',
	price: '5',
	currency: 'USD',
	countries: ['USA'],
	service: 'standard',
}

describe('seller shipping workflow', () => {
	test('preserves worldwide, pickup, and digital UI validation policies', () => {
		expect(validateShippingForm({ ...baseForm, countries: [] }, { isWorldwide: true })).toEqual({})
		expect(validateShippingForm({ ...baseForm, countries: [] }, { isWorldwide: false })).toEqual({
			countries: 'At least one country is required',
		})
		expect(validateShippingForm({ ...baseForm, service: 'digital', price: '', currency: '' }, { isWorldwide: false })).toEqual({})
		expect(validateShippingForm({ ...baseForm, service: 'pickup', countries: [], pickupAddress: { street: '', city: '', state: '', postalCode: '', country: '' } }, { isWorldwide: false })).toEqual({
			pickupStreet: 'Street address is required for local pickup',
			pickupCity: 'City is required for local pickup',
		})
	})

	test('publishing preparation fails in the existing validation order and normalizes zero-price services', () => {
		expect(prepareShippingOptionForPublish({ ...baseForm, title: ' ' })).toEqual({ ok: false, issue: 'shipping-title-required' })
		expect(prepareShippingOptionForPublish({ ...baseForm, price: 'bad' })).toEqual({ ok: false, issue: 'shipping-price-required' })
		const digital = prepareShippingOptionForPublish({ ...baseForm, service: 'digital', price: '9', currency: '' })
		expect(digital).toEqual({ ok: true, form: { ...baseForm, service: 'digital', price: '0', currency: 'USD' } })
		expect(baseForm.price).toBe('5')
		const pickupForm = {
			...baseForm,
			service: 'pickup' as const,
			pickupAddress: { street: 'Main', city: 'City', state: '', postalCode: '', country: '' },
		}
		const pickup = prepareShippingOptionForPublish(pickupForm)
		expect(pickup).toEqual({ ok: true, form: { ...pickupForm, price: '0' } })
	})

	test('builds kind-30406 shipping tags with worldwide and pickup compatibility behavior', () => {
		expect(buildShippingOptionEventData({ ...baseForm, countries: [] }, 'ship-1')).toEqual({
			kind: 30406,
			content: 'Usually arrives soon',
			tags: [['d', 'ship-1'], ['title', 'Standard'], ['price', '5', 'USD'], ['service', 'standard']],
		})
		const pickup = buildShippingOptionEventData({
			...baseForm,
			service: 'pickup',
			pickupAddress: { street: 'Main', city: 'Town', state: 'CA', postalCode: '90000', country: 'USA' },
		}, 'pickup-1')
		expect(pickup.tags).toContainEqual(['country', 'USA'])
		expect(pickup.tags).toContainEqual(['pickup-address', 'Main, Town, CA, 90000, USA'])
	})
})
