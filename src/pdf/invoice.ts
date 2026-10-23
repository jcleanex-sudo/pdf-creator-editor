import {PDFDocument,rgb,type PDFFont} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

export type Invoice={recipient:string;branch:string;issuer:string;representative:string;address:string;description:string;amount:number;date:string;due:string}
const fields=['recipient','branch','issuer','representative','address','description'] as const
export function validateInvoice(value:unknown):Invoice{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('請求書データを読み込めません。')
  const data=value as Record<string,unknown>
  for(const field of fields)if(typeof data[field]!=='string'||!data[field].trim()||data[field].length>200||/[\u0000-\u001f\u007f]/u.test(data[field]))throw new Error('請求書の文字を確認してください。')
  if(typeof data.amount!=='number'||!Number.isSafeInteger(data.amount)||data.amount<0||data.amount>1_000_000_000_000)throw new Error('請求金額を確認してください。')
  for(const key of ['date','due']){
    const date=data[key]
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('請求日・支払期限を確認してください。')
  }
  if(String(data.due)<String(data.date))throw new Error('支払期限は請求日以降に指定してください。')
  return Object.fromEntries([...fields.map(key=>[key,data[key]]),['amount',data.amount],['date',data.date],['due',data.due]]) as Invoice
}

/** The fragment stays in the browser; invoice fields never go into requests. */
export function readInvoiceLink(hash:string){
  const raw=hash.slice('#invoice='.length)
  if(!hash.startsWith('#invoice=')||raw.length>12_000||!raw||!/^[\w-]+$/.test(raw))throw new Error('請求書のリンクを読み込めません。')
  try{
    const bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
    if(bytes.length>8_000)throw new Error()
    return validateInvoice(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))
  }catch{throw new Error('請求書のリンクを読み込めません。内容を確認してください。')}
}
const dateLabel=(value:string)=>{const [year,month,day]=value.split('-');return `${year}年${Number(month)}月${Number(day)}日`}

export async function makeInvoice(input:Invoice,fontBytes:Uint8Array,boldBytes:Uint8Array){
  const data=validateInvoice(input),pdf=await PDFDocument.create();pdf.registerFontkit(fontkit)
  // Keep the verified full-font embedding path; do not subset Japanese glyphs.
  const regular=await pdf.embedFont(fontBytes,{subset:false}),bold=await pdf.embedFont(boldBytes,{subset:false})
  const page=pdf.addPage([595.28,841.89]),ink=rgb(.12,.17,.23),muted=rgb(.38,.43,.49),line=rgb(.80,.83,.86)
  const supported=new Set(regular.getCharacterSet())
  if(fields.some(field=>[...data[field]].some(c=>!supported.has(c.codePointAt(0)!))))throw new Error('請求書に同梱フォントで表示できない文字があります。')
  const text=(value:string,x:number,y:number,size=11,font:PDFFont=regular,color=ink,width?:number)=>{
    if(width){size=Math.min(size,width/Math.max(1,font.widthOfTextAtSize(value,1)));if(size<7)throw new Error('文字が長すぎます。請求書の内容を短くしてください。')}
    page.drawText(value,{x,y,size,font,color})
  }
  const right=(value:string,x:number,y:number,size=11,font:PDFFont=regular,color=ink)=>text(value,x-font.widthOfTextAtSize(value,size),y,size,font,color)
  const rule=(y:number,x1=48,x2=547.28)=>page.drawLine({start:{x:x1,y},end:{x:x2,y},thickness:.7,color:line})
  const amount=data.amount.toLocaleString('ja-JP')
  text('請求書',(595.28-bold.widthOfTextAtSize('請求書',26))/2,781,26,bold);rule(758)
  right(`請求日：${dateLabel(data.date)}`,547.28,731,10)
  right(`支払期限：${dateLabel(data.due)}`,547.28,712,10,bold)
  text(data.recipient,48,704,17,bold,ink,285);text(data.branch,48,676,16,bold,ink,285)
  text('下記のとおりご請求申し上げます。',48,622,10.5)
  text('請求元',344,679,9,regular,muted);text(data.issuer,344,656,14,bold,ink,203.28)
  text(data.representative,344,635,11,regular,ink,203.28);text(data.address,344,614,9.8,regular,ink,203.28)
  page.drawRectangle({x:48,y:528,width:499.28,height:62,color:rgb(.947,.959,.973)})
  text('ご請求金額',64,555,11,bold)
  const amountSize=Math.min(27,345/bold.widthOfTextAtSize(amount+' 円',1))
  right(amount+' 円',531.28,548,amountSize,bold)
  page.drawRectangle({x:48,y:464,width:499.28,height:29,color:rgb(.947,.959,.973)})
  text('項目',62,474,10.5,bold);right('金額（円）',531.28,474,10.5,bold)
  text(data.description,62,435,12,regular,ink,335);right(amount,531.28,435,12)
  rule(410);text('合計',367,381,12,bold);right(amount+' 円',531.28,379,14,bold);rule(368,344,547.28)
  text('お支払期限までにお支払いくださいますようお願いいたします。',48,316,10,regular,muted);right('1 / 1',547.28,32,8,regular,muted)
  pdf.setTitle('請求書');pdf.setAuthor(data.issuer);pdf.setSubject(data.description)
  return pdf.save()
}
