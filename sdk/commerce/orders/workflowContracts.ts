import type { OrderWorkflowStatus, ShippingWorkflowStatus } from './orderEvents'

/** Side-effect phases in the current non-atomic, multi-seller order publisher. */
export type SellerOrderPublishPhase = 'private_delivery' | 'order_marker' | 'payment_request'

export interface SellerOrderPublishProgress {
	sellerPubkey: string
	orderId: string
	phase: SellerOrderPublishPhase
	publishedEventIds: string[]
}

/**
 * Each seller order is published independently. A later failure does not undo
 * earlier relay writes; callers must retain IDs already confirmed published.
 */
export type SellerOrderPublishOutcome =
	| { status: 'published'; progress: SellerOrderPublishProgress }
	| { status: 'partial'; progress: SellerOrderPublishProgress; failedPhase: SellerOrderPublishPhase; error: string }
	| { status: 'failed'; progress: SellerOrderPublishProgress; failedPhase: SellerOrderPublishPhase; error: string }

/**
 * Workflow facts are orthogonal. Receipt publication is not settlement,
 * settlement is not merchant confirmation, and fulfillment is a later fact.
 */
export interface OrderWorkflowSnapshot {
	orderStatus: OrderWorkflowStatus
	shippingStatus: ShippingWorkflowStatus | null
	payment: {
		requested: boolean
		attempted: boolean
		walletAcknowledged: boolean
		settledOrProven: boolean
		receiptPublished: boolean
		merchantConfirmed: boolean
		failed: boolean
		expired: boolean
		refunded: boolean
	}
	fulfilled: boolean
}

/** Host adapters own these operations; SDK contracts do not own keys or transports. */
export interface OrderWorkflowCapabilities<PrivateDelivery, SignedEvent> {
	preparePrivateDelivery(details: PrivateDelivery): Promise<SignedEvent>
	publishPrivateDelivery(event: SignedEvent): Promise<{ eventId: string }>
	publishOrderMarker(event: SignedEvent): Promise<{ eventId: string }>
	publishPaymentRequest(event: SignedEvent): Promise<{ eventId: string }>
}
