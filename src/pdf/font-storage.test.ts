import {describe,it,expect} from 'vitest'
import {PDFDocument,PDFName,PDFRawStream} from 'pdf-lib'
import {compactNewFonts,existingObjects} from './font-storage'

describe('new font stream compaction',()=>{
  it('shares exact programs and redirects nested references, preserving existing streams and different dictionaries',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage()
    const stream=(subtype:string)=>pdf.context.register(pdf.context.stream(new Uint8Array([1,2,3]),{Subtype:subtype}))
    const descriptor=(ref:ReturnType<typeof stream>)=>pdf.context.register(pdf.context.obj({Type:'FontDescriptor',FontFile2:ref}))
    const original=stream('One');descriptor(original)
    const oldDuplicate=stream('One');descriptor(oldDuplicate)
    const before=existingObjects(pdf),duplicate=stream('One'),different=stream('Two')
    const dupeDescriptor=descriptor(duplicate);descriptor(different)
    const nested=pdf.context.obj({Other:[duplicate]});pdf.catalog.set(PDFName.of('Test'),nested)
    await compactNewFonts(pdf,before)
    expect(pdf.context.lookup(duplicate)).toBeUndefined()
    expect(pdf.context.lookup(original)).toBeInstanceOf(PDFRawStream)
    expect(pdf.context.lookup(oldDuplicate)).toBeInstanceOf(PDFRawStream)
    expect(pdf.context.lookup(different)).toBeInstanceOf(PDFRawStream)
    expect(pdf.context.lookup(dupeDescriptor)!.toString()).toContain(`/FontFile2 ${original.toString()}`)
    expect(nested.toString()).toContain(`[ ${original.toString()} ]`)
    await expect(PDFDocument.load(await pdf.save())).resolves.toBeDefined()
  })
})
