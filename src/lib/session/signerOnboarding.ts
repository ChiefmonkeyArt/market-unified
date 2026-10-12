/**
 * Session onboarding: what happens after a signer is set, and what is undone at logout.
 *
 * Moved out of `stores/ndk.ts` so the relay-client store no longer imports the wallet
 * stores, the NIP-60 store or the query layer (the retrofit's "ndk.ts knot":
 * store -> queries -> store). The auth flow composes the two halves explicitly:
 * `ndkActions.setSigner(s)` then `runSignerOnboarding(s)`.
 */
import { fetchNwcWalletBalance, fetchUserNwcWallets } from '@/queries/wallet'
import { fetchUserRelayListWithPreferences } from '@/queries/relay-list'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { nip60Actions } from '@/lib/stores/nip60'
import { walletActions, walletStore, type Wallet } from '@/lib/stores/wallet'

/** The relay client's signer type, without importing the client library here. */
type NDKSigner = NonNullable<Parameters<typeof ndkActions.setSigner>[0]>
type NDKUser = Awaited<ReturnType<NDKSigner['user']>>

/**
 * Post-signer pipeline: load the user's NIP-65 relay list, select
 * the best NWC wallet by balance, and bootstrap the NIP-60 Cashu
 * wallet. The three are run concurrently — they only share `user`
 * (derived once up front) and don't observe each other.
 *
 * The auth flow MUST call this after `setSigner(s)` for a fresh
 * login. Logout calls `clearSignerOnboarding()` instead.
 */
export async function runSignerOnboarding(signer: NDKSigner): Promise<void> {
	let user: NDKUser | null = null
	try {
		user = await signer.user()
	} catch (error) {
		console.error('[ndk] Failed to resolve user from signer; skipping onboarding pipeline:', error)
		return
	}
	if (!user?.pubkey) {
		console.warn('[ndk] Signer returned no pubkey; skipping onboarding pipeline')
		return
	}

	// Run in parallel — each step handles its own failure (caller
	// just sees a warning) so a failed NWC lookup doesn't block
	// NIP-60 init and vice versa.
	const userPubkey = user.pubkey
	await Promise.all([
		loadRelaysFromNostr().catch((e) => console.error('[ndk] loadRelaysFromNostr failed:', e)),
		selectAndSetInitialNwcWallet().catch((e) => console.error('[ndk] selectAndSetInitialNwcWallet failed:', e)),
		(async () => {
			try {
				await nip60Actions.initialize(userPubkey)
			} catch (e) {
				console.error('[ndk] nip60Actions.initialize failed:', e)
			}
		})(),
	])
}

/**
 * Tear-down counterpart to `runSignerOnboarding`. Auth logout calls
 * this after `setSigner(undefined)` so the store doesn't carry
 * stale NWC / NIP-60 state into the unauthenticated session.
 */
export function clearSignerOnboarding(): void {
	ndkActions.setActiveNwcWalletUri(null)
	nip60Actions.reset()
}

/**
 * Load user's relay list from Nostr (kind 10002)
 * This enables the outbox model to work properly by adding user's preferred relays
 */
export async function loadRelaysFromNostr(): Promise<void> {
	const ndk = ndkStore.state.ndk
	if (!ndk || !ndk.signer) {
		console.warn('NDK or signer not available for loading relays')
		return
	}

	let user: NDKUser | null = null
	try {
		user = await ndk.signer.user()
	} catch (e) {
		console.error('Error getting user from signer:', e)
		return
	}

	if (!user || !user.pubkey) {
		console.warn('User or user pubkey not available from signer')
		return
	}

	try {
		const relayPrefs = await fetchUserRelayListWithPreferences(user.pubkey)
		if (relayPrefs && relayPrefs.length > 0) {
			console.log(`📡 Loading ${relayPrefs.length} relays from user's Nostr relay list`)
			for (const relay of relayPrefs) {
				ndkActions.addSingleRelay(relay.url)
			}
		} else {
			console.log('📡 No relay list found on Nostr for user')
		}
	} catch (error) {
		console.error('Failed to load relays from Nostr:', error)
	}
}

export async function selectAndSetInitialNwcWallet(): Promise<void> {
	const ndk = ndkStore.state.ndk
	if (!ndk || !ndk.signer) {
		console.warn('NDK or signer not available for NWC wallet selection.')
		return
	}

	let user: NDKUser | null = null
	try {
		user = await ndk.signer.user()
	} catch (e) {
		console.error('Error getting user from signer:', e)
		return
	}

	if (!user || !user.pubkey) {
		console.warn('User or user pubkey not available from signer.')
		return
	}

	const userPubkey = user.pubkey

	// Set loading state for wallet operations
	walletStore.setState((state) => ({ ...state, isLoading: true }))

	await walletActions.initialize()

	try {
		const nostrWallets = await fetchUserNwcWallets(userPubkey)
		if (nostrWallets && nostrWallets.length > 0) {
			walletActions.setNostrWallets(nostrWallets as Wallet[])
		}
	} catch (error) {
		console.error('Failed to fetch or merge Nostr NWC wallets during initial setup:', error)
	}

	const allWallets = walletActions.getWallets()

	if (allWallets.length === 0) {
		ndkActions.setActiveNwcWalletUri(null)
		// Clear loading state when done
		walletStore.setState((state) => ({ ...state, isLoading: false }))
		return
	}

	let highestBalance = -1
	let bestWallet: Wallet | null = null

	const balancePromises = allWallets
		.filter((wallet) => wallet.nwcUri)
		.map(async (wallet) => {
			try {
				const balanceInfo = await fetchNwcWalletBalance(wallet.nwcUri)
				const currentBalance = balanceInfo?.balance ?? -1
				return { ...wallet, balance: currentBalance }
			} catch (error) {
				console.error(`Failed to fetch balance for wallet ${wallet.name} (ID: ${wallet.id}):`, error)
				return { ...wallet, balance: -1 }
			}
		})

	const walletsWithBalances = await Promise.all(balancePromises)

	for (const wallet of walletsWithBalances) {
		if (wallet.balance > highestBalance) {
			highestBalance = wallet.balance
			bestWallet = wallet
		}
	}

	if (bestWallet && bestWallet.nwcUri) {
		ndkActions.setActiveNwcWalletUri(bestWallet.nwcUri)
	} else {
		ndkActions.setActiveNwcWalletUri(null)
	}

	// Clear loading state when done
	walletStore.setState((state) => ({ ...state, isLoading: false }))
}
