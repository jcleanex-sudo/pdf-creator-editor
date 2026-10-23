import { PDFDocument, PDFName, PDFString, StandardFonts, StandardFontEmbedder, concatTransformationMatrix, pushGraphicsState, popGraphicsState, rgb, rectangle, clip, endPath, type PDFFont } from 'pdf-lib'
import { SAMPLE_TEMPLATE, type CalculationRule } from './calculation'
import { storeProject } from './project'
import fontkit from '@pdf-lib/fontkit'
import type { Edits, Replacement } from './types'
import { decodeBase64, portableAssets } from './portable'
import { glyphMetrics, registerGlyphMetrics } from './glyph-metrics'
import { MAX_TEXT_LENGTH, MIN_FONT_SIZE, MAX_FONT_SIZE } from './limits'
import { readHiddenText, storeHiddenText, describeHiddenText } from './hidden-text'
import { readFontAssets, storeFontAssets, inspectFont, type FontAssets } from './custom-fonts'
import { MAX_FILE_SIZE } from './limits'

const fontPromises = new Map<string, Promise<Uint8Array>>()
export function loadJapaneseFont(bold = false, serif = false) {
  const embedded=portableAssets()
  if(embedded) return Promise.resolve(decodeBase64(serif ? bold ? embedded.boldSerifFont : embedded.serifFont : bold ? embedded.boldFont : embedded.font))
  const key=`${serif?'serif':'sans'}-${bold}`
  let promise = fontPromises.get(key)
  promise ??= fetch(`${import.meta.env.BASE_URL}fonts/Noto${serif?'Serif':'Sans'}JP-${bold ? 'Bold' : 'Regular'}.ttf`)
    .then(async response => {
      if (!response.ok) throw new Error('日本語フォントを読み込めませんでした。ページを再読み込みしてください。')
      return new Uint8Array(await response.arrayBuffer())
    }).catch(error => { fontPromises.delete(key); throw error })
  fontPromises.set(key, promise)
  return promise
}

const charsets = new WeakMap<PDFFont, Set<number>>()
function charset(font: PDFFont) {
  let values = charsets.get(font)
  if (!values) { values = new Set(font.getCharacterSet()); charsets.set(font, values) }
  return values
}
function fontChoice(edit:Replacement) {
  const appearance=edit.region.appearance
  const bold=edit.bold??appearance?.bold??false,italic=appearance?.italic??false
  let family=edit.family??'auto'
  let standard=appearance?.standardFont
  if(family==='auto'&&standard&&edit.bold!==undefined)family=/Times/.test(standard)?'serif':/Courier/.test(standard)?'mono':'sans'
  if(family!=='auto')standard=family==='serif'?(bold?italic?StandardFonts.TimesRomanBoldItalic:StandardFonts.TimesRomanBold:italic?StandardFonts.TimesRomanItalic:StandardFonts.TimesRoman):family==='mono'?(bold?italic?StandardFonts.CourierBoldOblique:StandardFonts.CourierBold:italic?StandardFonts.CourierOblique:StandardFonts.Courier):(bold?italic?StandardFonts.HelveticaBoldOblique:StandardFonts.HelveticaBold:italic?StandardFonts.HelveticaOblique:StandardFonts.Helvetica)
  const serif=family==='serif'||family==='auto'&&/mincho|ming|myungjo|serif|times/i.test(appearance?.fontName??'')
  return {standard,bold,serif}
}
export function createFontResolver(pdf: PDFDocument, regularBytes: Uint8Array, subset = false, assets:FontAssets=readFontAssets(pdf)) {
  pdf.registerFontkit(fontkit)
  const fonts = new Map<string, Promise<PDFFont>>()
  const embed = (key: string, loader: () => Promise<PDFFont>) => {
    if (!fonts.has(key)) fonts.set(key, loader())
    return fonts.get(key)!
  }
  return async (edit: Replacement) => {
    if(edit.customFontId){
      const asset=assets[edit.customFontId]
      if(!asset)throw new Error('使用するフォントが見つかりません。フォントファイルをもう一度選択してください。')
      return embed(edit.customFontId,async()=>{
        inspectFont(asset.bytes)
        return registerGlyphMetrics(await pdf.embedFont(asset.bytes,{subset}),asset.bytes)
      })
    }
    const {standard,bold,serif}=fontChoice(edit)
    if (standard && Object.values(StandardFonts).includes(standard)) {
      const font = await embed(standard, () => pdf.embedFont(standard))
      if ([...edit.text].filter(c=>c!=='\n'&&c!=='\r').every(character => charset(font).has(character.codePointAt(0)!))) return font
    }
    return embed(`Noto${serif?'Serif':'Sans'}JP-${bold?'Bold':'Regular'}`,async()=>{
      const bytes=serif||bold?await loadJapaneseFont(bold,serif):regularBytes
      return registerGlyphMetrics(await pdf.embedFont(bytes,{subset}),bytes)
    })
  }
}

