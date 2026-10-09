/** @deprecated Import NIP-17 order publishing from `@sdk/commerce/messaging`. */
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import {
	publishNip17OrderMessage as sdkPublishNip17OrderMessage,
	type OrderMessageRumor,
	type PublishNip17GiftWrapParams,
	type PublishNip17GiftWrapResult,
} from '@sdk/commerce/messaging'
import type { Nip17DmRelayListEvent, Nip17RelayTargetsResult } from '@sdk/core'
import { toEncryptingSigner } from '../nostr/ndkEncryptingSigner'

export type { Nip17OrderPublishTarget, PublishNip17GiftWrapParams, PublishNip17GiftWrapResult } from '@sdk/commerce/messaging'

export type PublishNip17OrderMessageParams = {
	rumor: OrderMessageRumor
	signer: NDKSigner
	recipientPubkey: string
	recipientRelayEvents: Nip17DmRelayListEvent[]
	senderRelayEvents: Nip17DmRelayListEvent[]
	publishGiftWrap: (params: PublishNip17GiftWrapParams) => Promise<PublishNip17GiftWrapResult>
}

export type PublishNip17OrderMessageResult = {
	rumorId: string
	recipientGiftWrapId: string
	senderGiftWrapId: string
	relayTargets: Nip17RelayTargetsResult
}

export async function publishNip17OrderMessage(params: PublishNip17OrderMessageParams): Promise<PublishNip17OrderMessageResult> {
	return sdkPublishNip17OrderMessage({
		...params,
		signer: toEncryptingSigner(params.signer),
	})
}
