/**
 * Session onboarding: the signer-scoped services that start after a signer is
 * published, and are torn down when it is removed.
 *
 * These live outside `stores/ndk.ts` so the relay-client store never imports the
 * wallet stores, the NIP-60 store or the query layer (the retrofit's "ndk.ts
 * knot": store -> queries -> store). `ndk.ts` exposes a lease API and an
 * injection point (`configureSignerServices`); this module registers itself on
 * import. Every async step re-checks its lease so a late response from a
 * replaced or removed signer can never mutate the new session's state
 * (upstream master's signer-service lifecycle invariant).
 */
import { fetchNwcWalletBalance, fetchUserNwcWallets } from '@/queries/wallet'
import { fetchUserRelayListWithPreferences } from '@/queries/relay-list'
import { configureSignerServices, isCurrentSignerService, ndkActions, ndkStore, type SignerServiceLease } from '@/lib/stores/ndk'
import { nip60Actions } from '@/lib/stores/nip60'
import { walletActions, walletStore, type Wallet } from '@/lib/stores/wallet'

let activeNwcLoadingLease: SignerServiceLease | undefined

function syncNwcLoadingState(): void {
	const isLoading = Boolean(activeNwcLoadingLease && isCurrentSignerService(activeNwcLoadingLease))
	walletStore.setState((state) => (state.isLoading === isLoading ? state : { ...state, isLoading }))
}

function beginNwcLoading(lease: SignerServiceLease): void {
	if (!isCurrentSignerService(lease)) return
	activeNwcLoadingLease = lease
	syncNwcLoadingState()
}

function finishNwcLoading(lease: SignerServiceLease): void {
	if (activeNwcLoadingLease !== lease) return
	activeNwcLoadingLease = undefined
	syncNwcLoadingState()
}

async function leaseUserPubkey(lease: SignerServiceLease, label: string): Promise<string | undefined> {
	try {
		const user = await lease.signer.user()
		if (!isCurrentSignerService(lease)) return undefined
		if (!user?.pubkey) {
			console.warn(`User or user pubkey not available from signer (${label})`)
			return undefined
		}
		return user.pubkey
	} catch (error) {
		console.error('Error getting user from signer:', error)
		return undefined
	}
}

/** Load the user's kind-10002 relay list so the outbox model can use their preferred relays. */
export async function loadRelaysFromNostr(lease: SignerServiceLease): Promise<void> {
	if (!ndkStore.state.ndk || !isCurrentSignerService(lease)) return
	const pubkey = await leaseUserPubkey(lease, 'relay list')
	if (!pubkey) return

	try {
		const relayPrefs = await fetchUserRelayListWithPreferences(pubkey)
		if (!isCurrentSignerService(lease)) return
		if (relayPrefs && relayPrefs.length > 0) {
			console.log(`📡 Loading ${relayPrefs.length} relays from user's Nostr relay list`)
			for (const relay of relayPrefs) ndkActions.addSingleRelay(relay.url)
		} else {
			console.log('📡 No relay list found on Nostr for user')
		}
	} catch (error) {
		console.error('Failed to load relays from Nostr:', error)
	}
}

/** Pick the NWC wallet with the highest balance as the active one. */
export async function selectAndSetInitialNwcWallet(lease: SignerServiceLease): Promise<void> {
	if (!ndkStore.state.ndk || !isCurrentSignerService(lease)) return
	const userPubkey = await leaseUserPubkey(lease, 'NWC selection')
	if (!userPubkey) return

	beginNwcLoading(lease)
	await walletActions.initialize()
	if (!isCurrentSignerService(lease)) {
		// walletActions.initialize owns a generic loading flag. If an older lease
		// resolves after a newer one began, restore the newer lease's indicator.
		syncNwcLoadingState()
		return
	}

	try {
		const nostrWallets = await fetchUserNwcWallets(userPubkey)
		if (!isCurrentSignerService(lease)) return
		if (nostrWallets && nostrWallets.length > 0) walletActions.setNostrWallets(nostrWallets as Wallet[])
	} catch (error) {
		if (!isCurrentSignerService(lease)) return
		console.error('Failed to fetch or merge Nostr NWC wallets during initial setup:', error)
	}

	if (!isCurrentSignerService(lease)) return
	const allWallets = walletActions.getWallets()
	if (allWallets.length === 0) {
		ndkActions.setActiveNwcWalletUri(null)
		finishNwcLoading(lease)
		return
	}

	const walletsWithBalances = await Promise.all(
		allWallets
			.filter((wallet) => wallet.nwcUri)
			.map(async (wallet) => {
				try {
					const balanceInfo = await fetchNwcWalletBalance(wallet.nwcUri)
					return { ...wallet, balance: balanceInfo?.balance ?? -1 }
				} catch (error) {
					console.error(`Failed to fetch balance for wallet ${wallet.name} (ID: ${wallet.id}):`, error)
					return { ...wallet, balance: -1 }
				}
			}),
	)
	if (!isCurrentSignerService(lease)) return

	let highestBalance = -1
	let bestWallet: (Wallet & { balance: number }) | null = null
	for (const wallet of walletsWithBalances) {
		if (wallet.balance > highestBalance) {
			highestBalance = wallet.balance
			bestWallet = wallet
		}
	}

	ndkActions.setActiveNwcWalletUri(bestWallet?.nwcUri ?? null)
	finishNwcLoading(lease)
}

/** Clear signer-scoped NWC and NIP-60 state when the signer is removed. */
export function resetSignerServices(): void {
	activeNwcLoadingLease = undefined
	syncNwcLoadingState()
	nip60Actions.reset()
}

configureSignerServices({
	loadRelaysFromNostr,
	selectAndSetInitialNwcWallet,
	initializeWallet: (pubkey, isCurrent) => nip60Actions.initialize(pubkey, isCurrent),
	reset: resetSignerServices,
})
