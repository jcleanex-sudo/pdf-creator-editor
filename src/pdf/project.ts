import { PDFName, PDFRawStream, type PDFDocument } from 'pdf-lib'
import type { CalculationRule } from './calculation'
import type { Edits, Replacement } from './types'
import { MAX_FILE_SIZE, MAX_PAGES, MAX_TEXT_LENGTH, MIN_FONT_SIZE, MAX_FONT_SIZE } from './limits'

type StoredEdit = Omit<Replacement,'region'> & {id:string}
export type StoredProject = {
  version: 1 | 2
  edits: StoredEdit[]
  calculation: { sources: string[]; target: string; taxPercent: number } | null
}
const sourceKey = PDFName.of('PDFEditorSourceV1')
const projectKey = PDFName.of('PDFEditorProjectV1')
const MAX_PROJECT_BYTES = 16 * 1024 * 1024
const idPattern = /^(?:0|[1-9]\d{0,4}):(?:0|[1-9]\d{0,8})$/
const validId = (id: unknown): id is string => typeof id === 'string' && idPattern.test(id) && Number(id.split(':')[0]) < MAX_PAGES
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function parseProject(bytes: Uint8Array): StoredProject {
  if (bytes.length > MAX_PROJECT_BYTES) throw new Error('編集データが大きすぎます。')
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!record(value) || ![1,2].includes(Number(value.version)) || typeof value.version!=='number' || !Array.isArray(value.edits) || value.edits.length > 100_000)
    throw new Error('編集データの形式が正しくありません。')
  const ids = new Set<string>()
  for (const edit of value.edits) {
    if (!record(edit) || !validId(edit.id) || ids.has(edit.id) || typeof edit.text !== 'string' || edit.text.length > MAX_TEXT_LENGTH ||
      /[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/u.test(edit.text) || typeof edit.fontSize !== 'number' || !Number.isFinite(edit.fontSize) || edit.fontSize < MIN_FONT_SIZE || edit.fontSize > MAX_FONT_SIZE ||
      typeof edit.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(edit.color) || !['left', 'center', 'right'].includes(String(edit.align)))
      throw new Error('編集データの文字や書式が正しくありません。')
    if(edit.autoFit!==undefined&&typeof edit.autoFit!=='boolean'||edit.bold!==undefined&&typeof edit.bold!=='boolean'||
      edit.family!==undefined&&!['auto','sans','serif','mono'].includes(String(edit.family))||
      [edit.offsetX,edit.offsetY].some(value=>value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>100_000)))
      throw new Error('編集データの位置や書体が正しくありません。')
    if(edit.customFontId!==undefined&&(typeof edit.customFontId!=='string'||!/^font-[1-9]\d{0,3}$/.test(edit.customFontId))||
      edit.widthPercent!==undefined&&(typeof edit.widthPercent!=='number'||!Number.isFinite(edit.widthPercent)||edit.widthPercent<10||edit.widthPercent>500)||
      edit.lineHeight!==undefined&&(typeof edit.lineHeight!=='number'||!Number.isFinite(edit.lineHeight)||edit.lineHeight<0.5||edit.lineHeight>5))
      throw new Error('編集データの字幅・行間・フォントが正しくありません。')
    ids.add(edit.id)
  }
  const rule = value.calculation
  if (rule !== null && (!record(rule) || !validId(rule.target) || !Array.isArray(rule.sources) || !rule.sources.length || rule.sources.length > 100 ||
    !rule.sources.every(validId) || new Set(rule.sources).size !== rule.sources.length || rule.sources.includes(rule.target) ||
    rule.sources.some(id => id.split(':')[0] !== (rule.target as string).split(':')[0]) ||
    typeof rule.taxPercent !== 'number' || !Number.isFinite(rule.taxPercent) || rule.taxPercent < 0 || rule.taxPercent > 100 || rule.taxPercent !== Number(rule.taxPercent.toFixed(2))))
    throw new Error('編集データの計算設定が正しくありません。')
  return value as unknown as StoredProject
}

export function storeProject(pdf: PDFDocument, original: Uint8Array, edits: Edits, calculation: CalculationRule | null) {
  const project: StoredProject = { version: 2,
    edits: Object.values(edits).map(({ region, ...edit }) => ({ id: region.id, ...edit })),
    calculation: calculation ? { sources: calculation.sources.map(source => source.id), target: calculation.target.id, taxPercent: calculation.taxPercent } : null,
  }
  const data = new TextEncoder().encode(JSON.stringify(project))
  parseProject(data)
  // Keep these streams unfiltered: restoration has explicit byte limits and
  // cannot inflate arbitrary compressed project data supplied by a PDF.
  pdf.catalog.set(sourceKey, pdf.context.register(pdf.context.stream(original)))
  pdf.catalog.set(projectKey, pdf.context.register(pdf.context.stream(data)))
}

export function readProject(pdf: PDFDocument): { source: Uint8Array; project: StoredProject } | null {
  if (!pdf.catalog.has(projectKey)) return null
  const source = pdf.context.lookup(pdf.catalog.get(sourceKey))
  const data = pdf.context.lookup(pdf.catalog.get(projectKey))
  if (!(source instanceof PDFRawStream) || !(data instanceof PDFRawStream) || source.dict.has(PDFName.of('Filter')) || data.dict.has(PDFName.of('Filter')) ||
    source.contents.length > MAX_FILE_SIZE || !source.contents.length)
    throw new Error('編集データを復元できません。元のPDFを開いてください。')
  return { source: source.contents.slice(), project: parseProject(data.contents) }
}
