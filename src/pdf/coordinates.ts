/** Screen arrow movements stay in the screen direction on rotated text/pages. */
export function localNudge(dx:number,dy:number,page:number[]=[1,0,0,-1,0,0],text:number[]=[1,0,0,1,0,0]){
  const a=page[0]*text[0]+page[2]*text[1],b=page[1]*text[0]+page[3]*text[1]
  const c=page[0]*text[2]+page[2]*text[3],d=page[1]*text[2]+page[3]*text[3],det=a*d-b*c
  if(![a,b,c,d,det,dx,dy].every(Number.isFinite)||Math.abs(det)<1e-12)throw new Error('この文字の移動方向を取得できません。「範囲書き換え」を使用してください。')
  return {x:(d*dx-c*dy)/det,y:(a*dy-b*dx)/det}
}
