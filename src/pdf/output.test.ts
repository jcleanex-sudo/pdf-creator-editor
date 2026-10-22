import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PDFDocument, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { fitText, makeSample, writePdf } from './output'
import type { Replacement } from './types'
import { glyphMetrics, registerGlyphMetrics } from './glyph-metrics'

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
  registerGlyphMetrics(font, fontBytes)
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
  it('keeps the point size for modest width differences using horizontal fitting',()=>{
    const natural = font.widthOfTextAtSize(base.text, base.fontSize)
    const fit = fitText(font, { ...base, region: { ...base.region, width: natural * 0.9 } })
    expect(fit.size).toBe(base.fontSize)
    expect(fit.scaleX).toBeCloseTo(0.9)
    expect(fit.width).toBeCloseTo(natural * 0.9)
  })
  it('fits digits in a short table cell using their actual outlines, without reserving unrelated descenders',()=>{
    const edit: Replacement = { ...base, text:'166', fontSize:9, align:'right', region: {
      ...base.region, tightBounds:true, fontSize:9, x:50, width:15,
      rect:{x:49.5,y:99,width:16,height:9},baseline:100,
    } }
    const fit=fitText(font,edit), ink=glyphMetrics(font,edit.text)!
    expect(fit.size).toBe(9)
    expect(edit.region.baseline-ink.descent*fit.size).toBeGreaterThanOrEqual(edit.region.rect.y+0.35)
    expect(fit.x+ink.left*fit.size*fit.scaleX).toBeGreaterThanOrEqual(edit.region.rect.x+0.1)
    expect(fit.x+ink.right*fit.size*fit.scaleX).toBeLessThanOrEqual(edit.region.rect.x+edit.region.rect.width-0.1+1e-7)
  })
  it('moves a comma baseline within the cell instead of making the replacement illegibly small',()=>{
    const edit: Replacement = { ...base, text:'30,001', fontSize:9, align:'right', region: {
      ...base.region, tightBounds:true, fontSize:9, x:50, width:27,
      rect:{x:49.5,y:99.05,width:28,height:9.18},baseline:100,
    } }
    const fit=fitText(font,edit), ink=glyphMetrics(font,edit.text)!
    expect(fit.size).toBeGreaterThanOrEqual(8)
    expect(fit.baseline).toBeGreaterThan(100)
    expect(fit.baseline-ink.descent*fit.size).toBeGreaterThanOrEqual(edit.region.rect.y+0.35-1e-7)
    expect(fit.baseline+ink.ascent*fit.size).toBeLessThanOrEqual(edit.region.rect.y+edit.region.rect.height-0.35+1e-7)
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
