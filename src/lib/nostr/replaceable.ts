/**
 * created_at for a new version of a replaceable / addressable event.
 *
 * NIP-01 keeps the newest version and breaks a same-second tie by the lowest
 * id, so two edits within one second (add then remove) can leave the OLDER
 * content in force. A replacement must therefore be strictly newer than the
 * version it was computed from. Usually that is just "now"; after a same-second
 * edit it is one second past the previous version.
 */
export function nextReplaceableCreatedAt(previousCreatedAt: number | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): number {
	const previous = typeof previousCreatedAt === 'number' && Number.isFinite(previousCreatedAt) ? previousCreatedAt : 0
	return Math.max(nowSeconds, previous + 1)
}
