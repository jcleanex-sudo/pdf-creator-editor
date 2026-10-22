import type { Rect } from './types'

type Raster = Pick<ImageData, 'width' | 'height' | 'data'>
export function pixelBounds(rect: Rect, scale: number, image: Pick<Raster, 'width' | 'height'>) {
  // Rectangles are half-open. Do not sample the next pixel beyond their
  // right/bottom edge, including floating point round trips through PDF space.
  return {
    left: Math.max(0, Math.floor(rect.x * scale + 1e-7)),
    top: Math.max(0, Math.floor(rect.y * scale + 1e-7)),
    right: Math.min(image.width - 1, Math.ceil((rect.x + rect.width) * scale - 1e-7) - 1),
    bottom: Math.min(image.height - 1, Math.ceil((rect.y + rect.height) * scale - 1e-7) - 1),
  }
}

/** Trim only empty margins around visible glyphs; never whitewash a graphic. */
export function refineTextBounds(rect: Rect, background: Raster, foreground: Raster, scale: number): Rect | undefined {
  if (background.width !== foreground.width || background.height !== foreground.height) return
  const original = pixelBounds(rect, scale, background)
  const white = (x: number, y: number) => {
    const i = (y * background.width + x) * 4
    return Math.min(background.data[i], background.data[i+1], background.data[i+2]) >= 246
  }
  let hasGraphic = false, inkLeft = Infinity, inkTop = Infinity, inkRight = -Infinity, inkBottom = -Infinity
  for (let y = original.top; y <= original.bottom; y++) for (let x = original.left; x <= original.right; x++) {
    if (!white(x, y)) hasGraphic = true
    const i = (y * background.width + x) * 4
    if ([0,1,2].some(channel => foreground.data[i+channel] !== background.data[i+channel])) {
      inkLeft = Math.min(inkLeft, x); inkRight = Math.max(inkRight, x)
      inkTop = Math.min(inkTop, y); inkBottom = Math.max(inkBottom, y)
    }
  }
  if (!hasGraphic || !Number.isFinite(inkLeft)) return
  // A glyph reaching the search boundary may continue outside the font's
  // advertised box. Do not trim from an incomplete ink measurement.
  if (inkLeft <= original.left || inkRight >= original.right || inkTop <= original.top || inkBottom >= original.bottom) return
  // Graphics between letters, or underneath any visible glyph, still block
  // editing. A majority-white test would erase thin rules and small images.
  for (let y = inkTop; y <= inkBottom; y++) for (let x = inkLeft; x <= inkRight; x++) if (!white(x, y)) return
  let { left, top, right, bottom } = original
  for (let y = top; y < inkTop; y++) for (let x = inkLeft; x <= inkRight; x++) if (!white(x,y)) top = y + 1
  for (let y = bottom; y > inkBottom; y--) for (let x = inkLeft; x <= inkRight; x++) if (!white(x,y)) bottom = y - 1
  for (let x = left; x < inkLeft; x++) for (let y = top; y <= bottom; y++) if (!white(x,y)) left = x + 1
  for (let x = right; x > inkRight; x--) for (let y = top; y <= bottom; y++) if (!white(x,y)) right = x - 1
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) if (!white(x,y)) return
  const result = { x: Math.max(rect.x, left / scale), y: Math.max(rect.y, top / scale),
    width: 0, height: 0 }
  result.width = Math.min(rect.x + rect.width, (right+1) / scale) - result.x
  result.height = Math.min(rect.y + rect.height, (bottom+1) / scale) - result.y
  return result.width > 0 && result.height > 0 ? result : undefined
}
