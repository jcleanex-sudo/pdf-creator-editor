import fontkit, { type Font } from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'

export type FontAsset = { name:string; postscriptName:string; bytes:Uint8Array }
export type FontAssets = Record<string,FontAsset>
const key=PDFName.of('PDFEditorFontsV1')
export const MAX_FONT_BYTES=20*1024*1024
const MAX_TOTAL_BYTES=50*1024*1024,MAX_FONTS=16
const validId=(id:unknown):id is string=>typeof id==='string'&&/^font-[1-9]\d{0,3}$/.test(id)
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((value,index)=>value===b[index])
const safeName=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)

export function inspectFont(bytes:Uint8Array):FontAsset{
  if(!bytes.length||bytes.length>MAX_FONT_BYTES)throw new Error('フォントは20 MB以内のTTF・OTFを選んでください。')
  let font:Font&{'OS/2'?:{fsType:{noEmbedding?:boolean;viewOnly?:boolean;editable?:boolean;bitmapOnly?:boolean}}}
  try{font=fontkit.create(bytes) as typeof font
    if(typeof font.layout!=='function'||!Number.isFinite(font.unitsPerEm))throw new Error('Unsupported font collection')
    font.layout('Aaあいう123')
  }catch{throw new Error('フォントを読み込めません。単体のTTF・OTFファイルを選んでください。')}
  const rights=font['OS/2']?.fsType
  if(rights?.noEmbedding||rights?.bitmapOnly||rights?.viewOnly&&!rights.editable)throw new Error('このフォントには埋め込み制限があります。PDFへの埋め込みを許可されたフォントを選んでください。')
  return {name:safeName(font.fullName||font.postscriptName||'読み込んだフォント'),postscriptName:safeName(font.postscriptName||font.fullName||''),bytes}
}

export function addFont(assets:FontAssets,asset:FontAsset){
  for(const[id,value]of Object.entries(assets))if(same(value.bytes,asset.bytes))return {assets,id}
  if(Object.keys(assets).length>=MAX_FONTS||Object.values(assets).reduce((sum,font)=>sum+font.bytes.length,asset.bytes.length)>MAX_TOTAL_BYTES)
    throw new Error('手元のフォントは合計50 MB・16書体までです。別のPDFを開くと読み込み状況をリセットできます。')
  let index=1;while(assets[`font-${index}`])index++
  const id=`font-${index}`
  return {assets:{...assets,[id]:asset},id}
}

function records(pdf:PDFDocument){
  if(!pdf.catalog.has(key))return []
  const stream=pdf.context.lookup(pdf.catalog.get(key))
  if(!(stream instanceof PDFRawStream)||stream.dict.has(PDFName.of('Filter'))||stream.contents.length>32*1024)throw new Error('フォントの編集データが正しくありません。')
  const values:unknown=JSON.parse(new TextDecoder().decode(stream.contents))
  if(!Array.isArray(values)||values.length>MAX_FONTS||values.some(value=>!value||!validId(value.id)||typeof value.name!=='string'||value.name.length>200||typeof value.postscriptName!=='string'||value.postscriptName.length>200||!Number.isInteger(value.object)||value.object<1||!Number.isInteger(value.generation)||value.generation<0)||new Set(values.map(v=>v.id)).size!==values.length)
    throw new Error('フォントの編集データが正しくありません。')
  return values as {id:string;name:string;postscriptName:string;object:number;generation:number}[]
}
export function readFontAssets(pdf:PDFDocument):FontAssets{
  const assets:FontAssets={};let total=0
  for(const value of records(pdf)){
    const stream=pdf.context.lookup(PDFRef.of(value.object,value.generation))
    if(!(stream instanceof PDFRawStream)||stream.dict.has(PDFName.of('Filter'))||!stream.contents.length||stream.contents.length>MAX_FONT_BYTES||(total+=stream.contents.length)>MAX_TOTAL_BYTES)
      throw new Error('フォントの編集データが大きすぎるか、正しくありません。')
    assets[value.id]={name:safeName(value.name),postscriptName:safeName(value.postscriptName),bytes:stream.contents.slice()}
  }
  return assets
}
export function storeFontAssets(pdf:PDFDocument,assets:FontAssets){
  if(Object.keys(assets).some(id=>!validId(id))||Object.keys(assets).length>MAX_FONTS||Object.values(assets).some(font=>!font.bytes.length||font.bytes.length>MAX_FONT_BYTES)||Object.values(assets).reduce((sum,font)=>sum+font.bytes.length,0)>MAX_TOTAL_BYTES)
    throw new Error('フォントの編集データが大きすぎます。')
  const previous=records(pdf),values=[]
  for(const[id,font]of Object.entries(assets)){
    const old=previous.find(value=>value.id===id)
    const stream=old?pdf.context.lookup(PDFRef.of(old.object,old.generation)):undefined
    const ref=old&&stream instanceof PDFRawStream&&same(stream.contents,font.bytes)?PDFRef.of(old.object,old.generation):pdf.context.register(pdf.context.stream(font.bytes))
    values.push({id,name:safeName(font.name),postscriptName:safeName(font.postscriptName),object:ref.objectNumber,generation:ref.generationNumber})
  }
  if(values.length)pdf.catalog.set(key,pdf.context.register(pdf.context.stream(new TextEncoder().encode(JSON.stringify(values)))))
  else pdf.catalog.delete(key)
}
