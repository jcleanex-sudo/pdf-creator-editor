import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb, setTextRenderingMode, TextRenderingMode } from 'pdf-lib'

test('edits colored text on white while protecting backgrounds, images and lines', async ({ page }) => {
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
  await page.locator('input[type=file]').setInputFiles({
    name: 'background-check.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  })
  for (const text of ['Text on colored background', 'Text over image', 'Text over line']) {
    await page.getByRole('button', { name: `文字を選択: ${text}`, exact: true }).click()
    await expect(page.getByLabel('変更後のテキスト')).toBeDisabled()
    await expect(page.locator('.restriction-note')).toContainText('白い背景')
  }
  await page.getByRole('button', { name: '文字を選択: Blue on white', exact: true }).click()
  await expect(page.getByLabel('変更後のテキスト')).toBeEnabled()
  await page.getByLabel('変更後のテキスト').fill('250,000')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '変更を適用', exact: true }).click()
  await expect(page.locator('.status-left')).toContainText('1箇所の変更')
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
  await page.locator('input[type=file]').setInputFiles({
    name: 'text-clip.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  })
  await page.getByRole('button', { name: '文字を選択: Clipping text', exact: true }).click()
  await expect(page.getByLabel('変更後のテキスト')).toBeDisabled()
  await expect(page.locator('.restriction-note')).toContainText('切り抜き')
})
