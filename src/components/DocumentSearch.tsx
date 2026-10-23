import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { replaceLiteral, searchDocument, type SearchHit, type SearchOptions } from '../pdf/search'
import type { DocumentSession, Edits } from '../pdf/types'

export type BatchReport={changed:number;skipped:{page:number;text:string;reason:string}[]}
export function DocumentSearch({session,edits,busy,onClose,onJump,onReplace}:{session:DocumentSession;edits:Edits;busy:boolean;onClose:()=>void;onJump:(hit:SearchHit)=>Promise<void>;onReplace:(hits:SearchHit[],replacement:string,options:SearchOptions)=>Promise<BatchReport>}){
  const [query,setQuery]=useState(''),[replacement,setReplacement]=useState(''),[caseSensitive,setCaseSensitive]=useState(false),[wholeRegion,setWholeRegion]=useState(false)
  const [hits,setHits]=useState<SearchHit[]>([]),[chosen,setChosen]=useState(new Set<string>()),[offset,setOffset]=useState(0)
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[searched,setSearched]=useState(false),[report,setReport]=useState<BatchReport|null>(null)
  const task=useRef<AbortController|null>(null)
  const options={query,caseSensitive,wholeRegion},locked=running||busy
  useEffect(()=>{task.current?.abort();setHits([]);setChosen(new Set());setSearched(false);setOffset(0)},[session,edits,query,caseSensitive,wholeRegion])
  useEffect(()=>()=>task.current?.abort(),[])
  async function find(){
    const controller=new AbortController();task.current?.abort();task.current=controller
    setRunning(true);setError('');setReport(null);setProgress('検索を開始しています…')
    try{
      const next=await searchDocument(session,edits,options,controller.signal,(page,total)=>setProgress(`${page} / ${total}ページを検索中…`))
      setHits(next);setChosen(new Set(next.map(hit=>hit.id)));setOffset(0);setSearched(true);setProgress('')
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'検索できませんでした。');else setProgress('検索を中止しました。')}
    finally{if(task.current===controller)setRunning(false)}
  }
  async function apply(){
    setError('');setReport(null)
    try{const result=await onReplace(hits.filter(hit=>chosen.has(hit.id)),replacement,options);setReport(result)}
    catch(error){setError(error instanceof Error?error.message:'置換できませんでした。')}
  }
  const pages=Math.ceil(hits.length/100),current=Math.floor(offset/100)+1
  const preview=(text:string)=>{try{return replaceLiteral(text,replacement,options)||'（削除）'}catch{return '置換後の文字数を確認してください'}}
  return <div className="modal-backdrop"><section className="help-modal document-search" role="dialog" aria-modal="true" aria-labelledby="document-search-title">
    <div className="help-heading"><h2 id="document-search-title">全文検索・一括置換</h2><button type="button" className="icon-button" aria-label="全文検索を閉じる" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <p>全ページの文字情報を検索します。選んだ領域を、元の書式・位置・自動調整を引き継いで置換できます。画像内の文字や複数領域をまたぐ語句は検索できません。</p>
    <div className="field-group"><label>検索する文字<input autoFocus value={query} disabled={locked} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void find()}}/></label><label>置換する文字<input value={replacement} disabled={locked} onChange={e=>setReplacement(e.target.value)}/></label></div>
    <div className="search-options"><label><input type="checkbox" checked={caseSensitive} disabled={locked} onChange={e=>setCaseSensitive(e.target.checked)}/>大文字・小文字を区別</label><label><input type="checkbox" checked={wholeRegion} disabled={locked} onChange={e=>setWholeRegion(e.target.checked)}/>領域全体が一致</label></div>
    <div className="search-actions"><button type="button" className="button secondary" disabled={locked||!query} onClick={()=>void find()}>全ページを検索</button>{running&&<button type="button" className="button secondary" onClick={()=>task.current?.abort()}>検索を中止</button>}<span role="status">{progress|| (searched?`${hits.length}領域・${hits.reduce((sum,hit)=>sum+hit.count,0)}箇所が一致`:'')}</span></div>
    {error&&<p className="batch-error" role="alert">{error}</p>}
    {searched&&hits.length>0&&<><label className="option-check"><input type="checkbox" aria-label="検索結果をすべて選択" checked={chosen.size===hits.length} disabled={locked} onChange={e=>setChosen(e.target.checked?new Set(hits.map(hit=>hit.id)):new Set())}/>すべて選択（{chosen.size} / {hits.length}領域）</label>
      <div className="search-results">{hits.slice(offset,offset+100).map(hit=><div className="search-result" key={hit.id}><input type="checkbox" aria-label={`${hit.pageIndex+1}ページ ${hit.text} を置換対象にする`} checked={chosen.has(hit.id)} disabled={locked} onChange={e=>{const next=new Set(chosen);if(e.target.checked)next.add(hit.id);else next.delete(hit.id);setChosen(next)}}/><button type="button" disabled={locked} onClick={()=>void onJump(hit)}><small>{hit.pageIndex+1}ページ · {hit.count}箇所</small><span>{hit.text}</span><span className="replacement-preview">→ {preview(hit.text)}</span></button></div>)}</div>
      {pages>1&&<div className="search-actions"><button type="button" className="button secondary" disabled={locked||!offset} onClick={()=>setOffset(offset-100)}>前の100件</button><span>{current} / {pages}</span><button type="button" className="button secondary" disabled={locked||offset+100>=hits.length} onClick={()=>setOffset(offset+100)}>次の100件</button></div>}
      <button type="button" className="button primary" disabled={locked||!chosen.size} onClick={()=>void apply()}>選択した{chosen.size}領域を置換</button><p>編集できない領域は理由を表示して除外します。適用した置換は「元に戻す」でまとめて取り消せます。</p></>}
    {report&&<div className="batch-report" role="status"><strong>{report.changed}領域を置換しました。{report.skipped.length}領域は変更していません。</strong>{report.skipped.length>0&&<ul>{report.skipped.map((value,index)=><li key={index}>{value.page}ページ「{value.text}」：{value.reason}</li>)}</ul>}</div>}
  </section></div>
}
