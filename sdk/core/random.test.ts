import { describe, expect, test } from 'bun:test'
import { secureRandomHex, secureRandomUUID } from './random'

describe('secure randomness', () => {
	test('hex has requested length and varies', () => {
		const a = secureRandomHex(16)
		expect(a).toMatch(/^[0-9a-f]{32}$/)
		expect(secureRandomHex(16)).not.toBe(a)
	})
	test('uuid is v4 shaped', () => {
		expect(secureRandomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
	})
	test('throws instead of falling back when WebCrypto is missing', () => {
		const original = globalThis.crypto
		Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
		try {
			expect(() => secureRandomHex()).toThrow('WebCrypto')
		} finally {
			Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
		}
	})
})
