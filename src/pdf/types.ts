import type { PDFDocumentProxy } from 'pdfjs-dist'

export type Rect = { x: number; y: number; width: number; height: number }
export type TextRegion = {
  id: string
  pageIndex: number
  text: string
  x: number
  baseline: number
  fontSize: number
  width: number
  rect: Rect
  screen: Rect
  unsupportedReason?: string
}
export type Replacement = {
  region: TextRegion
  text: string
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
}
export type Edits = Record<string, Replacement>
export type PageModel = {
  width: number
  height: number
  regions: TextRegion[]
  pixels: ImageData
  pixelScale: number
}
export type DocumentSession = {
  name: string
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  pageCache: Map<number, Promise<PageModel>>
  size: number
}
