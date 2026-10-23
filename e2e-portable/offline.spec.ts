import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'

// Keep bundled binary data out of automatic DOM snapshots. API tracing and
// an explicit screenshot remain available.
test.use({trace:{mode:'retain-on-failure',snapshots:false,screenshots:false}})

test('self-contained HTML renders and edits PDFs offline without a server or form permissions',async({page,context},info)=>{
  test.setTimeout(180_000)
  const html=await readFile('release/PDF-Editor.html','utf8')
  const errors:string[]=[],network:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  // Managed cloud Chromium disallows all file: navigation. Use an opaque-origin
  // sandbox, with networking disabled and without allow-same-origin or
  // allow-forms, to verify the portable app's origin and resource independence.
  await page.route('http://pdf-editor.test/isolated',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><iframe id="app" sandbox="allow-scripts allow-downloads" style="width:100vw;height:100vh;border:0"></iframe></body></html>'}))
  await page.goto('http://pdf-editor.test/isolated')
  context.on('request',r=>{if(/^(https?|file):/.test(r.url()))network.push(r.url())})
  await context.setOffline(true)
  const mount=async()=>{
    // Avoid a huge srcdoc attribute: resolving a frame would otherwise copy
    // 50 MB of attributes on every Playwright action.
    await page.evaluate(()=>{const frame=document.getElementById('app')!;frame.replaceWith(frame.cloneNode(false))})
    const element=await page.locator('#app').elementHandle(),frame=await element!.contentFrame()
    await frame!.setContent(html)
  }
  await mount()
  const app=page.frameLocator('#app')
  await expect(app.getByRole('button',{name:'サンプルPDFを試す'})).toBeVisible()
  expect(await page.frames()[1].evaluate(()=>location.origin)).toBe('null')
  await app.getByRole('button',{name:'サンプルPDFを試す'}).click()
  const text=(str:string)=>app.getByRole('button',{name:`文字を選択: ${str}`,exact:true})
  await expect(text('150,000')).toBeVisible()
  await text('150,000').click()
  await app.getByLabel('変更後のテキスト').fill('275,000')
  await app.getByRole('button',{name:'変更を適用',exact:true}).click()
  await expect(app.locator('.status-left')).toContainText('2箇所の変更')
  await expect(app.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
  await text('株式会社サンプル 御中').click()
  await app.getByLabel('変更後のテキスト').fill('株式会社オフライン 御中')
  await app.getByLabel('使用するフォントファイル',{exact:true}).setInputFiles('public/fonts/NotoSerifJP-Bold.ttf')
  await expect(app.getByLabel('書体',{exact:true})).toHaveValue('font-1')
  await app.getByRole('button',{name:'変更を適用',exact:true}).click()
  await expect(app.locator('.status-left')).toContainText('3箇所の変更')
  await expect(app.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
  const event=page.waitForEvent('download')
  await app.getByRole('button',{name:'PDFを保存',exact:true}).click()
  const download=await event,output=info.outputPath('offline-edited.pdf')
  await download.saveAs(output)
  const bytes=await readFile(output)
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
  await page.screenshot({path:info.outputPath('offline-app.png'),fullPage:true})
  await mount()
  await expect(app.getByRole('button',{name:'サンプルPDFを試す'})).toBeVisible()
  await app.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({name:'offline-edited.pdf',mimeType:'application/pdf',buffer:bytes})
  await expect(text('275,000')).toBeAttached()
  await expect(text('株式会社オフライン 御中')).toBeAttached()
  await text('株式会社オフライン 御中').click()
  await expect(app.getByLabel('書体',{exact:true})).toHaveValue('font-1')
  await expect(text('335,500')).toBeAttached()
  await text('275,000').click()
  await expect(app.getByLabel('変更後のテキスト')).toBeEnabled()
  await app.getByLabel('変更後のテキスト').fill('280,000')
  const resumedEvent=page.waitForEvent('download')
  await app.getByRole('button',{name:'PDFを保存',exact:true}).click()
  await (await resumedEvent).saveAs(info.outputPath('offline-resumed.pdf'))
  await expect(text('341,000')).toBeAttached()
  await app.getByRole('button',{name:'ページ追加',exact:true}).click()
  await expect(app.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
  await expect(app.locator('.count-badge')).toHaveText('3')
  await app.getByRole('button',{name:'文字追加',exact:true}).click()
  await app.getByLabel('追加するテキスト').fill('通信なしの追加')
  await app.getByRole('button',{name:'PDFに追加',exact:true}).click()
  await expect(text('通信なしの追加')).toBeVisible()
  await expect(app.getByRole('button',{name:'PDFを保存',exact:true})).toBeEnabled()
  await app.getByRole('button',{name:'元に戻す',exact:true}).click()
  await expect(text('通信なしの追加')).toHaveCount(0)
  expect(errors).toEqual([])
  expect(network).toEqual([])
})
