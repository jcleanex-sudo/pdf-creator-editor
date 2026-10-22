import { useEffect, useMemo, useState } from 'react'
import { calculateTotal, formatAmount, parseAmount, type CalculationRule } from '../pdf/calculation'
import { editRestriction } from '../pdf/safety'
import type { Edits, PageModel, TextRegion } from '../pdf/types'

type Props = {
  model: PageModel
  rule: CalculationRule | null
  edits: Edits
  busy: boolean
  onApply: (rule: CalculationRule) => void
  onDisable: () => void
  onShowPage: (index: number) => void
}

export function CalculationPanel({ model, rule, edits, busy, onApply, onDisable, onShowPage }: Props) {
  const pageIndex = model.regions[0]?.pageIndex
  const samePage = !rule || rule.target.pageIndex === pageIndex
  const [target, setTarget] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [rate, setRate] = useState('0')
  useEffect(() => {
    setTarget(samePage ? rule?.target.id ?? '' : '')
    setSources(samePage ? rule?.sources.map(region => region.id) ?? [] : [])
    setRate(samePage ? String(rule?.taxPercent ?? 0) : '0')
  }, [rule, samePage, model])
  const candidates = useMemo(() => model.regions.filter(region => {
    try { parseAmount(edits[region.id]?.text ?? region.text) } catch { return false }
    return !editRestriction(region, model)
  }), [model, edits])
  const label = (region: TextRegion) => {
    const rowLabel = model.regions.find(other => other.id !== region.id && other.x < region.x &&
      Math.abs(other.baseline - region.baseline) < 3 && /[^\d\s,.¥￥]/u.test(other.text))
    return `${rowLabel ? `${rowLabel.text}：` : ''}${edits[region.id]?.text ?? region.text}`
  }
  const output = candidates.find(region => region.id === target)
  const proposal = output ? { target: output, sources: candidates.filter(region => sources.includes(region.id)), taxPercent: rate.trim() ? Number(rate) : NaN } : null
  let summary = ''
  try {
    if (proposal) {
      const result = calculateTotal(proposal, edits)
      summary = `${formatAmount(result.subtotal)}円 ＋ 税 ${formatAmount(result.tax)}円 ＝ ${formatAmount(result.total)}円`
    }
  } catch { /* The apply handler reports invalid settings without changing the PDF. */ }

  return <details className="calculation-panel">
    <summary>合計の自動計算 <span>{rule ? `有効・税率${rule.taxPercent}%` : '設定する'}</span></summary>
    {!samePage && rule ? <div className="calculation-fields"><p>{rule.target.pageIndex + 1}ページの合計を自動計算しています。</p><button type="button" className="button secondary" disabled={busy} onClick={() => onShowPage(rule.target.pageIndex)}>設定ページへ移動</button></div> :
      <div className="calculation-fields">
        <p>明細金額を足し、消費税を加えます。数量は掛けません。税の1円未満は切り捨てます。</p>
        <label className="field-label" htmlFor="calculation-target">合計を書き込む欄</label>
        <select id="calculation-target" disabled={busy} value={target} onChange={event => {
          setTarget(event.target.value); setSources(values => values.filter(id => id !== event.target.value))
        }}><option value="">合計欄を選択</option>{candidates.map(region => <option key={region.id} value={region.id}>{label(region)}</option>)}</select>
        <fieldset disabled={busy}><legend>合計に含める明細金額</legend><div className="calculation-sources">
          {candidates.filter(region => region.id !== target).map(region => <label key={region.id}>
            <input type="checkbox" checked={sources.includes(region.id)} onChange={event => setSources(values => event.target.checked ? [...values, region.id] : values.filter(id => id !== region.id))}/>
            <span>{label(region)}</span>
          </label>)}
          {!candidates.length && <p>編集できる数値がありません。</p>}
        </div></fieldset>
        <label className="field-label" htmlFor="calculation-tax">消費税率（%）</label>
        <input id="calculation-tax" type="number" min="0" max="100" step="0.01" value={rate} disabled={busy} onChange={event => setRate(event.target.value)}/>
        {summary && <output className="calculation-summary">{summary}</output>}
        <button type="button" className="button secondary" disabled={busy || !proposal || !sources.length} onClick={() => proposal && onApply(proposal)}>計算設定を適用</button>
        {rule && <button type="button" className="text-button" disabled={busy} onClick={onDisable}>自動計算を解除</button>}
        <p>合計欄は白く覆って更新します。設定はこのタブ内で保持し、PDFには計算結果を保存します。</p>
      </div>}
  </details>
}
