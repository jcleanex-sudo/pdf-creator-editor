import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { parseProject, readProject, storeProject } from './project'
import type { Edits } from './types'

const edit = { id: '0:1', text: '160,000', fontSize: 13, color: '#202733', align: 'right' }
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const project = { version: 1, edits: [edit], calculation: null }

describe('editable PDF project data', () => {
  it('validates stored text and calculation bindings without trusting stored geometry or fonts', () => {
    expect(parseProject(encode(project))).toEqual(project)
    expect(parseProject(encode({...project,version:2,edits:[{...edit,customFontId:'font-1',widthPercent:82.5,lineHeight:1.7}]})).edits[0]).toMatchObject({customFontId:'font-1',widthPercent:82.5,lineHeight:1.7})
    const rule = { sources: ['0:1', '0:2'], target: '0:3', taxPercent: 10 }
    expect(parseProject(encode({ ...project, calculation: rule })).calculation).toEqual(rule)
    for (const invalid of [
      { ...project, version: 3 },
      { ...project, edits: [edit, edit] },
      { ...project, edits: [{ ...edit, id: '__proto__' }] },
      { ...project, edits: [{ ...edit, id: '2000:0' }] },
      { ...project, edits: [{ ...edit, text: 'a\tb' }] },
      { ...project, edits: [{ ...edit, text: 'a'.repeat(10001) }] },
      { ...project, edits: [{ ...edit, fontSize: 0 }] },
      { ...project, edits: [{ ...edit, color: 'red' }] },
      { ...project, edits: [{ ...edit, align: 'invalid' }] },
      { ...project, edits: [{ ...edit, widthPercent:0 }] },
      { ...project, edits: [{ ...edit, lineHeight:6 }] },
      { ...project, edits: [{ ...edit, customFontId:'__proto__' }] },
      { ...project, calculation: { ...rule, sources: ['0:3'] } },
      { ...project, calculation: { ...rule, sources: ['1:1'] } },
      { ...project, calculation: { ...rule, taxPercent: 10.001 } },
    ]) expect(() => parseProject(encode(invalid))).toThrow()
    expect(() => parseProject(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow('大きすぎ')
  })

  it('round trips the exact original bytes and edit values through a normal saved PDF', async () => {
    const source = await PDFDocument.create(); source.addPage()
    const original = await source.save()
    const output = await PDFDocument.load(original)
    const edits: Edits = { '0:1': { ...edit, align: 'right', region: { id: '0:1' } as Edits[string]['region'] } }
    storeProject(output, original, edits, null)
    const result = readProject(await PDFDocument.load(await output.save()))!
    expect(result.source).toEqual(original)
    expect(result.project).toEqual({...project,version:2})
    expect(readProject(source)).toBeNull()
  })

  it('rejects missing source streams and filtered project data', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage()
    pdf.catalog.set(PDFName.of('PDFEditorProjectV1'), pdf.context.register(pdf.context.stream(encode(project))))
    expect(() => readProject(pdf)).toThrow('復元できません')
    pdf.catalog.set(PDFName.of('PDFEditorSourceV1'), pdf.context.register(pdf.context.flateStream(new Uint8Array([1, 2, 3]))))
    expect(() => readProject(pdf)).toThrow('復元できません')
  })
})
