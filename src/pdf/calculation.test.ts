import { describe, expect, it } from 'vitest'
import { calculateTotal, parseAmount, recalculate, type CalculationRule } from './calculation'
import type { Edits, TextRegion } from './types'

function region(id: string, text: string, pageIndex = 0): TextRegion {
  return { id, text, pageIndex, x: 50, baseline: 100, width: 60, fontSize: 12,
    rect: { x: 49, y: 95, width: 62, height: 20 }, screen: { x: 49, y: 100, width: 62, height: 20 } }
}
const first = region('0:1', '150,000'), second = region('0:2', '30,000'), target = region('0:3', '198,000')
const rule: CalculationRule = { sources: [first, second], target, taxPercent: 10 }
const edit = (source: TextRegion, text: string) => ({ region: source, text, fontSize: 12, color: '#202733', align: 'left' as const })

describe('money and tax calculation', () => {
  it('updates the sample total to 209,000 after a 160,000 line amount', () => {
    const edits = { [first.id]: edit(first, '160000') }
    expect(calculateTotal(rule, edits)).toEqual({ subtotal: 190000n, tax: 19000n, total: 209000n })
    const result = recalculate(edits, rule)
    expect(result[target.id].text).toBe('209,000')
    expect(Object.keys(edits)).toEqual([first.id])
    expect(first.text).toBe('150,000')
  })
  it('rounds tax down once on the subtotal using exact decimal rates', () => {
    const current = { ...rule, sources: [region('0:1', '101'), region('0:2', '109')] }
    expect(calculateTotal(current, {}).total).toBe(231n)
    expect(calculateTotal({ ...current, sources: [region('0:1', '1,001')], taxPercent: 8.25 }, {})).toEqual({ subtotal: 1001n, tax: 82n, total: 1083n })
    expect(calculateTotal({ ...rule, taxPercent: 0 }, {}).total).toBe(180000n)
  })
  it('accepts yen notation and full-width digits without floating point conversion', () => {
    expect(parseAmount('￥１６０，０００')).toBe(160000n)
    expect(parseAmount('160,000円')).toBe(160000n)
    expect(parseAmount('0')).toBe(0n)
  })
  it('rejects malformed, negative, fractional and excessive amounts', () => {
    for (const value of ['', '-1', '12,34', '01', '1.5', '1e6', 'NaN', '1\n2', '9007199254740992'])
      expect(() => parseAmount(value)).toThrow()
    expect(() => calculateTotal(rule, { [first.id]: edit(first, 'invalid') })).toThrow('整数')
    expect(() => calculateTotal({ ...rule, sources: [region('0:1', '9007199254740991')] }, {})).toThrow('上限')
  })
  it('rejects self references, duplicate sources, mixed pages and invalid rates', () => {
    const invalid: CalculationRule[] = [
      { ...rule, sources: [] }, { ...rule, sources: [first, first] }, { ...rule, sources: [target] },
      { ...rule, sources: [region('1:1', '100', 1)] },
      ...[-1, 101, NaN, 8.001, 8.000000001].map(taxPercent => ({ ...rule, taxPercent })),
    ]
    for (const value of invalid) expect(() => calculateTotal(value, {})).toThrow()
  })
  it('preserves existing total formatting while replacing its calculated value', () => {
    const edits: Edits = { [target.id]: { ...edit(target, '198,000'), color: '#ff0000', fontSize: 18, align: 'center' } }
    const result = recalculate({ ...edits, [first.id]: edit(first, '160,000') }, rule)
    expect(result[target.id]).toMatchObject({ text: '209,000', color: '#ff0000', fontSize: 18, align: 'center' })
    expect(edits[target.id].text).toBe('198,000')
  })
})
