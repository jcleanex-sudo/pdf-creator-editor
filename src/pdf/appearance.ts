import { StandardFonts } from 'pdf-lib'
import type { TextRegion } from './types'

export type OriginalAppearance = {
  fontName: string
  standardFont?: StandardFonts
  bold: boolean
  italic: boolean
  color?: string
  warning?: string
}
export const originalColor = (region: TextRegion) => region.appearance?.color ?? '#202733'
export const originalAlign = (region: TextRegion): 'left' | 'right' =>
  /^[¥￥]?\s*\d[\d,]*(?:\s*円)?$/u.test(region.text.normalize('NFKC').trim()) ? 'right' : 'left'

export function fontAppearance(name: string, bold = false, italic = false): OriginalAppearance {
  const clean = name.replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, '')
  bold ||= /bold|black|heavy|demi/i.test(clean)
  italic ||= /italic|oblique|slanted/i.test(clean)
  const exact = Object.values(StandardFonts).find(font => font === clean && !['Symbol', 'ZapfDingbats'].includes(font))
  let standardFont = exact
  if (!standardFont) {
    if (/helvetica|arial|liberationsans/i.test(clean)) standardFont = bold ? italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica
    else if (/times|liberationserif/i.test(clean)) standardFont = bold ? italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
    else if (/courier|liberationmono/i.test(clean)) standardFont = bold ? italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
  }
  return { fontName: clean || '不明', standardFont, bold, italic,
    warning: exact ? undefined : standardFont ? '元に近い標準書体を使用します。' : '同梱の日本語書体で近づけます。元の書体と完全には一致しません。' }
}

type PaintState = { font: string; color?: string; alpha: number; mode: number }
type PaintSpan = PaintState & { text: string }
type Operator = { name: string; args: unknown[] | null }
const normalize = (text: string) => text.normalize('NFKC').replace(/\s/g, '')

// PDF.js exposes drawing colors in its operator list. Keep the graphics-state
// stack and consume the same text order as getTextContent, rather than guessing
// foreground colors from antialiased screen pixels.
export function textPaints(operators: Operator[]) {
  let state: PaintState = { font: '', color: '#000000', alpha: 1, mode: 0 }
  const stack: PaintState[] = [], spans: PaintSpan[] = []
  let annotations = 0
  for (const { name, args } of operators) {
    if (['save', 'paintFormXObjectBegin', 'beginGroup', 'beginAnnotation'].includes(name)) {
      stack.push({ ...state }); if (name === 'beginAnnotation') annotations++
    }
    else if (['restore', 'paintFormXObjectEnd', 'endGroup', 'endAnnotation'].includes(name)) {
      state = stack.pop() ?? { font: '', color: '#000000', alpha: 1, mode: 0 }
      if (name === 'endAnnotation') annotations--
    }
    else if (name === 'setFont') state.font = String(args?.[0] ?? '')
    else if (name === 'setFillRGBColor') state.color = typeof args?.[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0]) ? args[0].toLowerCase() : undefined
    else if (name === 'setFillColorN' || name === 'setFillTransparent') state.color = undefined
    else if (name === 'setTextRenderingMode') state.mode = Number(args?.[0])
    else if (name === 'setGState' && Array.isArray(args?.[0])) {
      for (const [key, value] of args[0] as [string, unknown][]) {
        if (key === 'Font' && Array.isArray(value)) state.font = String(value[0])
        if (key === 'ca') state.alpha = Number(value)
      }
    }
    else if (!annotations && ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(name)) {
      const glyphs = args?.findLast(Array.isArray) as unknown[] | undefined
      const text = normalize((glyphs ?? []).map(glyph => glyph && typeof glyph === 'object' && 'unicode' in glyph ? String(glyph.unicode) : '').join(''))
      if (text) spans.push({ ...state, text })
    }
  }
  return new PaintCursor(spans)
}

class PaintCursor {
  private index = 0
  private offset = 0
  constructor(private spans: PaintSpan[]) {}
  next(text: string, font: string): { color?: string; unsafe?: string; warning?: string } {
    const expected = normalize(text)
    const matches: { index: number; offset: number; spans: PaintSpan[] }[] = []
    for (let start = this.index; start < Math.min(this.spans.length, this.index + 32); start++) {
      let rest = expected, offset = start === this.index ? this.offset : 0
      const parts: PaintSpan[] = []
      for (let index = start; index < this.spans.length && parts.length < 32; index++) {
        const span = this.spans[index], available = span.text.slice(offset)
        if (span.font !== font) break
        const length = Math.min(rest.length, available.length)
        if (rest.slice(0, length) !== available.slice(0, length)) break
        parts.push(span); rest = rest.slice(length)
        if (!rest) {
          const consumed = offset + length
          matches.push({ index: consumed === span.text.length ? index + 1 : index, offset: consumed === span.text.length ? 0 : consumed, spans: parts })
          break
        }
        offset = 0
      }
      // A direct sequential match is unambiguous. When skipping unrepresented
      // operators, accept only a unique match within the bounded lookahead.
      if (start === this.index && matches.length) break
    }
    if (matches.length !== 1) return { warning: '元の文字色を特定できません。文字色を確認してください。' }
    const match = matches[0]; this.index = match.index; this.offset = match.offset
    const colors = new Set(match.spans.map(span => span.color))
    if (match.spans.some(span => span.mode >= 4))
      return { unsafe: '文字の切り抜きを使ったPDFは、背景を保護するため編集できません。' }
    if (match.spans.some(span => span.alpha !== 1 || span.mode !== 0) || colors.size !== 1 || colors.has(undefined))
      return { unsafe: '複数色・透明・輪郭などの特殊な文字描画は、元の見た目を保つため編集できません。' }
    return { color: match.spans[0].color }
  }
}
