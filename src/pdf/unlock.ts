import { PDFDocument } from 'pdf-lib'
import { readPdf } from './reader'
import { MAX_FILE_SIZE, MAX_PAGES } from './limits'

/** Make a visual copy locally; this is not lossless PDF decryption. */
export async function unlockVisualCopy(bytes:Uint8Array,password:string,onProgress:(current:number,total:number)=>void){
  const task=readPdf(bytes,password)
  try{
    const source=await task.promise
    if(source.numPages>MAX_PAGES)throw new Error('ページ数が多すぎます。')
    const output=await PDFDocument.create()
    let imageBytes=0
    for(let index=0;index<source.numPages;index++){
      onProgress(index+1,source.numPages)
      const page=await source.getPage(index+1),natural=page.getViewport({scale:1})
      const scale=Math.min(2.5,Math.sqrt(10_000_000/(natural.width*natural.height))),viewport=page.getViewport({scale})
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
      await page.render({canvas,viewport,background:'rgb(255,255,255)'}).promise
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('ページを画像化できません。')),'image/png'))
      const data=new Uint8Array(await blob.arrayBuffer());imageBytes+=data.length
      if(imageBytes>MAX_FILE_SIZE)throw new Error('画像化したコピーが100 MBを超えます。')
      const image=await output.embedPng(data)
      output.addPage([natural.width,natural.height]).drawImage(image,{x:0,y:0,width:natural.width,height:natural.height})
      canvas.width=canvas.height=0
    }
    return output.save()
  }finally{await task.destroy()}
}
