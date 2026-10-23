import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Edits, PageModel, TextRegion, Rect } from '../pdf/types'

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
  drawing?: boolean
  area?: Rect
  onArea?: (rect:Rect)=>void
}

export function PdfPage({ pdf, pageIndex, model, zoom, selected, edits, disabled, onSelect, onError, drawing, area, onArea }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rendering, setRendering] = useState(true)
  const drag=useRef<{x:number;y:number}|null>(null)
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
    })().catch(error => {
      // Replacing a preview closes the previous PDF worker before React has
      // mounted the next canvas. Its cancelled render is an expected transition.
      if (!canceled && error?.name !== 'RenderingCancelledException') {
        setRendering(false); onError(`ページを表示できません：${String(error)}`)
      }
    })
    return () => { canceled = true; task?.cancel() }
  }, [pdf, pageIndex, zoom, model.width, model.height, onError])

  const point=(event:React.PointerEvent<HTMLDivElement>)=>{
    const box=event.currentTarget.getBoundingClientRect()
    return {x:Math.max(0,Math.min(model.width,(event.clientX-box.left)/zoom)),y:Math.max(0,Math.min(model.height,(event.clientY-box.top)/zoom))}
  }
  return <div className={`pdf-paper ${drawing?'drawing':''}`} style={{ width: model.width*zoom, height: model.height*zoom }} aria-label={`${pageIndex+1}ページ目のPDF`}
    onPointerDown={event=>{if(!drawing||disabled||event.button!==0)return;event.preventDefault();drag.current=point(event);event.currentTarget.setPointerCapture(event.pointerId)}}
    onPointerMove={event=>{if(!drag.current||!drawing||disabled)return;const end=point(event),start=drag.current;onArea?.({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.max(1,Math.abs(end.x-start.x)),height:Math.max(1,Math.abs(end.y-start.y))})}}
    onPointerUp={event=>{if(!drag.current)return;const end=point(event),start=drag.current;if(Math.abs(end.x-start.x)<2&&Math.abs(end.y-start.y)<2)onArea?.({x:start.x,y:start.y,width:Math.min(220,model.width-start.x),height:Math.min(60,model.height-start.y)});drag.current=null}}
    onPointerCancel={()=>{drag.current=null}}>
    <canvas ref={canvas} className="page-canvas" />
    {!rendering && <div className="text-hit-layer" aria-label="文字の選択領域" style={drawing?{pointerEvents:'none'}:undefined}>
      {model.regions.map(region => <button
        key={region.id}
        className={`text-hit ${selected === region.id ? 'selected' : ''} ${edits[region.id] ? 'edited' : ''}`}
        style={{ left: region.screen.x*zoom, top: region.screen.y*zoom, width: region.screen.width*zoom, height: region.screen.height*zoom }}
        type="button" disabled={disabled}
        aria-label={`文字を選択: ${edits[region.id]?.text ?? region.text}`} aria-pressed={selected === region.id}
        title={edits[region.id]?.text ?? region.text}
        onClick={() => onSelect(region)}
      />)}
    </div>}
    {drawing&&area&&<div className="placement-preview" style={{left:area.x*zoom,top:area.y*zoom,width:area.width*zoom,height:area.height*zoom}}/>}
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
      })().catch(error => { if (!canceled && error?.name !== 'RenderingCancelledException') setFailed(true) })
    }, { rootMargin: '150px' })
    if (button.current) observer.observe(button.current)
    return () => { canceled = true; observer.disconnect(); task?.cancel() }
  }, [pdf,index])
  return <button ref={button} type="button" className={`thumbnail ${active ? 'active' : ''}`} onClick={onClick} aria-label={`${index+1}ページへ`} aria-current={active ? 'page' : undefined}>
    <div className="thumbnail-paper"><canvas ref={canvas} />{failed && <span>表示できません</span>}</div>
    <span className="thumbnail-number">{index+1}</span>
  </button>
}
