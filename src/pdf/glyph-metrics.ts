import fontkit, { type Font } from '@pdf-lib/fontkit'
import type { PDFFont } from 'pdf-lib'

const sources = new WeakMap<PDFFont, Uint8Array>()
const parsed = new WeakMap<Uint8Array, Font>()
export function registerGlyphMetrics(font: PDFFont, bytes: Uint8Array) {
  sources.set(font, bytes)
  return font
}

export function glyphMetrics(font: PDFFont, text: string) {
  const bytes = sources.get(font)
  if (!bytes) return
  let source = parsed.get(bytes)
  if (!source) { source = fontkit.create(bytes); parsed.set(bytes, source) }
  const unit = source.unitsPerEm
  let pen = 0, left = Infinity, right = -Infinity, top = 0, bottom = 0
  // Match pdf-lib's emitted glyph sequence and advance widths. It does not
  // emit fontkit's optional positioning offsets in its single Tj operation.
  for (const glyph of source.layout(text).glyphs) {
    const box = glyph.bbox
    if (box.maxX > box.minX && box.maxY > box.minY) {
      left = Math.min(left, pen + box.minX); right = Math.max(right, pen + box.maxX)
      top = Math.max(top, box.maxY); bottom = Math.min(bottom, box.minY)
    }
    pen += glyph.advanceWidth
  }
  return { left: Number.isFinite(left) ? left / unit : 0,
    right: Number.isFinite(right) ? right / unit : 0, ascent: top / unit, descent: -bottom / unit }
}
