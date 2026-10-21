import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, PDFSignature } from 'pdf-lib'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { DocumentSession, PageModel, Rect, TextRegion } from './types'
import { EmbeddedBinaryDataFactory, portableAssets } from './portable'

const embedded=portableAssets()
pdfjs.GlobalWorkerOptions.workerSrc = embedded
  ? URL.createObjectURL(new Blob([embedded.worker],{type:'text/javascript'}))
  : workerUrl
export const MAX_FILE_SIZE = 25 * 1024 * 1024
export const MAX_PAGES = 200

export function readPdf(bytes: Uint8Array) {
  const base = `${import.meta.env.BASE_URL}pdfjs/`
  return pdfjs.getDocument({ data: bytes.slice(), cMapUrl: `${base}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
    isOffscreenCanvasSupported: false,
    ...(embedded ? {useWorkerFetch:false,BinaryDataFactory:EmbeddedBinaryDataFactory} : {}) })
}

export async function openPdf(bytes: Uint8Array, name: string): Promise<DocumentSession> {
  if (bytes.length > MAX_FILE_SIZE) throw new Error('Phase 1では25 MBまでのPDFを開けます。')
  if (!new TextDecoder('latin1').decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('PDFファイルを選択してください。')
  let pageCount: number
  let hasSignature: boolean
  try {
    const parsed = await PDFDocument.load(bytes)
    pageCount = parsed.getPageCount()
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Invalid page tree')
    hasSignature = parsed.getForm().getFields().some(field => field instanceof PDFSignature)
  }
  catch (error) {
    if (String(error).toLowerCase().includes('encrypt')) throw new Error('パスワード付きPDFにはまだ対応していません。保護されていないPDFを使用してください。')
    throw new Error('PDFを読み込めません。ファイルが破損していないか確認してください。')
  }
  if (pageCount > MAX_PAGES) throw new Error('Phase 1では200ページまでのPDFに対応しています。')
  if (hasSignature) throw new Error('署名欄を含むPDFは、署名を保護するためPhase 1では開けません。')
  const task = readPdf(bytes)
  try {
    const pdf = await task.promise
    return { bytes, pdf, name, size: bytes.length, pageCache: new Map() }
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
  const regions: TextRegion[] = []
  const items = content.items.filter((item): item is TextItem => 'str' in item && !!item.str.trim())
  for (const [index, item] of items.entries()) {
    const [a,b,c,d,x,y] = item.transform
    const fontSize = Math.hypot(c,d)
    const style = content.styles[item.fontName]
    const ascent = style?.ascent ?? 0.88
    const descent = style?.descent ?? -0.12
    const rect = { x: x-0.5, y: y + descent * fontSize - 0.5, width: item.width+1, height: (ascent-descent)*fontSize+1 }
    const screen = viewportRect(viewport,rect)
    let unsupportedReason: string | undefined
    if (page.rotate !== 0 || page.userUnit !== 1 || Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0 || style?.vertical)
      unsupportedReason = '回転・縦書き・特殊な変形の文字にはまだ対応していません。'
    else if (fontSize < 4 || item.width <= 1 || screen.x < 0 || screen.y < 0 || screen.x+screen.width > viewport.width || screen.y+screen.height > viewport.height)
      unsupportedReason = '文字領域が小さすぎるか、ページの外側にあります。'
    regions.push({ id: `${pageIndex}:${index}`, pageIndex, text: item.str, x, baseline: y, width: item.width, fontSize, rect, screen, unsupportedReason })
  }
  const pixelScale = Math.min(1.5, Math.sqrt(8_000_000 / (viewport.width*viewport.height)))
  const raster = page.getViewport({ scale: pixelScale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(raster.width); canvas.height = Math.ceil(raster.height)
  await page.render({ canvas, viewport: raster, background: 'rgb(255,255,255)' }).promise
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.height = 0
  return { width: viewport.width, height: viewport.height, regions, pixels, pixelScale }
}

export { editRestriction } from './safety'
