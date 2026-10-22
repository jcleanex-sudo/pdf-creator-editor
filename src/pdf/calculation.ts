import type { Edits, PageModel, Replacement, TextRegion } from './types'
import { editRestriction } from './safety'
import { originalColor } from './appearance'

export const SAMPLE_TEMPLATE = 'estimate-v1'
export type CalculationRule = { sources: TextRegion[]; target: TextRegion; taxPercent: number }
const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER)

export function parseAmount(text: string): bigint {
  const value = text.normalize('NFKC').trim().replace(/^[¥￥]\s*/, '').replace(/\s*円$/, '')
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value))
    throw new Error('自動計算の明細金額は、0以上の整数で入力してください。例：160,000')
  const amount = BigInt(value.replaceAll(',', ''))
  if (amount > MAX_AMOUNT) throw new Error('自動計算できる金額の上限を超えています。')
  return amount
}

export function formatAmount(value: bigint) { return value.toLocaleString('ja-JP') }

export function calculateTotal(rule: CalculationRule, edits: Edits) {
  if (!rule.sources.length || rule.sources.length > 100 ||
      new Set(rule.sources.map(source => source.id)).size !== rule.sources.length ||
      rule.sources.some(source => source.id === rule.target.id || source.pageIndex !== rule.target.pageIndex))
    throw new Error('同じページの明細金額と、別の合計欄を指定してください。明細は100件までです。')
  const rate = Math.round(rule.taxPercent * 100)
  if (!Number.isFinite(rule.taxPercent) || rule.taxPercent < 0 || rule.taxPercent > 100 ||
      rule.taxPercent !== Number(rule.taxPercent.toFixed(2)))
    throw new Error('税率は0〜100%の範囲で、小数第2位まで入力してください。')
  const subtotal = rule.sources.reduce((sum, source) => sum + parseAmount(edits[source.id]?.text ?? source.text), 0n)
  // Integer arithmetic avoids floating point rounding of currency. Tax is
  // calculated once on the subtotal and rounded down to whole yen.
  const tax = subtotal * BigInt(rate) / 10_000n
  const total = subtotal + tax
  if (total > MAX_AMOUNT) throw new Error('自動計算できる合計金額の上限を超えています。')
  return { subtotal, tax, total }
}

export function recalculate(edits: Edits, rule: CalculationRule): Edits {
  const { total } = calculateTotal(rule, edits)
  const previous: Replacement = edits[rule.target.id] ?? {
    region: rule.target, text: rule.target.text, fontSize: rule.target.fontSize, color: originalColor(rule.target), align: 'right',
  }
  return { ...edits, [rule.target.id]: { ...previous, text: formatAmount(total) } }
}

export function sampleCalculation(page: PageModel): CalculationRule | null {
  const find = (x: number, baseline: number, text: string) => page.regions.find(region =>
    region.pageIndex === 0 && Math.abs(region.x - x) < 0.05 && Math.abs(region.baseline - baseline) < 0.05 && region.text === text)
  const first = find(450, 502, '150,000'), second = find(457, 456, '30,000'), target = find(432, 380, '198,000')
  // A saved overlay PDF can contain old and new text at the same position.
  // Do not infer a rule from hidden original values in such a document.
  if (!first || !second || !target || [first, second, target].some(region => editRestriction(region, page))) return null
  return { sources: [first, second], target, taxPercent: 10 }
}
