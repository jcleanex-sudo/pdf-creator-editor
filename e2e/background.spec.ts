import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb, setTextRenderingMode, TextRenderingMode } from 'pdf-lib'

test('edits text over colors, images and lines by restoring the background', async ({ page }) => {
  await page.goto('/')
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 4
    const context = canvas.getContext('2d')!
    context.fillStyle = '#888888'
    context.fillRect(0, 0, 4, 4)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const paper = pdf.addPage([600, 800])
  const draw = (text: string, y: number) => paper.drawText(text, {
    x: 50, y, size: 14, font, color: rgb(0.05, 0.1, 0.6),
  })
  draw('Blue on white', 700)
  paper.drawRectangle({ x: 45, y: 635, width: 230, height: 35, color: rgb(0.93, 0.95, 0.97) })
  draw('Text on colored background', 645)
  paper.drawImage(await pdf.embedPng(Buffer.from(image, 'base64')), { x: 90, y: 590, width: 12, height: 12 })
  draw('Text over image', 590)
  paper.drawLine({ start: { x: 50, y: 540 }, end: { x: 145, y: 540 }, thickness: 0.5 })
  draw('Text over line', 535)
  const background=pdf.addPage([600,800])
  background.drawRectangle({x:45,y:635,width:230,height:35,color:rgb(0.93,0.95,0.97)})
  background.drawImage(await pdf.embedPng(Buffer.from(image,'base64')),{x:90,y:590,width:12,height:12})
  background.drawLine({start:{x:50,y:540},end:{x:145,y:540},thickness:0.5})

  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({
    name: 'background-check.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.getByRole('button',{name:'文字を選択: Blue on white',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'2ページへ',exact:true}).click()
  await expect(page.locator('.inline-note')).toContainText('文字情報がありません')
  await page.locator('.paper-loading').waitFor({state:'hidden'})
  const reference=await page.locator('.page-canvas').evaluate(element=>{const c=element as HTMLCanvasElement;return Array.from(c.getContext('2d')!.getImageData(0,0,c.width,c.height).data)})
  await page.getByRole('button',{name:'1ページへ',exact:true}).click()
  const masks:{x:number;y:number;width:number;height:number}[]=[]
  for (const text of ['Text on colored background', 'Text over image', 'Text over line']) {
    const target=page.getByRole('button', { name: `文字を選択: ${text}`, exact: true })
    const box=await target.boundingBox(),paper=await page.locator('.pdf-paper').boundingBox()
    masks.push({x:box!.x-paper!.x,y:box!.y-paper!.y,width:box!.width,height:box!.height})
    await target.click()
    await expect(page.getByLabel('変更後のテキスト')).toBeEnabled()
    await page.getByLabel('変更後のテキスト').fill('')
    await page.getByRole('button',{name:'変更を適用',exact:true}).click()
    await expect(page.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
  }
  await page.locator('.paper-loading').waitFor({state:'hidden'})
  const errors=await page.locator('.page-canvas').evaluate((element,{reference,masks})=>{
    const c=element as HTMLCanvasElement,data=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data
    return masks.map(mask=>{let sum=0,count=0;for(let y=Math.ceil(mask.y);y<Math.floor(mask.y+mask.height);y++)for(let x=Math.ceil(mask.x);x<Math.floor(mask.x+mask.width);x++){const i=(y*c.width+x)*4;for(let k=0;k<3;k++){sum+=Math.abs(data[i+k]-reference[i+k]);count++}}return sum/count})
  },{reference,masks})
  expect(errors[0]).toBeLessThan(1)
  expect(errors[1]).toBeLessThan(8)
  expect(errors[2]).toBeLessThan(12)
  await page.getByRole('button', { name: '文字を選択: Blue on white', exact: true }).click()
  await expect(page.getByLabel('変更後のテキスト')).toBeEnabled()
  await page.getByLabel('変更後のテキスト').fill('250,000')
  await page.getByRole('button', { name: '変更を適用', exact: true }).click()
  await expect(page.locator('.status-left')).toContainText('4箇所の変更')
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled()
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  expect((await saved).suggestedFilename()).toBe('background-check_edited.pdf')
})

test('protects pages whose graphics depend on text clipping', async ({ page }) => {
  await page.goto('/')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const paper = pdf.addPage([600, 800])
  paper.pushOperators(setTextRenderingMode(TextRenderingMode.FillAndClip))
  paper.drawText('Clipping text', { x: 50, y: 700, size: 20, font })
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({
    name: 'text-clip.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  })
  await page.getByRole('button', { name: '文字を選択: Clipping text', exact: true }).click()
  await expect(page.getByLabel('変更後のテキスト')).toBeDisabled()
  await expect(page.locator('.restriction-note')).toContainText('切り抜き')
})
