import { PDFDocument, PDFName } from 'pdf-lib'
import { MAX_FILE_SIZE, MAX_PAGES } from './limits'
import { readHiddenText, storeHiddenText } from './hidden-text'
import { readFontAssets, storeFontAssets } from './custom-fonts'

export function parsePageRange(value:string,count:number):number[]{
  const text=value.normalize('NFKC').replace(/\s/g,'')
  if(!text)throw new Error('ページ番号を指定してください。例：1,3-5')
  const pages:number[]=[]
  for(const part of text.split(',')){
    const match=/^(\d+)(?:-(\d+))?$/.exec(part)
    if(!match)throw new Error('ページは「1,3-5」のように指定してください。')
    const start=Number(match[1]),end=Number(match[2]??match[1])
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<1||start>count||end>count)throw new Error(`1〜${count}ページの範囲で指定してください。`)
    const step=start<=end?1:-1
    if(pages.length+Math.abs(end-start)+1>MAX_PAGES)throw new Error('出力は2,000ページ以内で指定してください。')
    for(let page=start;;page+=step){pages.push(page-1);if(page===end)break}
  }
  return pages
}

export async function extractPages(bytes:Uint8Array,range:string){
  const source=await PDFDocument.load(bytes),indices=parsePageRange(range,source.getPageCount()),pdf=await PDFDocument.create()
  for(const page of await pdf.copyPages(source,indices))pdf.addPage(page)
  const hidden=readHiddenText(source)
  storeHiddenText(pdf,indices.flatMap((old,pageIndex)=>hidden.filter(value=>value.pageIndex===old).map(value=>({...value,pageIndex}))))
  storeFontAssets(pdf,readFontAssets(source))
  // A new file contains the chosen pages, not a restoration project for the
  // original page order. Editable visible text is rediscovered on opening.
  for(const key of ['PDFEditorSourceV1','PDFEditorProjectV1','PDFEditorTemplate'])pdf.catalog.delete(PDFName.of(key))
  const result=await pdf.save()
  if(result.length>MAX_FILE_SIZE)throw new Error('出力PDFが100 MBを超えます。ページを減らしてください。')
  return result
}
