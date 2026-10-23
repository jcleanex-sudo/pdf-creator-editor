import { useRef } from 'react'
import type { FontAssets } from '../pdf/custom-fonts'
import type { Replacement } from '../pdf/types'

export function FontPicker({label,id,family,customFontId,fonts,busy,onChange,onLoad}:{label:string;id:string;family:Replacement['family'];customFontId?:string;fonts:FontAssets;busy:boolean;onChange:(family:Replacement['family'],customFontId?:string)=>void;onLoad:(file:File)=>Promise<string|undefined>}){
  const input=useRef<HTMLInputElement>(null)
  return <><label className="field-label" htmlFor={id}>{label}</label><select id={id} value={customFontId??family??'auto'} disabled={busy} onChange={event=>{const value=event.target.value;if(value.startsWith('font-'))onChange('auto',value);else onChange(value as Replacement['family'])}}>
    <option value="auto">元の書体に合わせる</option><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="mono">等幅（欧文）</option>
    {Object.keys(fonts).length>0&&<optgroup label="追加・保存された書体">{Object.entries(fonts).map(([id,font])=><option key={id} value={id}>{font.name}</option>)}</optgroup>}
  </select><input ref={input} type="file" accept=".ttf,.otf,font/ttf,font/otf" className="visually-hidden" aria-label="使用するフォントファイル" disabled={busy} onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(file){const id=await onLoad(file);if(id)onChange('auto',id)}}}/><button type="button" className="text-button custom-font-button" disabled={busy} onClick={()=>input.current?.click()}>手元のフォントを読み込む</button><p className="font-input-hint">PDFへの埋め込みを許可されたTTF・OTFを使用できます。太さ・斜体は選んだファイルのものを使います。ファイルは送信されません。</p></>
}
