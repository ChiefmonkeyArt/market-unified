/**
 * Dev wallet panel helper: bid on a seeded auction with test ecash.
 *
 * Lives outside `stores/nip60.ts` so the wallet store does not import the
 * auction publish layer (that lazy import closed the nip60 <-> publish/auctions
 * runtime cycle). Gated on `isNip60WalletDevModeEnabled()`.
 */
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { ndkActions } from '@/lib/stores/ndk'
import {
	getAuctionSettlementGraceSeconds,
	getBalancesFromState,
	isNip60WalletDevModeEnabled,
	nip60Actions,
	nip60Store,
	type Nip60DevAuctionBidResult,
} from '@/lib/stores/nip60'
import { publishAuctionBid } from '@/publish/auctions'

const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]

const getFirstTagValue = (event: { tags: string[][] }, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

const parseNonNegativeInt = (value: string, fallback: number = 0): number => {
	const parsed = parseInt(value, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * Dev-only helper: pick a live seeded auction on the user's relays,
 * top up the wallet with test ecash if needed, and publish a bid via
 * the bidder-held-path flow. Restored in Phase 3 — delegates the
 * heavy lifting to `publishAuctionBid` so this helper stays a thin
 * UX wrapper rather than reimplementing the bid pipeline.
 */
export async function placeDevBidOnSeededAuction(params?: {
	preferredBidAmount?: number
	preferredMintUrl?: string
}): Promise<Nip60DevAuctionBidResult> {
	if (!isNip60WalletDevModeEnabled()) {
		throw new Error('Dev wallet actions are disabled in this environment')
	}

	const wallet = nip60Store.state.wallet
	if (!wallet || nip60Store.state.status !== 'ready') {
		throw new Error('NIP-60 wallet not ready')
	}

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available')
	const bidder = await signer.user()

	// Find a live auction. We pull recent kind-30408 events and
	// filter to ones that (a) we're not the seller of and (b) still
	// have time on the clock.
	const now = Math.floor(Date.now() / 1000)
	const auctions = Array.from(await ndkActions.fetchEventsWithTimeout({ kinds: [AUCTION_KIND], limit: 100 }, { timeoutMs: 5000 }))
	const candidates = auctions.filter((auction) => {
		if (auction.pubkey === bidder.pubkey) return false
		const endAt = parseNonNegativeInt(getFirstTagValue(auction, 'end_at'), 0)
		const maxEndAt = parseNonNegativeInt(getFirstTagValue(auction, 'max_end_at'), 0) || endAt
		if (!endAt || maxEndAt <= now) return false
		const startAt = parseNonNegativeInt(getFirstTagValue(auction, 'start_at'), 0)
		if (startAt && startAt > now) return false
		return true
	})
	if (!candidates.length) throw new Error('No live seeded auction available to bid on')
	const selected = candidates[Math.floor(Math.random() * candidates.length)]

	// Pull the auction fields the publish flow needs.
	const dTag = getFirstTagValue(selected, 'd')
	const auctionCoordinates = dTag ? `${AUCTION_KIND}:${selected.pubkey}:${dTag}` : ''
	if (!auctionCoordinates) throw new Error('Selected auction has no `d` tag')
	const p2pkXpub = getFirstTagValue(selected, 'p2pk_xpub')
	if (!p2pkXpub) throw new Error('Selected auction is missing p2pk_xpub')
	const startAt = parseNonNegativeInt(getFirstTagValue(selected, 'start_at'), 0)
	const endAt = parseNonNegativeInt(getFirstTagValue(selected, 'end_at'), 0)
	const maxEndAt = parseNonNegativeInt(getFirstTagValue(selected, 'max_end_at'), 0) || endAt
	const settlementGraceSeconds =
		parseNonNegativeInt(getFirstTagValue(selected, 'settlement_grace'), 0) || getAuctionSettlementGraceSeconds()
	const startingBid = parseNonNegativeInt(getFirstTagValue(selected, 'starting_bid'), 0)
	const bidIncrement = parseNonNegativeInt(getFirstTagValue(selected, 'bid_increment'), 0) || 100
	const trustedMints = selected.tags.filter((tag) => tag[0] === 'mint' && tag[1]).map((tag) => tag[1])

	// Decide the bid amount: caller's preference, or a minimum
	// increment over the current top bid.
	const existingBids = Array.from(
		await ndkActions.fetchEventsWithTimeout({ kinds: [AUCTION_BID_KIND], '#e': [selected.id], limit: 200 }, { timeoutMs: 5000 }),
	)
	const currentTop = existingBids.reduce((max, bid) => {
		const amount = parseNonNegativeInt(getFirstTagValue(bid, 'amount'), 0)
		return amount > max ? amount : max
	}, 0)
	const minBid = currentTop > 0 ? currentTop + bidIncrement : startingBid
	const preferred = params?.preferredBidAmount ? Math.floor(params.preferredBidAmount) : minBid
	const bidAmount = Math.max(minBid, Number.isFinite(preferred) && preferred > 0 ? preferred : minBid)

	// Top up the wallet at the chosen mint if it can't cover the
	// bid. mintTestEcash works against the public testnut mints
	// only — that's a dev-only assumption, fine here.
	const mintForLock = params?.preferredMintUrl?.trim() || trustedMints[0]
	if (!mintForLock) throw new Error('Selected auction has no trusted mint')
	const { mintBalances } = getBalancesFromState(wallet)
	const balanceAtMint = mintBalances[mintForLock] ?? 0
	if (balanceAtMint < bidAmount) {
		const topUpAmount = bidAmount - balanceAtMint + 1000 // small safety buffer for fees / future bids
		await nip60Actions.mintTestEcash(topUpAmount, mintForLock)
	}

	type AuctionBidFormData = Parameters<typeof publishAuctionBid>[0]
	const formData: AuctionBidFormData = {
		auctionEventId: selected.id,
		auctionCoordinates,
		amount: bidAmount,
		auctionStartAt: startAt,
		auctionEffectiveEndAt: maxEndAt,
		auctionLocktimeAt: maxEndAt,
		settlementGraceSeconds,
		sellerPubkey: selected.pubkey,
		p2pkXpub,
		mintCandidates: trustedMints.length ? trustedMints : [mintForLock],
	}

	const bidEventId = await publishAuctionBid(formData)

	return {
		bidEventId,
		auctionEventId: selected.id,
		auctionCoordinates,
		auctionTitle: getFirstTagValue(selected, 'title') || 'untitled',
		mintUrl: mintForLock,
		bidAmount,
		minBid,
		topUpAmount: Math.max(0, bidAmount - balanceAtMint),
	}
}
