import {test,expect} from '@playwright/test'
import {PDFDocument} from 'pdf-lib'
import {readFile} from 'node:fs/promises'

test('opens invoice details in the browser, downloads a valid PDF and reopens it without sending invoice fields',async({page,context},info)=>{
  test.setTimeout(90_000)
  const data={recipient:'Example Transport Ltd',branch:'Example Branch',issuer:'Example Issuer Ltd',representative:'Representative Example',address:'PRIVATE_BILLING_TOKEN',description:'Shipping services',amount:123456,date:'2026-10-10',due:'2026-12-10'}
  const encoded=Buffer.from(JSON.stringify(data)).toString('base64url'),requests:string[]=[],errors:string[]=[]
  context.on('request',r=>{requests.push(r.url());expect(r.method()).toBe('GET');expect(r.url()).not.toContain('PRIVATE_BILLING_TOKEN');expect(r.url()).not.toContain(encoded)})
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/#invoice='+encoded)
  await expect(page.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
  await expect(page.locator('.toolbar-file')).toContainText('請求書_20261010.pdf')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('')
  await expect(page.getByRole('button',{name:'文字を選択: Example Transport Ltd',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'文字を選択: 123,456 円',exact:true})).toHaveCount(2)
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const output=info.outputPath('invoice.pdf');await(await event).saveAs(output)
  expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(1)
  const reopened=await context.newPage();await reopened.goto('/')
  await reopened.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(output)
  await expect(reopened.getByRole('button',{name:'文字を選択: Example Transport Ltd',exact:true})).toBeVisible()
  expect(errors).toEqual([]);expect(requests.every(url=>!url.includes('#invoice='))).toBe(true)
})

test('an invalid invoice link leaves a working file opener with a useful error',async({page})=>{
  await page.goto('/#invoice=broken')
  await expect(page.getByRole('alert')).toContainText('請求書のリンクを読み込めません')
  await expect(page.getByRole('button',{name:'ファイルを開く',exact:true})).toBeEnabled()
  await expect(page.getByRole('button',{name:'新規PDF',exact:true})).toBeEnabled()
})
