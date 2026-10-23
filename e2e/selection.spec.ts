import {test,expect,type Page} from '@playwright/test'
import {PDFDocument} from 'pdf-lib'
import {readFile} from 'node:fs/promises'

const ready=async(page:Page)=>{await expect(page.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toHaveCount(0);await page.locator('.paper-loading').waitFor({state:'hidden'})}

test('a physical click near tiny text selects and focuses the editable value without enlarging its export bounds',async({page,context},info)=>{
  const pdf=await PDFDocument.create();pdf.addPage([600,800]).drawText('12345',{x:150,y:650,size:5})
  await page.goto('/')
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({name:'tiny.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await ready(page)
  const hit=page.getByRole('button',{name:'文字を選択: 12345',exact:true});await expect(hit).toBeVisible()
  const box=(await hit.boundingBox())!
  await page.mouse.click(box.x-4,box.y+box.height/2)
  const input=page.getByLabel('変更後のテキスト',{exact:true})
  await expect(input).toHaveValue('12345');await expect(input).toBeFocused()
  await page.keyboard.type('24680')
  await expect(input).toHaveValue('24680')
  await page.getByRole('button',{name:'変更を適用',exact:true}).click();await ready(page)
  const after=(await page.getByRole('button',{name:'文字を選択: 24680',exact:true}).boundingBox())!
  expect(after.width).toBeCloseTo(box.width,3);expect(after.height).toBeCloseTo(box.height,3)
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const output=info.outputPath('tiny-click-edited.pdf');await(await event).saveAs(output)
  expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(1)
  const reopened=await context.newPage();await reopened.goto('/')
  await reopened.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(output);await ready(reopened)
  await reopened.getByRole('button',{name:'文字を選択: 24680',exact:true}).click()
  await expect(reopened.getByLabel('変更後のテキスト',{exact:true})).toBeEnabled()
})

test('clicking image-only text starts area rewriting directly and its saved result is selectable',async({page,context},info)=>{
  await page.goto('/')
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,600,800);x.fillStyle='black';x.font='18px sans-serif';x.fillText('IMAGE 123',60,120);x.fillStyle='#2687aa';x.fillRect(400,600,100,100);return c.toDataURL('image/png').split(',')[1]})
  const pdf=await PDFDocument.create();pdf.addPage([600,800]).drawImage(await pdf.embedPng(Buffer.from(png,'base64')),{x:0,y:0,width:600,height:800})
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await ready(page)
  await expect(page.locator('.inline-note')).toContainText('画像や図形')
  let paper=(await page.locator('.pdf-paper').boundingBox())!
  await page.mouse.click(paper.x+100,paper.y+110)
  await expect(page.getByRole('heading',{name:'範囲を書き換える',exact:true})).toBeVisible()
  await expect(page.getByLabel('追加するテキスト',{exact:true})).toBeFocused()
  paper=(await page.locator('.pdf-paper').boundingBox())!
  await page.mouse.move(paper.x+55,paper.y+90);await page.mouse.down();await page.mouse.move(paper.x+260,paper.y+135);await page.mouse.up()
  await page.getByLabel('追加するテキスト',{exact:true}).fill('画像の文字を変更')
  await page.getByRole('button',{name:'この範囲を書き換える',exact:true}).click();await ready(page)
  await expect(page.getByRole('button',{name:'文字を選択: 画像の文字を変更',exact:true})).toBeVisible()
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const output=info.outputPath('image-click-edited.pdf');await(await event).saveAs(output)
  const reopened=await context.newPage();await reopened.goto('/')
  await reopened.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(output);await ready(reopened)
  await reopened.getByRole('button',{name:'文字を選択: 画像の文字を変更',exact:true}).click()
  await expect(reopened.getByLabel('変更後のテキスト',{exact:true})).toBeEnabled()
})

test('the main edit button exits drawing mode and restores text and number clicking',async({page})=>{
  const pdf=await PDFDocument.create(),p=pdf.addPage([600,800]);p.drawText('TEXT VALUE',{x:60,y:650,size:14});p.drawText('123456',{x:300,y:650,size:14})
  await page.goto('/')
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({name:'mode.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await ready(page)
  await page.getByRole('button',{name:'範囲書き換え',exact:true}).click()
  await expect(page.locator('.pdf-paper')).toHaveClass(/drawing/)
  await page.getByRole('button',{name:'文字を編集',exact:true}).click()
  await expect(page.locator('.pdf-paper')).not.toHaveClass(/drawing/)
  for(const text of ['TEXT VALUE','123456']){
    const box=(await page.getByRole('button',{name:`文字を選択: ${text}`,exact:true}).boundingBox())!
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2)
    await expect(page.getByLabel('変更後のテキスト',{exact:true})).toHaveValue(text)
    await expect(page.getByLabel('変更後のテキスト',{exact:true})).toBeFocused()
  }
})
