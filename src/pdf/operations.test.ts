import {describe,it,expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'
import {blankDocument,operateDocument} from './operations'
import {readHiddenText,storeHiddenText} from './hidden-text'

describe('document operations preserve original pages and indices',()=>{
  it('duplicates an independent page and its hidden-text metadata while shifting following pages',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText('COPY');pdf.addPage([500,600])
    storeHiddenText(pdf,[{pageIndex:0,text:'HIDDEN',x:10,baseline:20,fontSize:12},{pageIndex:1,text:'LATER',x:10,baseline:20,fontSize:12}])
    const result=await operateDocument(await pdf.save(),{type:'page-duplicate',index:0}),parsed=await PDFDocument.load(result.bytes)
    expect(result.active).toBe(1);expect([...result.pageMap]).toEqual([[0,0],[1,2]])
    expect(parsed.getPage(0).ref).not.toEqual(parsed.getPage(1).ref)
    expect(parsed.getPages().map(page=>page.getSize().width)).toEqual([300,300,500])
    expect(readHiddenText(parsed).map(value=>[value.text,value.pageIndex])).toEqual([['HIDDEN',0],['LATER',2],['HIDDEN',1]])
  })
  it('adds, reorders, rotates and deletes pages without changing the source bytes',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText('FIRST');pdf.addPage([500,600]).drawText('SECOND')
    const original=await pdf.save(),copy=original.slice()
    const moved=await operateDocument(original,{type:'page-move',index:1,to:0})
    expect([...moved.pageMap]).toEqual([[0,1],[1,0]])
    expect((await PDFDocument.load(moved.bytes)).getPage(0).getSize()).toEqual({width:500,height:600})
    const rotated=await operateDocument(moved.bytes,{type:'page-rotate',index:0})
    expect((await PDFDocument.load(rotated.bytes)).getPage(0).getRotation().angle).toBe(90)
    const added=await operateDocument(rotated.bytes,{type:'page-add',index:0})
    expect([...added.pageMap]).toEqual([[0,0],[1,2]])
    expect((await PDFDocument.load(added.bytes)).getPageCount()).toBe(3)
    const removed=await operateDocument(added.bytes,{type:'page-delete',index:1})
    expect([...removed.pageMap]).toEqual([[0,0],[2,1]])
    expect((await PDFDocument.load(removed.bytes)).getPageCount()).toBe(2)
    expect(original).toEqual(copy)
  })
  it('merges pages while preserving page sizes and rejects invalid page operations',async()=>{
    const a=await blankDocument(),pdf=await PDFDocument.create();pdf.addPage([250,350]);const b=await pdf.save()
    const merged=await operateDocument(a,{type:'merge',bytes:b})
    const result=await PDFDocument.load(merged.bytes)
    expect(result.getPageCount()).toBe(2);expect(result.getPage(1).getSize()).toEqual({width:250,height:350})
    await expect(operateDocument(a,{type:'page-delete',index:0})).rejects.toThrow('最後の1ページ')
    await expect(operateDocument(a,{type:'page-rotate',index:4})).rejects.toThrow('見つかりません')
    await expect(operateDocument(a,{type:'page-move',index:0,to:-1})).rejects.toThrow('移動先')
  })
})
