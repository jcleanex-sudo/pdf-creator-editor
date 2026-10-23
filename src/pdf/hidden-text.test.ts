import {describe,it,expect} from 'vitest'
import {PDFDocument,PDFName} from 'pdf-lib'
import {readHiddenText,storeHiddenText,visibleTextRegions,type HiddenText} from './hidden-text'
import {operateDocument} from './operations'
import type {TextRegion} from './types'

const hidden:HiddenText={pageIndex:0,text:'OLD',x:50,baseline:100,fontSize:12}
const region=(id:string,value=hidden)=>({...value,id}) as TextRegion

describe('covered source text registry',()=>{
  it('hides only the recorded number of earlier copies and keeps new identical text selectable',()=>{
    expect(visibleTextRegions([region('old'),region('new'),region('else',{...hidden,text:'OTHER'})],[hidden]).map(r=>r.id)).toEqual(['new','else'])
    expect(visibleTextRegions([region('one'),region('two'),region('three')],[hidden,hidden]).map(r=>r.id)).toEqual(['three'])
  })
  it('round trips metadata and remaps it when pages move, merge or disappear',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();storeHiddenText(pdf,[hidden])
    const bytes=await pdf.save()
    expect(readHiddenText(await PDFDocument.load(bytes))).toEqual([hidden])
    const moved=await operateDocument(bytes,{type:'page-move',index:0,to:1})
    expect(readHiddenText(await PDFDocument.load(moved.bytes))).toEqual([{...hidden,pageIndex:1}])
    const merged=await operateDocument(moved.bytes,{type:'merge',bytes})
    expect(readHiddenText(await PDFDocument.load(merged.bytes))).toEqual([{...hidden,pageIndex:1},{...hidden,pageIndex:2}])
    const deleted=await operateDocument(moved.bytes,{type:'page-delete',index:1})
    expect(readHiddenText(await PDFDocument.load(deleted.bytes))).toEqual([])
  })
  it('ignores malformed metadata instead of trusting embedded data',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage()
    pdf.catalog.set(PDFName.of('PDFEditorHiddenTextV1'),pdf.context.register(pdf.context.stream(new TextEncoder().encode(JSON.stringify([{...hidden,pageIndex:-1}])))))
    expect(readHiddenText(pdf)).toEqual([])
    pdf.catalog.set(PDFName.of('PDFEditorHiddenTextV1'),pdf.context.register(pdf.context.stream(new TextEncoder().encode('{bad'))))
    expect(readHiddenText(pdf)).toEqual([])
  })
})
