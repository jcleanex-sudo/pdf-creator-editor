import {useEffect,useRef,useState} from 'react'
import type {PDFDocumentProxy,RenderTask} from 'pdfjs-dist'
import type {Rect} from '../pdf/types'

function Crop({pdf,index,rect,label}:{pdf:PDFDocumentProxy;index:number;rect:Rect;label:string}){
  const canvas=useRef<HTMLCanvasElement>(null),[state,setState]=useState('描画中…')
  useEffect(()=>{
    let canceled=false,task:RenderTask|undefined
    setState('描画中…')
    void (async()=>{
      const page=await pdf.getPage(index+1);if(canceled||!canvas.current)return
      const view=page.getViewport({scale:1}),left=Math.max(0,rect.x-20),top=Math.max(0,rect.y-20)
      const width=Math.max(1,Math.min(view.width-left,rect.x+rect.width+20-left)),height=Math.max(1,Math.min(view.height-top,rect.y+rect.height+20-top))
      const scale=Math.min(4,Math.sqrt(4_000_000/(width*height))),target=canvas.current
      target.width=Math.ceil(width*scale);target.height=Math.ceil(height*scale)
      target.style.width=`${width*4}px`;target.style.height=`${height*4}px`
      task=page.render({canvas:target,viewport:page.getViewport({scale}),transform:[1,0,0,1,-left*scale,-top*scale],background:'rgb(255,255,255)'})
      await task.promise;if(!canceled)setState('')
    })().catch(error=>{if(!canceled&&error?.name!=='RenderingCancelledException')setState('拡大表示を取得できません')})
    return()=>{canceled=true;task?.cancel()}
  },[pdf,index,rect.x,rect.y,rect.width,rect.height])
  return <div className="detail-crop"><span>{label}</span><div className="detail-scroll" tabIndex={0} aria-label={`${label}の拡大表示`}><canvas ref={canvas} aria-label={`${label}の文字画像`}/>{state&&<small>{state}</small>}</div></div>
}
export function RegionPreview({source,preview,index,rect}:{source:PDFDocumentProxy;preview:PDFDocumentProxy;index:number;rect:Rect}){
  return <details className="region-preview"><summary>選択範囲を拡大して比較</summary><div className="detail-pair"><Crop pdf={source} index={index} rect={rect} label="元の表示"/><Crop pdf={preview} index={index} rect={rect} label="適用後"/></div><p>4倍表示。横・縦にスクロールできます。入力は「変更を適用」後に反映されます。</p></details>
}
