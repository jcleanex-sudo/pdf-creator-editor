import { describe, expect, it } from 'vitest'
import { editRestriction } from './safety'
import type { PageModel, TextRegion } from './types'

const region: TextRegion = { id:'0:0',pageIndex:0,text:'123',x:10,baseline:80,fontSize:10,width:30,
  rect:{x:10,y:70,width:30,height:15},screen:{x:10,y:15,width:30,height:15} }
function page(background=255): PageModel {
  const data=new Uint8ClampedArray(100*100*4).fill(255)
  for(let i=0;i<data.length;i+=4) data[i]=data[i+1]=data[i+2]=background
  return {width:100,height:100,regions:[region],pixelScale:1,pixels:{data,width:100,height:100,colorSpace:'srgb'} as ImageData}
}
describe('background protection',()=>{
  it('allows isolated black text on a white area',()=>{
    const model=page()
    for(let y=20;y<25;y++)for(let x=15;x<30;x++) {
      const i=(y*100+x)*4
      model.pixels.data[i]=model.pixels.data[i+1]=model.pixels.data[i+2]=30
    }
    expect(editRestriction(region,model)).toBeUndefined()
  })
  it('blocks nonwhite and colored backgrounds',()=>{
    expect(editRestriction(region,page(230))).toContain('白い背景')
    const model=page()
    for(let y=15;y<=30;y++)for(let x=10;x<=40;x++)model.pixels.data[(y*100+x)*4]=180
    expect(editRestriction(region,model)).toContain('白い背景')
  })
  it('blocks overlaps, rotated text, and unsafe region edges',()=>{
    const model=page()
    model.regions.push({...region,id:'0:1'})
    expect(editRestriction(region,model)).toContain('重なって')
    expect(editRestriction({...region,unsupportedReason:'回転文字'},page())).toBe('回転文字')
    const edge=page()
    for(let x=10;x<=40;x++) {
      const i=(15*100+x)*4
      edge.pixels.data[i]=edge.pixels.data[i+1]=edge.pixels.data[i+2]=0
    }
    expect(editRestriction(region,edge)).toContain('白い背景')
  })
})
