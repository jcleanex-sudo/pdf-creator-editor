import {describe,it,expect} from 'vitest'
import {areaAt,pickRegion} from './selection'
import type {TextRegion} from './types'

const region=(id:string,x:number,y:number,width:number,height:number)=>({id,screen:{x,y,width,height}} as TextRegion)
describe('mouse picking keeps export bounds intact',()=>{
  it('accepts nearby screen pixels at all zoom levels without expanding the edited region',()=>{
    const tiny=region('tiny',50,60,20,4),before=JSON.stringify(tiny)
    for(const zoom of [.25,1,2,8]){
      expect(pickRegion([tiny],{x:50-4/zoom,y:62},zoom)).toBe(tiny)
      expect(pickRegion([tiny],{x:50-9/zoom,y:62},zoom)).toBeUndefined()
    }
    expect(JSON.stringify(tiny)).toBe(before)
  })
  it('chooses the nearest cell and the smaller exact region, never a distant word',()=>{
    const left=region('left',10,10,20,10),right=region('right',40,10,20,10),row=region('row',10,10,50,10)
    expect(pickRegion([row,right],{x:50,y:15},1)).toBe(right)
    expect(pickRegion([left,right],{x:39,y:15},1)).toBe(right)
    expect(pickRegion([left,right],{x:200,y:15},1)).toBeUndefined()
  })
  it('suggests an editable image area inside even small page edges',()=>{
    expect(areaAt({x:0,y:0},600,800)).toEqual({x:0,y:0,width:120,height:24})
    expect(areaAt({x:599,y:799},600,800)).toEqual({x:480,y:776,width:120,height:24})
    expect(areaAt({x:2,y:2},80,12)).toEqual({x:0,y:0,width:80,height:12})
  })
})
