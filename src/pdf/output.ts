import { PDFDocument, PDFName, PDFString, StandardFonts, StandardFontEmbedder, concatTransformationMatrix, pushGraphicsState, popGraphicsState, rgb, type PDFFont } from 'pdf-lib'
import { SAMPLE_TEMPLATE, type CalculationRule } from './calculation'
import { storeProject } from './project'
import fontkit from '@pdf-lib/fontkit'
import type { Edits, Replacement } from './types'
import { decodeBase64, portableAssets } from './portable'

const fontPromises = new Map<boolean, Promise<Uint8Array>>()
export function loadJapaneseFont(bold = false) {
  const embedded=portableAssets()
  if(embedded) return Promise.resolve(decodeBase64(bold ? embedded.boldFont : embedded.font))
  let promise = fontPromises.get(bold)
  promise ??= fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-${bold ? 'Bold' : 'Regular'}.ttf`)
    .then(async response => {
      if (!response.ok) throw new Error('日本語フォントを読み込めませんでした。ページを再読み込みしてください。')
      return new Uint8Array(await response.arrayBuffer())
    }).catch(error => { fontPromises.delete(bold); throw error })
  fontPromises.set(bold, promise)
  return promise
}

const charsets = new WeakMap<PDFFont, Set<number>>()
function charset(font: PDFFont) {
  let values = charsets.get(font)
  if (!values) { values = new Set(font.getCharacterSet()); charsets.set(font, values) }
  return values
}
export function createFontResolver(pdf: PDFDocument, regularBytes: Uint8Array, subset = false) {
  pdf.registerFontkit(fontkit)
  const fonts = new Map<string, Promise<PDFFont>>()
  const embed = (key: string, loader: () => Promise<PDFFont>) => {
    if (!fonts.has(key)) fonts.set(key, loader())
    return fonts.get(key)!
  }
  return async (edit: Replacement) => {
    const standard = edit.region.appearance?.standardFont
    if (standard && Object.values(StandardFonts).includes(standard)) {
      const font = await embed(standard, () => pdf.embedFont(standard))
      if ([...edit.text].every(character => charset(font).has(character.codePointAt(0)!))) return font
    }
    return edit.region.appearance?.bold
      ? embed('NotoSansJP-Bold', async () => pdf.embedFont(await loadJapaneseFont(true), { subset }))
      : embed('NotoSansJP-Regular', () => pdf.embedFont(regularBytes, { subset }))
  }
}

const latinEncoding = StandardFontEmbedder.for('Helvetica' as Parameters<typeof StandardFontEmbedder.for>[0]).encoding
export function replacementFontLabel(edit: Replacement) {
  const standard = edit.region.appearance?.standardFont
  if (standard && [...edit.text].every(character => latinEncoding.canEncodeUnicodeCodePoint(character.codePointAt(0)!))) return standard
  return `Noto Sans JP ${edit.region.appearance?.bold ? 'Bold' : 'Regular'}`
}

export function replacementFontWarning(edit: Replacement) {
  const label = replacementFontLabel(edit), appearance = edit.region.appearance
  const fallback = label.startsWith('Noto Sans JP')
  return [appearance?.warning,
    appearance?.standardFont && fallback ? '入力した文字を元の欧文書体で表示できないため、日本語書体を使用します。' : undefined,
    appearance?.italic && fallback ? '元の斜体の形は再現できません。' : undefined,
  ].filter(Boolean).join(' ')
}

export function fitText(font: PDFFont, edit: Replacement) {
  const { text, region } = edit
  if (text.length > 300) throw new Error('変更する文字列は300文字以内にしてください。')
  if (/[\r\n\t\u0000-\u001f\u007f]/u.test(text)) throw new Error('改行・タブ・制御文字は使用できません。')
  if (!Number.isFinite(edit.fontSize) || edit.fontSize < 4 || edit.fontSize > 144) throw new Error('文字サイズは4〜144 ptで指定してください。')
  if (!/^#[0-9a-f]{6}$/iu.test(edit.color)) throw new Error('文字色を正しく指定してください。')
  const unsupported = [...new Set([...text].filter(c => !charset(font).has(c.codePointAt(0)!)))]
  if (unsupported.length) throw new Error(`同梱フォントで保存できない文字があります：${unsupported.slice(0, 8).join(' ')}`)
  // Keep both the width and the glyph ascent/descent inside the original region.
  const ascent = font.heightAtSize(1, { descender: false })
  const fullHeight = font.heightAtSize(1, { descender: true })
  const descent = Math.max(0, fullHeight - ascent)
  const topSpace = region.rect.y + region.rect.height - region.baseline - 0.35
  const bottomSpace = region.baseline - region.rect.y - 0.35
  let size = Math.min(edit.fontSize,
    topSpace / ascent, descent ? bottomSpace / descent : edit.fontSize)
  const naturalWidth = text ? font.widthOfTextAtSize(text, size) : 0
  // Preserve the original point size when possible. Modest horizontal fitting
  // avoids making a same-length numeric replacement noticeably shorter.
  const scaleX = naturalWidth > region.width ? Math.max(0.8, region.width / naturalWidth) : 1
  if (naturalWidth * scaleX > region.width) size *= region.width / (naturalWidth * scaleX)
  if (!Number.isFinite(size) || size < 4) throw new Error('元の領域に収まりません。文字を短くするか、別の領域を選んでください。')
  const fittedWidth = text ? font.widthOfTextAtSize(text, size) * scaleX : 0
  const offset = edit.align === 'right' ? region.width - fittedWidth : edit.align === 'center' ? (region.width - fittedWidth) / 2 : 0
  return { size, x: region.x + offset, width: fittedWidth, scaleX }
}

export async function writePdf(original: Uint8Array, edits: Edits, fontBytes: Uint8Array, calculation: CalculationRule | null = null): Promise<Uint8Array> {
  const entries = Object.values(edits)
  if (!entries.length) return original.slice()
  const pdf = await PDFDocument.load(original)
  // Full embedding avoids reproducible missing glyphs in fontkit's Japanese subsetting.
  // The extra file size is intentional until a verified subset pipeline is available.
  const resolveFont = createFontResolver(pdf, fontBytes)
  const pages = pdf.getPages()
  // Compute every placement before changing the document: failed edits never produce partial output.
  const placements = await Promise.all(entries.map(async edit => {
    const font = await resolveFont(edit)
    return { edit, font, fit: fitText(font, edit) }
  }))
  for (const { edit, font, fit } of placements) {
    const page = pages[edit.region.pageIndex]
    if (!page) throw new Error('編集対象のページが見つかりません。')
    page.drawRectangle({ ...edit.region.rect, color: rgb(1, 1, 1), borderWidth: 0 })
    if (edit.text) {
      const parts = edit.color.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(fit.scaleX, 0, 0, 1, fit.x, edit.region.baseline))
      page.drawText(edit.text, { x: 0, y: 0, size: fit.size, font, color: rgb(parts[0], parts[1], parts[2]) })
      page.pushOperators(popGraphicsState())
    }
  }
  storeProject(pdf, original, edits, calculation)
  return pdf.save()
}

export async function makeSample(fontBytes: Uint8Array) {
  const pdf = await PDFDocument.create()
  pdf.catalog.set(PDFName.of('PDFEditorTemplate'), PDFString.of(SAMPLE_TEMPLATE))
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(fontBytes, { subset: false })
  const page = pdf.addPage([595.28, 841.89])
  const text = (value: string, x: number, y: number, size = 12) => page.drawText(value, { x, y, size, font, color: rgb(0.12, 0.15, 0.20) })
  text('SAMPLE DOCUMENT', 48, 780, 10)
  text('御見積書', 48, 722, 30)
  text('株式会社サンプル 御中', 48, 654, 14)
  text('見積番号：2026-001', 365, 780, 10)
  text('発行日：2026年10月22日', 365, 758, 10)
  text('下記の通り、お見積もり申し上げます。', 48, 608, 11)
  page.drawRectangle({ x: 48, y: 537, width: 499, height: 34, color: rgb(0.93, 0.95, 0.97) })
  text('品名', 62, 548, 11)
  text('数量', 330, 548, 11)
  text('金額', 465, 548, 11)
  text('Webサイト制作', 62, 502, 13)
  text('1', 340, 502, 13)
  text('150,000', 450, 502, 13)
  text('保守・運用サポート', 62, 456, 13)
  text('3', 340, 456, 13)
  text('30,000', 457, 456, 13)
  page.drawLine({ start: { x: 48, y: 430 }, end: { x: 547, y: 430 }, thickness: 0.5, color: rgb(0.8, 0.83, 0.86) })
  text('合計金額（税込）', 290, 380, 12)
  text('198,000', 432, 380, 21)
  text('備考', 48, 276, 12)
  text('有効期限：発行日より30日間', 48, 246, 11)
  text('このサンプルの文字や数字をクリックして編集できます。', 48, 160, 10)
  text('色の付いた表の見出しは、背景保護のため編集できません。', 48, 138, 10)
  text('PDF Creator & Editor  /  Sample', 48, 50, 9)
  const second = pdf.addPage([595.28, 841.89])
  second.drawText('ご利用について', { x: 48, y: 740, size: 24, font })
  second.drawText('PDFの処理はすべて、お使いのブラウザ内で行います。', { x: 48, y: 678, size: 12, font })
  second.drawText('ファイルはサーバーへ送信されません。', { x: 48, y: 646, size: 12, font })
  second.drawText('元の文字を白く覆い、新しい文字を重ねて保存します。', { x: 48, y: 580, size: 12, font })
  second.drawText('機密情報の削除・墨消しには使用しないでください。', { x: 48, y: 548, size: 12, font })
  return pdf.save()
}
