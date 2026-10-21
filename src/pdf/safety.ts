import type { PageModel, Rect, TextRegion } from './types'

function overlap(a: Rect, b: Rect) {
  return Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x) > 0.4 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y) > 0.4
}

export function editRestriction(region: TextRegion, page: PageModel): string | undefined {
  if (region.unsupportedReason) return region.unsupportedReason
  if (page.regions.some(other => other.id !== region.id && overlap(region.screen, other.screen)))
    return '近くの文字と領域が重なっています。ほかの文字を保護するため編集できません。'
  const { pixels, pixelScale: scale } = page
  const left = Math.max(0,Math.floor(region.screen.x*scale)), top = Math.max(0,Math.floor(region.screen.y*scale))
  const right = Math.min(pixels.width-1,Math.ceil((region.screen.x+region.screen.width)*scale))
  const bottom = Math.min(pixels.height-1,Math.ceil((region.screen.y+region.screen.height)*scale))
  let count=0, white=0, border=0, whiteBorder=0, colored=0
  for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) {
    const i=(y*pixels.width+x)*4
    const [r,g,b]=pixels.data.subarray(i,i+3)
    const isWhite = Math.min(r,g,b)>=246
    count++; if (isWhite) white++
    if (Math.max(r,g,b)-Math.min(r,g,b)>24) colored++
    if (x===left || x===right || y===top || y===bottom) { border++; if (isWhite) whiteBorder++ }
  }
  if (!count || white/count<0.55 || whiteBorder/border<0.98 || colored/count>0.02)
    return '白い背景を確認できません。背景や図形を保護するため、この領域は編集できません。'
}
