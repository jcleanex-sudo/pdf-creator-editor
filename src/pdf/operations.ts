import { PDFDocument, PDFName, degrees, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib'
import { createFontResolver, loadJapaneseFont } from './output'
import type { DocumentSession, Rect, TextRegion, Replacement } from './types'
import { MAX_FILE_SIZE, MAX_PAGES, MAX_TEXT_LENGTH } from './limits'
import { readHiddenText, storeHiddenText, type HiddenText } from './hidden-text'
import { readFontAssets, storeFontAssets, addFont, type FontAssets } from './custom-fonts'
import { compactNewFonts, existingObjects } from './font-storage'

export type Placement = { rect: Rect; matrix: [number,number,number,number,number,number]; coverRect: Rect }
export type DocumentOperation =
  | { type:'page-add'; index:number }
  | { type:'page-delete'; index:number }
  | { type:'page-duplicate'; index:number }
  | { type:'page-rotate'; index:number }
  | { type:'page-move'; index:number; to:number }
  | { type:'merge'; bytes:Uint8Array }
  | { type:'text'; index:number; placement:Placement; text:string; size:number; color:string; family:Replacement['family']; bold:boolean; cover?:string; autoFit?:boolean; hidden?:HiddenText[]; customFontId?:string; widthPercent?:number; lineHeight?:number }
  | { type:'image'; index:number; placement:Placement; bytes:Uint8Array; format:'png'|'jpg' }
  | { type:'shape'; index:number; placement:Placement; shape:'rectangle'|'line'|'highlight'|'cover'; color:string }

const color=(value:string)=>{
  if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error('色を正しく指定してください。')
  const parts=value.slice(1).match(/../g)!.map(value=>parseInt(value,16)/255)
  return rgb(parts[0],parts[1],parts[2])
}
export async function blankDocument(){const pdf=await PDFDocument.create();pdf.addPage([595.28,841.89]);return pdf.save()}

export async function placementAt(session:DocumentSession,index:number,rect:Rect):Promise<Placement>{
  const page=await session.pdf.getPage(index+1),view=page.getViewport({scale:1})
  if(![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<1||rect.height<1||rect.x<0||rect.y<0||rect.x+rect.width>view.width+0.01||rect.y+rect.height>view.height+0.01)throw new Error('ページ内の範囲を指定してください。')
  const base=view.convertToPdfPoint(rect.x,rect.y+rect.height),right=view.convertToPdfPoint(rect.x+1,rect.y+rect.height),up=view.convertToPdfPoint(rect.x,rect.y+rect.height-1)
  const points=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>view.convertToPdfPoint(x,y))
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1])
  return {rect,matrix:[right[0]-base[0],right[1]-base[1],up[0]-base[0],up[1]-base[1],...base] as Placement['matrix'],coverRect:{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}}
}

