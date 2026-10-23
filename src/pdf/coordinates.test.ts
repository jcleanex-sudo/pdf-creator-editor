import {describe,it,expect} from 'vitest'
import {localNudge} from './coordinates'

describe('fine screen movements on transformed pages',()=>{
  it('moves the rendered text exactly 0.1 screen points right or up on rotated and scaled pages',()=>{
    for(const page of [[1,0,0,-1,0,800],[0,1,1,0,0,0],[-2,0,0,2,1200,0]])for(const angle of [0,35,90,180]){
      const r=angle*Math.PI/180,text=[Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),200,350]
      for(const [dx,dy]of [[0.1,0],[0,-0.1]]){
        const local=localNudge(dx,dy,page,text),x=text[0]*local.x+text[2]*local.y,y=text[1]*local.x+text[3]*local.y
        expect(page[0]*x+page[2]*y).toBeCloseTo(dx,10);expect(page[1]*x+page[3]*y).toBeCloseTo(dy,10)
      }
    }
    expect(()=>localNudge(1,0,[0,0,0,0,0,0])).toThrow('移動方向')
  })
})
