/**
 * Lightning invoice payment helpers (NWC via NIP-47, WebLN).
 *
 * Moved out of `publish/payment.tsx` so the query layer can pay invoices
 * without importing the publish layer (that import closed the
 * queries/payment <-> publish/payment runtime cycle).
 */
import NDK from '@nostr-dev-kit/ndk'
import { NDKNWCWallet, NDKWalletStatus } from '@nostr-dev-kit/wallet'
import { ndkActions } from '@/lib/stores/ndk'
import { parseNwcUri } from '@/lib/stores/wallet'
import { validatePreimage } from '@/lib/utils/payment.utils'

export interface PayWithNwcParams {
	bolt11: string
	nwcUri: string
	userPubkey: string
	recipientPubkey: string
	invoiceId: string
	amount: number
	description: string
}

export const createPaymentNwcNdk = (relayUrl: string): NDK => new NDK({ explicitRelayUrls: [relayUrl], autoConnectUserRelays: false })

/**
 * Pays an invoice using an NWC connection via direct NIP-47 pay_invoice method
 * @returns The payment preimage on success
 */
export const payInvoiceWithNwc = async (params: PayWithNwcParams): Promise<string> => {
	const { bolt11, nwcUri, userPubkey } = params

	// Parse the NWC URI to get the relay URL
	const parsedUri = parseNwcUri(nwcUri)
	if (!parsedUri || !parsedUri.relay) {
		throw new Error('Failed to parse NWC URI or missing relay URL')
	}

	// Create a dedicated NDK instance for this specific NWC wallet
	const nwcNdk = createPaymentNwcNdk(parsedUri.relay)

	// Set the signer from the main NDK instance
	const mainNdk = ndkActions.getNDK()
	if (!mainNdk || !mainNdk.signer) {
		throw new Error('Main NDK instance or signer not available')
	}
	nwcNdk.signer = mainNdk.signer

	// Connect to the NWC relay
	try {
		console.log('Connecting to NWC relay for payment:', parsedUri.relay)
		await nwcNdk.connect()
	} catch (error) {
		throw new Error(`Failed to connect to NWC relay: ${error}`)
	}

	const nwcWalletForPayment = new NDKNWCWallet(nwcNdk, { pairingCode: nwcUri })

	// Wait for the wallet to connect
	const timeout = 10000 // 10 seconds
	const startTime = Date.now()

	while (nwcWalletForPayment.status !== NDKWalletStatus.READY) {
		if (Date.now() - startTime > timeout) {
			throw new Error('NWC wallet connection timeout')
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	console.log(`Initiating NWC pay_invoice request for ${params.amount} sats`)

	try {
		const response = await nwcWalletForPayment.lnPay({
			pr: bolt11,
		})

		const candidate =
			response?.preimage ||
			// Some wallets may use different keys (or nest results)
			(response as any)?.payment_preimage ||
			(response as any)?.paymentPreimage ||
			(response as any)?.preimageHex ||
			(response as any)?.preimage_hex ||
			(response as any)?.result?.preimage ||
			undefined

		if (typeof candidate === 'string' && candidate.length > 0 && validatePreimage(bolt11, candidate)) {
			console.log(`✅ NWC payment successful, preimage: ${candidate.substring(0, 16)}...`)
			return candidate
		}

		// Some wallets (e.g. Primal) may not return a real Lightning preimage.
		// Treat the successful response as an ACK and rely on zap receipts / other signals for confirmation.
		return 'external-payment'
	} catch (error) {
		console.error('❌ NWC payment failed:', error)
		throw new Error(`NWC payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
	} finally {
		// NDK doesn't expose a disconnect API
	}
}

/**
 * Initiates a payment using a WebLN-compatible browser extension (e.g., Alby).
 * @param bolt11 The BOLT11 payment request string.
 * @returns A promise that resolves with the payment preimage if successful.
 * @throws If WebLN is not available or the payment fails.
 */
export const payInvoiceWithWebln = async (bolt11: string): Promise<string> => {
	if (!window.webln) {
		throw new Error('WebLN not available. Please install a WebLN-compatible wallet extension.')
	}

	await window.webln.enable()
	const result = await window.webln.sendPayment(bolt11)

	const candidate = result?.preimage
	if (typeof candidate === 'string' && candidate.length > 0 && validatePreimage(bolt11, candidate)) {
		return candidate
	}

	// WebLN is expected to return a preimage, but fall back to a generic proof string if missing/invalid.
	return 'external-payment'
}
