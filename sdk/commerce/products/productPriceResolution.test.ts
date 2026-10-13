import { describe, expect, test } from 'bun:test'
import { deriveFiatPriceFromSats, getSellerProductTabValidationIssues } from './index'

const satsToUsd = (sats: number) => sats * 0.000837
const base = { currencyMode: 'fiat' as const, fiatPrice: '', price: '10000', currency: 'USD', hasExchangeRates: true }

describe('deriveFiatPriceFromSats', () => {
	test('fills the fiat price when sats were typed before rates loaded', () => {
		expect(deriveFiatPriceFromSats(base, satsToUsd)).toBe('8.37')
	})

	test('the derived price unblocks fiat-mode detail validation', () => {
		const state = {
			...base,
			bitcoinUnit: 'SATS' as const,
			name: 'n',
			description: 'd',
			quantity: '5',
			mainCategory: null,
			images: [],
			shippings: [],
		}
		expect(getSellerProductTabValidationIssues(state, 'detail')).toEqual(['Valid product price is required'])
		const fiatPrice = deriveFiatPriceFromSats(base, satsToUsd)!
		expect(getSellerProductTabValidationIssues({ ...state, fiatPrice }, 'detail')).toEqual([])
	})

	test('never overwrites a fiat price the seller entered', () => {
		expect(deriveFiatPriceFromSats({ ...base, fiatPrice: '12.00' }, satsToUsd)).toBeNull()
	})

	test('does nothing without rates, outside fiat mode, for bitcoin currencies, or without a sats price', () => {
		expect(deriveFiatPriceFromSats({ ...base, hasExchangeRates: false }, satsToUsd)).toBeNull()
		expect(deriveFiatPriceFromSats({ ...base, currencyMode: 'sats' }, satsToUsd)).toBeNull()
		expect(deriveFiatPriceFromSats({ ...base, currency: 'SATS' }, satsToUsd)).toBeNull()
		expect(deriveFiatPriceFromSats({ ...base, price: '' }, satsToUsd)).toBeNull()
		expect(deriveFiatPriceFromSats({ ...base, price: '0' }, satsToUsd)).toBeNull()
	})

	test('a zero conversion (rates not really usable) yields nothing', () => {
		expect(deriveFiatPriceFromSats(base, () => 0)).toBeNull()
	})
})
