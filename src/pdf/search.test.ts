import {describe,it,expect} from 'vitest'
import {occurrences,replaceLiteral,searchDocument} from './search'
import type { DocumentSession } from './types'

const options={query:'Item (1).',caseSensitive:false,wholeRegion:false}
describe('literal document search and replace',()=>{
  it('handles punctuation, repeated matches, Unicode, literal dollars and complete regions',()=>{
    expect(occurrences('ITEM (1). / Item (1).',options)).toBe(2)
    expect(replaceLiteral('ITEM (1). / Item (1).','$&$1',options)).toBe('$&$1 / $&$1')
    expect(occurrences('ITEM (1).',{...options,caseSensitive:true})).toBe(0)
    expect(occurrences('Item (1).\n',{...options,wholeRegion:true})).toBe(0)
    expect(occurrences('ITEM (1).',{...options,wholeRegion:true})).toBe(1)
    expect(replaceLiteral('日本語日本語','編集',{...options,query:'日本語'})).toBe('編集編集')
    expect(()=>replaceLiteral('aa','x'.repeat(5001),{...options,query:'a'})).toThrow('10,000')
  })
  it('indexes stable IDs without rendering, uses current edits and omits covered source text',async()=>{
    const item=(str:string,x:number)=>({str,transform:[12,0,0,12,x,100]})
    const controller=new AbortController(),progress:number[]=[]
    const session={pdf:{numPages:2,getPage:async(index:number)=>({getTextContent:async()=>({items:index===1?[item(' ',0),item('OLD',10),item('KEEP',50)]:[item('OLD',20)]})})},hiddenText:[{pageIndex:0,text:'OLD',x:10,baseline:100,fontSize:12}]} as unknown as DocumentSession
    const result=await searchDocument(session,{'0:1':{text:'NEW'} as never},{...options,query:'new'},controller.signal,page=>progress.push(page))
    expect(result).toEqual([{id:'0:1',pageIndex:0,text:'NEW',count:1}]);expect(progress).toEqual([1,2])
    const hidden=await searchDocument(session,{}, {...options,query:'old'},controller.signal,()=>{})
    expect(hidden.map(hit=>hit.id)).toEqual(['1:0'])
    controller.abort();await expect(searchDocument(session,{},options,controller.signal,()=>{})).rejects.toThrow()
    const midScan=new AbortController(),visited:number[]=[]
    await expect(searchDocument(session,{},options,midScan.signal,page=>{visited.push(page);midScan.abort()})).rejects.toThrow()
    expect(visited).toEqual([1])
  })
})
