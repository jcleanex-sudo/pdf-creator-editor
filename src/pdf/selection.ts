import type { Rect, TextRegion } from './types'

/** Picking uses screen pixels, independently of zoom. Do not expand the
 * actual replacement rectangle: generous selection must not erase neighbours. */
export function pickRegion(regions:TextRegion[],point:{x:number;y:number},scale:number,tolerance=8){
  let result:TextRegion|undefined,distance=Infinity,area=Infinity
  for(const region of regions){
    const box=region.screen,dx=Math.max(box.x-point.x,0,point.x-box.x-box.width)*scale,dy=Math.max(box.y-point.y,0,point.y-box.y-box.height)*scale
    const score=dx*dx+dy*dy,size=box.width*box.height
    if(score<=tolerance*tolerance&&(score<distance||score===distance&&size<area)){result=region;distance=score;area=size}
  }
  return result
}

export function areaAt(point:{x:number;y:number},width:number,height:number):Rect{
  const w=Math.min(120,width),h=Math.min(24,height)
  return {x:Math.max(0,Math.min(width-w,point.x-w/2)),y:Math.max(0,Math.min(height-h,point.y-h/2)),width:w,height:h}
}
