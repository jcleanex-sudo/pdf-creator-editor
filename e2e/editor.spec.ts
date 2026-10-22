import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

const textButton=(page: Page,text: string)=>page.getByRole('button',{name:`文字を選択: ${text}`,exact:true})
const ready=(page: Page,count: number)=>expect(page.locator('.status-left')).toContainText(`${count}箇所の変更`)
const saveReady=(page: Page)=>expect(page.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()

test('real upload, Japanese/numeric replacement, preview preservation, undo/redo, download and reopen',async({page,context},info)=>{
  const errors:string[]=[], external:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  context.on('request',r=>{ if(/^https?:/.test(r.url()) && new URL(r.url()).origin!=='http://127.0.0.1:4173') external.push(r.url()) })
  await page.goto('/')
  await page.getByRole('button',{name:'サンプルPDFを試す'}).click()
  await expect(textButton(page,'150,000')).toBeVisible()
  await saveReady(page)
  const sourceEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const source=await sourceEvent, sourcePath=info.outputPath('original.pdf')
  await source.saveAs(sourcePath)

  // Exercise actual file input, not just the sample-document path.
  await page.locator('input[type=file]').setInputFiles(sourcePath)
  await expect(textButton(page,'150,000')).toBeVisible()
  await expect(page.locator('.toolbar-file')).toContainText('original.pdf')
  await page.locator('.paper-loading').waitFor({state:'hidden'})
  // Regression: all four Japanese title glyphs must have visible ink, not just extractable Unicode.
  const titleInk=await page.locator('.page-canvas').evaluate((element)=>{
    const canvas=element as HTMLCanvasElement,ctx=canvas.getContext('2d')!
    return Array.from({length:4},(_,glyph)=>{
      const pixels=ctx.getImageData(48+glyph*30,84,30,45).data
      let ink=0
      for(let i=0;i<pixels.length;i+=4)if(pixels[i]<150&&pixels[i+1]<150&&pixels[i+2]<150)ink++
      return ink
    })
  })
  for(const ink of titleInk) expect(ink).toBeGreaterThan(110)

  await textButton(page,'品名').click()
  await expect(page.locator('.restriction-note')).toContainText('白い背景')
  await expect(page.getByLabel('変更後のテキスト')).toBeDisabled()
  await textButton(page,'150,000').click()
  const masks: {x:number;y:number;width:number;height:number}[]=[]
  async function rememberMask(text:string) {
    const b=await textButton(page,text).boundingBox(),paper=await page.locator('.pdf-paper').boundingBox()
    masks.push({x:b!.x-paper!.x,y:b!.y-paper!.y,width:b!.width,height:b!.height})
  }
  await rememberMask('150,000');await rememberMask('株式会社サンプル 御中');await rememberMask('198,000')
  await page.locator('.page-canvas').evaluate((el)=>{
    const canvas=el as HTMLCanvasElement
    ;(window as unknown as {originalPixels:ImageData}).originalPixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height)
  })
  await page.getByLabel('変更後のテキスト').fill('250,000')
  await page.getByRole('button',{name:'変更を適用',exact:true}).click()
  await ready(page,2);await saveReady(page)
  await textButton(page,'株式会社サンプル 御中').click()
  await page.getByLabel('変更後のテキスト').fill('株式会社テスト 御中')
  await page.getByRole('button',{name:'変更を適用',exact:true}).click()
  await ready(page,3);await saveReady(page)
  await page.locator('.paper-loading').waitFor({state:'hidden'})
  const outsideDifferences=await page.locator('.page-canvas').evaluate((element,rects)=>{
    const canvas=element as HTMLCanvasElement,after=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height)
    const before=(window as unknown as {originalPixels:ImageData}).originalPixels
    if(before.width!==after.width||before.height!==after.height)throw new Error('Raster dimensions changed')
    let changed=0
    for(let y=0;y<after.height;y++)for(let x=0;x<after.width;x++) {
      if(rects.some(r=>x>=r.x-2&&x<=r.x+r.width+2&&y>=r.y-2&&y<=r.y+r.height+2))continue
      const i=(y*after.width+x)*4
      if(Math.abs(before.data[i]-after.data[i])+Math.abs(before.data[i+1]-after.data[i+1])+Math.abs(before.data[i+2]-after.data[i+2])>6)changed++
    }
    return changed
  },masks)
  expect(outsideDifferences).toBe(0)

  await page.getByRole('button',{name:'元に戻す',exact:true}).click()
  await ready(page,2);await saveReady(page)
  await page.getByRole('button',{name:'やり直す',exact:true}).click()
  await ready(page,3);await saveReady(page)
  await page.getByRole('button',{name:'次のページ',exact:true}).click()
  await expect(textButton(page,'ご利用について')).toBeVisible()
  await page.getByRole('button',{name:'前のページ',exact:true}).click()
  await expect(textButton(page,'250,000')).toBeVisible()

  const downloadEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const download=await downloadEvent,outputPath=info.outputPath('edited.pdf')
  expect(download.suggestedFilename()).toBe('original_edited.pdf')
  await download.saveAs(outputPath)
  expect((await PDFDocument.load(await readFile(outputPath))).getPageCount()).toBe(2)
  await page.screenshot({path:info.outputPath('editor.png'),fullPage:true})
  const reopened=await context.newPage()
  await reopened.goto('/')
  await reopened.locator('input[type=file]').setInputFiles(outputPath)
  await expect(textButton(reopened,'250,000')).toBeAttached()
  await expect(textButton(reopened,'株式会社テスト 御中')).toBeAttached()
  await expect(textButton(reopened,'308,000')).toBeAttached()
  // Restored editing exposes the visible replacement, not the hidden old value.
  await expect(textButton(reopened,'150,000')).toHaveCount(0)
  await textButton(reopened,'250,000').click()
  await expect(reopened.getByLabel('変更後のテキスト')).toBeEnabled()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('rejects invalid inputs and unsupported edits, preserving the current document',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'サンプルPDFを試す'}).click()
  await expect(textButton(page,'150,000')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nnot a valid document')})
  await expect(page.getByRole('alert')).toContainText('PDFを読み込めません')
  await expect(textButton(page,'150,000')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({name:'too-large.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(26*1024*1024)})
  await expect(page.getByRole('alert')).toContainText('25 MB')
  await textButton(page,'150,000').click()
  await page.getByLabel('変更後のテキスト').fill('一行目\n二行目')
  await page.getByRole('button',{name:'変更を適用',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('改行')
  await ready(page,0)
  await page.getByLabel('変更後のテキスト').fill('🦄')
  await page.getByRole('button',{name:'変更を適用',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('保存できない文字')
  await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('保存できない文字')
})

test('handles PDFs without text and blocks editing rotated pages',async({page})=>{
  await page.goto('/')
  const blank=await PDFDocument.create();blank.addPage()
  await page.locator('input[type=file]').setInputFiles({name:'no-text.pdf',mimeType:'application/pdf',buffer:Buffer.from(await blank.save())})
  await expect(page.locator('.inline-note')).toContainText('文字情報がありません')
  const rotated=await PDFDocument.create(),p=rotated.addPage()
  p.drawText('Rotated text',{font:await rotated.embedFont(StandardFonts.Helvetica),x:50,y:500,size:14})
  p.setRotation(degrees(90))
  await page.locator('input[type=file]').setInputFiles({name:'rotated.pdf',mimeType:'application/pdf',buffer:Buffer.from(await rotated.save())})
  await textButton(page,'Rotated text').click()
  await expect(page.locator('.restriction-note')).toContainText('回転')
  await expect(page.getByLabel('変更後のテキスト')).toBeDisabled()
})
