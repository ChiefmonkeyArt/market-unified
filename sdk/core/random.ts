/**
 * Cryptographically secure identifiers. There is deliberately no Math.random fallback:
 * where WebCrypto is missing this throws, because a predictable nonce or pairing secret
 * is worse than a visible failure. (Every path that uses these already needs WebCrypto
 * for signing or Cashu blinding, so a throw here never strands a half-finished action.)
 */
export function secureRandomHex(bytes = 16): string {
	const c = globalThis.crypto
	if (!c?.getRandomValues) throw new Error('Secure randomness (WebCrypto) is unavailable')
	const buf = new Uint8Array(bytes)
	c.getRandomValues(buf)
	return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function secureRandomUUID(): string {
	const c = globalThis.crypto
	if (c?.randomUUID) return c.randomUUID()
	const h = secureRandomHex(16)
	// RFC 4122 v4 layout
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}
