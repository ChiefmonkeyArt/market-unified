/**
 * Minimal, spec-shaped BOLT11 encoder for e2e mocks.
 *
 * The app decodes every invoice it is handed (`@getalby/lightning-tools`
 * `Invoice`), so mocks must return real, signed BOLT11 strings rather than
 * placeholders. Only the fields the app reads are emitted: timestamp, payment
 * hash (p), payment secret (s), description (d) and expiry (x), signed with a
 * fixed test node key. These invoices are never payable on a real network.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import { bech32 } from '@scure/base'

// Fixed test node key; not a secret.
const NODE_SK = hexToBytes('e2e3333333333333333333333333333333333333333333333333333333333333')

/** Big-endian base32 words for an unsigned integer, at least `minWords` long. */
function intToWords(value: number, minWords = 1): number[] {
	const words: number[] = []
	let v = value
	while (v > 0) {
		words.unshift(v & 31)
		v = Math.floor(v / 32)
	}
	while (words.length < minWords) words.unshift(0)
	return words
}

function taggedField(type: number, words: number[]): number[] {
	return [type, ...intToWords(words.length, 2), ...words]
}

/** Amount suffix for the human-readable part (BOLT11 multipliers). */
function amountHrp(amountMsat: number): string {
	if (amountMsat % 100_000_000_000 === 0) return `${amountMsat / 100_000_000_000}`
	if (amountMsat % 100_000_000 === 0) return `${amountMsat / 100_000_000}m`
	if (amountMsat % 100_000 === 0) return `${amountMsat / 100_000}u`
	if (amountMsat % 100 === 0) return `${amountMsat / 100}n`
	return `${amountMsat * 10}p`
}

export type MockBolt11 = { bolt11: string; paymentHash: string; preimage: string }

export function encodeMockBolt11(input: {
	amountMsat: number
	description: string
	expirySeconds?: number
	timestamp?: number
}): MockBolt11 {
	const preimage = randomBytes(32)
	const paymentHash = sha256(preimage)
	const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000)
	const hrp = `lnbc${amountHrp(input.amountMsat)}`

	const data: number[] = [
		...intToWords(timestamp, 7),
		...taggedField(1, bech32.toWords(paymentHash)),
		...taggedField(16, bech32.toWords(randomBytes(32))),
		...taggedField(13, bech32.toWords(new TextEncoder().encode(input.description))),
		...taggedField(6, intToWords(input.expirySeconds ?? 3600)),
	]

	// Signature covers hrp bytes || data words packed to bytes (zero-padded).
	const message = new Uint8Array([...new TextEncoder().encode(hrp), ...packWords(data)])
	const sig = secp256k1.sign(sha256(message), NODE_SK, { prehash: false, format: 'recovered' })
	// noble 'recovered' format is recovery byte first; BOLT11 wants r||s||recovery.
	const signature = new Uint8Array([...sig.slice(1), sig[0]])

	const words = [...data, ...bech32.toWords(signature)]
	return { bolt11: bech32.encode(hrp, words, false), paymentHash: bytesToHex(paymentHash), preimage: bytesToHex(preimage) }
}

/** Packs 5-bit words into bytes, zero-padding the final byte. */
function packWords(words: number[]): Uint8Array {
	const out: number[] = []
	let acc = 0
	let bits = 0
	for (const w of words) {
		acc = (acc << 5) | w
		bits += 5
		while (bits >= 8) {
			bits -= 8
			out.push((acc >> bits) & 0xff)
		}
	}
	if (bits > 0) out.push((acc << (8 - bits)) & 0xff)
	return new Uint8Array(out)
}
