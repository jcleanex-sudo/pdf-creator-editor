import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFile, writeFile } from 'node:fs/promises'

test('preserves source colors, standard font faces and Japanese bold without changing surrounding pixels', async ({ page, context }, info) => {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  const paper = pdf.addPage([600, 800])
  paper.drawText('123,000', { x: 100, y: 680, size: 20, font: await pdf.embedFont(StandardFonts.TimesRomanBold), color: rgb(0.8, 0.12, 0.2) })
  paper.drawText('456,000', { x: 100, y: 600, size: 18, font: await pdf.embedFont(StandardFonts.CourierOblique), color: rgb(0.1, 0.2, 0.7) })
  paper.drawText('見積金額', { x: 100, y: 520, size: 16, font: await pdf.embedFont(await readFile('public/fonts/NotoSansJP-Bold.ttf')) })
  paper.drawText('Latin only', { x: 100, y: 440, size: 16, font: await pdf.embedFont(StandardFonts.Helvetica) })
  paper.drawText('Transparent', { x: 100, y: 360, size: 16, font: await pdf.embedFont(StandardFonts.Helvetica), opacity: 0.5 })
  pdf.addPage([600, 800]).drawText('Untouched page')
  const source = info.outputPath('original-style.pdf')
  await writeFile(source, await pdf.save())
  await page.goto('/')
  await page.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(source)
  const select = (value: string) => page.getByRole('button', { name: `文字を選択: ${value}`, exact: true })
  await select('Transparent').click()
  await expect(page.getByLabel('変更後のテキスト')).toBeDisabled()
  await expect(page.locator('.restriction-note')).toContainText('透明')
  const masks: { x: number; y: number; width: number; height: number }[] = []
  for (const value of ['123,000', '456,000', '見積金額', 'Latin only']) {
    const box = await select(value).boundingBox(), sheet = await page.locator('.pdf-paper').boundingBox()
    masks.push({ x: box!.x - sheet!.x, y: box!.y - sheet!.y, width: box!.width, height: box!.height })
  }
  const before = await page.locator('.page-canvas').evaluate(element => Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (element as HTMLCanvasElement).width, (element as HTMLCanvasElement).height).data))
  for (const [original, replacement, font, color, size] of [
    ['123,000', '124,000', 'Times-Bold', '#cc1f33', '20'],
    ['456,000', '457,000', 'Courier-Oblique', '#1a33b2', '18'],
    ['見積金額', '請求金額', 'Noto Sans JP Bold', '#000000', '16'],
    ['Latin only', '日本語', 'Noto Sans JP Regular', '#000000', '16'],
  ]) {
    await select(original).click()
    await expect(page.getByLabel('文字色')).toHaveValue(color)
    await expect(page.getByLabel('文字サイズ')).toHaveValue(size)
    await expect(page.getByLabel('配置')).toHaveValue(/^\d/.test(original) ? 'right' : 'left')
    await page.getByLabel('変更後のテキスト').fill(replacement)
    await expect(page.locator('.font-note strong')).toHaveText(font)
    if (original === 'Latin only') await expect(page.locator('.font-warning')).toContainText('元の欧文書体')
    await page.getByRole('button', { name: '変更を適用', exact: true }).click()
    await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled()
  }
  await page.locator('.paper-loading').waitFor({ state: 'hidden' })
  const outside = await page.locator('.page-canvas').evaluate((element, { before, masks }) => {
    const canvas = element as HTMLCanvasElement, after = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let changed = 0
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (masks.some(box => x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2)) continue
      const i = (y * canvas.width + x) * 4
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 6) changed++
    }
    return changed
  }, { before, masks })
  expect(outside).toBe(0)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click()
  const output = info.outputPath('preserved-style.pdf')
  await (await downloaded).saveAs(output)
  const reopened = await context.newPage(); await reopened.goto('/')
  await reopened.getByLabel('PDFファイルを選択',{exact:true}).setInputFiles(output)
  await reopened.getByRole('button', { name: '文字を選択: 124,000', exact: true }).click()
  await expect(reopened.locator('.font-note strong')).toHaveText('Times-Bold')
  await expect(reopened.getByLabel('文字色')).toHaveValue('#cc1f33')
  await expect(reopened.getByLabel('文字サイズ')).toHaveValue('20')
  await reopened.getByRole('button', { name: '文字を選択: 請求金額', exact: true }).click()
  await expect(reopened.locator('.font-note strong')).toHaveText('Noto Sans JP Bold')
})
