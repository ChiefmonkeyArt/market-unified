import { describe, expect, test } from 'bun:test'
import {
	createBuyerChatTemplate,
	createBuyerOrderTemplate,
	createBuyerPaymentReceiptTemplate,
	createBuyerPaymentRequestTemplate,
} from './orderEvents'

describe('buyer order event templates', () => {
	test('builds a sanitized order marker with item and optional shipping references', () => {
		const event = createBuyerOrderTemplate({
			merchantPubkey: 'b'.repeat(64),
			orderId: 'order-1',
			amountSats: 1200,
			items: [{ productRef: `30402:${'b'.repeat(64)}:product`, quantity: 2 }],
			shippingRef: `30406:${'b'.repeat(64)}:shipping`,
			createdAt: 100,
		})

		expect(event).toEqual({
			kind: 16,
			created_at: 100,
			content: 'Order created',
			tags: [
				['p', 'b'.repeat(64)],
				['subject', 'order-info'],
				['type', '1'],
				['order', 'order-1'],
				['amount', '1200'],
				['item', `30402:${'b'.repeat(64)}:product`, '2'],
				['shipping', `30406:${'b'.repeat(64)}:shipping`],
			],
		})
	})

	test('builds the current payment request recipient and payment method tags', () => {
		const event = createBuyerPaymentRequestTemplate({
			buyerPubkey: 'a'.repeat(64),
			merchantPubkey: 'b'.repeat(64),
			orderId: 'order-1',
			amountSats: 500,
			paymentMethods: [{ type: 'lightning', details: 'invoice' }],
			createdAt: 101,
		})

		expect(event.tags).toContainEqual(['recipient', 'b'.repeat(64)])
		expect(event.tags).toContainEqual(['payment', 'lightning', 'invoice'])
		expect(event.kind).toBe(16)
	})

	test('builds receipt evidence without making a settlement claim', () => {
		const event = createBuyerPaymentReceiptTemplate({
			merchantPubkey: 'b'.repeat(64),
			orderId: 'order-1',
			amountSats: 500,
			bolt11: 'invoice',
			proof: 'preimage',
			createdAt: 102,
		})
		expect(event.kind).toBe(17)
		expect(event.tags).toContainEqual(['payment', 'lightning', 'invoice', 'preimage'])
		expect(event.content).toBe('Payment confirmation')
	})

	test('builds a kind-14 buyer chat message template', () => {
		expect(createBuyerChatTemplate({ recipientPubkey: 'b'.repeat(64), content: 'Hello', subject: 'order', createdAt: 103 })).toEqual({
			kind: 14,
			created_at: 103,
			content: 'Hello',
			tags: [
				['p', 'b'.repeat(64)],
				['subject', 'order'],
			],
		})
	})
})
