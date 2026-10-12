import { describe, expect, test } from 'bun:test'
import {
	createSellerOrderPublishFailure,
	executeSellerOrderPublishWorkflow,
	planSellerOrders,
	recordSellerOrderEventPublished,
} from './workflowContracts'
import { resolveCheckoutDeliveryRequirements } from '../checkout/deliveryRequirements'

const deliveryRequirements = (service: string) =>
	resolveCheckoutDeliveryRequirements({
		products: [{ id: 'product', shippingMethodId: `30406:seller:${service}` }],
		servicesByShippingRef: { [`30406:seller:${service}`]: service },
	})

describe('multi-seller order planning', () => {
	test('plans each seller independently in caller order with canonical product coordinates', () => {
		const result = planSellerOrders([
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				amountSats: 1200,
				products: [{ productId: 'one:blue', quantity: 2 }],
				shippingRef: '30406:seller-a:standard',
				deliveryRequirements: deliveryRequirements('standard'),
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				amountSats: 400,
				products: [{ productId: 'two', quantity: 1 }],
				deliveryRequirements: deliveryRequirements('pickup'),
			},
		])

		expect(result.status).toBe('planned')
		if (result.status !== 'planned') throw new Error('Expected seller plans')
		expect(result.plans).toEqual([
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				amountSats: 1200,
				items: [{ productRef: '30402:seller-a:one:blue', quantity: 2 }],
				shippingRef: '30406:seller-a:standard',
				deliveryRequirements: deliveryRequirements('standard'),
				requiresPrivateDelivery: true,
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				amountSats: 400,
				items: [{ productRef: '30402:seller-b:two', quantity: 1 }],
				deliveryRequirements: deliveryRequirements('pickup'),
				requiresPrivateDelivery: false,
			},
		])
	})

	test('fails planning with seller and unresolved shipping refs before any workflow adapters run', () => {
		const result = planSellerOrders([
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				amountSats: 1200,
				products: [{ productId: 'item-a', quantity: 1 }],
				deliveryRequirements: deliveryRequirements('pickup'),
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				amountSats: 400,
				products: [{ productId: 'item-b', quantity: 1 }],
				deliveryRequirements: resolveCheckoutDeliveryRequirements({
					products: [{ id: 'item-b', shippingMethodId: '30406:seller-b:unknown' }],
					servicesByShippingRef: {},
				}),
			},
		])

		expect(result).toEqual({
			status: 'unresolved_delivery',
			failedSellerPubkey: 'seller-b',
			failedOrderId: 'order-b',
			unresolvedShippingRefs: ['30406:seller-b:unknown'],
		})
	})

	test('records per-seller publish progress and classifies partial failures without discarding published IDs', () => {
		const progress = [
			{ sellerPubkey: 'seller-a', orderId: 'order-a', completedPhases: [], publishedEventIds: [], paymentRequestFailures: 0 },
			{ sellerPubkey: 'seller-b', orderId: 'order-b', completedPhases: [], publishedEventIds: [], paymentRequestFailures: 0 },
		]
		const afterFirstOrder = recordSellerOrderEventPublished(progress, {
			sellerPubkey: 'seller-a',
			orderId: 'order-a',
			phase: 'order_marker',
			eventId: 'event-a',
		})
		const outcome = createSellerOrderPublishFailure({
			orderIds: ['order-a'],
			progress: afterFirstOrder,
			failedSellerPubkey: 'seller-b',
			failedOrderId: 'order-b',
			failedPhase: 'private_delivery',
			error: 'Private delivery could not be published',
			paymentRequestFailures: 0,
		})

		expect(outcome).toMatchObject({ status: 'partial', orderIds: ['order-a'], failedOrderId: 'order-b' })
		if (outcome.status === 'partial') expect(outcome.progress[0]?.publishedEventIds).toEqual(['event-a'])
	})

	test('executes private deliveries before markers then payment requests through injected ports', async () => {
		const sequence: string[] = []
		const work = [
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				requiresPrivateDelivery: true,
				privateDelivery: 'private-a',
				orderMarker: 'marker-a',
			},
			{ sellerPubkey: 'seller-b', orderId: 'order-b', requiresPrivateDelivery: false, orderMarker: 'marker-b' },
		]
		const outcome = await executeSellerOrderPublishWorkflow(work, {
			publishPrivateDelivery: async (item) => {
				sequence.push(`private:${item.orderId}`)
				return { eventId: `private-event:${item.orderId}` }
			},
			publishOrderMarker: async (item) => {
				sequence.push(`marker:${item.orderId}`)
				return { eventId: `marker-event:${item.orderId}` }
			},
			publishPaymentRequests: async (item) => {
				sequence.push(`payment:${item.orderId}`)
				return { completed: 1, failed: item.orderId === 'order-b' ? 1 : 0 }
			},
		})

		expect(sequence).toEqual(['private:order-a', 'marker:order-a', 'payment:order-a', 'marker:order-b', 'payment:order-b'])
		expect(outcome).toMatchObject({ status: 'published', orderIds: ['order-a', 'order-b'], paymentRequestFailures: 1 })
	})

	test('returns partial outcome with published IDs when later marker publish fails', async () => {
		const outcome = await executeSellerOrderPublishWorkflow(
			[
				{ sellerPubkey: 'seller-a', orderId: 'order-a', requiresPrivateDelivery: false, orderMarker: 'marker-a' },
				{ sellerPubkey: 'seller-b', orderId: 'order-b', requiresPrivateDelivery: false, orderMarker: 'marker-b' },
			],
			{
				publishPrivateDelivery: async () => ({ eventId: 'unused' }),
				publishOrderMarker: async (item) => {
					if (item.orderId === 'order-b') throw new Error('relay unavailable')
					return { eventId: 'marker-event:order-a' }
				},
				publishPaymentRequests: async () => ({ completed: 0, failed: 0 }),
			},
		)

		expect(outcome).toMatchObject({
			status: 'partial',
			orderIds: ['order-a'],
			failedSellerPubkey: 'seller-b',
			failedOrderId: 'order-b',
			failedPhase: 'order_marker',
			error: 'relay unavailable',
		})
	})
})

