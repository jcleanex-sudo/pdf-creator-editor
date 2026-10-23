import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, PDFSignature, PDFName, PDFString } from 'pdf-lib'
import { SAMPLE_TEMPLATE, calculateTotal, type CalculationRule } from './calculation'
import { fontAppearance, textPaints } from './appearance'
import { readProject } from './project'
import { editRestriction } from './safety'
import { refineTextBounds } from './bounds'
import { pixelBounds } from './bounds'
import { uniformBackground } from './background'
import { MAX_FILE_SIZE, MAX_PAGES, MIN_FONT_SIZE } from './limits'
import { readHiddenText, visibleTextRegions } from './hidden-text'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { DocumentSession, Edits, PageModel, Rect, TextRegion } from './types'
import { EmbeddedBinaryDataFactory, portableAssets } from './portable'

const embedded=portableAssets()
pdfjs.GlobalWorkerOptions.workerSrc = embedded
  ? URL.createObjectURL(new Blob([embedded.worker],{type:'text/javascript'}))
  : workerUrl
export { MAX_FILE_SIZE, MAX_PAGES } from './limits'

export class EncryptedPdfError extends Error {}
export function readPdf(bytes: Uint8Array, password?:string) {
  const base = `${import.meta.env.BASE_URL}pdfjs/`
  return pdfjs.getDocument({ data: bytes.slice(), password, cMapUrl: `${base}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
    isOffscreenCanvasSupported: false, fontExtraProperties: true,
    ...(embedded ? {useWorkerFetch:false,BinaryDataFactory:EmbeddedBinaryDataFactory} : {}) })
}

export async function openPdf(bytes: Uint8Array, name: string, restore = true): Promise<DocumentSession> {
  if (bytes.length > MAX_FILE_SIZE) throw new Error('この環境では100 MBまでのPDFを開けます。')
  if (!new TextDecoder('latin1').decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('PDFファイルを選択してください。')
  let pageCount: number
  let hasSignature: boolean
  let sampleEstimate = false
  let stored: ReturnType<typeof readProject> = null
  let hiddenText:ReturnType<typeof readHiddenText>=[]
  try {
    const parsed = await PDFDocument.load(bytes)
    const template = parsed.catalog.get(PDFName.of('PDFEditorTemplate'))
    sampleEstimate = template instanceof PDFString && template.decodeText() === SAMPLE_TEMPLATE
    pageCount = parsed.getPageCount()
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Invalid page tree')
    hasSignature = parsed.getForm().getFields().some(field => field instanceof PDFSignature)
    if (restore) stored = readProject(parsed)
    hiddenText=readHiddenText(parsed)
  }
  catch (error) {
    if (String(error).toLowerCase().includes('encrypt')) throw new EncryptedPdfError('パスワード付きPDFです。')
    throw new Error('PDFを読み込めません。ファイルが破損していないか確認してください。')
  }
  if (pageCount > MAX_PAGES) throw new Error('この環境では2,000ページまでのPDFに対応しています。')
  if (stored) {
    const session = await openPdf(stored.source, name, false)
    try {
      if (session.pdf.numPages !== pageCount) throw new Error('ページ数が一致しません。')
      const ids = new Set(stored.project.edits.map(edit => edit.id))
      if (stored.project.calculation) {
        ids.add(stored.project.calculation.target)
        stored.project.calculation.sources.forEach(id => ids.add(id))
      }
      const regions = new Map<string, TextRegion>()
      for (const index of new Set([...ids].map(id => Number(id.split(':')[0])))) {
        const model = await loadPage(session, index)
        for (const region of model.regions) if (ids.has(region.id)) {
          if (editRestriction(region, model)) throw new Error('編集できない文字が含まれています。')
          regions.set(region.id, region)
        }
      }
      if (regions.size !== ids.size) throw new Error('対象の文字が見つかりません。')
      const edits: Edits = Object.fromEntries(stored.project.edits.map(({ id, ...edit }) => [id, { ...edit, region: regions.get(id)! }]))
      for (const edit of Object.values(edits)) await prepareEditBackground(session, edit.region)
      const rule = stored.project.calculation
      const calculation: CalculationRule | null = rule ? { sources: rule.sources.map(id => regions.get(id)!), target: regions.get(rule.target)!, taxPercent: rule.taxPercent } : null
      if (calculation) {
        const { total } = calculateTotal(calculation, edits)
        if (edits[calculation.target.id]?.text !== total.toLocaleString('ja-JP')) throw new Error('計算結果が一致しません。')
      }
      session.restored = { edits, calculation }
      session.size = bytes.length
      return session
    } catch {
      await session.pdf.loadingTask.destroy()
      throw new Error('編集データを復元できません。元のPDFを開いてください。')
    }
  }
  const task = readPdf(bytes)
  try {
    const pdf = await task.promise
    return { bytes, pdf, name, size: bytes.length, pageCache: new Map(), sampleEstimate, signed:hasSignature,hiddenText }
  } catch {
    await task.destroy()
    throw new Error('このPDFを表示できません。別のPDFをお試しください。')
  }
}

function viewportRect(viewport: pdfjs.PageViewport, rect: Rect): Rect {
  const p = [...viewport.convertToViewportPoint(rect.x, rect.y), ...viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)]
  return { x: Math.min(p[0], p[2]), y: Math.min(p[1], p[3]), width: Math.abs(p[2]-p[0]), height: Math.abs(p[3]-p[1]) }
}

export function loadPage(session: DocumentSession, pageIndex: number): Promise<PageModel> {
  const cached = session.pageCache.get(pageIndex)
  if (cached) return cached
  const promise = analyzePage(session, pageIndex).catch(error => { session.pageCache.delete(pageIndex); throw error })
  session.pageCache.set(pageIndex, promise)
  // Retain at most six raster analyses. Original PDF bytes and edits remain intact.
  if (session.pageCache.size > 6) session.pageCache.delete(session.pageCache.keys().next().value!)
  return promise
}

async function analyzePage(session: DocumentSession, pageIndex: number): Promise<PageModel> {
  const page = await session.pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const operators = await page.getOperatorList()
  const operatorNames = Object.fromEntries(Object.entries(pdfjs.OPS).map(([name, value]) => [value, name]))
  const paints = textPaints(operators.fnArray.map((value, index) => ({ name: operatorNames[value], args: operators.argsArray[index] })))
  const regions: TextRegion[] = []
  const items = content.items.filter((item): item is TextItem => 'str' in item && !!item.str.trim())
  const pixelScale = Math.min(3, Math.sqrt(8_000_000 / (viewport.width*viewport.height)))
  const raster = page.getViewport({ scale: pixelScale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(raster.width); canvas.height = Math.ceil(raster.height)
  // Analyze the background without painting glyphs. Including glyph pixels in
  // this raster made text color and platform antialiasing look like a colored
  // background, even in the bundled sample on a plain white page.
  const textPaint = new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText,
    pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText])
  let unreliableBackground = false
  let annotationDepth = 0
  await page.render({ canvas, viewport: raster, background: 'rgb(255,255,255)',
    operationsFilter(index, operators) {
      const operation = operators.fnArray[index]
      // Text clips, soft masks and knockout groups can make later graphics
      // depend on glyphs. Do not edit pages where omitting them is unreliable.
      if (operation === pdfjs.OPS.setTextRenderingMode && operators.argsArray[index][0] >= 4)
        unreliableBackground = true
      if (operation === pdfjs.OPS.beginGroup) {
        const group = operators.argsArray[index][0]
        if (group.smask || group.knockout) unreliableBackground = true
      }
      if (operation === pdfjs.OPS.setGState && operators.argsArray[index][0].some(
        ([key, value]: [string, unknown]) => key === 'SMask' && !!value))
        unreliableBackground = true
      // Annotation appearance text is not in getTextContent's regions. Keep
      // it in this raster so a cover cannot erase an overlapping annotation.
      if (operation === pdfjs.OPS.beginAnnotation) annotationDepth++
      if (operation === pdfjs.OPS.endAnnotation) annotationDepth--
      return annotationDepth > 0 || !textPaint.has(operation)
    },
  }).promise
  for (const [index, item] of items.entries()) {
    const [a,b,c,d,x,y] = item.transform
    const fontSize = Math.hypot(c,d)
    const style = content.styles[item.fontName]
    const ascent = style?.ascent ?? 0.88
    const descent = style?.descent ?? -0.12
    const angle=Math.atan2(b,a),cos=Math.cos(angle),sin=Math.sin(angle)
    const rotated=Math.abs(angle)>1e-6
    const localRect={x:-0.5,y:descent*fontSize-0.5,width:item.width+1,height:(ascent-descent)*fontSize+1}
    const corners=[...[[localRect.x,localRect.y],[localRect.x+localRect.width,localRect.y],[localRect.x,localRect.y+localRect.height],[localRect.x+localRect.width,localRect.y+localRect.height]]].map(([u,v])=>[x+u*cos-v*sin,y+u*sin+v*cos])
    const rect = rotated ? {x:Math.min(...corners.map(p=>p[0])),y:Math.min(...corners.map(p=>p[1])),width:Math.max(...corners.map(p=>p[0]))-Math.min(...corners.map(p=>p[0])),height:Math.max(...corners.map(p=>p[1]))-Math.min(...corners.map(p=>p[1]))}
      : { x: x-0.5, y: y + descent * fontSize - 0.5, width: item.width+1, height: (ascent-descent)*fontSize+1 }
    const screen = viewportRect(viewport,rect)
    let unsupportedReason: string | undefined
    if (a*d-b*c<=0 || Math.abs(a*c+b*d)>Math.hypot(a,b)*fontSize*0.001 || style?.vertical)
      unsupportedReason = 'この文字は特殊な変形・縦書きです。「範囲書き換え」で編集できます。'
    else if (fontSize < MIN_FONT_SIZE || item.width <= 0 || screen.x < 0 || screen.y < 0 || screen.x+screen.width > viewport.width+0.01 || screen.y+screen.height > viewport.height+0.01)
      unsupportedReason = '文字領域が小さすぎるか、ページの外側にあります。'
    const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : undefined
    const appearance = fontAppearance(String(font?.name ?? ''), !!(font?.bold || font?.black), !!font?.italic)
    const paint = paints.next(item.str, item.fontName)
    appearance.color = paint.color
    if (paint.warning) appearance.warning = [appearance.warning, paint.warning].filter(Boolean).join(' ')
    unsupportedReason ??= paint.unsafe
    regions.push({ id: `${pageIndex}:${index}`, pageIndex, text: item.str, x, baseline: y, width: item.width, fontSize, rect, screen, unsupportedReason, appearance,
      ...(rotated?{layout:{x:0,baseline:0,width:item.width,rect:localRect},transform:[cos,sin,-sin,cos,x,y] as [number,number,number,number,number,number]}:{}) })
  }
  if (unreliableBackground) for (const region of regions)
    region.unsupportedReason ??= '文字の切り抜きや透明マスクを使ったPDFは、背景を保護するため編集できません。'
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
  if (!unreliableBackground && regions.some(region => !region.unsupportedReason)) {
    await page.render({ canvas, viewport: raster, background: 'rgb(255,255,255)' }).promise
    const foreground = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
    for (const region of regions) {
      if (region.unsupportedReason || region.transform) continue
      const refined = refineTextBounds(region.screen, pixels, foreground, pixelScale)
      if (!refined) continue
      const [left, top] = viewport.convertToPdfPoint(refined.x, refined.y)
      const [right, bottom] = viewport.convertToPdfPoint(refined.x + refined.width, refined.y + refined.height)
      region.rect = { x: Math.min(left,right), y: Math.min(top,bottom), width: Math.abs(right-left), height: Math.abs(top-bottom) }
      region.screen = refined
      region.tightBounds = true
    }
  }
  if(!unreliableBackground)for(const region of regions) {
    const color=uniformBackground(region.screen,pixels,pixelScale)
    region.backgroundKind=color?'solid':'patch'
    if(color)region.background={color}
  }
  canvas.width = canvas.height = 0
  // Extra metadata is needed for font identification, not for retaining a
  // second copy of every font program after the browser has loaded it.
  for (const name of Object.keys(content.styles)) if (page.commonObjs.has(name)) page.commonObjs.get(name)?.clearData?.()
  return { width: viewport.width, height: viewport.height, regions:visibleTextRegions(regions,session.hiddenText??[]), pixels, pixelScale, supportsBackground:!unreliableBackground }
}

export async function prepareEditBackground(session:DocumentSession,region:TextRegion) {
  if(region.background || region.backgroundKind!=='patch')return
  const model=await loadPage(session,region.pageIndex)
  const reason=editRestriction(region,model)
  if(reason)throw new Error(reason)
  const {left,top,right,bottom}=pixelBounds(region.screen,model.pixelScale,model.pixels)
  const width=right-left+1,height=bottom-top+1
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const context=canvas.getContext('2d')!
  context.putImageData(model.pixels,-left,-top)
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('背景を復元できませんでした。')),'image/png'))
  const page=await session.pdf.getPage(region.pageIndex+1),viewport=page.getViewport({scale:1})
  const start=viewport.convertToPdfPoint(left/model.pixelScale,(bottom+1)/model.pixelScale)
  const endX=viewport.convertToPdfPoint((right+1)/model.pixelScale,(bottom+1)/model.pixelScale)
  const endY=viewport.convertToPdfPoint(left/model.pixelScale,top/model.pixelScale)
  region.background={png:new Uint8Array(await blob.arrayBuffer()),matrix:[endX[0]-start[0],endX[1]-start[1],endY[0]-start[0],endY[1]-start[1],start[0],start[1]]}
  canvas.width=canvas.height=0
}

export async function remapDocumentEdits(session:DocumentSession,edits:Edits,calculation:CalculationRule|null,pageMap:Map<number,number>){
  const resolved=new Map<string,TextRegion>()
  const resolve=async(old:TextRegion)=>{
    if(resolved.has(old.id))return resolved.get(old.id)!
    const index=pageMap.get(old.pageIndex);if(index===undefined)return
    const page=await loadPage(session,index)
    const matches=page.regions.filter(r=>r.text===old.text&&Math.abs(r.x-old.x)<0.05&&Math.abs(r.baseline-old.baseline)<0.05&&Math.abs(r.fontSize-old.fontSize)<0.05)
    if(matches.length!==1)throw new Error('既存の編集対象を引き継げませんでした。変更を保存して別の位置で追加してください。')
    resolved.set(old.id,matches[0]);return matches[0]
  }
  const next:Edits={}
  for(const edit of Object.values(edits)){
    const region=await resolve(edit.region);if(!region)continue
    await prepareEditBackground(session,region);next[region.id]={...edit,region}
  }
  let rule:CalculationRule|null=null
  if(calculation&&pageMap.has(calculation.target.pageIndex)){
    const target=await resolve(calculation.target),sources=await Promise.all(calculation.sources.map(resolve))
    if(target&&sources.every((source):source is TextRegion=>!!source))rule={target,sources,taxPercent:calculation.taxPercent}
  }
  return {edits:next,calculation:rule}
}

export { editRestriction } from './safety'
