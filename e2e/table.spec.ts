import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

test('edits short table cells without erasing rules, including Japanese and commas', async ({page, context}, info) => {
  const pdf=await PDFDocument.create()
  const font=await pdf.embedFont(StandardFonts.TimesRoman)
  const paper=pdf.addPage([600,800]), rowHeight=11.7
  for(let row=0;row<4;row++) {
    const top=700-row*rowHeight
    paper.drawRectangle({x:50,y:top-rowHeight,width:490,height:rowHeight,borderWidth:1.08,borderColor:rgb(0,0,0)})
    for(const x of [250,400]) paper.drawLine({start:{x,y:top},end:{x,y:top-rowHeight},thickness:1.08,color:rgb(0,0,0)})
    const label=['Detail A','Detail B','Detail C','Detail D'][row]
    paper.drawText(label,{x:52,y:top-9.5,size:9.9,font})
    const amount=['123,456','321,654','987,654','456,789'][row]
    paper.drawText(amount,{x:539.15-font.widthOfTextAtSize(amount,9),y:top-9.5,size:9,font})
  }
  pdf.addPage([600,800]).drawText('Untouched page')
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({name:'dense-table.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())})
  const target=(text:string)=>page.getByRole('button',{name:`文字を選択: ${text}`,exact:true})
  await expect(target('123,456')).toBeVisible()
  await page.locator('.paper-loading').waitFor({state:'hidden'})
  const before=await page.locator('.page-canvas').evaluate(element=>{
    const c=element as HTMLCanvasElement
    return Array.from(c.getContext('2d')!.getImageData(0,0,c.width,c.height).data)
  })
  const masks:{x:number;y:number;width:number;height:number}[]=[]
  for(const [oldText,newText] of [['123,456','124,567'],['Detail A','編集内容']]) {
    const box=await target(oldText).boundingBox(),sheet=await page.locator('.pdf-paper').boundingBox()
    masks.push({x:box!.x-sheet!.x,y:box!.y-sheet!.y,width:box!.width,height:box!.height})
    await target(oldText).click()
    await expect(page.getByLabel('変更後のテキスト')).toBeEnabled()
    await page.getByLabel('変更後のテキスト').fill(newText)
    await page.getByRole('button',{name:'変更を適用',exact:true}).click()
    await expect(page.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  await page.locator('.paper-loading').waitFor({state:'hidden'})
  const changedOutside=await page.locator('.page-canvas').evaluate((element,{before,masks})=>{
    const c=element as HTMLCanvasElement, after=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data
    let count=0
    for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
      if(masks.some(r=>x>=Math.floor(r.x)&&x<Math.ceil(r.x+r.width)&&y>=Math.floor(r.y)&&y<Math.ceil(r.y+r.height)))continue
      const i=(y*c.width+x)*4
      if([0,1,2].some(k=>after[i+k]!==before[i+k]))count++
    }
    return count
  },{before,masks})
  expect(changedOutside).toBe(0)
  const event=page.waitForEvent('download')
  await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const path=info.outputPath('edited-table.pdf');await(await event).saveAs(path)
  const reopened=await context.newPage();await reopened.goto('/')
  await reopened.locator('input[type=file]').setInputFiles(path)
  await reopened.getByRole('button',{name:'文字を選択: 124,567',exact:true}).click()
  await expect(reopened.getByLabel('変更後のテキスト')).toBeEnabled()
  await expect(reopened.getByRole('button',{name:'文字を選択: 編集内容',exact:true})).toBeAttached()
})
