'use client';
import { CSSProperties, ReactNode } from 'react';
import { obsLabel, countLabel } from './graph/model';

type Obs={id:string;text:string;bbox:number[]|null;label?:string|null;mask?:{instance_count:number}|null};
const masked=(url:string):CSSProperties=>({maskImage:`url(${url})`,WebkitMaskImage:`url(${url})`});
const tint=(c:string)=>({'--c':c}) as CSSProperties;

// The analysed photograph with each observation in its own colour. SAM3 masks are drawn as an outline
// and a light tint; when observations are spotlit the photo dims and only their pixels stay bright.
export function ImageStage({src,maskUrl,obs,colors,spot,chosen,ratio,onSelect,onHover,children}:{src:string;ratio?:number;maskUrl:(id:string)=>string;obs:Obs[];colors:Record<string,string>;spot:Set<string>;chosen?:string;
 onSelect:(id:string)=>void;onHover:(id:string|null)=>void;children?:ReactNode}){
 const lit=obs.some(o=>spot.has(o.id)&&(o.mask||o.bbox));
 // With a known aspect the photo is capped at 70% of the viewport height, so the caption below stays in view.
 return <div className={'result-image'+(lit?' spotlit':'')} id="jump-image" style={ratio?{width:`min(100%, calc(70vh * ${ratio.toFixed(4)}))`,marginInline:'auto'}:undefined}>
  <img src={src} alt=""/>
  {lit&&<span className="spot-dim" aria-hidden="true"/>}
  {obs.map(o=>{
   const on=spot.has(o.id),c=colors[o.id];
   if(o.mask){const url=maskUrl(o.id);return <span key={'seg-'+o.id} aria-hidden="true" className={'seg'+(lit?on?' lit':' off':'')} style={tint(c)}>
    <span className="seg-edge"><span style={masked(url)}/></span><img className="seg-photo" src={src} alt="" style={masked(url)}/><span className="seg-tint" style={masked(url)}/></span>}
   // Without a mask the spotlight falls back to the candidate box.
   if(on&&lit&&o.bbox){const [x,y,w,h]=o.bbox;return <span key={'seg-'+o.id} aria-hidden="true" className="seg lit box" style={tint(c)}><img className="seg-photo" src={src} alt="" style={{clipPath:`inset(${y*100}% ${(1-x-w)*100}% ${(1-y-h)*100}% ${x*100}%)`}}/></span>}
   return null;
  })}
  {obs.filter(o=>o.bbox).map(o=><button key={o.id} className={'region'+(o.mask?' masked':'')+(chosen===o.id?' chosen':'')+(lit?spot.has(o.id)?' lit':' off':'')} style={{...tint(colors[o.id]),left:`${o.bbox![0]*100}%`,top:`${o.bbox![1]*100}%`,width:`${o.bbox![2]*100}%`,height:`${o.bbox![3]*100}%`}}
   aria-label={`Inspect: ${o.text}`} onClick={()=>onSelect(o.id)} onMouseEnter={()=>onHover(o.id)} onMouseLeave={()=>onHover(null)} onFocus={()=>onHover(o.id)} onBlur={()=>onHover(null)}>
   <span><b>{obsLabel(o.id)}</b>{o.label&&<> {countLabel(o.label,o.mask?.instance_count)}</>}</span></button>)}
  {children}
 </div>;
}

// Widen a [x,y,w,h] box (0..1) so its pixel aspect stays between lo and hi, inside the image.
function fit(b:number[],W:number,H:number,lo=.75,hi=1.8){
 let [x,y,w,h]=b;const pad=.03;x-=pad*w;y-=pad*h;w*=1+2*pad;h*=1+2*pad;
 const r=w*W/(h*H);
 if(r>hi){const nh=w*W/hi/H;y-=(nh-h)/2;h=nh}
 else if(r<lo){const nw=h*H*lo/W;x-=(nw-w)/2;w=nw}
 w=Math.min(w,1);h=Math.min(h,1);x=Math.min(Math.max(0,x),1-w);y=Math.min(Math.max(0,y),1-h);
 return [x,y,w,h];
}

// The observed object on its own: the photo cropped to the candidate box, with the background removed by the SAM3 mask.
export function Cutout({src,mask,bbox,width,height,color}:{src:string;mask?:string;bbox:number[];width?:number;height?:number;color?:string}){
 const W=width||1500,H=height||1000,[x,y,w,h]=fit(bbox,W,H);
 return <span className={'cutout'+(mask?' is-masked':'')} style={{...(color?tint(color):{}),aspectRatio:`${w*W} / ${h*H}`}} aria-hidden="true">
  <span className="cutout-inner" style={{width:`${100/w}%`,height:`${100/h}%`,left:`${-x/w*100}%`,top:`${-y/h*100}%`}}>
   <img src={src} alt="" style={mask?masked(mask):undefined}/>
  </span>
 </span>;
}
