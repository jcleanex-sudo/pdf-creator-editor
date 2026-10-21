import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, FilePlus2, FileText, FolderOpen, Info, Layers, LoaderCircle, LockKeyhole, MousePointer2, RotateCcw, RotateCw, ShieldCheck, Type, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { PdfPage, Thumbnail } from './components/PdfPage'
import { editRestriction, loadPage, MAX_FILE_SIZE, openPdf, readPdf } from './pdf/reader'
import { fitText, loadJapaneseFont, makeSample, writePdf } from './pdf/output'
import type { DocumentSession, Edits, PageModel, Replacement, TextRegion } from './pdf/types'
import { getLicenseUrl, portableAssets } from './pdf/portable'

type History = { past: Edits[]; present: Edits; future: Edits[] }
type Action = { type: 'set'; edits: Edits } | { type: 'undo' | 'redo' | 'clear' }
const emptyHistory: History = { past: [], present: {}, future: [] }
function historyReducer(state: History, action: Action): History {
  if (action.type === 'clear') return emptyHistory
  if (action.type === 'set') return { past: [...state.past.slice(-39), state.present], present: action.edits, future: [] }
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0,-1), present: state.past.at(-1)!, future: [state.present, ...state.future] }
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
  return state
}
type Draft = Pick<Replacement, 'text' | 'fontSize' | 'color' | 'align'>
const messageOf = (error: unknown) => error instanceof Error ? error.message : '処理に失敗しました。別のPDFでお試しください。'
const formatSize = (size: number) => size >= 1024*1024 ? `${(size/1024/1024).toFixed(1)} MB` : `${Math.ceil(size/1024)} KB`

