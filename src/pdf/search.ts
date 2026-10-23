import type { DocumentSession, Edits } from './types'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { visibleTextRegions } from './hidden-text'
import { MAX_TEXT_LENGTH } from './limits'

export type SearchOptions={query:string;caseSensitive:boolean;wholeRegion:boolean}
export type SearchHit={id:string;pageIndex:number;text:string;count:number}

function pattern(options:SearchOptions){
  if(!options.query)throw new Error('検索する文字を入力してください。')
  if(options.query.length>MAX_TEXT_LENGTH)throw new Error('検索文字が長すぎます。')
  const literal=options.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return new RegExp(options.wholeRegion?`^(?:${literal})(?![\\s\\S])`:literal,options.caseSensitive?'gu':'giu')
}
export function occurrences(text:string,options:SearchOptions){return [...text.matchAll(pattern(options))].length}
export function replaceLiteral(text:string,replacement:string,options:SearchOptions){
  // A function replacement keeps user-entered $&, $1 and $$ literal.
  const next=text.replace(pattern(options),()=>replacement)
  if(next.length>MAX_TEXT_LENGTH)throw new Error('置換後の文字が10,000文字を超えます。')
  return next
}

export async function searchDocument(session:DocumentSession,edits:Edits,options:SearchOptions,signal:AbortSignal,onProgress:(page:number,total:number)=>void){
  pattern(options)
  const hits:SearchHit[]=[]
  for(let index=0;index<session.pdf.numPages;index++){
    signal.throwIfAborted()
    const page=await session.pdf.getPage(index+1),content=await page.getTextContent()
    signal.throwIfAborted()
    // Use the exact same nonblank item ordering and fingerprints as reader.ts.
    // Searching does not render pages or retain large background rasters.
    const items=content.items.filter((item):item is TextItem=>'str' in item&&!!item.str.trim())
    const regions=visibleTextRegions(items.map((item,itemIndex)=>({id:`${index}:${itemIndex}`,pageIndex:index,text:item.str,x:item.transform[4],baseline:item.transform[5],fontSize:Math.hypot(item.transform[2],item.transform[3])})),session.hiddenText??[])
    for(const region of regions){
      const text=edits[region.id]?.text??region.text,count=occurrences(text,options)
      if(count)hits.push({id:region.id,pageIndex:index,text,count})
    }
    onProgress(index+1,session.pdf.numPages)
    // Let cancellation, progress and keyboard events run between pages.
    await new Promise(resolve=>setTimeout(resolve,0))
  }
  return hits
}
