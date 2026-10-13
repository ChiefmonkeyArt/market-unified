import { describe, expect, test } from 'bun:test'
import { nextReplaceableCreatedAt } from './replaceable'

describe('nextReplaceableCreatedAt', () => {
	test('uses now when the previous version is older', () => {
		expect(nextReplaceableCreatedAt(100, 200)).toBe(200)
	})
	test('is strictly newer than a same-second previous version', () => {
		expect(nextReplaceableCreatedAt(200, 200)).toBe(201)
	})
	test('stays ahead of a previous version stamped slightly ahead of this clock', () => {
		expect(nextReplaceableCreatedAt(205, 200)).toBe(206)
	})
	test('uses now when there is no previous version', () => {
		expect(nextReplaceableCreatedAt(null, 200)).toBe(200)
		expect(nextReplaceableCreatedAt(undefined, 200)).toBe(200)
		expect(nextReplaceableCreatedAt(Number.NaN, 200)).toBe(200)
	})
})
