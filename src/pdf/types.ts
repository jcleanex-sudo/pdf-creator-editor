import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OriginalAppearance } from './appearance'
import type { CalculationRule } from './calculation'
import type { HiddenText } from './hidden-text'

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
  /** Empty margins were clipped to protect nearby table rules. */
  tightBounds?: boolean
  layout?: { x: number; baseline: number; width: number; rect: Rect }
  transform?: [number, number, number, number, number, number]
  background?: { color: string } | { png: Uint8Array; matrix: [number, number, number, number, number, number] }
  backgroundKind?: 'solid' | 'patch'
  unsupportedReason?: string
  appearance?: OriginalAppearance
}
export type Replacement = {
  region: TextRegion
  text: string
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  autoFit?: boolean
  offsetX?: number
  offsetY?: number
  family?: 'auto' | 'sans' | 'serif' | 'mono'
  bold?: boolean
}
export type Edits = Record<string, Replacement>
export type PageModel = {
  width: number
  height: number
  regions: TextRegion[]
  /** Background analysis raster with text painting omitted. */
  pixels: ImageData
  pixelScale: number
  supportsBackground?: boolean
}
export type DocumentSession = {
  name: string
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  pageCache: Map<number, Promise<PageModel>>
  size: number
  sampleEstimate: boolean
  signed?: boolean
  hiddenText?:HiddenText[]
  restored?: { edits: Edits; calculation: CalculationRule | null }
}
