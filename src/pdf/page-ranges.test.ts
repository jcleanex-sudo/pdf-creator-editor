import {describe,it,expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'
import {parsePageRange,extractPages} from './page-ranges'
import {readProject,storeProject} from './project'
import {readHiddenText,storeHiddenText} from './hidden-text'

describe('page range exports',()=>{
  it('supports reversed and repeated pages, normalizes full width digits and rejects invalid or excessive ranges',()=>{
    expect(parsePageRange('３-１, ２',3)).toEqual([2,1,0,1])
    for(const value of ['0','4','1,,2','1.5','1-','all',''])expect(()=>parsePageRange(value,3)).toThrow()
    expect(()=>parsePageRange('1-2000,1',2000)).toThrow('2,000')
  })
  it('preserves requested page size/order, remaps hidden text and does not restore an unrelated project',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage([200,300]).drawText('ONE');pdf.addPage([400,500]).drawText('TWO')
    storeHiddenText(pdf,[{pageIndex:1,text:'COVERED',x:20,baseline:50,fontSize:12}]);storeProject(pdf,new Uint8Array([1]),{},null)
    const bytes=await pdf.save(),original=bytes.slice(),result=await PDFDocument.load(await extractPages(bytes,'2,1,2'))
    expect(result.getPages().map(page=>page.getSize())).toEqual([{width:400,height:500},{width:200,height:300},{width:400,height:500}])
    expect(readHiddenText(result).map(value=>value.pageIndex)).toEqual([0,2]);expect(readProject(result)).toBeNull();expect(bytes).toEqual(original)
  })
})