export async function operateDocument(bytes:Uint8Array,operation:DocumentOperation,assets:FontAssets={}){
  const pdf=await PDFDocument.load(bytes),count=pdf.getPageCount()
  const originalObjects=existingObjects(pdf)
  let hidden=readHiddenText(pdf)
  let fonts={...readFontAssets(pdf),...assets},notice:string|undefined
  // These edits become the new base document; they must not restore a stale
  // project catalog from a file previously saved by another editing session.
  for(const key of ['PDFEditorSourceV1','PDFEditorProjectV1'])pdf.catalog.delete(PDFName.of(key))
  const pageMap=new Map(Array.from({length:count},(_,index)=>[index,index]))
  let active='index' in operation?operation.index:0
  if('index' in operation&&(!Number.isInteger(operation.index)||operation.index<0||operation.index>=count))throw new Error('対象のページが見つかりません。')
  if(operation.type==='page-add'){
    if(count>=MAX_PAGES)throw new Error('ページ数が多すぎます。')
    const at=operation.index+1;pdf.insertPage(at,[595.28,841.89]);active=at
    for(const[index]of pageMap)if(index>=at)pageMap.set(index,index+1)
  }else if(operation.type==='page-delete'){
    if(count===1)throw new Error('最後の1ページは削除できません。')
    pdf.removePage(operation.index);pageMap.delete(operation.index)
    for(const[index]of pageMap)if(index>operation.index)pageMap.set(index,index-1)
    active=Math.min(operation.index,count-2)
  }else if(operation.type==='page-duplicate'){
    if(count>=MAX_PAGES)throw new Error('ページ数が多すぎます。')
    const [copy]=await pdf.copyPages(pdf,[operation.index]),at=operation.index+1
    pdf.insertPage(at,copy);active=at
    for(const[index]of pageMap)if(index>=at)pageMap.set(index,index+1)
    const copied=hidden.filter(value=>value.pageIndex===operation.index).map(value=>({...value,pageIndex:at}))
    hidden=hidden.map(value=>({...value,pageIndex:pageMap.get(value.pageIndex)!})).concat(copied)
  }else if(operation.type==='page-move'){
    if(!Number.isInteger(operation.to)||operation.to<0||operation.to>=count)throw new Error('移動先のページが正しくありません。')
    const page=pdf.getPage(operation.index);pdf.removePage(operation.index);pdf.insertPage(operation.to,page);active=operation.to
    const order=Array.from({length:count},(_,index)=>index);order.splice(operation.to,0,...order.splice(operation.index,1));order.forEach((old,index)=>pageMap.set(old,index))
  }else if(operation.type==='page-rotate'){
    const page=pdf.getPage(operation.index);page.setRotation(degrees((page.getRotation().angle+90)%360))
  }else if(operation.type==='merge'){
    const other=await PDFDocument.load(operation.bytes)
    for(const asset of Object.values(readFontAssets(other))){
      try{fonts=addFont(fonts,asset).assets}
      catch{notice='ページを結合しました。書体保存の容量上限により、一部の書体は編集時に別途フォントファイルを選択してください。表示は保持しています。'}
    }
    hidden.push(...readHiddenText(other).map(value=>({...value,pageIndex:value.pageIndex+count})))
    if(count+other.getPageCount()>MAX_PAGES)throw new Error('結合後のページ数が多すぎます。')
    for(const page of await pdf.copyPages(other,other.getPageIndices()))pdf.addPage(page)
    active=count
  }else{
    const page=pdf.getPage(operation.index),{rect,matrix,coverRect}=operation.placement
    if(operation.type==='text'&&operation.cover)hidden.push(...operation.hidden??[])
    if(operation.type==='text'&&operation.cover)page.drawRectangle({...coverRect,color:color(operation.cover),borderWidth:0})
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...matrix))
    if(operation.type==='image'){
      const image=operation.format==='png'?await pdf.embedPng(operation.bytes):await pdf.embedJpg(operation.bytes)
      const scale=Math.min(rect.width/image.width,rect.height/image.height)
      page.drawImage(image,{x:0,y:rect.height-image.height*scale,width:image.width*scale,height:image.height*scale})
    }else if(operation.type==='shape'){
      if(operation.shape==='line')page.drawLine({start:{x:0,y:rect.height},end:{x:rect.width,y:0},thickness:1.5,color:color(operation.color)})
      else page.drawRectangle({x:0,y:0,width:rect.width,height:rect.height,...(operation.shape==='rectangle'?{borderColor:color(operation.color),borderWidth:1.5}:{color:color(operation.color),borderWidth:0,opacity:operation.shape==='highlight'?0.3:1})})
    }else{
      if(operation.text.length>MAX_TEXT_LENGTH||/[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/.test(operation.text)||!Number.isFinite(operation.size)||operation.size<1||operation.size>720)throw new Error('文字やサイズを正しく指定してください。')
      const widthScale=(operation.widthPercent??100)/100,lineHeight=operation.lineHeight??1.2
      if(!Number.isFinite(widthScale)||widthScale<0.1||widthScale>5||!Number.isFinite(lineHeight)||lineHeight<0.5||lineHeight>5)throw new Error('字幅・行間を正しく指定してください。')
      const resolve=createFontResolver(pdf,await loadJapaneseFont(),false,fonts)
      const font=await resolve({text:operation.text,fontSize:operation.size,color:operation.color,align:'left',family:operation.family,bold:operation.bold,customFontId:operation.customFontId,region:{appearance:{fontName:'Noto Sans JP',bold:operation.bold,italic:false}} as TextRegion})
      const supported=new Set(font.getCharacterSet())
      if([...operation.text].some(c=>c!=='\n'&&c!=='\r'&&!supported.has(c.codePointAt(0)!)))throw new Error('選んだ書体で表示できない文字があります。')
      const lines:string[]=[]
      for(const paragraph of operation.text.replace(/\r\n/g,'\n').split('\n')){
        let line=''
        for(const character of paragraph){if(operation.autoFit!==false&&line&&font.widthOfTextAtSize(line+character,operation.size)*widthScale>rect.width){lines.push(line);line=''}line+=character}
        lines.push(line)
      }
      const size=operation.autoFit===false?operation.size:Math.min(operation.size,rect.height/Math.max(1,lines.length*lineHeight),rect.width/Math.max(1,...lines.map(line=>font.widthOfTextAtSize(line,1)*widthScale)))
      if(size<1)throw new Error('文字が多すぎます。範囲を広げてください。')
      page.pushOperators(concatTransformationMatrix(widthScale,0,0,1,0,0))
      page.drawText(lines.join('\n'),{x:0,y:rect.height-size,size,lineHeight:size*lineHeight,font,color:color(operation.color)})
    }
    page.pushOperators(popGraphicsState())
  }
  if(operation.type.startsWith('page-')&&operation.type!=='page-duplicate')hidden=hidden.flatMap(value=>{const index=pageMap.get(value.pageIndex);return index===undefined?[]:[{...value,pageIndex:index}]})
  storeHiddenText(pdf,hidden)
  storeFontAssets(pdf,fonts)
  await compactNewFonts(pdf,originalObjects)
  const result=await pdf.save()
  if(result.length>MAX_FILE_SIZE)throw new Error('編集後のPDFが100 MBを超えます。画像を小さくしてください。')
  return {bytes:result,pageMap,active,notice}
}