const latinEncoding = StandardFontEmbedder.for('Helvetica' as Parameters<typeof StandardFontEmbedder.for>[0]).encoding
export function replacementFontLabel(edit: Replacement,assets:FontAssets={}) {
  if(edit.customFontId)return assets[edit.customFontId]?.name??'読み込んだフォント'
  const {standard,bold,serif}=fontChoice(edit)
  if (standard && [...edit.text].filter(c=>c!=='\n'&&c!=='\r').every(character => latinEncoding.canEncodeUnicodeCodePoint(character.codePointAt(0)!))) return standard
  return `Noto ${serif?'Serif':'Sans'} JP ${bold?'Bold':'Regular'}`
}

export function replacementFontWarning(edit: Replacement) {
  if(edit.customFontId)return ''
  const label = replacementFontLabel(edit), appearance = edit.region.appearance
  const fallback = label.startsWith('Noto ')
  return [appearance?.warning,
    appearance?.standardFont && fallback ? '入力した文字を元の欧文書体で表示できないため、日本語書体を使用します。' : undefined,
    appearance?.italic && fallback ? '元の斜体の形は再現できません。' : undefined,
  ].filter(Boolean).join(' ')
}

export function fitText(font: PDFFont, edit: Replacement) {
  const widthScale=(edit.widthPercent??100)/100,lineHeight=edit.lineHeight??1.2
  if(!Number.isFinite(widthScale)||widthScale<0.1||widthScale>5||!Number.isFinite(lineHeight)||lineHeight<0.5||lineHeight>5)throw new Error('字幅は10〜500%、行間は0.5〜5倍で指定してください。')
  if([edit.offsetX,edit.offsetY].some(value=>value!==undefined&&(!Number.isFinite(value)||Math.abs(value)>100_000)))throw new Error('位置を正しく指定してください。')
  const {text}=edit
  const region=edit.region.layout?{...edit.region,...edit.region.layout}:edit.region
  const lines=text.replace(/\r\n/g,'\n').split('\n')
  if (text.length > MAX_TEXT_LENGTH) throw new Error('変更する文字列は10,000文字以内にしてください。')
  if (/[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error('タブ・制御文字は使用できません。')
  if (!Number.isFinite(edit.fontSize) || edit.fontSize < MIN_FONT_SIZE || edit.fontSize > MAX_FONT_SIZE) throw new Error('文字サイズは1〜720 ptで指定してください。')
  if (!/^#[0-9a-f]{6}$/iu.test(edit.color)) throw new Error('文字色を正しく指定してください。')
  const unsupported = [...new Set([...text].filter(c => c!=='\n'&&c!=='\r'&&!charset(font).has(c.codePointAt(0)!)))]
  if (unsupported.length) throw new Error(`同梱フォントで保存できない文字があります：${unsupported.slice(0, 8).join(' ')}`)
  // Keep both the width and the glyph ascent/descent inside the original region.
  const measurements=lines.map(line=>glyphMetrics(font,line))
  const hasMetrics=measurements.every(value=>!!value)
  const ink=hasMetrics?{left:Math.min(...measurements.map(v=>v!.left)),right:Math.max(...measurements.map(v=>v!.right)),ascent:Math.max(...measurements.map(v=>v!.ascent)),descent:Math.max(...measurements.map(v=>v!.descent))+lineHeight*(lines.length-1)}:undefined
  const ascent = ink?.ascent ?? font.heightAtSize(1, { descender: false })
  const fullHeight = font.heightAtSize(1, { descender: true })
  const descent = ink?.descent ?? Math.max(0, fullHeight - ascent)+lineHeight*(lines.length-1)
  const topSpace = region.rect.y + region.rect.height - region.baseline - 0.35
  const bottomSpace = region.baseline - region.rect.y - 0.35
  const flexible=region.tightBounds||lines.length>1
  let size = flexible
    ? Math.min(edit.fontSize, ascent + descent ? (region.rect.height - 0.7) / (ascent + descent) : edit.fontSize)
    : Math.min(edit.fontSize, ascent ? topSpace / ascent : edit.fontSize, descent ? bottomSpace / descent : edit.fontSize)
  if(edit.autoFit===false)size=edit.fontSize
  const measure=(size:number)=>Math.max(0,...lines.map(line=>font.widthOfTextAtSize(line,size)))
  const naturalWidth = text ? measure(size) : 0
  // Preserve the original point size when possible. Modest horizontal fitting
  // avoids making a same-length numeric replacement noticeably shorter.
  let scaleX = widthScale*(edit.autoFit===false?1:naturalWidth*widthScale > region.width ? Math.max(0.8, region.width / (naturalWidth*widthScale)) : 1)
  if (edit.autoFit!==false && naturalWidth * scaleX > region.width) size *= region.width / (naturalWidth * scaleX)
  if (edit.autoFit!==false && region.tightBounds) {
    const inkWidth = ink ? (ink.right-ink.left) * size : (text ? measure(size) : 0)
    if (inkWidth > 0) scaleX = Math.min(scaleX, (region.rect.width-0.2) / inkWidth)
  }
  if (!Number.isFinite(size) || size < MIN_FONT_SIZE) throw new Error('元の領域に収まりません。文字を短くするか、別の領域を選んでください。')
  const fittedWidth = text ? measure(size) * scaleX : 0
  const offset = edit.align === 'right' ? region.width - fittedWidth : edit.align === 'center' ? (region.width - fittedWidth) / 2 : 0
  let x = region.x + offset
  if (edit.autoFit!==false && region.tightBounds) {
    const left = ink ? ink.left * size * scaleX : 0
    const right = ink ? ink.right * size * scaleX : fittedWidth
    x = Math.max(region.rect.x + 0.1 - left, Math.min(x, region.rect.x + region.rect.width - 0.1 - right))
  }
  if (!Number.isFinite(scaleX) || scaleX <= 0) throw new Error('元の領域に収まりません。別の領域を選んでください。')
  const baseline = edit.autoFit!==false && flexible ? Math.max(region.rect.y + 0.35 + descent * size,
    Math.min(region.baseline, region.rect.y + region.rect.height - 0.35 - ascent * size)) : region.baseline
  return { size, x:x+(edit.offsetX??0), baseline:baseline+(edit.offsetY??0), width: fittedWidth, scaleX, lines, lineHeight:size*lineHeight }
}

export async function writePdf(original: Uint8Array, edits: Edits, fontBytes: Uint8Array, calculation: CalculationRule | null = null, assets:FontAssets={}): Promise<Uint8Array> {
  const entries = Object.values(edits)
  if (!entries.length) return original.slice()
  const pdf = await PDFDocument.load(original)
  // Full embedding avoids reproducible missing glyphs in fontkit's Japanese subsetting.
  // The extra file size is intentional until a verified subset pipeline is available.
  const baseFonts=readFontAssets(pdf),fonts={...baseFonts,...assets}
  const resolveFont = createFontResolver(pdf, fontBytes,false,fonts)
  const pages = pdf.getPages()
  // Compute every placement before changing the document: failed edits never produce partial output.
  const placements = await Promise.all(entries.map(async edit => {
    const font = await resolveFont(edit)
    return { edit, font, fit: fitText(font, edit) }
  }))
  for (const { edit, font, fit } of placements) {
    const page = pages[edit.region.pageIndex]
    if (!page) throw new Error('編集対象のページが見つかりません。')
    const background=edit.region.background
    if(background&&'png' in background){
      const image=await pdf.embedPng(background.png)
      page.pushOperators(pushGraphicsState(),rectangle(edit.region.rect.x,edit.region.rect.y,edit.region.rect.width,edit.region.rect.height),clip(),endPath(),concatTransformationMatrix(...background.matrix))
      page.drawImage(image,{x:0,y:0,width:1,height:1});page.pushOperators(popGraphicsState())
    }else{
      if(edit.region.backgroundKind==='patch')throw new Error('背景データがありません。変更をもう一度適用してください。')
      const color=background&&'color' in background?background.color:'#ffffff'
      const components=color.slice(1).match(/../g)!.map(part=>parseInt(part,16)/255)
      page.drawRectangle({ ...edit.region.rect, color: rgb(components[0],components[1],components[2]), borderWidth: 0 })
    }
    if (edit.text) {
      const parts = edit.color.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255)
      page.pushOperators(pushGraphicsState())
      if(edit.region.transform)page.pushOperators(concatTransformationMatrix(...edit.region.transform))
      page.pushOperators(concatTransformationMatrix(fit.scaleX, 0, 0, 1, fit.x, fit.baseline))
      page.drawText(fit.lines.join('\n'), { x: 0, y: 0, size: fit.size, lineHeight:fit.lineHeight, font, color: rgb(parts[0], parts[1], parts[2]) })
      page.pushOperators(popGraphicsState())
    }
  }
  storeHiddenText(pdf,[...readHiddenText(pdf),...entries.map(edit=>describeHiddenText(edit.region))])
  const keep=new Set([...Object.keys(baseFonts),...entries.flatMap(edit=>edit.customFontId?[edit.customFontId]:[])])
  storeFontAssets(pdf,Object.fromEntries(Object.entries(fonts).filter(([id])=>keep.has(id))))
  storeProject(pdf, original, edits, calculation)
  const bytes=await pdf.save()
  if(bytes.length>MAX_FILE_SIZE)throw new Error('保存するPDFが100 MBを超えます。使用するフォントや画像を減らしてください。')
  return bytes
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
  text('色の付いた表の見出しも、背景を保って編集できます。', 48, 138, 10)
  text('PDF Creator & Editor  /  Sample', 48, 50, 9)
  const second = pdf.addPage([595.28, 841.89])
  second.drawText('ご利用について', { x: 48, y: 740, size: 24, font })
  second.drawText('PDFの処理はすべて、お使いのブラウザ内で行います。', { x: 48, y: 678, size: 12, font })
  second.drawText('ファイルはサーバーへ送信されません。', { x: 48, y: 646, size: 12, font })
  second.drawText('元の背景を復元し、新しい文字を重ねて保存します。', { x: 48, y: 580, size: 12, font })
  second.drawText('機密情報の削除・墨消しには使用しないでください。', { x: 48, y: 548, size: 12, font })
  return pdf.save()
}
