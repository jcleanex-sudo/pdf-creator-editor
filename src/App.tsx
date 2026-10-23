import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, FilePlus2, FileText, FolderOpen, Info, Layers, LoaderCircle, LockKeyhole, MousePointer2, RotateCcw, RotateCw, ShieldCheck, Type, Upload, X, ZoomIn, ZoomOut, Plus, ImagePlus, Square, Trash2, RotateCwSquare, ArrowUp, ArrowDown, Printer, Files } from 'lucide-react'
import { PdfPage, Thumbnail } from './components/PdfPage'
import { CalculationPanel } from './components/CalculationPanel'
import { calculateTotal, formatAmount, recalculate, sampleCalculation, type CalculationRule } from './pdf/calculation'
import { editRestriction, loadPage, MAX_FILE_SIZE, openPdf, readPdf, prepareEditBackground, EncryptedPdfError, remapDocumentEdits } from './pdf/reader'
import { createFontResolver, replacementFontLabel, replacementFontWarning, fitText, loadJapaneseFont, makeSample, writePdf } from './pdf/output'
import type { DocumentSession, Edits, PageModel, Replacement, TextRegion } from './pdf/types'
import { getLicenseUrl, portableAssets } from './pdf/portable'
import { originalColor, originalAlign } from './pdf/appearance'
import { describeHiddenText } from './pdf/hidden-text'
import { unlockVisualCopy } from './pdf/unlock'
import { InsertionPanel, type ToolMode, type Insertion } from './components/InsertionPanel'
import { blankDocument, operateDocument, placementAt, type DocumentOperation } from './pdf/operations'

type SourceDocument={bytes:Uint8Array;name:string}
type Snapshot = { edits: Edits; calculation: CalculationRule | null; document:SourceDocument|null }
type History = { past: Snapshot[]; present: Snapshot; future: Snapshot[] }
type Action = { type: 'set'; edits: Edits; calculation?: CalculationRule | null; document?:SourceDocument } | { type: 'clear'; edits?: Edits; calculation?: CalculationRule | null; document?:SourceDocument } | { type: 'undo' | 'redo' }
const emptyHistory: History = { past: [], present: { edits: {}, calculation: null, document:null }, future: [] }
function historyReducer(state: History, action: Action): History {
  if (action.type === 'clear') return { past: [], present: { edits: action.edits ?? {}, calculation: action.calculation ?? null, document:action.document??null }, future: [] }
  if(action.type==='set'){
    const present={edits:action.edits,calculation:action.calculation===undefined?state.present.calculation:action.calculation,document:action.document??state.present.document}
    const candidates=[...state.past.slice(-39),state.present],past:Snapshot[]=[],seen=new Set<SourceDocument>()
    let total=0
    if(present.document){seen.add(present.document);total=present.document.bytes.length}
    for(const item of candidates.reverse()){
      if(item.document&&!seen.has(item.document)){total+=item.document.bytes.length;if(total>256*1024*1024)break;seen.add(item.document)}
      past.unshift(item)
    }
    return {past,present,future:[]}
  }
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0,-1), present: state.past.at(-1)!, future: [state.present, ...state.future] }
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
  return state
}
type Draft = Omit<Replacement, 'region'>
const messageOf = (error: unknown) => error instanceof Error ? error.message : '処理に失敗しました。別のPDFでお試しください。'
const formatSize = (size: number) => size >= 1024*1024 ? `${(size/1024/1024).toFixed(1)} MB` : `${Math.ceil(size/1024)} KB`