describe('resuming a partial multi-seller checkout', () => {
	const work = [
		{ sellerPubkey: 'seller-a', orderId: 'order-a', requiresPrivateDelivery: true, privateDelivery: 'wrap-a', orderMarker: 'marker-a' },
		{ sellerPubkey: 'seller-b', orderId: 'order-b', requiresPrivateDelivery: true, privateDelivery: 'wrap-b', orderMarker: 'marker-b' },
	]
	const makePorts = (sequence: string[], failWrapB: { value: boolean }) => ({
		publishPrivateDelivery: async (seller: (typeof work)[number]) => {
			if (seller.sellerPubkey === 'seller-b' && failWrapB.value) throw new Error('relay rejected wrap-b')
			sequence.push(`wrap:${seller.sellerPubkey}`)
			return { eventId: `wrap-event-${seller.sellerPubkey}` }
		},
		publishOrderMarker: async (seller: (typeof work)[number]) => {
			sequence.push(`marker:${seller.sellerPubkey}`)
			return { eventId: `marker-event-${seller.sellerPubkey}` }
		},
		publishPaymentRequests: async (seller: (typeof work)[number]) => {
			sequence.push(`pay:${seller.sellerPubkey}`)
			return { completed: 1, failed: 0, eventIds: [`pay-event-${seller.sellerPubkey}`] }
		},
	})

	test('first seller delivered, second fails: outcome is partial with no order IDs but resumable progress', async () => {
		const sequence: string[] = []
		const outcome = await executeSellerOrderPublishWorkflow(work, makePorts(sequence, { value: true }))
		expect(outcome.status).toBe('partial')
		expect(outcome.orderIds).toEqual([])
		expect(outcome.progress.find((p) => p.sellerPubkey === 'seller-a')?.completedPhases).toEqual(['private_delivery'])
		expect(sequence).toEqual(['wrap:seller-a'])
	})

	test('resume skips already-confirmed phases and never republishes them', async () => {
		const first: string[] = []
		const failing = { value: true }
		const partial = await executeSellerOrderPublishWorkflow(work, makePorts(first, failing))
		failing.value = false
		const second: string[] = []
		const outcome = await executeSellerOrderPublishWorkflow(work, makePorts(second, failing), { resume: partial.progress })
		expect(outcome.status).toBe('published')
		expect(outcome.orderIds).toEqual(['order-a', 'order-b'])
		expect(second).toEqual(['wrap:seller-b', 'marker:seller-a', 'pay:seller-a', 'marker:seller-b', 'pay:seller-b'])
		expect(outcome.progress.find((p) => p.sellerPubkey === 'seller-a')?.publishedEventIds).toContain('wrap-event-seller-a')
	})

	test('resume after a marker was published does not publish that marker again', async () => {
		const resume = [
			{
				sellerPubkey: 'seller-a',
				orderId: 'order-a',
				completedPhases: ['private_delivery', 'order_marker', 'payment_request'] as const,
				publishedEventIds: ['w', 'm', 'p'],
				paymentRequestFailures: 0,
			},
			{
				sellerPubkey: 'seller-b',
				orderId: 'order-b',
				completedPhases: ['private_delivery'] as const,
				publishedEventIds: ['w2'],
				paymentRequestFailures: 0,
			},
		].map((entry) => ({ ...entry, completedPhases: [...entry.completedPhases] }))
		const sequence: string[] = []
		const outcome = await executeSellerOrderPublishWorkflow(work, makePorts(sequence, { value: false }), { resume })
		expect(outcome.status).toBe('published')
		expect(outcome.orderIds).toEqual(['order-a', 'order-b'])
		expect(sequence).toEqual(['marker:seller-b', 'pay:seller-b'])
	})

	test('progress for a different order ID is ignored (no cross-checkout resume)', async () => {
		const resume = [
			{
				sellerPubkey: 'seller-a',
				orderId: 'other-order',
				completedPhases: ['private_delivery' as const],
				publishedEventIds: ['x'],
				paymentRequestFailures: 0,
			},
		]
		const sequence: string[] = []
		await executeSellerOrderPublishWorkflow(work, makePorts(sequence, { value: false }), { resume })
		expect(sequence[0]).toBe('wrap:seller-a')
	})
})
