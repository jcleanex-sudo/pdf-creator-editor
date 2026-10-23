import { PDFName, PDFRawStream, type PDFDocument } from 'pdf-lib'
import type { TextRegion } from './types'
import { MAX_PAGES } from './limits'

export type HiddenText=Pick<TextRegion,'pageIndex'|'text'|'x'|'baseline'|'fontSize'>
const key=PDFName.of('PDFEditorHiddenTextV1')
const fingerprint=(value:HiddenText)=>JSON.stringify([value.pageIndex,value.text,value.x.toFixed(4),value.baseline.toFixed(4),value.fontSize.toFixed(4)])
export function readHiddenText(pdf:PDFDocument):HiddenText[]{
  if(!pdf.catalog.has(key))return []
  const stream=pdf.context.lookup(pdf.catalog.get(key))
  if(!(stream instanceof PDFRawStream)||stream.dict.has(PDFName.of('Filter'))||stream.contents.length>16*1024*1024)return []
  try{
    const values:unknown=JSON.parse(new TextDecoder().decode(stream.contents))
    if(!Array.isArray(values)||values.length>100_000)return []
    if(values.some(v=>!v||typeof v!=='object'||!Number.isInteger(v.pageIndex)||v.pageIndex<0||v.pageIndex>=MAX_PAGES||typeof v.text!=='string'||v.text.length>1_000_000||![v.x,v.baseline,v.fontSize].every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1_000_000)))return []
    return values
  }catch{return []}
}
export function storeHiddenText(pdf:PDFDocument,values:HiddenText[]){
  const bytes=new TextEncoder().encode(JSON.stringify(values))
  if(bytes.length>16*1024*1024)throw new Error('編集データが大きすぎます。')
  if(values.length)pdf.catalog.set(key,pdf.context.register(pdf.context.stream(bytes)))
  else pdf.catalog.delete(key)
}
export function visibleTextRegions<T extends HiddenText>(regions:T[],hidden:HiddenText[]):T[]{
  const counts=new Map<string,number>()
  for(const value of hidden){const id=fingerprint(value);counts.set(id,(counts.get(id)??0)+1)}
  return regions.filter(region=>{const id=fingerprint(region),remaining=counts.get(id)??0;if(!remaining)return true;counts.set(id,remaining-1);return false})
}
export const describeHiddenText=({pageIndex,text,x,baseline,fontSize}:TextRegion):HiddenText=>({pageIndex,text,x,baseline,fontSize})
