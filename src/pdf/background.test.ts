import {describe,it,expect} from 'vitest'
import {uniformBackground} from './background'

describe('background color recovery',()=>{
  it('recovers solid colors without replacing the rest of the page',()=>{
    const data=new Uint8ClampedArray(10*10*4)
    for(let i=0;i<data.length;i+=4){data[i]=230;data[i+1]=240;data[i+2]=250;data[i+3]=255}
    const image={data,width:10,height:10} as ImageData
    expect(uniformBackground({x:2,y:2,width:4,height:4},image,1)).toBe('#e6f0fa')
    data[(4*10+4)*4]=0
    expect(uniformBackground({x:2,y:2,width:4,height:4},image,1)).toBeUndefined()
  })
})