export default function App() {
  const [passwordFile,setPasswordFile]=useState<{bytes:Uint8Array;name:string}|null>(null)
  const [password,setPassword]=useState('')
  const [passwordError,setPasswordError]=useState('')
  const [toolMode,setToolMode]=useState<ToolMode>('select')
  const [areaText,setAreaText]=useState('')
  const [area,setArea]=useState({x:40,y:80,width:240,height:60})
  const mergeInput=useRef<HTMLInputElement>(null)
  const [session, setSession] = useState<DocumentSession | null>(null)
  const [history, dispatch] = useReducer(historyReducer, emptyHistory)
  const { edits, calculation } = history.present
  const [pageIndex, setPageIndex] = useState(0)
  const [model, setModel] = useState<PageModel | null>(null)
  const [preview, setPreview] = useState<{ pdf: PDFDocumentProxy; bytes: Uint8Array; edits: Edits; calculation: CalculationRule | null; owned?:boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [validating, setValidating] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<TextRegion | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [actualSize, setActualSize] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [downloadRequested, setDownloadRequested] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const loadVersion = useRef(0)
  const busy = loading || building || validating
  const saved = selected ? edits[selected.id] : undefined
  const dirty = !!draft && !!selected && (draft.text !== (saved?.text ?? selected.text) || draft.fontSize !== (saved?.fontSize ?? selected.fontSize) || draft.color !== (saved?.color ?? originalColor(selected)) || draft.align !== (saved?.align ?? originalAlign(selected)) || draft.autoFit !== (saved?.autoFit ?? true) || draft.family !== (saved?.family ?? 'auto') || draft.bold !== (saved?.bold ?? selected.appearance?.bold ?? false) || draft.offsetX !== (saved?.offsetX ?? 0) || draft.offsetY !== (saved?.offsetY ?? 0))
  const editCount = Object.keys(edits).length
  const calculatedTarget = calculation?.target.id === selected?.id && !!calculation
  const restriction = selected && model ? editRestriction(selected, model) || (calculatedTarget
    ? 'この合計欄は自動計算で更新します。明細金額を変更してください。' : undefined) : undefined
  const reportError = useCallback((message: string) => setError(message), [])

  useEffect(() => {
    if (!selected) { setDraft(null); return }
    setDraft({ text: saved?.text ?? selected.text, fontSize: saved?.fontSize ?? selected.fontSize, color: saved?.color ?? originalColor(selected), align: saved?.align ?? originalAlign(selected), autoFit:saved?.autoFit??true, family:saved?.family??'auto', bold:saved?.bold??selected.appearance?.bold??false, offsetX:saved?.offsetX??0, offsetY:saved?.offsetY??0 })
    setActualSize(null)
  }, [selected, saved])

  useEffect(() => {
    if (!session) return
    let canceled = false
    setModel(null)
    void loadPage(session,pageIndex).then(value => { if (!canceled) setModel(value) }).catch(e => { if (!canceled) setError(messageOf(e)) })
    return () => { canceled = true }
  }, [session,pageIndex])

  useEffect(() => {
    if (!session) return
    let canceled = false
    let owned: PDFDocumentProxy | undefined
    let transferred = false
    let task: ReturnType<typeof readPdf> | undefined
    setPreviewError(false)
    if (!Object.keys(edits).length) {
      setPreview({ pdf: session.pdf, bytes: session.bytes, edits, calculation }); setBuilding(false)
      return
    }
    setBuilding(true)
    void (async () => {
      const bytes = await writePdf(session.bytes, edits, await loadJapaneseFont(), calculation)
      if (canceled) return
      task = readPdf(bytes)
      owned = await task.promise
      if (canceled) { await owned.loadingTask.destroy(); return }
      transferred = true
      setPreview({ pdf: owned, bytes, edits, calculation, owned:true }); setBuilding(false)
    })().catch(e => { if (!canceled) { setError(messageOf(e)); setBuilding(false); setPreviewError(true) } })
    // Keep the displayed worker alive while the next preview is being built.
    // Ownership moves to preview state only after it has been published.
    return () => { canceled = true; if (!transferred) { if (owned) void owned.loadingTask.destroy(); else if (task) void task.destroy() } }
  }, [session,edits,calculation])

  useEffect(() => () => { if (preview?.owned) void preview.pdf.loadingTask.destroy() }, [preview])

  useEffect(() => {
    if (!downloadRequested) return
    if (previewError) { setDownloadRequested(false); return }
    if (!busy && preview?.edits === edits && preview.calculation === calculation && !dirty) download()
  })

  useEffect(() => () => { if (session) void session.pdf.loadingTask.destroy() }, [session])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (editCount || dirty || history.past.length) event.preventDefault() }
    window.addEventListener('beforeunload',beforeUnload)
    return () => window.removeEventListener('beforeunload',beforeUnload)
  }, [editCount,dirty,history.past.length])

  const canLeaveDraft = () => !dirty || window.confirm('入力中の変更を破棄しますか？「変更を適用」でPDFに反映できます。')
  const chooseRegion = (region: TextRegion) => { setToolMode('select'); if (selected?.id !== region.id && canLeaveDraft()) { setSelected(region); setNotice(''); setError('') } }
  const changePage = (index: number) => {
    if (!session || index===pageIndex || index<0 || index>=session.pdf.numPages || !canLeaveDraft()) return
    setSelected(null); setModel(null); setPageIndex(index); setError('')
    workspace.current?.scrollTo({ top: 0, left: 0 })
  }

  async function openBytes(bytes: Uint8Array, name: string) {
    const version = ++loadVersion.current
    setLoading(true); setError(''); setNotice('')
    try {
      const next = await openPdf(bytes,name)
      const firstPage = await loadPage(next,0).catch(async e => { await next.pdf.loadingTask.destroy(); throw e })
      if (version !== loadVersion.current) { await next.pdf.loadingTask.destroy(); return }
      setPreview(null); setSelected(null); setModel(null); setToolMode('select')
      setSession(next); setPageIndex(0); dispatch({ type:'clear', document:{bytes:next.bytes,name:next.name}, edits: next.restored?.edits,
        calculation: next.restored ? next.restored.calculation : next.sampleEstimate ? sampleCalculation(firstPage) : null }); setDownloadRequested(false); setZoom(1)
      if(next.signed)setNotice('署名欄のあるPDFです。編集・保存すると電子署名は無効になります。')
      if (next.restored) setNotice('保存時の編集データから再開しました。別のアプリで保存後に加えた変更は引き継がれないため、プレビューをご確認ください。')
    } catch (e) { if (version === loadVersion.current) {if(e instanceof EncryptedPdfError){setPasswordFile({bytes,name});setPassword('');setPasswordError('')}else setError(messageOf(e))} }
    finally { if (version === loadVersion.current) setLoading(false) }
  }
  const allowOpen = () => !(editCount || dirty || history.past.length) || window.confirm('別のPDFを開くと、現在の編集履歴は消えます。必要な変更はPDFを保存してください。続けますか？')
  async function openFile(file: File) {
    if (busy || !allowOpen()) return
    if (file.size > MAX_FILE_SIZE) { setError('100 MBまでのPDFを選択してください。'); return }

    try { await openBytes(new Uint8Array(await file.arrayBuffer()),file.name) } catch(e) { setError(messageOf(e)) }
  }
  async function unlockFile(){
    if(!passwordFile||busy)return
    setLoading(true);setPasswordError('')
    try{
      const bytes=await unlockVisualCopy(passwordFile.bytes,password,(current,total)=>setNotice(`画像化した編集用コピーを作成中… ${current} / ${total}ページ`))
      const name=passwordFile.name.replace(/\.pdf$/iu,'')+'_画像コピー.pdf'
      setPassword('');setPasswordFile(null)
      await openBytes(bytes,name)
      setNotice('画像化したコピーを開きました。範囲書き換え・文字追加で編集できます。元PDFの文字情報やリンクはコピーに含まれません。')
    }catch(error){setPasswordError(String(error).includes('Password')?'パスワードが正しいか確認してください。':messageOf(error));setNotice('')}
    finally{setLoading(false)}
  }
  async function openSample() {
    if (busy || !allowOpen()) return
    setLoading(true); setError('')
    try { await openBytes(await makeSample(await loadJapaneseFont()),'サンプル見積書.pdf') }
    catch(e) { setError(messageOf(e)); setLoading(false) }
  }
  async function applyEdit(saveAfter = false) {
    if (!draft || !selected || !session || !model || busy) return
    if (restriction) { setError(restriction); return }
    setValidating(true); setError(''); setNotice('')
    try {
      const edit: Replacement = { ...draft, region:selected }
      const { next, resolveFont } = await validateEdits({ ...edits, [selected.id]: edit }, calculation)
      const fitted = fitText(await resolveFont(edit),edit)
      setActualSize(fitted.size)
      dispatch({ type:'set', edits: next })
      if (saveAfter) setDownloadRequested(true)
      setNotice(calculation && calculation.sources.some(source => source.id === selected.id)
        ? `明細と合計を更新しました。合計 ${formatAmount(calculateTotal(calculation, next).total)}円（消費税${calculation.taxPercent}%）。`
        : '変更を反映しました。保存前にプレビューをご確認ください。')
    } catch(e) { setError(messageOf(e)) }
    finally { setValidating(false) }
  }
  async function validateEdits(proposed: Edits, rule: CalculationRule | null) {
    const doc = await PDFDocument.create()
    const resolveFont = createFontResolver(doc, await loadJapaneseFont(), true)
    for (const edit of Object.values(proposed)) { await prepareEditBackground(session!, edit.region); fitText(await resolveFont(edit), edit) }
    const next = rule ? recalculate(proposed, rule) : proposed
    if (rule) { await prepareEditBackground(session!, rule.target); fitText(await resolveFont(next[rule.target.id]), next[rule.target.id]) }
    return { next, resolveFont }
  }
  async function configureCalculation(rule: CalculationRule) {
    if (!model || busy || !canLeaveDraft()) return
    setValidating(true); setError(''); setNotice('')
    try {
      if ([...rule.sources, rule.target].some(region => !model.regions.includes(region) || editRestriction(region, model)))
        throw new Error('自動計算には、同じページの編集できる金額欄を選択してください。')
      const { next } = await validateEdits(edits, rule)
      dispatch({ type:'set', edits: next, calculation: rule })
      setSelected(null)
      setNotice('自動計算を設定しました。明細金額を変更すると合計も更新します。')
    } catch (error) { setError(messageOf(error)) }
    finally { setValidating(false) }
  }
  async function resetSelectedEdit() {
    if (!selected || busy || calculatedTarget) return
    setValidating(true); setError('')
    try {
      const proposed = { ...edits }; delete proposed[selected.id]
      const { next } = await validateEdits(proposed, calculation)
      dispatch({ type:'set', edits: next })
      setNotice(calculation ? '変更を取り消し、合計も更新しました。' : '変更を取り消しました。')
    } catch (error) { setError(messageOf(error)) }
    finally { setValidating(false) }
  }
  function download() {
    if (!session || !preview || preview.edits !== edits || preview.calculation !== calculation || busy || previewError) return
    if(toolMode!=='select'){setError('追加・書き換えのボタンで反映してから保存してください。');return}
    if (dirty) { void applyEdit(true); return }
    setDownloadRequested(false)
    const url = URL.createObjectURL(new Blob([preview.bytes.slice().buffer], { type:'application/pdf' }))
    const anchor = document.createElement('a')
    anchor.href=url; anchor.download=`${session.name.replace(/\.pdf$/iu,'')}_edited.pdf`
    document.body.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url),60_000)
    setNotice('PDFのダウンロードを開始しました。元のファイルは上書きしません。')
  }
  async function moveHistory(type:'undo'|'redo') {
    const snapshot=type==='undo'?history.past.at(-1):history.future[0]
    if(busy||!snapshot||!canLeaveDraft())return
    setLoading(true);setError('')
    let prepared:DocumentSession|undefined
    try{
      if(snapshot.document&&snapshot.document!==history.present.document){
        prepared=await openPdf(snapshot.document.bytes,snapshot.document.name,false)
        const index=Math.min(pageIndex,prepared.pdf.numPages-1)
        await loadPage(prepared,index)
        setPreview(null);setSelected(null);setModel(null);setSession(prepared);setPageIndex(index);setToolMode('select')
      }
      dispatch({type});setNotice(type==='undo'?'変更を元に戻しました。':'変更をやり直しました。')
    }catch(error){if(prepared)void prepared.pdf.loadingTask.destroy();setError(messageOf(error))}
    finally{setLoading(false)}
  }
  const undo=()=>void moveHistory('undo'),redo=()=>void moveHistory('redo')
  function selectTool(mode:ToolMode){
    if(busy||!canLeaveDraft())return
    setSelected(null);setToolMode(mode);setAreaText('');setError('')
    if(model)setArea({x:Math.min(40,model.width/10),y:Math.min(80,model.height/10),width:Math.min(240,model.width*0.7),height:Math.min(80,model.height*0.3)})
  }
  async function newPdf(){if(!busy&&allowOpen())await openBytes(await blankDocument(),'新しいPDF.pdf')}
  async function changeDocument(operation:DocumentOperation){
    if(!session||busy||!canLeaveDraft())return
    setLoading(true);setError('');setNotice('')
    let next:DocumentSession|undefined
    try{
      const result=await operateDocument(session.bytes,operation)
      next=await openPdf(result.bytes,session.name,false)
      await loadPage(next,result.active)
      const discarded=operation.type==='text'&&operation.cover?operation.hidden??[]:[]
      const hiddenIds=new Set(Object.values(edits).filter(edit=>discarded.some(value=>value.pageIndex===edit.region.pageIndex&&value.text===edit.region.text&&Math.abs(value.x-edit.region.x)<0.05&&Math.abs(value.baseline-edit.region.baseline)<0.05)).map(edit=>edit.region.id))
      const retained=Object.fromEntries(Object.entries(edits).filter(([id])=>!hiddenIds.has(id)))
      const rule=calculation&&[...calculation.sources,calculation.target].some(region=>discarded.some(value=>value.pageIndex===region.pageIndex&&value.text===region.text&&Math.abs(value.x-region.x)<0.05&&Math.abs(value.baseline-region.baseline)<0.05))?null:calculation
      const snapshot=await remapDocumentEdits(next,retained,rule,result.pageMap)
      setPreview(null);setSelected(null);setModel(null);setSession(next);setPageIndex(result.active);setToolMode('select')
      dispatch({type:'set',...snapshot,document:{bytes:next.bytes,name:next.name}})
      setNotice('変更を反映しました。「元に戻す」で取り消せます。')
    }catch(error){if(next)void next.pdf.loadingTask.destroy();setError(messageOf(error))}
    finally{setLoading(false)}
  }
  async function insert(content:Insertion){
    if(!session)return
    try{const {kind,rect,...values}=content
      const hidden=content.kind==='text'&&content.cover&&model?model.regions.filter(region=>region.screen.x>=rect.x-0.01&&region.screen.y>=rect.y-0.01&&region.screen.x+region.screen.width<=rect.x+rect.width+0.01&&region.screen.y+region.screen.height<=rect.y+rect.height+0.01).map(describeHiddenText):[]
      await changeDocument({type:kind,index:pageIndex,placement:await placementAt(session,pageIndex,rect),...values,...(kind==='text'?{hidden}:{})} as DocumentOperation)}
    catch(error){setError(messageOf(error))}
  }
  async function merge(file:File){
    if(file.size>MAX_FILE_SIZE){setError('100 MB以内のPDFを選択してください。');return}
    try{await changeDocument({type:'merge',bytes:new Uint8Array(await file.arrayBuffer())})}catch(error){setError(messageOf(error))}
  }
  function printPdf(){
    if(!preview||busy)return
    if(dirty){setError('入力中の文字を適用してから印刷してください。');return}
    const url=URL.createObjectURL(new Blob([preview.bytes.slice().buffer],{type:'application/pdf'}))
    window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60_000)
    setNotice('印刷用PDFを開きました。開いた画面の印刷ボタンで印刷できます。')
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if(passwordFile||showHelp)return
      if (!(event.ctrlKey || event.metaKey)) return
      const input = event.target instanceof HTMLElement && (['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) || event.target.isContentEditable)
      if (event.key.toLowerCase()==='s') { event.preventDefault(); download() }
      else if (event.key==='Enter' && input) { event.preventDefault(); void applyEdit() }
      else if (!input && event.key.toLowerCase()==='z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      else if (!input && event.key.toLowerCase()==='y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown',onKey)
    return () => window.removeEventListener('keydown',onKey)
  })

  return <div className="app-shell" onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={e => {
    e.preventDefault(); setDragging(false)
    if (e.dataTransfer.files.length!==1) { setError('PDFファイルを1つ選択してください。'); return }
    void openFile(e.dataTransfer.files[0])
  }}>
    <header className="app-header">
      <a className="brand" href="./" onClick={e => { e.preventDefault(); setShowHelp(true) }} aria-label="PDF Creator & Editorについて"><span className="brand-mark"><FileText size={22}/></span><span>PDF<span className="brand-light"> Editor</span><small>CREATE. EDIT. KEEP IT YOURS.</small></span></a>
      <span className="phase-tag">{portableAssets() ? 'OFFLINE' : 'EDITOR'}</span>
      <div className="header-actions"><span className="privacy-pill"><LockKeyhole size={13}/>ブラウザ内で安全に処理</span><button type="button" className="text-button help-button" onClick={() => setShowHelp(true)}><Info size={16}/>使い方と制限</button></div>
    </header>

    <div className="toolbar">
      <button className="button secondary" onClick={() => fileInput.current?.click()} disabled={busy}><FolderOpen size={16}/>ファイルを開く</button>
      <input ref={fileInput} className="visually-hidden" type="file" accept="application/pdf,.pdf" aria-label="PDFファイルを選択" disabled={busy} onChange={e => { const file=e.target.files?.[0]; e.target.value=''; if (file) void openFile(file) }}/>
      <span className="toolbar-divider"/>
      <button type="button" className="icon-button" aria-label="元に戻す" title="元に戻す (Ctrl+Z)" disabled={busy || !history.past.length} onClick={undo}><RotateCcw size={18}/></button>
      <button type="button" className="icon-button" aria-label="やり直す" title="やり直す (Ctrl+Shift+Z)" disabled={busy || !history.future.length} onClick={redo}><RotateCw size={18}/></button>
      <span className="toolbar-divider"/>
      <span className="tool-mode"><MousePointer2 size={15}/>文字を編集</span>
      <div className="toolbar-file">{session ? <><FileText size={15}/><span title={session.name}>{session.name}</span>{editCount>0 && <span className="unsaved-dot" title={`${editCount}箇所の変更`}/>}</> : <span>ファイルを開いて、編集をはじめましょう</span>}</div>
      <button className="button primary save-button" onClick={download} disabled={!session || !preview || preview.edits !== edits || preview.calculation !== calculation || busy || previewError}><ArrowDownToLine size={17}/>PDFを保存</button>
    </div>

    <div className="extended-toolbar" aria-label="作成とページ操作">
      <button type="button" className="tool-button" disabled={busy} onClick={()=>void newPdf()}><FilePlus2 size={15}/>新規PDF</button>
      <button type="button" className={`tool-button ${toolMode==='select'?'active':''}`} disabled={!session||busy} onClick={()=>selectTool('select')}><MousePointer2 size={15}/>文字を選ぶ</button>
      <button type="button" className={`tool-button ${toolMode==='text'?'active':''}`} disabled={!session||busy} onClick={()=>selectTool('text')}><Type size={15}/>文字追加</button>
      <button type="button" className={`tool-button ${toolMode==='replace'?'active':''}`} disabled={!session||busy} onClick={()=>selectTool('replace')}><Square size={15}/>範囲書き換え</button>
      <button type="button" className={`tool-button ${toolMode==='image'?'active':''}`} disabled={!session||busy} onClick={()=>selectTool('image')}><ImagePlus size={15}/>画像追加</button>
      <button type="button" className={`tool-button ${toolMode==='shape'?'active':''}`} disabled={!session||busy} onClick={()=>selectTool('shape')}><Square size={15}/>図形追加</button>
      <button type="button" className="tool-button" disabled={!session||busy} onClick={()=>void changeDocument({type:'page-add',index:pageIndex})}><Plus size={15}/>ページ追加</button>
      <button type="button" className="tool-button" disabled={!session||busy} onClick={()=>mergeInput.current?.click()}><Files size={15}/>PDF結合</button>
      <input ref={mergeInput} type="file" accept="application/pdf,.pdf" className="visually-hidden" aria-label="結合するPDFファイル" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void merge(file)}}/>
      <button type="button" className="tool-button" disabled={!preview||busy} onClick={printPdf}><Printer size={15}/>印刷</button>
    </div>
    {(error || notice) && <div className={`message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => { setError(''); setNotice('') }}><X size={15}/></button></div>}

    <main className="editor-layout">
      <aside className="pages-panel"><div className="panel-title"><Layers size={16}/><h2>ページ</h2><span className="count-badge">{session?.pdf.numPages ?? 0}</span></div>
        {session && preview ? <div className="page-list">{Array.from({length:session.pdf.numPages},(_,index)=><div className="page-entry" key={index}><Thumbnail pdf={preview.pdf} index={index} active={pageIndex===index} onClick={() => changePage(index)}/><div className="page-actions"><button type="button" className="icon-button" aria-label={`${index+1}ページを前へ`} disabled={busy||index===0} onClick={()=>void changeDocument({type:'page-move',index,to:index-1})}><ArrowUp size={12}/></button><button type="button" className="icon-button" aria-label={`${index+1}ページを後へ`} disabled={busy||index===session.pdf.numPages-1} onClick={()=>void changeDocument({type:'page-move',index,to:index+1})}><ArrowDown size={12}/></button><button type="button" className="icon-button" aria-label={`${index+1}ページを回転`} disabled={busy} onClick={()=>void changeDocument({type:'page-rotate',index})}><RotateCwSquare size={12}/></button><button type="button" className="icon-button" aria-label={`${index+1}ページを削除`} disabled={busy||session.pdf.numPages===1} onClick={()=>void changeDocument({type:'page-delete',index})}><Trash2 size={12}/></button></div></div>)}</div> : <div className="empty-pages"><div className="mini-page"><span/><span/><span/><span/></div><p>PDFのページが<br/>ここに表示されます</p></div>}
        <div className="sidebar-bottom"><ShieldCheck size={16}/><span>あなたのファイルは<br/>あなたのデバイスに。</span></div>
      </aside>

      <section className="document-area">
        <div className="canvas-toolbar"><span><span className="status-dot"/>{session ? `${pageIndex+1} / ${session.pdf.numPages} ページ` : 'ワークスペース'}</span>
          {session && <div className="zoom-controls"><button className="icon-button" aria-label="縮小" onClick={() => setZoom(z=>Math.max(0.25,z-0.1))} disabled={busy}><ZoomOut size={16}/></button><label className="zoom-label"><select aria-label="表示倍率" value={zoom.toFixed(2)} onChange={e=>setZoom(Number(e.target.value))}>{[0.25,0.5,0.75,1,1.25,1.5,2].includes(Number(zoom.toFixed(2))) ? null : <option value={zoom.toFixed(2)}>{Math.round(zoom*100)}%</option>}{[0.25,0.5,0.75,1,1.25,1.5,2].map(z=><option key={z} value={z.toFixed(2)}>{z*100}%</option>)}</select><ChevronDown size={12}/></label><button className="icon-button" aria-label="拡大" onClick={()=>setZoom(z=>Math.min(2,z+0.1))} disabled={busy}><ZoomIn size={16}/></button></div>}
        </div>
        <div className={`workspace ${session ? 'has-document' : ''}`} ref={workspace}>
          {!session ? <div className="welcome"><span className="eyebrow">YOUR DOCUMENT, YOUR CONTROL</span><h1>PDFを、もっと自由に。</h1><p className="welcome-description">文字を選んで、書き換えて、保存する。<br/>いつものブラウザが、あなたのPDFエディターに。</p>
            <div className="drop-zone"><div className="upload-illustration"><div className="illustration-sheet"><div className="illustration-pdf">PDF</div><span/><span/><span/></div><span className="upload-circle"><Upload size={21}/></span></div><h2>PDFをここにドロップ</h2><p>または、ファイルを選択してください</p><button type="button" className="button primary upload-button" disabled={busy} onClick={()=>fileInput.current?.click()}>{loading ? <LoaderCircle className="spin" size={17}/> : <FolderOpen size={17}/>}PDFファイルを選択</button><span className="file-limit">PDF形式 · 最大100 MB / 2,000ページ</span></div>
            <button type="button" className="sample-button" disabled={busy} onClick={()=>void openSample()}><FilePlus2 size={16}/>サンプルPDFを試す<ArrowRight size={15}/></button>
            <div className="welcome-benefits"><span><LockKeyhole size={15}/>アップロード不要</span><span><Check size={15}/>日本語に対応</span><span><Check size={15}/>無料・アカウント不要</span></div>
          </div> : <>
            {model && preview ? <><div className="document-hint"><MousePointer2 size={14}/>PDF上の文字をクリックして選択<span>{model.regions.length}件の文字領域</span>{calculation && <span className="calculation-active">合計を自動計算・税率{calculation.taxPercent}%</span>}</div><PdfPage pdf={preview.pdf} pageIndex={pageIndex} model={model} zoom={zoom} selected={selected?.id} edits={edits} disabled={busy} onSelect={chooseRegion} onError={reportError} drawing={toolMode!=='select'} area={area} onArea={setArea}/><div className="page-navigation"><button className="icon-button" aria-label="前のページ" onClick={()=>changePage(pageIndex-1)} disabled={pageIndex===0 || busy}><ArrowLeft size={16}/></button><span>{pageIndex+1} / {session.pdf.numPages}</span><button className="icon-button" aria-label="次のページ" onClick={()=>changePage(pageIndex+1)} disabled={pageIndex===session.pdf.numPages-1 || busy}><ArrowRight size={16}/></button></div></> : <div className="workspace-loading"><LoaderCircle className="spin" size={24}/><p>PDFを読み込んでいます…</p></div>}
            {model?.regions.length===0 && <div className="inline-note">文字情報がありません。「範囲書き換え」で画像の文字を覆って書き換えたり、「文字追加」で記入できます。</div>}

          </>}
        </div>
      </section>

      <aside className="properties-panel"><div className="panel-title"><Type size={17}/><h2>テキスト編集</h2>{selected && <button className="icon-button" aria-label="選択を解除" onClick={()=>{if(canLeaveDraft())setSelected(null)}}><X size={15}/></button>}</div>
        {toolMode==='select' && model && model.regions.length > 0 && <div className="text-picker"><label htmlFor="text-picker">編集する文字を選択</label><select id="text-picker" value={selected?.id ?? ''} disabled={busy} onChange={event => {
          const region = model.regions.find(region => region.id === event.target.value)
          if (region) chooseRegion(region)
        }}><option value="">PDF上をクリック、または一覧から選択</option>{model.regions.map(region => <option key={region.id} value={region.id}>{edits[region.id]?.text || region.text}</option>)}</select></div>}
        {toolMode==='select' && model && <CalculationPanel model={model} rule={calculation} edits={edits} busy={busy}
          onApply={rule => void configureCalculation(rule)}
          onDisable={() => { if (!busy && canLeaveDraft()) { dispatch({ type:'set', edits, calculation:null }); setSelected(null); setNotice('自動計算を解除しました。現在の合計値は残ります。') } }}
          onShowPage={changePage}/>}
        {toolMode!=='select'&&model?<InsertionPanel mode={toolMode} model={model} area={area} onArea={setArea} busy={busy} onInsert={value=>void insert(value)} onCancel={()=>selectTool('select')} onError={reportError} initialText={areaText}/>:selected && draft ? <div className="properties-scroll"><div className="selection-tag"><span className="selection-dot"/>テキストを選択中<span>{pageIndex+1}ページ</span></div>
          <label className="field-label">元のテキスト</label><div className="original-text">{selected.text}</div>
          {restriction && <div className="restriction-note" role="status"><Info size={16}/><span>{restriction}{!calculatedTarget&&<button type="button" className="text-button" disabled={busy} onClick={()=>{selectTool('replace');setArea(selected.screen);setAreaText(saved?.text??selected.text)}}>この範囲を指定して書き換える</button>}</span></div>}
          <div className="text-editor-controls">
            <label className="field-label" htmlFor="replacement">変更後のテキスト</label><textarea id="replacement" value={draft.text} disabled={!!restriction || busy} maxLength={10000} rows={3} onChange={e=>setDraft({...draft,text:e.target.value})}/><div className="field-hint">改行できます · {draft.text.length}/10,000</div>
            {!restriction && <><p className="cover-notice">元の背景を復元して文字を変更します。画像のある箇所は編集範囲の背景を画像化します。元の文字はPDF内に残ります。</p><button type="button" onClick={()=>void applyEdit()} className="button primary apply-button" disabled={busy || !dirty}>{validating ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}変更を適用</button><p className="save-hint">「PDFを保存」でも入力中の変更を反映できます。</p></>}
            <div className="field-group"><div><label className="field-label" htmlFor="font-size">文字サイズ</label><div className="number-input"><input id="font-size" type="number" min="1" max="720" step="0.1" value={Number(draft.fontSize.toFixed(2))} disabled={!!restriction || busy} onChange={e=>setDraft({...draft,fontSize:Number(e.target.value)})}/><span>pt</span></div></div><div><label className="field-label" htmlFor="text-color">文字色</label><div className="color-input"><input id="text-color" type="color" value={draft.color} disabled={!!restriction || busy} onChange={e=>setDraft({...draft,color:e.target.value})}/><span>{draft.color.toUpperCase()}</span></div></div></div>
            <label className="field-label" htmlFor="text-align">配置</label><select id="text-align" value={draft.align} disabled={!!restriction || busy} onChange={e=>setDraft({...draft,align:e.target.value as Draft['align']})}><option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option></select>
            <div className="advanced-fields"><label className="field-label" htmlFor="font-family">書体</label><select id="font-family" value={draft.family??'auto'} disabled={!!restriction||busy} onChange={e=>setDraft({...draft,family:e.target.value as Draft['family']})}><option value="auto">元の書体に合わせる</option><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="mono">等幅</option></select><label className="option-check"><input type="checkbox" checked={draft.bold??false} disabled={!!restriction||busy} onChange={e=>setDraft({...draft,bold:e.target.checked})}/>太字</label><label className="option-check"><input type="checkbox" checked={draft.autoFit!==false} disabled={!!restriction||busy} onChange={e=>setDraft({...draft,autoFit:e.target.checked})}/>元の領域に自動で収める</label><div className="field-group"><label>横へ移動（pt）<input aria-label="横へ移動（pt）" type="number" value={draft.offsetX??0} disabled={!!restriction||busy} onChange={e=>setDraft({...draft,offsetX:Number(e.target.value)})}/></label><label>上へ移動（pt）<input aria-label="上へ移動（pt）" type="number" value={draft.offsetY??0} disabled={!!restriction||busy} onChange={e=>setDraft({...draft,offsetY:Number(e.target.value)})}/></label></div></div><div className="font-note"><span>書体を元に合わせて自動選択</span><strong>{replacementFontLabel({ ...draft, region: selected })}</strong><small>元の書体：{selected.appearance?.fontName ?? '不明'}{selected.appearance?.bold ? '（太字）' : ''}</small>{replacementFontWarning({ ...draft, region: selected }) && <small className="font-warning">{replacementFontWarning({ ...draft, region: selected })}</small>}</div>
            <div className="autofit-note"><Check size={15}/><div>{draft.autoFit===false?'自由な大きさで配置':'元の領域に合わせて自動調整'}<small>{draft.autoFit===false?'移動量とサイズを自由に指定できます。':'幅・高さに収まるよう文字を調整します。'}{actualSize && ` 適用サイズ ${actualSize.toFixed(1)} pt`}</small></div></div>
            {saved && !calculatedTarget && <button type="button" className="text-button reset-button" disabled={busy} onClick={()=>void resetSelectedEdit()}><RotateCcw size={14}/>この変更を取り消す</button>}
          </div>
        </div> : <div className="empty-properties"><div className="cursor-icon"><MousePointer2 size={29}/><span>文字</span></div><h3>編集したい文字を選択</h3><p>PDF上をクリックするか、上の一覧から<br/>文字を選んで変更できます。</p><div className="step-list"><div><span>1</span>PDFファイルを開く</div><div><span>2</span>文字を選んで変更する</div><div><span>3</span>PDFを保存する</div></div></div>}
        <div className="limitation-note"><Info size={16}/><div><strong>編集できる範囲について</strong><p>背景色や画像の上も編集できます。自動で選べない部分は「範囲書き換え」を使用してください。墨消しには使えません。</p><button type="button" onClick={()=>setShowHelp(true)}>詳しい制限を見る<ArrowRight size={12}/></button></div></div>
      </aside>
    </main>

    <footer className="status-bar"><span className="status-left"><span className={`status-dot ${busy?'working':''}`}/>{busy ? '処理中…' : session ? previewError ? 'プレビューにエラーがあります' : `${formatSize(session.size)} · ${editCount}箇所の変更${dirty ? ' · 入力中の変更あり' : ''} · ${history.past.length}操作` : '準備完了'}</span><span className="status-center"><ShieldCheck size={12}/>ファイルはサーバーに送信されません</span><a href={getLicenseUrl()} target="_blank" rel="noreferrer">ライセンス</a><span>v0.2.0</span></footer>
    {dragging && <div className="drag-overlay"><Upload size={44}/><h2>PDFをドロップして開く</h2><p>ファイルはブラウザ内で処理されます</p></div>}
    {passwordFile&&<div className="modal-backdrop"><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="password-title"><h2 id="password-title">パスワード付きPDFを開く</h2><p>パスワードを使って、このブラウザ内で画像の編集用コピーを作成します。コピーは文字の自動選択・検索やリンクを保持しません。範囲書き換えや文字追加で編集できます。パスワードやPDFは送信されません。</p><label className="field-label" htmlFor="pdf-password">PDFのパスワード</label><input id="pdf-password" type="password" autoFocus autoComplete="off" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void unlockFile()}}/>{passwordError&&<p role="alert">{passwordError}</p>}<button type="button" className="button primary" disabled={busy} onClick={()=>void unlockFile()}>画像化して開く</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setPasswordFile(null);setPassword('');setPasswordError('')}}>キャンセル</button></section></div>}
    {showHelp && <div className="modal-backdrop" onClick={()=>setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><div className="help-heading"><span className="brand-mark"><FileText size={22}/></span><h2 id="help-title">使い方と編集の制限</h2><button type="button" className="icon-button" aria-label="説明を閉じる" autoFocus onClick={()=>setShowHelp(false)}><X size={20}/></button></div><p>PDFを開き、文字をクリックするか一覧から選んで内容を変更します。「変更を適用」でプレビューを確認し、「PDFを保存」で別名ダウンロードできます。保存ボタンは入力中の変更も反映します。</p><h3>背景を保ちながら文字を編集</h3><p>元の背景を復元して文字を重ねます。単色の背景は色を引き継ぎ、画像や模様のある部分は編集する小さな範囲を画像として復元します。この部分は拡大時に画像の解像度の影響を受けます。回転ページ・回転文字にも対応します。重なる文字、縦書き、特殊なクリップや透明効果など、自動選択で編集できない箇所には「範囲書き換え」を使ってください。書体・色・サイズ・太字・位置を変更でき、改行も使えます。「元の領域に自動で収める」を外すと自由な大きさで配置できます。書体の完全な再現を保証するものではありません。</p><div className="help-warning"><strong>墨消し機能ではありません</strong><p>元の文字はPDF内に残り、検索・コピーできる場合があります。機密情報の削除には使用しないでください。このバージョンで保存したPDFには、元のPDFと編集データを含めて保存し、このツールで再編集できます。元のデータも残るためファイルサイズは増えます。旧バージョンや別アプリで保存したPDFには、文字の重複により再編集できない領域があります。別アプリで加えた変更は、編集データからの再開時に引き継がれない場合があります。</p></div><h3>新規作成・追加・ページ操作</h3><p>新規PDF、文字・画像・図形の追加、ページ追加・削除・並べ替え・回転、PDF結合に対応します。追加の場所はPDF上のドラッグか数値で指定します。「範囲書き換え」は指定した範囲の背景や画像も選んだ色で覆うため、保存前にプレビューで確認してください。スキャンPDFも手動で書き換えられます。OCRは使用しません。画像はPNG・JPEG・WebP・GIF・BMPに対応し、GIFは最初の画像を使います。印刷は別タブに開いたPDFの印刷ボタンから行えます。</p><h3>読み込みと履歴</h3><p>ブラウザのメモリを保護するため、入力100 MB・2,000ページ、置換1件10,000文字、文字サイズ1〜720 ptを上限とします。履歴はこのタブ内で最大40操作、文書の履歴は合計256 MB以内で保持します。ページ操作も元に戻す・やり直すの対象です。パスワード付きPDFは、パスワードを入力して画像化したコピーで編集できます。このコピーは文字情報・リンクなどを保持しません。電子署名は編集・保存すると無効になります。</p><h3>合計の自動計算</h3><p>サンプル見積書は明細金額の合計に消費税10%を加え、1円未満を切り捨てます。ほかのPDFは「合計の自動計算」で同じページの明細と合計欄・税率を指定してください。数量から金額を算出する機能ではありません。設定と計算結果をPDFの編集データにも保存します。</p><h3>ローカル処理・オープンソース</h3><p>AI・外部APIは使いません。PDFの内容をサーバーに送信しません。PDF.js（Apache-2.0）、pdf-lib・fontkit・React（MIT）、Noto Sans JP・Noto Serif JP（SIL OFL 1.1）などを使用しています。</p><button className="button primary" onClick={()=>setShowHelp(false)}>編集画面に戻る</button></section></div>}
  </div>
}
