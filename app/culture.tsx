'use client';
import { CSSProperties, KeyboardEvent } from 'react';
import { CircleHelp, Sparkles, LoaderCircle } from 'lucide-react';
import { Bi } from './i18n';
import { shortModel } from './graph/model';
import { Cutout } from './spotlight';

type Consensus={status:'agreed'|'disputed'|'unchecked';agree:number;total:number;corrections:{model:string;verdict:string;en?:string|null;ja?:string|null}[]};
type Item={id:string;en:string;ja?:string|null;consensus:Consensus};
export type Note={id:string;about:string|null;term:{ja:string;reading?:string|null;en:string};summary:Item;points:Item[];caution_en?:string|null;caution_ja?:string|null;
 consensus:string;writer:string;reviews:{model:string;failed:boolean;verdict:string|null}[]};
type Obs={id:string;asset_id:string;bbox:number[]|null;mask?:unknown};
type Asset={id:string;width?:number;height?:number};

// Same fixed wording as backend/culture.py NOTE.
const NOTE=['AI background from several models — general knowledge, not evidence about this photograph.','複数の AI による一般的な背景知識です。この写真についての証拠ではありません。'];
const FAMILY:Record<string,string>={deepseek:'DeepSeek',glm:'GLM',qwen:'Qwen',kimi:'Kimi'};
export function modelName(id:string){
 const s=shortModel(id),[head,...rest]=s.split('-'),fam=Object.keys(FAMILY).find(f=>head.toLowerCase().startsWith(f));
 if(!fam)return s;
 if(fam==='glm')return `GLM-${rest.join('-')}`;
 return [FAMILY[fam]+head.slice(fam.length),...rest.map(x=>/\d/.test(x)?x.toUpperCase():x[0].toUpperCase()+x.slice(1))].join(' ');
}

function Agreement({c}:{c:Consensus}){
 if(c.status==='agreed')return <span className="agree ok">✓ <Bi en={`${c.agree}/${c.total} models agree`} ja={`${c.total}モデル中${c.agree}が一致`} inline/></span>;
 if(c.status==='disputed')return <span className="agree warn">⚠ <Bi en={`Models disagree · ${c.agree}/${c.total} agree`} ja={`見解が分かれています · ${c.total}中${c.agree}が一致`} inline/></span>;
 return <span className="agree none"><Bi en="Unchecked" ja="未確認" inline/></span>;
}
function Corrections({c}:{c:Consensus}){
 if(!c.corrections.length)return null;
 return <ul className="corrections">{c.corrections.map(x=><li key={x.model}><b>{modelName(x.model)}</b> <Bi en={x.en} ja={x.ja}/></li>)}</ul>;
}

export default function CultureSection({notes,observations,assets,colors,assetUrl,maskUrl,chosen,running,onChoose,onHover}:{notes:Note[]|null|undefined;observations:Obs[];assets:Asset[];colors:Record<string,string>;
 assetUrl:(id:string)=>string;maskUrl:(id:string)=>string;chosen:string|null;running:boolean;onChoose:(n:Note)=>void;onHover:(n:Note|null)=>void}){
 return <div className="meaning-section culture" id="jump-culture">
  <div className="meaning-title"><span>✦</span><h2><Bi en="Cultural background" ja="文化の背景"/></h2><Sparkles size={18}/></div>
  <p className="culture-note"><Bi en={NOTE[0]} ja={NOTE[1]}/></p>
  {!notes?.length?(running&&notes==null?<div className="pending"><span className="skeleton"/><span className="skeleton short"/><p><LoaderCircle size={14} className="spin"/> <Bi en="Several models are writing and cross-checking background notes…" ja="複数のモデルが背景の解説を書き、互いに確認しています…" inline/></p></div>
   :<p className="empty-section"><Bi en="No cultural background notes for this analysis." ja="この解析には文化の背景の解説はありません。" inline/></p>)
  :<div className="culture-list">{notes.map(n=>{
   const o=observations.find(o=>o.id===n.about),a=o&&assets.find(a=>a.id===o.asset_id),c=o?colors[o.id]:undefined;
   const checked=n.reviews.filter(r=>!r.failed).map(r=>modelName(r.model));
   const key=(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onChoose(n)}};
   return <article key={n.id} className={'culture-card'+(chosen===n.id?' chosen':'')+(c?' has-color':'')} style={c?{'--c':c} as CSSProperties:undefined}
    role="button" tabIndex={0} aria-pressed={chosen===n.id} aria-label={`${n.term.ja} ${n.term.en}: show in the image`}
    onClick={()=>onChoose(n)} onKeyDown={key} onMouseEnter={()=>onHover(n)} onMouseLeave={()=>onHover(null)}>
    {o?.bbox&&a?<Cutout src={assetUrl(a.id)} mask={o.mask?maskUrl(o.id):undefined} bbox={o.bbox} width={a.width} height={a.height} color={c}/>:<span className="culture-mark" aria-hidden="true">{n.term.ja.slice(0,1)}</span>}
    <div className="culture-body">
     <div className="culture-term"><span lang="ja" className="term-ja">{n.term.ja}</span><span className="term-gloss">{n.term.reading&&<i>{n.term.reading}</i>}<span lang="en">{n.term.en}</span></span></div>
     <p className="culture-summary"><Bi en={n.summary.en} ja={n.summary.ja}/></p>
     <Agreement c={n.summary.consensus}/><Corrections c={n.summary.consensus}/>
     {n.points.length>0&&<ul className="culture-points">{n.points.map(p=><li key={p.id}><Bi en={p.en} ja={p.ja}/><Agreement c={p.consensus}/><Corrections c={p.consensus}/></li>)}</ul>}
     {n.caution_en&&<p className="culture-caution"><CircleHelp size={15}/><Bi en={n.caution_en} ja={n.caution_ja}/></p>}
     <p className="culture-models"><Bi en="Written by" ja="執筆" inline/><span className="model-chip">{modelName(n.writer)}</span>{checked.length>0&&<><span aria-hidden="true">·</span><Bi en="checked by" ja="確認" inline/>{checked.map(m=><span key={m} className="model-chip">{m}</span>)}</>}{n.reviews.some(r=>r.failed)&&<> · <Bi en={`${n.reviews.filter(r=>r.failed).length} reviewer unavailable`} ja={`確認役${n.reviews.filter(r=>r.failed).length}件は応答なし`} inline/></>}</p>
    </div>
   </article>})}</div>}
 </div>;
}
