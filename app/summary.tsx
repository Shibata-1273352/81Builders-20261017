'use client';
import { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Bi } from './i18n';
import { shortModel } from './graph/model';

type Run={id:string;tool:string;model_id:string;status:string;latency_ms?:number;started_at?:string};
type Input={claims:{id:string}[];assessments:{status:string}[];observations:{mask?:{instance_count:number}|null}[];runs:Run[];cultural_notes?:unknown[]|null;started_at?:string};
export type Jump='claims'|'context'|'unknown'|'image'|'culture'|'activity';

function Item({n,en,ja,tone,to,onJump}:{n:ReactNode;en:string;ja:string;tone?:string;to:Jump;onJump:(to:Jump)=>void}){
 return <button className={'strip-item'+(tone?' '+tone:'')} onClick={()=>onJump(to)}><b>{n}</b><span><Bi en={en} ja={ja}/></span></button>;
}

// One line that says what the analysis found, in numbers large enough to read from the back of a room.
export default function ResultStrip({a,running,elapsed,onJump}:{a:Input;running:boolean;elapsed:number;onJump:(to:Jump)=>void}){
 const count=(s:string)=>a.assessments.filter(x=>x.status===s).length;
 const objects=a.observations.reduce((n,o)=>n+(o.mask?.instance_count||0),0);
 const since=a.started_at||'';
 const models=new Set(a.runs.filter(r=>r.status!=='failed').map(r=>r.model_id));
 const live=a.runs.filter(r=>r.status==='running'&&(r.started_at||'')>=since);
 const notes=a.cultural_notes?.length||0;
 return <div className="result-strip" role="status" aria-live="polite">
  <Item n={a.claims.length} en={a.claims.length===1?'claim':'claims'} ja="主張" to="claims" onJump={onJump}/>
  {a.assessments.length>0&&<><Item n={<>✓{count('confirmed')}</>} en="Confirmed" ja="確認済み" tone="confirmed" to="context" onJump={onJump}/>
   {count('contradicted')>0&&<Item n={<>✕{count('contradicted')}</>} en="Contradicted" ja="反証あり" tone="contradicted" to="context" onJump={onJump}/>}
   <Item n={<>?{count('unresolved')}</>} en="Unresolved" ja="未解決" tone="unresolved" to="unknown" onJump={onJump}/></>}
  {objects>0&&<Item n={objects} en="objects segmented by SAM3" ja="SAM3 が切り出した物体" tone="sam" to="image" onJump={onJump}/>}
  {notes>0&&<Item n={notes} en="cultural notes" ja="文化の解説" tone="culture" to="culture" onJump={onJump}/>}
  <Item n={models.size} en={models.size===1?'model':'models'} ja="モデル" to="activity" onJump={onJump}/>
  {running&&<button className="strip-live" onClick={()=>onJump('activity')}><LoaderCircle size={18} className="spin"/><span>{live.length?[...new Set(live.map(r=>shortModel(r.model_id)))].join(' · '):<Bi en="Starting" ja="開始中" inline/>}</span><b>{elapsed}s</b></button>}
 </div>;
}
