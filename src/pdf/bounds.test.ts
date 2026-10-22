import { describe, expect, it } from 'vitest'
import { pixelBounds, refineTextBounds } from './bounds'

const rect = { x: 10, y: 10, width: 20, height: 20 }
function raster() { return { width: 50, height: 50, data: new Uint8ClampedArray(50*50*4).fill(255) } }
function ink(image: ReturnType<typeof raster>, x: number, y: number, color = 0) {
  const index = (y*image.width+x)*4
  image.data[index] = image.data[index+1] = image.data[index+2] = color
}

describe('dense table text bounds', () => {
  it('uses half-open pixel bounds and tolerates PDF coordinate rounding', () => {
    expect(pixelBounds(rect, 1, raster())).toEqual({ left: 10, top: 10, right: 29, bottom: 29 })
    expect(pixelBounds({ ...rect, x: 10-1e-12, y: 10-1e-12 }, 1, raster())).toEqual({ left: 10, top: 10, right: 29, bottom: 29 })
  })
  it('clips empty font margins touching rules while retaining every visible glyph pixel', () => {
    const background = raster()
    for (let i=10; i<30; i++) for (const edge of [10,29]) { ink(background,i,edge); ink(background,edge,i) }
    const foreground = { ...background, data: background.data.slice() }
    for (let y=14; y<=25; y++) for (let x=14; x<=25; x++) ink(foreground,x,y)
    expect(refineTextBounds(rect, background, foreground, 1)).toEqual({ x:11, y:11, width:18, height:18 })
  })
  it('rejects lines and small images inside the glyph bounds, including between letters', () => {
    const background = raster()
    for (let y=10; y<30; y++) ink(background,20,y)
    const foreground = { ...background, data: background.data.slice() }
    for (const x of [14,25]) for (let y=14; y<=25; y++) ink(foreground,x,y)
    expect(refineTextBounds(rect, background, foreground, 1)).toBeUndefined()
    ink(background,20,20,180)
    expect(refineTextBounds(rect, background, foreground, 1)).toBeUndefined()
  })
  it('does not invent a safe cover for invisible text, colored backgrounds or mismatched rasters', () => {
    const background=raster(), foreground=raster()
    for (let y=10;y<30;y++) for (let x=10;x<30;x++) ink(background,x,y,200)
    foreground.data.set(background.data)
    expect(refineTextBounds(rect,background,foreground,1)).toBeUndefined()
    ink(foreground,15,15)
    expect(refineTextBounds(rect,background,foreground,1)).toBeUndefined()
    expect(refineTextBounds(rect,background,{...foreground,width:1},1)).toBeUndefined()
  })
  it('keeps a potentially clipped glyph blocked rather than trusting a partial measurement',()=>{
    const background=raster(); ink(background,29,29)
    const foreground={...background,data:background.data.slice()};ink(foreground,10,15)
    expect(refineTextBounds(rect,background,foreground,1)).toBeUndefined()
  })
})
