import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PDFDocument, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { fitText, makeSample, writePdf } from './output'
import type { Replacement } from './types'

let font: PDFFont
let fontBytes: Uint8Array
const base: Replacement = {
  region: { id:'0:1', pageIndex:0, text:'150,000', x:50, baseline:100, fontSize:12, width:45,
    rect:{x:49.5,y:95,width:46,height:20},screen:{x:49.5,y:100,width:46,height:20} },
  text:'250,000', fontSize:12, color:'#202733', align:'left',
}
beforeAll(async () => {
  fontBytes = new Uint8Array(await readFile(new URL('../../public/fonts/NotoSansJP-Regular.ttf',import.meta.url)))
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit)
  font=await doc.embedFont(fontBytes)
})

describe('text placement and validation',()=>{
  it('fits long numeric strings inside the original width',()=>{
    const fit=fitText(font,{...base,text:'123456789012345'})
    expect(fit.width).toBeLessThanOrEqual(base.region.width+0.00001)
    expect(fit.size).toBeGreaterThanOrEqual(4)
    expect(fit.size).toBeLessThan(base.fontSize)
  })
  it('places right-aligned Japanese text at the original right edge',()=>{
    const fit=fitText(font,{...base,text:'日本語',align:'right'})
    expect(fit.x+fit.width).toBeCloseTo(base.region.x+base.region.width)
  })
  it('rejects line breaks and unsupported characters before export',()=>{
    expect(()=>fitText(font,{...base,text:'a\nb'})).toThrow('改行')
    expect(()=>fitText(font,{...base,text:'🦄'})).toThrow('保存できない文字')
  })
  it('rejects invalid sizes, colors, and text too long to fit',()=>{
    expect(()=>fitText(font,{...base,fontSize:NaN})).toThrow('文字サイズ')
    expect(()=>fitText(font,{...base,color:'red'})).toThrow('文字色')
    expect(()=>fitText(font,{...base,text:'長'.repeat(200)})).toThrow('収まりません')
  })
  it('allows removing displayed text with an empty replacement',()=>{
    expect(fitText(font,{...base,text:''}).width).toBe(0)
  })
})

describe('PDF preservation and Japanese export',()=>{
  it('returns the original bytes unchanged when there are no edits',async()=>{
    const source=await makeSample(fontBytes)
    expect(Buffer.compare(await writePdf(source,{},fontBytes),source)).toBe(0)
  })
  it('preserves source bytes, page count, and the unedited page content',async()=>{
    const source=await makeSample(fontBytes), snapshot=source.slice()
    const original=await PDFDocument.load(source)
    const result=await writePdf(source,{'0:1':{...base,text:'日本語の見積書'}},fontBytes)
    const output=await PDFDocument.load(result)
    expect(Buffer.compare(source,snapshot)).toBe(0)
    expect(output.getPageCount()).toBe(2)
    expect(output.getPage(1).node.Contents()?.toString()).toBe(original.getPage(1).node.Contents()?.toString())
    expect(output.getPage(0).node.Contents()?.toString()).not.toBe(original.getPage(0).node.Contents()?.toString())
  })
})
