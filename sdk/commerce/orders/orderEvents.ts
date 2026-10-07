import type { EventTemplate } from 'nostr-tools/pure'

export const ORDER_PROCESS_KIND = 16
export const PAYMENT_RECEIPT_KIND = 17

export const ORDER_MESSAGE_TYPE = {
	ORDER_CREATION: '1',
	PAYMENT_REQUEST: '2',
	STATUS_UPDATE: '3',
	SHIPPING_UPDATE: '4',
} as const

export type BuyerOrderItem = {
	productRef: string
	quantity: number
}

export interface BuyerOrderTemplateInput {
	merchantPubkey: string
	orderId: string
	amountSats: number
	items: BuyerOrderItem[]
	shippingRef?: string
	createdAt: number
	content?: string
}

/** Builds the unsigned public order marker. Private delivery details are never accepted here. */
export function createBuyerOrderTemplate(input: BuyerOrderTemplateInput): EventTemplate {
	const tags: string[][] = [
		['p', input.merchantPubkey],
		['subject', 'order-info'],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', input.orderId],
		['amount', String(input.amountSats)],
	]

	for (const item of input.items) tags.push(['item', item.productRef, String(item.quantity)])
	if (input.shippingRef) tags.push(['shipping', input.shippingRef])

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: input.createdAt,
		content: input.content ?? 'Order created',
		tags,
	}
}

export interface BuyerPaymentRequestTemplateInput {
	buyerPubkey: string
	merchantPubkey: string
	orderId: string
	amountSats: number
	paymentMethods: Array<{ type: 'lightning' | 'bitcoin' | 'other'; details: string }>
	expirationTime?: number
	createdAt: number
	content?: string
}

/** Builds an unsigned payment request, preserving the current event/tag contract. */
export function createBuyerPaymentRequestTemplate(input: BuyerPaymentRequestTemplateInput): EventTemplate {
	const tags: string[][] = [
		['p', input.buyerPubkey],
		['recipient', input.merchantPubkey],
		['subject', 'order-payment'],
		['type', ORDER_MESSAGE_TYPE.PAYMENT_REQUEST],
		['order', input.orderId],
		['amount', String(input.amountSats)],
	]

	for (const method of input.paymentMethods) tags.push(['payment', method.type, method.details])
	if (input.expirationTime) tags.push(['expiration', String(input.expirationTime)])

	return {
		kind: ORDER_PROCESS_KIND,
		created_at: input.createdAt,
		content: input.content || 'Payment request for your order',
		tags,
	}
}

export interface BuyerPaymentReceiptTemplateInput {
	merchantPubkey: string
	orderId: string
	amountSats: number
	bolt11: string
	proof: string
	createdAt: number
	content?: string
}

/** Builds the current Lightning receipt template; this does not verify settlement. */
export function createBuyerPaymentReceiptTemplate(input: BuyerPaymentReceiptTemplateInput): EventTemplate {
	return {
		kind: PAYMENT_RECEIPT_KIND,
		created_at: input.createdAt,
		content: input.content || 'Payment confirmation',
		tags: [
			['p', input.merchantPubkey],
			['subject', 'order-receipt'],
			['order', input.orderId],
			['payment', 'lightning', input.bolt11, input.proof],
			['amount', String(input.amountSats)],
		],
	}
}

export interface BuyerChatTemplateInput {
	recipientPubkey: string
	content: string
	createdAt: number
	subject?: string
}

/** Builds the current unsigned kind-14 buyer/seller message template. */
export function createBuyerChatTemplate(input: BuyerChatTemplateInput): EventTemplate {
	const tags: string[][] = [['p', input.recipientPubkey]]
	if (input.subject) tags.push(['subject', input.subject])
	return { kind: 14, created_at: input.createdAt, content: input.content, tags }
}
