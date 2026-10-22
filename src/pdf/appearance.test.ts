import { describe, expect, it } from 'vitest'
import { StandardFonts } from 'pdf-lib'
import { fontAppearance, textPaints, originalAlign } from './appearance'
import type { TextRegion } from './types'

const op = (name: string, ...args: unknown[]) => ({ name, args })
const glyphs = (text: string) => [...text].map(unicode => ({ unicode }))

describe('original text appearance', () => {
  it('keeps standard fonts and identifies bold Japanese fallback without claiming an exact match', () => {
    expect(fontAppearance('ABCDEF+Times-Bold')).toMatchObject({ standardFont: StandardFonts.TimesRomanBold, bold: true })
    expect(fontAppearance('Arial-BoldItalicMT')).toMatchObject({ standardFont: StandardFonts.HelveticaBoldOblique, bold: true, italic: true })
    expect(fontAppearance('CustomJapanese-Bold')).toMatchObject({ bold: true, warning: expect.stringContaining('完全には一致') })
  })
  it('preserves different colors of repeated text and restores form graphics state', () => {
    const paints = textPaints([
      op('setFont', 'f1', 12), op('setFillRGBColor', '#cc1234'), op('showText', glyphs('100')),
      op('paintFormXObjectBegin'), op('setFillRGBColor', '#1234cc'), op('showText', glyphs('100')),
      op('paintFormXObjectEnd'), op('showText', glyphs('100')),
    ])
    expect(paints.next('100', 'f1').color).toBe('#cc1234')
    expect(paints.next('100', 'f1').color).toBe('#1234cc')
    expect(paints.next('100', 'f1').color).toBe('#cc1234')
  })
  it('matches split drawing operations and normalized ligatures', () => {
    const paints = textPaints([
      op('setFont', 'f1', 12), op('showText', glyphs('ﬁ ')), op('showText', glyphs('le')),
    ])
    expect(paints.next('fi le', 'f1')).toEqual({ color: '#000000' })
  })
  it('refuses flattening mixed colors, transparency or outlined letters', () => {
    const mixed = textPaints([
      op('setFont', 'f1', 12), op('showText', glyphs('12')), op('setFillRGBColor', '#ff0000'), op('showText', glyphs('34')),
    ])
    expect(mixed.next('1234', 'f1').unsafe).toContain('複数色')
    const transparent = textPaints([op('setFont', 'f1', 12), op('setGState', [['ca', 0.5]]), op('showText', glyphs('100'))])
    expect(transparent.next('100', 'f1').unsafe).toContain('透明')
    const outlined = textPaints([op('setFont', 'f1', 12), op('setTextRenderingMode', 1), op('showText', glyphs('100'))])
    expect(outlined.next('100', 'f1').unsafe).toContain('輪郭')
  })
  it('reports an unknown color when the content cannot be matched uniquely', () => {
    const paints = textPaints([op('setFont', 'f1', 12), op('showText', glyphs('different'))])
    expect(paints.next('100', 'f1').warning).toContain('特定できません')
  })
  it('keeps monetary values against the original right edge and ordinary text on the left', () => {
    expect(originalAlign({ text: '１５０，０００円' } as TextRegion)).toBe('right')
    expect(originalAlign({ text: '株式会社サンプル' } as TextRegion)).toBe('left')
  })
})
