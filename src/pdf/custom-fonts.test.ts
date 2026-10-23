import {describe,it,expect} from 'vitest'
import {readFile} from 'node:fs/promises'
import {PDFDocument,PDFName} from 'pdf-lib'
import {inspectFont,addFont,readFontAssets,storeFontAssets} from './custom-fonts'

describe('local font files and reusable PDF font data',()=>{
  it('accepts a real licensed static font, deduplicates it and reuses its stream on repeated saves',async()=>{
    const bytes=new Uint8Array(await readFile('public/fonts/NotoSerifJP-Bold.ttf')),font=inspectFont(bytes)
    expect(font.name).toContain('Noto Serif JP');expect(font.postscriptName).toBe('NotoSerifJP-Bold')
    const first=addFont({},font),again=addFont(first.assets,{...font,bytes:bytes.slice()})
    expect(again.id).toBe(first.id);expect(again.assets).toBe(first.assets)
    const pdf=await PDFDocument.create();pdf.addPage();storeFontAssets(pdf,first.assets)
    const before=pdf.context.enumerateIndirectObjects().length
    storeFontAssets(pdf,first.assets)
    expect(pdf.context.enumerateIndirectObjects().length-before).toBe(1)
    const output=await PDFDocument.load(await pdf.save()),assets=readFontAssets(output)
    expect(assets[first.id].name).toBe(font.name);expect(Buffer.compare(assets[first.id].bytes,bytes)).toBe(0)
  })
  it('rejects broken files, actual restricted embedding flags and missing or filtered data',async()=>{
    expect(()=>inspectFont(new Uint8Array([1,2,3]))).toThrow('読み込めません')
    const bytes=new Uint8Array(await readFile('public/fonts/NotoSerifJP-Regular.ttf')),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
    let offset=0
    for(let i=0;i<view.getUint16(4);i++){const at=12+i*16;if(new TextDecoder().decode(bytes.subarray(at,at+4))==='OS/2')offset=view.getUint32(at+8)}
    expect(offset).toBeGreaterThan(0);view.setUint16(offset+8,2)
    expect(()=>inspectFont(bytes)).toThrow('埋め込み制限')
    const pdf=await PDFDocument.create();pdf.addPage()
    const record=[{id:'font-1',name:'Missing',postscriptName:'Missing',object:9999,generation:0}]
    pdf.catalog.set(PDFName.of('PDFEditorFontsV1'),pdf.context.register(pdf.context.stream(new TextEncoder().encode(JSON.stringify(record)))))
    expect(()=>readFontAssets(pdf)).toThrow('正しくありません')
    pdf.catalog.set(PDFName.of('PDFEditorFontsV1'),pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('[]'))))
    expect(()=>readFontAssets(pdf)).toThrow('正しくありません')
  })
})
