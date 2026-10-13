import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import type { PublishPaymentDetailParams } from '@/queries/payment'
import { publishPaymentDetail } from '@/queries/payment'
import { paymentDetailsKeys } from '@/queries/queryKeyFactory'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createBuyerPaymentReceiptTemplate } from '@sdk/commerce/orders'

/**
 * Mutation hook for publishing payment details with query invalidation
 * This wraps the query function with additional functionality
 */
export const usePublishPaymentDetailMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (params: PublishPaymentDetailParams) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			// Get app pubkey if not provided
			if (!params.appPubkey) {
				const appPubkey = configStore.state.config.appPublicKey
				if (!appPubkey) {
					throw new Error('App public key is required')
				}
				params.appPubkey = appPubkey
			}

			return publishPaymentDetail(params)
		},

		onSuccess: async (eventId, params) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(userPubkey) })
			}

			if (params.coordinates) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(params.coordinates) })
			}

			toast.success('Payment details published successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to publish payment details:', error)
			toast.error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Helper function for creating lightning payment details
 */
export const useLightningPaymentDetailMutation = () => {
	const publishPaymentDetailMutation = usePublishPaymentDetailMutation()

	return useMutation({
		mutationFn: async (params: { lightningAddress: string; coordinates?: string; appPubkey?: string }) => {
			return publishPaymentDetailMutation.mutateAsync({
				paymentMethod: 'ln',
				paymentDetail: params.lightningAddress,
				coordinates: params.coordinates,
				appPubkey: params.appPubkey,
			})
		},

		onSuccess: (eventId) => {
			toast.success('Lightning payment details saved')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to save lightning payment details:', error)
			toast.error('Failed to save lightning payment details')
		},
	})
}

/**
 * Helper function for creating on-chain payment details
 */
export const useOnChainPaymentDetailMutation = () => {
	const publishPaymentDetailMutation = usePublishPaymentDetailMutation()

	return useMutation({
		mutationFn: async (params: { bitcoinAddress: string; coordinates?: string; appPubkey?: string }) => {
			return publishPaymentDetailMutation.mutateAsync({
				paymentMethod: 'on-chain',
				paymentDetail: params.bitcoinAddress,
				coordinates: params.coordinates,
				appPubkey: params.appPubkey,
			})
		},

		onSuccess: (eventId) => {
			toast.success('Bitcoin address saved')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to save bitcoin address:', error)
			toast.error('Failed to save bitcoin address')
		},
	})
}

export { createPaymentNwcNdk, payInvoiceWithNwc, payInvoiceWithWebln, type PayWithNwcParams } from '@/lib/payments/invoicePayment'

/**
 * Parameters for publishing a payment receipt
 */
export interface PublishPaymentReceiptParams {
	invoice: {
		orderId: string
		recipientPubkey?: string
		amount: number
		description?: string
		id: string
		bolt11?: string
	}
	preimage: string
	bolt11: string
}

/**
 * Publishes a payment receipt (Kind 17) to the Nostr network
 * This creates a proof of payment for the order
 */
export const publishPaymentReceipt = async (params: PublishPaymentReceiptParams): Promise<string> => {
	const { invoice, preimage, bolt11 } = params

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available')

	// Get current user
	const user = await signer.user()
	if (!user) throw new Error('No user available')

	// Build the event through SDK rules, then sign and publish at the app boundary.
	const event = new (await import('@nostr-dev-kit/ndk')).NDKEvent(ndk)
	const template = createBuyerPaymentReceiptTemplate({
		merchantPubkey: invoice.recipientPubkey || '',
		orderId: invoice.orderId,
		amountSats: invoice.amount,
		bolt11,
		proof: preimage,
		createdAt: Math.floor(Date.now() / 1000),
		content: invoice.description,
	})
	event.kind = template.kind
	event.content = template.content
	event.tags = template.tags
	event.created_at = template.created_at

	try {
		await event.sign(signer)
		await ndkActions.publishEvent(event)

		console.log(`✅ Payment receipt published for order ${invoice.orderId}`)
		return event.id
	} catch (error) {
		console.error('❌ Failed to publish payment receipt:', error)
		throw new Error(`Failed to publish payment receipt: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}
