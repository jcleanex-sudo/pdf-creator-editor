import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Edits, PageModel, TextRegion } from '../pdf/types'

type Props = {
  pdf: PDFDocumentProxy
  pageIndex: number
  model: PageModel
  zoom: number
  selected: string | undefined
  edits: Edits
  disabled: boolean
  onSelect: (region: TextRegion) => void
  onError: (message: string) => void
}

export function PdfPage({ pdf, pageIndex, model, zoom, selected, edits, disabled, onSelect, onError }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rendering, setRendering] = useState(true)
  useEffect(() => {
    let canceled = false
    let task: RenderTask | undefined
    setRendering(true)
    void (async () => {
      const page = await pdf.getPage(pageIndex + 1)
      if (canceled || !canvas.current) return
      const scale = Math.min(zoom * window.devicePixelRatio, Math.sqrt(12_000_000/(model.width*model.height)))
      const viewport = page.getViewport({ scale })
      const target = canvas.current
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height)
      task = page.render({ canvas: target, viewport, background: 'rgb(255,255,255)' })
      await task.promise
      if (!canceled) setRendering(false)
    })().catch(error => { if (!canceled) { setRendering(false); onError(`ページを表示できません：${String(error)}`) } })
    return () => { canceled = true; task?.cancel() }
  }, [pdf, pageIndex, zoom, model.width, model.height, onError])

  return <div className="pdf-paper" style={{ width: model.width*zoom, height: model.height*zoom }} aria-label={`${pageIndex+1}ページ目のPDF`}>
    <canvas ref={canvas} className="page-canvas" />
    {!rendering && <div className="text-hit-layer" aria-label="文字の選択領域">
      {model.regions.slice(0, 3000).map(region => <button
        key={region.id}
        className={`text-hit ${selected === region.id ? 'selected' : ''} ${edits[region.id] ? 'edited' : ''}`}
        style={{ left: region.screen.x*zoom, top: region.screen.y*zoom, width: region.screen.width*zoom, height: region.screen.height*zoom }}
        type="button" disabled={disabled}
        aria-label={`文字を選択: ${region.text}`} aria-pressed={selected === region.id}
        title={edits[region.id]?.text ?? region.text}
        onClick={() => onSelect(region)}
      />)}
    </div>}
    {rendering && <div className="paper-loading"><span className="spinner" />ページを描画しています</div>}
  </div>
}

export function Thumbnail({ pdf, index, active, onClick }: { pdf: PDFDocumentProxy; index: number; active: boolean; onClick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let canceled = false
    let task: RenderTask | undefined
    setFailed(false)
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void (async () => {
        const page = await pdf.getPage(index+1)
        if (canceled || !canvas.current) return
        const natural = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 112/natural.width })
        canvas.current.width = Math.ceil(viewport.width)
        canvas.current.height = Math.ceil(viewport.height)
        task = page.render({ canvas: canvas.current, viewport, background: 'rgb(255,255,255)' })
        await task.promise
      })().catch(() => { if (!canceled) setFailed(true) })
    }, { rootMargin: '150px' })
    if (button.current) observer.observe(button.current)
    return () => { canceled = true; observer.disconnect(); task?.cancel() }
  }, [pdf,index])
  return <button ref={button} type="button" className={`thumbnail ${active ? 'active' : ''}`} onClick={onClick} aria-label={`${index+1}ページへ`} aria-current={active ? 'page' : undefined}>
    <div className="thumbnail-paper"><canvas ref={canvas} />{failed && <span>表示できません</span>}</div>
    <span className="thumbnail-number">{index+1}</span>
  </button>
}
