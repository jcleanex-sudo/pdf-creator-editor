import { pixelBounds } from './bounds'
import type { Rect } from './types'

export function uniformBackground(rect: Rect, pixels: ImageData, scale: number): string | undefined {
  const bounds=pixelBounds(rect,scale,pixels)
  if(bounds.right<bounds.left||bounds.bottom<bounds.top)return
  const start=(bounds.top*pixels.width+bounds.left)*4
  const red=pixels.data[start],green=pixels.data[start+1],blue=pixels.data[start+2]
  for(let y=bounds.top;y<=bounds.bottom;y++)for(let x=bounds.left;x<=bounds.right;x++) {
    const i=(y*pixels.width+x)*4
    if(pixels.data[i]!==red||pixels.data[i+1]!==green||pixels.data[i+2]!==blue)return
  }
  return '#'+[red,green,blue].map(value=>value.toString(16).padStart(2,'0')).join('')
}
