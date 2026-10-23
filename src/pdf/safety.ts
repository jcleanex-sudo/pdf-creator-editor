import type { PageModel, Rect, TextRegion } from './types'
import { pixelBounds } from './bounds'

function overlap(a: Rect, b: Rect) {
  return Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x) > 0.4 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y) > 0.4
}

export function editRestriction(region: TextRegion, page: PageModel): string | undefined {
  if (region.unsupportedReason) return region.unsupportedReason
  if (page.regions.some(other => other.id !== region.id && overlap(region.screen, other.screen)))
    return '近くの文字と領域が重なっています。ほかの文字を保護するため編集できません。'
  if (region.background || page.supportsBackground) return
  const { pixels, pixelScale: scale } = page
  const {left, top, right, bottom} = pixelBounds(region.screen, scale, pixels)
  let count=0
  for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) {
    const i=(y*pixels.width+x)*4
    const [r,g,b]=pixels.data.subarray(i,i+3)
    // Text is omitted from this analysis raster. Every pixel covered during
    // export must be white, including the middle of the region where an image
    // or a thin line could otherwise pass a majority-white test.
    if (Math.min(r,g,b)<246)
      return '白い背景を確認できません。背景を復元できないため、「範囲書き換え」を使用してください。'
    count++
  }
  if (!count)
    return '白い背景を確認できません。背景や図形を保護するため、この領域は編集できません。'
}
