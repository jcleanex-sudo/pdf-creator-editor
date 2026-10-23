import { useEffect, useRef, useState } from 'react'
import type { PageModel, Rect, Replacement } from '../pdf/types'
import type {FontAssets} from '../pdf/custom-fonts'
import {FontPicker} from './FontPicker'
import {TypographyControls} from './TypographyControls'

export type ToolMode='select'|'text'|'replace'|'image'|'shape'
export type Insertion=
  |{kind:'text';rect:Rect;text:string;size:number;color:string;family:Replacement['family'];bold:boolean;cover?:string;autoFit:boolean;customFontId?:string;widthPercent:number;lineHeight:number}
  |{kind:'image';rect:Rect;bytes:Uint8Array;format:'png'|'jpg'}
  |{kind:'shape';rect:Rect;shape:'rectangle'|'line'|'highlight'|'cover';color:string}

export function InsertionPanel({mode,model,area,onArea,busy,onInsert,onCancel,onError,initialText='',fonts,onLoadFont}:{mode:ToolMode;model:PageModel;area:Rect;onArea:(rect:Rect)=>void;busy:boolean;onInsert:(insertion:Insertion)=>void;onCancel:()=>void;onError:(message:string)=>void;initialText?:string;fonts:FontAssets;onLoadFont:(file:File)=>Promise<string|undefined>}){
  const [text,setText]=useState(initialText),[size,setSize]=useState(16),[color,setColor]=useState('#202733'),[background,setBackground]=useState('#ffffff')
  const [fit,setFit]=useState(true),[vertical,setVertical]=useState(false)
  const [family,setFamily]=useState<Replacement['family']>('sans'),[bold,setBold]=useState(false)
  const [customFontId,setCustomFontId]=useState<string|undefined>(),[typography,setTypography]=useState({widthPercent:100,lineHeight:1.2})
  const [shape,setShape]=useState<'rectangle'|'line'|'highlight'|'cover'>('rectangle')
  const [image,setImage]=useState<{name:string;bytes:Uint8Array;format:'png'|'jpg'}|null>(null)
  const imageInput=useRef<HTMLInputElement>(null)
  const textInput=useRef<HTMLTextAreaElement>(null)
  useEffect(()=>setText(initialText),[initialText])
  useEffect(()=>{
    if(mode!=='replace'&&mode!=='text')return
    const frame=requestAnimationFrame(()=>{textInput.current?.focus({preventScroll:true});textInput.current?.select();textInput.current?.scrollIntoView({block:'nearest'})})
    return ()=>cancelAnimationFrame(frame)
  },[mode,initialText])
  useEffect(()=>{if(mode==='replace')setSize(Math.max(1,Math.min(24,area.height*0.7)))},[mode,area.height])
  const numeric=(key:keyof Rect,label:string)=> <label className="placement-field">{label}<input type="number" aria-label={label} min={key==='width'||key==='height'?1:0} max={key==='x'||key==='width'?model.width:model.height} step="0.1" value={Number(area[key].toFixed(2))} disabled={busy} onChange={e=>onArea({...area,[key]:Number(e.target.value)})}/></label>
  async function chooseImage(file:File){
    try{
      if(file.size>100*1024*1024)throw new Error('画像は100 MB以内で選択してください。')
      if(!['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(file.type))throw new Error('PNG・JPEG・WebP・GIF・BMPの画像を選んでください。')
      if(file.type==='image/png'||file.type==='image/jpeg'){setImage({name:file.name,bytes:new Uint8Array(await file.arrayBuffer()),format:file.type==='image/png'?'png':'jpg'});return}
      const bitmap=await createImageBitmap(file),scale=Math.min(1,4096/Math.max(bitmap.width,bitmap.height))
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
      canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('画像を変換できません。')),'image/png'))
      setImage({name:file.name,bytes:new Uint8Array(await blob.arrayBuffer()),format:'png'});canvas.width=canvas.height=0
    }catch(error){onError(error instanceof Error?error.message:'画像を開けません。')}
  }
  return <div className="properties-scroll insertion-panel"><h3>{mode==='replace'?'範囲を書き換える':mode==='image'?'画像を追加':mode==='shape'?'図形を追加':'テキストを追加'}</h3><p className="insertion-hint">PDF上をドラッグして場所と大きさを指定できます。</p>
    <div className="placement-grid">{numeric('x','左から（pt）')}{numeric('y','上から（pt）')}{numeric('width','範囲の幅（pt）')}{numeric('height','範囲の高さ（pt）')}</div>
    {mode==='text'||mode==='replace'?<><label className="field-label" htmlFor="insert-text">追加するテキスト</label><textarea ref={textInput} id="insert-text" value={text} disabled={busy} rows={5} maxLength={10000} onChange={e=>setText(e.target.value)} placeholder="文字を入力（改行できます）"/><label className="field-label" htmlFor="insert-size">追加文字のサイズ（pt）</label><input id="insert-size" type="number" min="1" max="720" value={size} step="0.1" disabled={busy} onChange={e=>setSize(Number(e.target.value))}/><FontPicker id="insert-family" label="追加文字の書体" family={family} customFontId={customFontId} fonts={fonts} busy={busy} onChange={(family,id)=>{setFamily(family);setCustomFontId(id)}} onLoad={onLoadFont}/><TypographyControls {...typography} disabled={busy} onChange={setTypography}/><label className="option-check"><input type="checkbox" checked={bold} disabled={busy||!!customFontId} onChange={e=>setBold(e.target.checked)}/>太字で追加</label><label className="option-check"><input type="checkbox" checked={fit} disabled={busy} onChange={e=>setFit(e.target.checked)}/>追加する文字を範囲に収める</label><label className="option-check"><input type="checkbox" checked={vertical} disabled={busy} onChange={e=>setVertical(e.target.checked)}/>1文字ずつ縦に配置</label></>:null}
    {mode==='image'?<><input ref={imageInput} type="file" className="visually-hidden" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" aria-label="追加する画像ファイル" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void chooseImage(file)}}/><button type="button" className="button secondary" disabled={busy} onClick={()=>imageInput.current?.click()}>画像ファイルを選択</button>{image&&<p className="insertion-hint">{image.name}</p>}<p className="insertion-hint">縦横比を保って範囲内に配置します。GIFは最初の画像、WebP・GIF・BMPはPNGに変換します。</p></>:<><label className="field-label">{mode==='shape'?'図形の色':'追加文字の色'}<input aria-label={mode==='shape'?'図形の色':'追加文字の色'} type="color" value={color} disabled={busy} onChange={e=>setColor(e.target.value)}/></label></>}
    {mode==='shape'&&<><label className="field-label" htmlFor="insert-shape">図形の種類</label><select id="insert-shape" value={shape} disabled={busy} onChange={e=>setShape(e.target.value as typeof shape)}><option value="rectangle">四角い枠</option><option value="line">線</option><option value="highlight">半透明のマーカー</option><option value="cover">塗りつぶし</option></select></>}
    {mode==='replace'&&<><label className="field-label">元の部分を覆う色<input type="color" aria-label="元の部分を覆う色" value={background} disabled={busy} onChange={e=>setBackground(e.target.value)}/></label><p className="cover-notice">指定した範囲をこの色で覆い、新しい文字を配置します。スキャン画像・重なる文字にも使えます。背景や罫線も範囲内は覆われます。墨消しには使えません。</p></>}
    <button type="button" className="button primary apply-button" disabled={busy||mode==='image'&&!image} onClick={()=>{
      if(mode==='image'&&image)onInsert({kind:'image',rect:area,bytes:image.bytes,format:image.format})
      else if(mode==='shape')onInsert({kind:'shape',rect:area,shape,color})
      else onInsert({kind:'text',rect:area,text:vertical?[...text.replace(/\r?\n/g,'')].join('\n'):text,size,color,family,bold,autoFit:fit,customFontId,...typography,...(mode==='replace'?{cover:background}:{})})
    }}>{mode==='replace'?'この範囲を書き換える':'PDFに追加'}</button><button type="button" className="text-button" disabled={busy} onClick={onCancel}>文字の選択に戻る</button>
  </div>
}