export default function App() {
  const [session, setSession] = useState<DocumentSession | null>(null)
  const [history, dispatch] = useReducer(historyReducer, emptyHistory)
  const edits = history.present
  const [pageIndex, setPageIndex] = useState(0)
  const [model, setModel] = useState<PageModel | null>(null)
  const [preview, setPreview] = useState<{ pdf: PDFDocumentProxy; bytes: Uint8Array; edits: Edits } | null>(null)
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
  const [allowCover, setAllowCover] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const loadVersion = useRef(0)
  const busy = loading || building || validating
  const saved = selected ? edits[selected.id] : undefined
  const dirty = !!draft && !!selected && (draft.text !== (saved?.text ?? selected.text) || draft.fontSize !== (saved?.fontSize ?? selected.fontSize) || draft.color !== (saved?.color ?? '#202733') || draft.align !== (saved?.align ?? 'left'))
  const editCount = Object.keys(edits).length
  const restriction = selected && model ? editRestriction(selected, model) : undefined
  const reportError = useCallback((message: string) => setError(message), [])

  useEffect(() => {
    if (!selected) { setDraft(null); return }
    setDraft({ text: saved?.text ?? selected.text, fontSize: saved?.fontSize ?? selected.fontSize, color: saved?.color ?? '#202733', align: saved?.align ?? 'left' })
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
    let task: ReturnType<typeof readPdf> | undefined
    setPreviewError(false)
    if (!Object.keys(edits).length) {
      setPreview({ pdf: session.pdf, bytes: session.bytes, edits }); setBuilding(false)
      return
    }
    setBuilding(true)
    void (async () => {
      const bytes = await writePdf(session.bytes, edits, await loadJapaneseFont())
      if (canceled) return
      task = readPdf(bytes)
      owned = await task.promise
      if (canceled) { await owned.loadingTask.destroy(); return }
      setPreview({ pdf: owned, bytes, edits }); setBuilding(false)
    })().catch(e => { if (!canceled) { setError(messageOf(e)); setBuilding(false); setPreviewError(true) } })
    return () => { canceled = true; if (owned) void owned.loadingTask.destroy(); else if (task) void task.destroy() }
  }, [session,edits])

  useEffect(() => () => { if (session) void session.pdf.loadingTask.destroy() }, [session])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (editCount || dirty) event.preventDefault() }
    window.addEventListener('beforeunload',beforeUnload)
    return () => window.removeEventListener('beforeunload',beforeUnload)
  }, [editCount,dirty])

  const canLeaveDraft = () => !dirty || window.confirm('入力中の変更を破棄しますか？「変更を適用」でPDFに反映できます。')
  const chooseRegion = (region: TextRegion) => { if (selected?.id !== region.id && canLeaveDraft()) { setSelected(region); setNotice(''); setError('') } }
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
      await loadPage(next,0).catch(async e => { await next.pdf.loadingTask.destroy(); throw e })
      if (version !== loadVersion.current) { await next.pdf.loadingTask.destroy(); return }
      setPreview(null); setSelected(null); setModel(null)
      setSession(next); setPageIndex(0); dispatch({ type:'clear' }); setAllowCover(false); setZoom(1)
    } catch (e) { if (version === loadVersion.current) setError(messageOf(e)) }
    finally { if (version === loadVersion.current) setLoading(false) }
  }
  const allowOpen = () => !(editCount || dirty) || window.confirm('別のPDFを開くと、現在の編集履歴は消えます。必要な変更はPDFを保存してください。続けますか？')
  async function openFile(file: File) {
    if (busy || !allowOpen()) return
    if (file.size > MAX_FILE_SIZE) { setError('25 MBまでのPDFを選択してください。'); return }
    if (!/\.pdf$/iu.test(file.name)) { setError('拡張子が.pdfのファイルを選択してください。'); return }
    try { await openBytes(new Uint8Array(await file.arrayBuffer()),file.name) } catch(e) { setError(messageOf(e)) }
  }
  async function openSample() {
    if (busy || !allowOpen()) return
    setLoading(true); setError('')
    try { await openBytes(await makeSample(await loadJapaneseFont()),'サンプル見積書.pdf') }
    catch(e) { setError(messageOf(e)); setLoading(false) }
  }
  async function applyEdit() {
    if (!draft || !selected || !session || !model || restriction || !allowCover || busy) return
    setValidating(true); setError(''); setNotice('')
    try {
      const doc = await PDFDocument.create(); doc.registerFontkit(fontkit)
      const font = await doc.embedFont(await loadJapaneseFont(), { subset: true })
      const edit: Replacement = { ...draft, region:selected }
      const fitted = fitText(font,edit)
      setActualSize(fitted.size)
      dispatch({ type:'set', edits:{ ...edits, [selected.id]:edit } })
      setNotice('変更を反映しました。保存前にプレビューをご確認ください。')
    } catch(e) { setError(messageOf(e)) }
    finally { setValidating(false) }
  }
  function download() {
    if (!session || !preview || preview.edits !== edits || busy || previewError) return
    if (dirty) { setError('入力中の変更があります。「変更を適用」してから保存してください。'); return }
    const url = URL.createObjectURL(new Blob([preview.bytes.slice().buffer], { type:'application/pdf' }))
    const anchor = document.createElement('a')
    anchor.href=url; anchor.download=`${session.name.replace(/\.pdf$/iu,'')}_edited.pdf`
    document.body.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url),60_000)
    setNotice('PDFのダウンロードを開始しました。元のファイルは上書きしません。')
  }
  const undo = () => { if (!busy && history.past.length && canLeaveDraft()) { dispatch({type:'undo'}); setError(''); setNotice('変更を元に戻しました。') } }
  const redo = () => { if (!busy && history.future.length && canLeaveDraft()) { dispatch({type:'redo'}); setError(''); setNotice('変更をやり直しました。') } }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
      <span className="phase-tag">{portableAssets() ? 'OFFLINE' : 'PHASE 1'}</span>
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
      <button className="button primary save-button" onClick={download} disabled={!session || !preview || preview.edits !== edits || busy || previewError}><ArrowDownToLine size={17}/>PDFを保存</button>
    </div>

    {(error || notice) && <div className={`message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button className="icon-button" aria-label="通知を閉じる" onClick={() => { setError(''); setNotice('') }}><X size={15}/></button></div>}

    <main className="editor-layout">
      <aside className="pages-panel"><div className="panel-title"><Layers size={16}/><h2>ページ</h2><span className="count-badge">{session?.pdf.numPages ?? 0}</span></div>
        {session && preview ? <div className="page-list">{Array.from({length:session.pdf.numPages},(_,index)=><Thumbnail key={index} pdf={preview.pdf} index={index} active={pageIndex===index} onClick={() => changePage(index)}/>)}</div> : <div className="empty-pages"><div className="mini-page"><span/><span/><span/><span/></div><p>PDFのページが<br/>ここに表示されます</p></div>}
        <div className="sidebar-bottom"><ShieldCheck size={16}/><span>あなたのファイルは<br/>あなたのデバイスに。</span></div>
      </aside>

      <section className="document-area">
        <div className="canvas-toolbar"><span><span className="status-dot"/>{session ? `${pageIndex+1} / ${session.pdf.numPages} ページ` : 'ワークスペース'}</span>
          {session && <div className="zoom-controls"><button className="icon-button" aria-label="縮小" onClick={() => setZoom(z=>Math.max(0.25,z-0.1))} disabled={busy}><ZoomOut size={16}/></button><label className="zoom-label"><select aria-label="表示倍率" value={zoom.toFixed(2)} onChange={e=>setZoom(Number(e.target.value))}>{[0.25,0.5,0.75,1,1.25,1.5,2].includes(Number(zoom.toFixed(2))) ? null : <option value={zoom.toFixed(2)}>{Math.round(zoom*100)}%</option>}{[0.25,0.5,0.75,1,1.25,1.5,2].map(z=><option key={z} value={z.toFixed(2)}>{z*100}%</option>)}</select><ChevronDown size={12}/></label><button className="icon-button" aria-label="拡大" onClick={()=>setZoom(z=>Math.min(2,z+0.1))} disabled={busy}><ZoomIn size={16}/></button></div>}
        </div>
        <div className={`workspace ${session ? 'has-document' : ''}`} ref={workspace}>
          {!session ? <div className="welcome"><span className="eyebrow">YOUR DOCUMENT, YOUR CONTROL</span><h1>PDFを、もっと自由に。</h1><p className="welcome-description">文字を選んで、書き換えて、保存する。<br/>いつものブラウザが、あなたのPDFエディターに。</p>
            <div className="drop-zone"><div className="upload-illustration"><div className="illustration-sheet"><div className="illustration-pdf">PDF</div><span/><span/><span/></div><span className="upload-circle"><Upload size={21}/></span></div><h2>PDFをここにドロップ</h2><p>または、ファイルを選択してください</p><button type="button" className="button primary upload-button" disabled={busy} onClick={()=>fileInput.current?.click()}>{loading ? <LoaderCircle className="spin" size={17}/> : <FolderOpen size={17}/>}PDFファイルを選択</button><span className="file-limit">PDF形式 · 最大25 MB / 200ページ</span></div>
            <button type="button" className="sample-button" disabled={busy} onClick={()=>void openSample()}><FilePlus2 size={16}/>サンプルPDFを試す<ArrowRight size={15}/></button>
            <div className="welcome-benefits"><span><LockKeyhole size={15}/>アップロード不要</span><span><Check size={15}/>日本語に対応</span><span><Check size={15}/>無料・アカウント不要</span></div>
          </div> : <>
            {model && preview ? <><div className="document-hint"><MousePointer2 size={14}/>PDF上の文字をクリックして選択<span>{model.regions.length}件の文字領域</span></div><PdfPage pdf={preview.pdf} pageIndex={pageIndex} model={model} zoom={zoom} selected={selected?.id} edits={edits} disabled={busy} onSelect={chooseRegion} onError={reportError}/><div className="page-navigation"><button className="icon-button" aria-label="前のページ" onClick={()=>changePage(pageIndex-1)} disabled={pageIndex===0 || busy}><ArrowLeft size={16}/></button><span>{pageIndex+1} / {session.pdf.numPages}</span><button className="icon-button" aria-label="次のページ" onClick={()=>changePage(pageIndex+1)} disabled={pageIndex===session.pdf.numPages-1 || busy}><ArrowRight size={16}/></button></div></> : <div className="workspace-loading"><LoaderCircle className="spin" size={24}/><p>PDFを読み込んでいます…</p></div>}
            {model?.regions.length===0 && <div className="inline-note">文字情報がありません。スキャン画像のPDFには、Phase 1では文字編集できません。</div>}
            {model && model.regions.length>3000 && <div className="inline-note">文字領域が多いため、先頭3,000件を選択対象にしています。</div>}
          </>}
        </div>
      </section>

      <aside className="properties-panel"><div className="panel-title"><Type size={17}/><h2>テキスト編集</h2>{selected && <button className="icon-button" aria-label="選択を解除" onClick={()=>{if(canLeaveDraft())setSelected(null)}}><X size={15}/></button>}</div>
        {selected && draft ? <div className="properties-scroll"><div className="selection-tag"><span className="selection-dot"/>テキストを選択中<span>{pageIndex+1}ページ</span></div>
          <label className="field-label">元のテキスト</label><div className="original-text">{selected.text}</div>
          {restriction && <div className="restriction-note" role="status"><Info size={16}/><span>{restriction}</span></div>}
          <div className="text-editor-controls">
            <label className="field-label" htmlFor="replacement">変更後のテキスト</label><textarea id="replacement" value={draft.text} disabled={!!restriction || busy} maxLength={300} rows={3} onChange={e=>setDraft({...draft,text:e.target.value})}/><div className="field-hint">1行のテキスト · {draft.text.length}/300</div>
            <div className="field-group"><div><label className="field-label" htmlFor="font-size">文字サイズ</label><div className="number-input"><input id="font-size" type="number" min="4" max="144" step="0.1" value={Number(draft.fontSize.toFixed(2))} disabled={!!restriction || busy} onChange={e=>setDraft({...draft,fontSize:Number(e.target.value)})}/><span>pt</span></div></div><div><label className="field-label" htmlFor="text-color">文字色</label><div className="color-input"><input id="text-color" type="color" value={draft.color} disabled={!!restriction || busy} onChange={e=>setDraft({...draft,color:e.target.value})}/><span>{draft.color.toUpperCase()}</span></div></div></div>
            <label className="field-label" htmlFor="text-align">配置</label><select id="text-align" value={draft.align} disabled={!!restriction || busy} onChange={e=>setDraft({...draft,align:e.target.value as Draft['align']})}><option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option></select>
            <div className="font-note"><span>フォント</span><strong>Noto Sans JP Regular</strong><small>日本語フォントをPDFに埋め込みます</small></div>
            <div className="autofit-note"><Check size={15}/><div>元の領域に合わせて自動調整<small>幅・高さに収まるよう文字を縮小します。{actualSize && ` 適用サイズ ${actualSize.toFixed(1)} pt`}</small></div></div>
            <label className="cover-consent"><input type="checkbox" checked={allowCover} disabled={!!restriction || busy} onChange={e=>setAllowCover(e.target.checked)}/><span>元の文字を白く覆う方式を理解しました。背景はプレビューで確認します。</span></label>
            <button type="button" onClick={()=>void applyEdit()} className="button primary apply-button" disabled={!!restriction || busy || !allowCover || !dirty}>{validating ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}変更を適用</button>
            {saved && <button type="button" className="text-button reset-button" disabled={busy} onClick={()=>{const next={...edits};delete next[selected.id];dispatch({type:'set',edits:next});setError('')}}><RotateCcw size={14}/>この変更を取り消す</button>}
          </div>
        </div> : <div className="empty-properties"><div className="cursor-icon"><MousePointer2 size={29}/><span>文字</span></div><h3>編集したい文字を選択</h3><p>PDF上の文字や数字をクリックすると、<br/>ここで内容を変更できます。</p><div className="step-list"><div><span>1</span>PDFファイルを開く</div><div><span>2</span>文字を選んで変更する</div><div><span>3</span>PDFを保存する</div></div></div>}
        <div className="limitation-note"><Info size={16}/><div><strong>編集できる範囲について</strong><p>Phase 1は白背景の横書き文字に対応。元の文字はPDF内に残ります。機密情報の削除には使えません。</p><button type="button" onClick={()=>setShowHelp(true)}>詳しい制限を見る<ArrowRight size={12}/></button></div></div>
      </aside>
    </main>

    <footer className="status-bar"><span className="status-left"><span className={`status-dot ${busy?'working':''}`}/>{busy ? '処理中…' : session ? previewError ? 'プレビューにエラーがあります' : `${formatSize(session.size)} · ${editCount}箇所の変更${dirty ? ' · 入力中の変更あり' : ''}` : '準備完了'}</span><span className="status-center"><ShieldCheck size={12}/>ファイルはサーバーに送信されません</span><a href={getLicenseUrl()} target="_blank" rel="noreferrer">ライセンス</a><span>v0.1.0</span></footer>
    {dragging && <div className="drag-overlay"><Upload size={44}/><h2>PDFをドロップして開く</h2><p>ファイルはブラウザ内で処理されます</p></div>}
    {showHelp && <div className="modal-backdrop" onClick={()=>setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><div className="help-heading"><span className="brand-mark"><FileText size={22}/></span><h2 id="help-title">使い方と編集の制限</h2><button type="button" className="icon-button" aria-label="説明を閉じる" autoFocus onClick={()=>setShowHelp(false)}><X size={20}/></button></div><p>PDFを開き、文字をクリックして内容を変更します。「変更を適用」で実際のPDFプレビューを確認し、「PDFを保存」で別名ダウンロードできます。</p><h3>白い背景の横書き文字に対応</h3><p>元の領域を白く覆い、日本語フォントで新しい文字を重ねます。背景色・画像・回転・縦書き・重なった文字は対象外です。背景判定は推定のため、保存前に必ずプレビューを確認してください。元のフォントの字形や太さは維持できません。</p><div className="help-warning"><strong>墨消し機能ではありません</strong><p>元の文字はPDF内に残り、検索・コピーできる場合があります。機密情報の削除には使用しないでください。保存後の再読み込みでは文字が重複し、再編集できない領域があります。</p></div><h3>Phase 1の対応範囲</h3><p>25 MB・200ページまで。スキャン画像は表示のみ。OCR、パスワード付きPDF、署名欄のあるPDF、縦書き、改行を含む文字変更は対象外です。電子署名済みPDFは使用しないでください。編集履歴はこのタブ内だけに保持されます。</p><h3>ローカル処理・オープンソース</h3><p>AI・外部APIは使いません。PDFの内容をサーバーに送信しません。PDF.js（Apache-2.0）、pdf-lib・fontkit・React（MIT）、Noto Sans JP（SIL OFL 1.1）などを使用しています。</p><button className="button primary" onClick={()=>setShowHelp(false)}>編集画面に戻る</button></section></div>}
  </div>
}
