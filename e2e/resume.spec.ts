import { test, expect } from '@playwright/test'
import { PDFDocument, PDFName } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

test('selects from the text list, saves an unapplied draft and resumes repeated editing with totals', async ({ page, context }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  context.on('page', current => current.on('pageerror', error => errors.push(error.message)))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'サンプルPDFを試す' }).click()
  await page.getByLabel('編集する文字を選択', { exact: true }).selectOption({ label: '150,000' })
  await expect(page.getByLabel('変更後のテキスト')).toBeEnabled()
  await page.getByLabel('変更後のテキスト').fill('160,000')
  await expect(page.getByRole('button', { name: '変更を適用', exact: true })).toBeEnabled()
  const firstEvent = page.waitForEvent('download')
  // No checkbox and no separate apply action are needed to save an entered change.
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  const firstPath = info.outputPath('first-edit.pdf')
  await (await firstEvent).saveAs(firstPath)
  const firstBytes = await readFile(firstPath)
  const firstPdf = await PDFDocument.load(firstBytes)
  expect(firstPdf.getPageCount()).toBe(2)
  await page.locator('.paper-loading').waitFor({ state: 'hidden' })
  const before = await page.locator('.page-canvas').evaluate(element => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (element as HTMLCanvasElement).width, (element as HTMLCanvasElement).height).data))

  const reopened = await context.newPage(); await reopened.goto('/')
  await reopened.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(firstPath)
  await expect(reopened.locator('.message.success')).toContainText('編集データから再開')
  await reopened.getByRole('button', { name: '文字を選択: 160,000', exact: true }).click()
  await expect(reopened.getByLabel('変更後のテキスト')).toBeEnabled()
  await expect(reopened.getByLabel('変更後のテキスト')).toHaveValue('160,000')
  await expect(reopened.locator('.calculation-panel summary')).toContainText('有効・税率10%')
  await expect(reopened.getByRole('button', { name: '文字を選択: 209,000', exact: true })).toBeAttached()
  await reopened.locator('.paper-loading').waitFor({ state: 'hidden' })
  const differences = await reopened.locator('.page-canvas').evaluate((element, before) => {
    const canvas = element as HTMLCanvasElement
    const after = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    if (after.length !== before.length) return { dimensionsMatch: false, changed: -1 }
    let changed = 0
    for (let index = 0; index < after.length; index++) if (after[index] !== before[index]) changed++
    return { dimensionsMatch: true, changed }
  }, before)
  expect(differences).toEqual({ dimensionsMatch: true, changed: 0 })
  await reopened.getByLabel('変更後のテキスト').fill('170,000')
  const secondEvent = reopened.waitForEvent('download')
  await reopened.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  const secondPath = info.outputPath('second-edit.pdf')
  await (await secondEvent).saveAs(secondPath)
  const secondBytes = await readFile(secondPath)
  const secondPdf = await PDFDocument.load(secondBytes)
  expect(secondBytes.length).toBeLessThan(firstBytes.length + 10_000)
  expect(secondPdf.getPage(0).node.Contents()?.toString()).toBe(firstPdf.getPage(0).node.Contents()?.toString())
  const third = await context.newPage(); await third.goto('/')
  await third.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(secondPath)
  await expect(third.getByRole('button', { name: '文字を選択: 220,000', exact: true })).toBeAttached()
  await third.getByLabel('編集する文字を選択', { exact: true }).selectOption({ label: '170,000' })
  await expect(third.getByLabel('変更後のテキスト')).toBeEnabled()
  expect(errors).toEqual([])
})

test('rejects invalid restored text references and retains the open document', async ({ page }) => {
  const source = await PDFDocument.create()
  source.addPage().drawText('Original document', { x: 50, y: 700, size: 16 })
  const bytes = await source.save()
  await page.goto('/')
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) })
  const original = page.getByRole('button', { name: '文字を選択: Original document', exact: true })
  await expect(original).toBeVisible()
  const invalid = await PDFDocument.load(bytes)
  invalid.catalog.set(PDFName.of('PDFEditorSourceV1'), invalid.context.register(invalid.context.stream(bytes)))
  invalid.catalog.set(PDFName.of('PDFEditorProjectV1'), invalid.context.register(invalid.context.stream(JSON.stringify({
    version: 1, calculation: null, edits: [{ id: '0:999999', text: 'changed', fontSize: 16, color: '#000000', align: 'left' }],
  }))))
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles({ name: 'invalid-project.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await invalid.save()) })
  await expect(page.getByRole('alert')).toContainText('編集データを復元できません')
  await original.click()
  await expect(page.getByLabel('変更後のテキスト')).toBeEnabled()
  await expect(page.getByLabel('変更後のテキスト')).toHaveValue('Original document')
})
