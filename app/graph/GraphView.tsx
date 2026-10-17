'use client';
import { useState, useEffect, useLayoutEffect, useRef, useContext, useMemo, useCallback, KeyboardEvent, ReactNode, CSSProperties } from 'react';
import { Check, AlertCircle, CircleHelp, LoaderCircle, Network, ShieldCheck, Database, Copy, GitCompare } from 'lucide-react';
import { Lang, Bi } from '../i18n';
import { buildView, draftGraph, diffGraphs, cypherFor, obsLabel, obsColors, Graph, GNode, Impact, Status, Column, DraftInput, Diff, ObsView } from './model';
import './graph.css';

type AnalysisLike=DraftInput&{display_revision:number;status:string;stale_claim_ids?:string[]};
type Props={analysis:AnalysisLike;graph:Graph|null;running:boolean;focus:string|null;impact:Impact|null;compact:boolean;busy:boolean;
 onPick:(n:GNode)=>void;onImpact:(sourceId:string|null)=>void;onToggleSource:(sourceId:string,active:boolean)=>void};
type Wire={key:string;from:string;to:string;kind:string};

const STATUS:Record<Status,[string,string]>={confirmed:['Confirmed','確認済み'],contradicted:['Contradicted','反証あり'],unresolved:['Unresolved','未解決']};
const STANCE:Record<string,[string,string]>={supports:['Supports','支持'],contradicts:['Contradicts','反証'],context_only:['Context only','文脈のみ']};
const KIND:Record<string,[string,string]>={photo_identity:['photo identity','写真の同定'],context:['context','文脈'],interpretation:['interpretation','解釈']};
const FIELD:Record<string,[string,string]>={text:['Text revised','本文を更新'],check_verdict:['Check','検証']};
const num=(id:string)=>(id.match(/(\d+)$/)||[])[1]||id;
const both=(en:string,ja:string)=>`${en} / ${ja}`;
const statusName=(s:string)=>STATUS[s as Status]||[s,s];

function StatusBadge({status}:{status:Status}){const Icon=status==='confirmed'?Check:status==='contradicted'?AlertCircle:CircleHelp;return <span className={'badge '+status}><Icon size={12}/><Bi en={STATUS[status][0]} ja={STATUS[status][1]} inline/></span>}
function Chip({children,tone,title}:{children:ReactNode;tone?:string;title?:string}){return <span className={'gchip'+(tone?' '+tone:'')} title={title}>{children}</span>}

// Diff marker shown on a card when comparing with the previous revision.
function Mark({ids,diff}:{ids:(string|undefined)[];diff:Diff|null}){
 if(!diff)return null;
 if(ids.some(id=>id&&diff.added.has(id)))return <span className="gmark new"><Bi en="New" ja="新規" inline/></span>;
 const changes=ids.flatMap(id=>id?diff.changed.get(id)||[]:[]);
 if(!changes.length)return null;
 const c=changes.find(c=>c.field==='status')||changes.find(c=>c.field==='active')||changes[0];
 if(c.field==='status'){const a=statusName(c.from),b=statusName(c.to);return <span className="gmark changed"><Bi en={`${a[0]} → ${b[0]}`} ja={`${a[1]} → ${b[1]}`} inline/></span>}
 if(c.field==='active')return <span className="gmark changed"><Bi en={`${c.from} → ${c.to}`} ja={`${c.from==='Active'?'有効':'無効'} → ${c.to==='Active'?'有効':'無効'}`} inline/></span>;
 const f=FIELD[c.field]||[c.field,c.field];
 return <span className="gmark changed"><Bi en={c.field==='check_verdict'?`${f[0]}: ${c.to||'none'}`:f[0]} ja={c.field==='check_verdict'?`${f[1]}：${c.to||'なし'}`:f[1]} inline/></span>;
}

function Crop({src,mask,o,w,h}:{src:string;mask?:string;o:ObsView;w?:number;h?:number}){
 // Shows the observed region with CSS background positioning; widened to a square when the image size is known.
 let box=o.crop;
 if(box&&w&&h){const px=Math.max(box[2]*w,box[3]*h);const bw=Math.min(1,px/w),bh=Math.min(1,px/h);box=[Math.min(Math.max(0,box[0]+box[2]/2-bw/2),1-bw),Math.min(Math.max(0,box[1]+box[3]/2-bh/2),1-bh),bw,bh]}
 const size=box?`${100/box[2]}% ${100/box[3]}%`:'100% 100%',pos=box?`${box[2]<1?box[0]/(1-box[2])*100:0}% ${box[3]<1?box[1]/(1-box[3])*100:0}%`:'center';
 const style=box?{backgroundImage:`url(${src})`,backgroundSize:size,backgroundPosition:pos}:{backgroundImage:`url(${src})`,backgroundSize:'cover',backgroundPosition:'center'};
 // The SAM3 mask PNG covers the whole image, so it is cropped with the same size and position as the photo:
 // the object is cut out of its background.
 const m=mask?`url(${mask})`:'';
 if(mask&&box)return <span className="gcrop cut" aria-hidden="true"><span className="gcrop-mask" style={{...style,maskImage:m,WebkitMaskImage:m,maskSize:size,WebkitMaskSize:size,maskPosition:pos,WebkitMaskPosition:pos}}/></span>;
 return <span className={'gcrop'+(box?'':' whole')} style={style} aria-hidden="true"/>;
}

export default function GraphView({analysis,graph,running,focus,impact,compact,busy,onPick,onImpact,onToggleSource}:Props){
 const mode=useContext(Lang);
 const latest=analysis.display_revision;
 const [viewRev,setViewRev]=useState<number|null>(null),[compare,setCompare]=useState(false),[loaded,setLoaded]=useState<Record<number,Graph>>({}),[copied,setCopied]=useState(false);
 const canvas=useRef<HTMLDivElement>(null),scroller=useRef<HTMLDivElement>(null),[wires,setWires]=useState<(Wire&{d:string})[]>([]),[size,setSize]=useState({w:0,h:0});
 useEffect(()=>{setLoaded({});setViewRev(null);setCompare(false)},[analysis.id]);
 useEffect(()=>{if(graph&&graph.stored!=='draft')setLoaded(l=>l[graph.revision]?l:{...l,[graph.revision]:graph})},[graph]);
 const rev=viewRev&&viewRev<=latest?viewRev:latest;
 const onLatest=rev===latest;

 // Which graph to draw, and what the storage chip says about it.
 let g:Graph|null,state:'draft'|'reading'|'stored'|'updating'|'unsaved';
 if(!onLatest){g=loaded[rev]||null;state=g?'stored':'reading'}
 else if(graph&&latest>0&&graph.revision===latest){g=graph;state=running?'updating':'stored'}
 else if(!latest){g=null;state=running?'draft':'unsaved'}
 else{g=graph;state='reading'}
 const draft=useMemo(()=>g?null:draftGraph(analysis),[g,analysis]);
 const shown=g||draft!;
 const prev=compare&&rev>1?loaded[rev-1]||null:null;

 // Earlier revisions come from the same read-back endpoint and are cached per analysis.
 useEffect(()=>{
  const need=[!onLatest?rev:0,compare&&rev>1?rev-1:0].filter(r=>r>0&&!loaded[r]);
  let live=true;
  need.forEach(r=>fetch(`/api/analyses/${analysis.id}/graph?revision=${r}`).then(x=>x.ok?x.json():null).then(v=>{if(live&&v)setLoaded(l=>({...l,[r]:v}))}).catch(()=>{}));
  return()=>{live=false};
 },[analysis.id,rev,onLatest,compare,loaded]);

 const view=useMemo(()=>buildView(shown),[shown]);
 const colors=useMemo(()=>obsColors(view.assets.flatMap(a=>a.observations.map(o=>o.id))),[view]);
 const diff=useMemo(()=>prev&&state!=='reading'?diffGraphs(prev,shown):null,[prev,shown,state]);
 const prevView=useMemo(()=>diff&&prev?buildView(prev):null,[diff,prev]);
 const stale=new Set(running&&latest>0?analysis.stale_claim_ids||[]:[]);
 const hit=impact&&onLatest&&!running?new Set([impact.source_id,...impact.passage_ids,...impact.assessment_ids,...impact.claim_ids,...impact.explanation_ids]):null;

 // Selection: the focused claim's column, its linked observations and the sources it cites stay lit.
 const lit=useMemo(()=>{
  if(!focus)return null;
  const cols=view.columns.filter(c=>c.id===focus||c.explanation?.id===focus||c.assessment?.id===focus||c.passages.some(p=>p.id===focus));
  const set=new Set<string>();
  if(cols.length)cols.forEach(c=>{set.add(c.id);c.observationIds.forEach(o=>set.add(o));c.passages.forEach(p=>set.add(p.sourceId))});
  else{set.add(focus);view.columns.filter(c=>c.observationIds.includes(focus)).forEach(c=>set.add(c.id))}
  return set;
 },[focus,view]);
 const dim=(id:string)=>lit&&!lit.has(id)?' dim':'';

 // Wires are drawn in an SVG over the HTML cards, measured from the cards' boxes.
 const wireList=useMemo(()=>{
  const list:Wire[]=[];
  view.columns.forEach(c=>{c.observationIds.forEach(o=>list.push({key:`l:${c.id}:${o}`,from:o,to:c.id,kind:'linked'}));c.passages.forEach(p=>list.push({key:`p:${p.id}`,from:p.id,to:p.sourceId,kind:'passage '+p.stance}))});
  return list;
 },[view]);
 const measure=useCallback(()=>{
  const root=canvas.current,sc=scroller.current;if(!root||!sc)return;
  const base=root.getBoundingClientRect(),clip=sc.getBoundingClientRect();
  const box=(id:string)=>root.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.getBoundingClientRect();
  const next:(Wire&{d:string})[]=[];
  for(const w of wireList){
   const a=box(w.from),b=box(w.to);if(!a||!b)continue;
   const ax=a.left+a.width/2,bx=b.left+b.width/2;
   // Ends that are scrolled out of the columns' viewport are not drawn.
   if((w.kind==='linked'?bx:ax)<clip.left-2||(w.kind==='linked'?bx:ax)>clip.right+2)continue;
   const x1=ax-base.left,y1=a.bottom-base.top,x2=bx-base.left,y2=b.top-base.top,m=(y1+y2)/2;
   next.push({...w,d:`M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${m.toFixed(1)} ${x2.toFixed(1)},${m.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`});
  }
  setWires(next);setSize({w:root.offsetWidth,h:root.offsetHeight});
 },[wireList]);
 const frame=useRef(0);
 const schedule=useCallback(()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(measure)},[measure]);
 useLayoutEffect(()=>{measure()},[measure,compact,mode,diff]);
 useEffect(()=>{
  const ro=new ResizeObserver(schedule);if(canvas.current)ro.observe(canvas.current);
  const grid=scroller.current?.firstElementChild;if(grid)ro.observe(grid);
  window.addEventListener('resize',schedule);
  return()=>{ro.disconnect();window.removeEventListener('resize',schedule);cancelAnimationFrame(frame.current)};
 },[schedule]);

 // Arrow keys move between cards by position: up/down within a column, left/right across columns.
 function navigate(e:KeyboardEvent<HTMLDivElement>){
  const dir={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];
  const from=e.target as HTMLElement;if(!dir||!from.classList.contains('gmain'))return;
  const r=from.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  let best:HTMLElement|null=null,score=Infinity;
  canvas.current?.querySelectorAll<HTMLElement>('.gmain').forEach(el=>{
   if(el===from)return;const b=el.getBoundingClientRect(),dx=b.left+b.width/2-cx,dy=b.top+b.height/2-cy;
   const along=dir[0]?dx*dir[0]:dy*dir[1],across=Math.abs(dir[0]?dy:dx);
   if(along<=4)return;const s=along+across*(dir[0]?2:4);if(s<score){score=s;best=el}
  });
  if(best){e.preventDefault();(best as HTMLElement).focus();(best as HTMLElement).scrollIntoView({block:'nearest',inline:'nearest'})}
 }

 async function copyCypher(){try{await navigator.clipboard.writeText(cypherFor(analysis.id,shown.revision));setCopied(true);setTimeout(()=>setCopied(false),1600)}catch{}}

 const s=view.summary;
 const cols=view.columns.length||1;
 const tally=[['✓',s.confirmed],['✕',s.contradicted],['?',s.unresolved]].filter(([,n])=>n).map(([k,n])=>`${k}${n}`).join(' · ')||'—';
 const assetUrl=(id:string)=>`/api/analyses/${analysis.id}/assets/${id}`;
 const ghostPassages=(c:Column)=>{const was=prevView?.columns.find(x=>x.id===c.id);return was?was.passages.filter(p=>!c.passages.some(q=>q.id===p.id)):[]};
 const ghostColumns=prevView?prevView.columns.filter(c=>!view.columns.some(x=>x.id===c.id)):[];
 const ghostSources=prevView?prevView.sources.filter(x=>!view.sources.some(y=>y.id===x.id)):[];
 const impactSource=hit?view.sources.find(x=>x.id===impact!.source_id):undefined;
 const claimList=(ids:string[],ja=false)=>ids.map(id=>ja?`主張${num(id)}`:`C${num(id)}`).join(ja?'、':', ');

 const chip=state==='draft'?<Chip tone="gold"><LoaderCircle size={12} className="spin"/><Bi en="Draft · building" ja="下書き · 構築中" inline/></Chip>
  :state==='reading'?<Chip tone="gold"><LoaderCircle size={12} className="spin"/><Bi en={`Reading from Neo4j… rev ${rev}`} ja={`Neo4j から読み込み中… rev ${rev}`} inline/></Chip>
  :state==='unsaved'?<Chip tone="gold"><Bi en="Draft · not stored (no verified revision)" ja="下書き · 未保存（検証済みの版がありません）" inline/></Chip>
  :<Chip tone={shown.stored==='neo4j'?'green':'gold'}><Network size={12}/>{shown.stored==='neo4j'?<Bi en="Stored in Neo4j ✓" ja="Neo4j に保存済み ✓" inline/>:<Bi en="Local snapshot (Neo4j unreachable)" ja="ローカルの控え（Neo4j に接続できません）" inline/>}<span className="gchip-sub">rev {shown.revision} · {shown.node_count} nodes / {shown.relationship_count} relationships</span></Chip>;

 return <div className={'gv '+state+(compact?' compact':'')+(lit?' has-focus':'')+(hit?' has-impact':'')}>
  <div className="gv-head">
   <p className="gv-summary"><Bi en={`${s.claims} claim${s.claims===1?'':'s'} · ${tally} · ${s.sources} source${s.sources===1?'':'s'}`} ja={`主張${s.claims}件 · ${tally} · 出典${s.sources}件`} inline/></p>
   {chip}
   {state==='updating'&&<Chip tone="violet"><LoaderCircle size={12} className="spin"/><Bi en={`Re-evaluating · showing stored rev ${latest}`} ja={`再評価中 · 保存済みの rev ${latest} を表示`} inline/></Chip>}
   {latest>1&&<div className="gv-revs" role="group" aria-label="Revision">
    {Array.from({length:latest},(_,i)=>i+1).map(r=><button key={r} className={r===rev?'active':''} aria-pressed={r===rev} onClick={()=>setViewRev(r===latest?null:r)}>rev {r}</button>)}
    <button className={'gv-compare'+(compare?' active':'')} aria-pressed={compare} disabled={rev<2} onClick={()=>setCompare(!compare)}><GitCompare size={12}/><Bi en="Compare with previous" ja="前の版と比較" inline/></button>
   </div>}
  </div>
  {diff&&<p className="gv-banner diff" role="status"><GitCompare size={14}/><Bi en={`rev ${rev} vs rev ${rev-1}: ${diff.added.size} new · ${diff.changed.size} changed · ${diff.removed.length} removed nodes; +${diff.addedEdges} / −${diff.removedEdges} relationships`} ja={`rev ${rev} と rev ${rev-1} の比較：追加 ${diff.added.size} · 変化 ${diff.changed.size} · 削除 ${diff.removed.length} ノード、関係 +${diff.addedEdges} / −${diff.removedEdges}`}/></p>}
  {compare&&rev>1&&!prev&&<p className="gv-banner diff" role="status"><LoaderCircle size={14} className="spin"/><Bi en={`Reading rev ${rev-1} from Neo4j…`} ja={`rev ${rev-1} を Neo4j から読み込み中…`} inline/></p>}

  {/* Zero-height sticky slot: the impact banner floats at the top of the viewport so hovering Disable never moves the button. */}
  <div className="gv-float" role="status" aria-live="polite">{hit&&<p className="gv-banner impact"><AlertCircle size={14}/><Bi
   en={impact!.claim_ids.length?`Disabling “${impactSource?.title||'this source'}” re-evaluates ${impact!.claim_ids.length} claim${impact!.claim_ids.length===1?'':'s'} (${claimList(impact!.claim_ids)}) and ${impact!.explanation_ids.length} explanation${impact!.explanation_ids.length===1?'':'s'} · traced in ${impact!.stored==='local'?'the local snapshot':'Neo4j'}`:`Disabling “${impactSource?.title||'this source'}” changes no claim`}
   ja={impact!.claim_ids.length?`「${impactSource?.title||'この出典'}」を無効にすると、主張${impact!.claim_ids.length}件（${claimList(impact!.claim_ids,true)}）と説明${impact!.explanation_ids.length}件を再評価します · ${impact!.stored==='local'?'ローカルの控え':'Neo4j'}でたどりました`:`「${impactSource?.title||'この出典'}」を無効にしても、再評価される主張はありません`}/></p>}</div>
  <div className="gv-canvas" ref={canvas} onKeyDown={navigate}>
   <svg className="gv-wires" width={size.w} height={size.h} aria-hidden="true">
    {wires.map(w=>{const on=hit?hit.has(w.from)&&hit.has(w.to):lit?lit.has(w.from)&&lit.has(w.to):false;return <path key={w.key} d={w.d} className={'w '+w.kind+(on?(hit?' impact':' on'):(hit||lit)?' dim':'')}/>})}
   </svg>

   <section className="gv-band images" aria-label="Images and observations · 画像と観察">
    <h3 className="gv-band-label"><Bi en="Images · observations" ja="画像 · 観察" inline/></h3>
    <div className="gv-assets">{view.assets.map(a=>{
     const models=[...new Set(a.observations.flatMap(o=>[o.model,o.regionModel]).filter(Boolean))] as string[];
     return <div key={a.id} className="gasset">
      <button className="gmain gasset-head" data-node={a.id} onClick={()=>onPick(a.node)} aria-label={both(`Image ${a.index}: show it large`,`画像${a.index}：大きく表示`)}>
       <img src={assetUrl(a.id)} alt="" onLoad={schedule}/><span><Bi en={`Image ${a.index}`} ja={`画像${a.index}`} inline/></span>{!compact&&models.map(m=><Chip key={m} tone="model">{m}</Chip>)}
      </button>
      <div className="gobs-list">{a.observations.map(o=><button key={o.id} className={'gmain gcard gobs'+dim(o.id)+(diff?.added.has(o.id)?' is-new':'')} style={{'--c':colors[o.id]} as CSSProperties} data-node={o.id} onClick={()=>onPick(o.node)} aria-label={both(`Observation ${obsLabel(o.id)}: ${o.text}`,`観察 ${obsLabel(o.id)}：${o.text_ja||o.text}`)}>
       <Crop src={assetUrl(a.id)} mask={o.masked?`/api/analyses/${analysis.id}/masks/${o.id}`:undefined} o={o} w={Number(a.node.width)||undefined} h={Number(a.node.height)||undefined}/>
       <span className="gobs-body"><span className="glabel">{obsLabel(o.id)}{o.regionModel&&o.regionModel!==o.model&&<Chip tone="model">{o.regionModel}</Chip>}<Mark ids={[o.id]} diff={diff}/></span><span className="gclamp two"><Bi en={o.text} ja={o.text_ja}/></span></span>
      </button>)}
      {!a.observations.length&&<span className="gplaceholder"><LoaderCircle size={12} className="spin"/><Bi en="Looking at the image…" ja="画像を見ています…" inline/></span>}</div>
     </div>})}</div>
   </section>

   <div className="gv-scroll" ref={scroller} onScroll={schedule}>
    <div className="gv-grid" style={{gridTemplateColumns:`repeat(${cols+ghostColumns.length},var(--gcol))`}}>
     <h3 className="gv-band-label row"><span><Bi en="Claims · checks · quoted passages" ja="主張 · 判定 · 引用" inline/></span></h3>
     {view.columns.map((c,i)=>{
      const exp=c.explanation,impacted=hit?.has(c.id);
      return <div key={c.id} className={'gcol'+dim(c.id)+(impacted?' impact':'')+(stale.has(c.id)?' stale':'')} style={{gridColumn:i+1,gridRow:2}} role="group" aria-label={both(`Claim ${num(c.id)} column`,`主張${num(c.id)}の列`)}>
       <button className={'gmain gcard claim st-'+(c.status||'pending')+(diff?.added.has(c.id)?' is-new':'')+(focus===c.id?' focus':'')} data-node={c.id} onClick={()=>onPick(c.claim)} aria-label={both(`Claim ${num(c.id)}${c.status?' ('+STATUS[c.status][0]+')':''}: ${c.text}`,`主張${num(c.id)}${c.status?'（'+STATUS[c.status][1]+'）':''}：${c.text_ja||c.text}`)}>
        <span className="glabel"><Bi en={`Claim ${num(c.id)}`} ja={`主張${num(c.id)}`} inline/>{KIND[c.kind]&&<Chip tone="kind"><Bi en={KIND[c.kind][0]} ja={KIND[c.kind][1]} inline/></Chip>}<Mark ids={[c.id]} diff={diff}/></span>
        <span className="gclamp three serif"><Bi en={c.text} ja={c.text_ja}/></span>
        {c.scope.length>0&&<span className="gchips">{c.scope.map(x=><Chip key={x} tone="scope">{x}</Chip>)}</span>}
       </button>
       {c.assessment?<button className={'gmain gcard verdict st-'+c.status+(impacted?' impact':'')+(diff?.added.has(c.assessment.id)?' is-new':diff?.changed.has(c.assessment.id)||(exp&&diff?.changed.has(exp.id))?' is-changed':'')+(focus===exp?.id?' focus':'')} data-node={c.assessment.id} onClick={()=>onPick(exp||c.assessment!)} aria-label={both(`Check for claim ${num(c.id)}: ${STATUS[c.status!]?.[0]||c.status}. ${exp?.text||c.reason||''}`,`主張${num(c.id)}の判定：${STATUS[c.status!]?.[1]||c.status}。${c.expText_ja||c.reason_ja||''}`)}>
        <span className="glabel">{c.status&&<StatusBadge status={c.status}/>}{stale.has(c.id)&&<span className="badge stale"><LoaderCircle size={11} className="spin"/><Bi en="Re-evaluating" ja="再評価中" inline/></span>}<Mark ids={[c.assessment.id,exp?.id]} diff={diff}/></span>
        {c.expText?<span className="gfull"><Bi en={c.expText} ja={c.expText_ja}/></span>:c.reason&&<span className="gfull"><Bi en={c.reason} ja={c.reason_ja}/></span>}
        <span className="gchips">
         {c.check?.verdict==='accepted'&&<Chip tone="green"><span>✓ <Bi en="Independent check" ja="独立検証" inline/> · {c.check.model}</span></Chip>}
         {c.check?.verdict==='rejected'&&<Chip tone="gold"><ShieldCheck size={11}/><Bi en="Template wording" ja="定型文" inline/></Chip>}
         {!compact&&[...new Set([c.assessModel,c.expModel].filter(Boolean))].map(m=><Chip key={m} tone="model" title="GENERATED_BY → ToolRun">{m}</Chip>)}
        </span>
       </button>
       :<div className="gcard verdict pending" data-node={'pending-'+c.id}><span className="glabel"><LoaderCircle size={12} className="spin"/><Bi en="Checking…" ja="確認中…" inline/></span><span className="skeleton"/><span className="skeleton short"/></div>}
       {c.passages.map(p=><div key={p.id} className={'gcard passage '+p.stance+(p.scopeMatch?'':' off-scope')+(hit?.has(p.id)?' impact':'')+(diff?.added.has(p.id)?' is-new':'')} data-node={p.id}>
        <button className="gmain" onClick={()=>onPick(p.node)} aria-label={both(`Quoted passage, ${STANCE[p.stance]?.[0]||p.stance}: ${p.quote}`,`引用（${STANCE[p.stance]?.[1]||p.stance}）：${p.quote}`)}>
         <span className="glabel"><Bi en={p.scopeMatch?STANCE[p.stance]?.[0]||p.stance:'Different or unclear scope'} ja={p.scopeMatch?STANCE[p.stance]?.[1]:'条件が異なる・不明'} inline/><Mark ids={[p.id]} diff={diff}/></span>
         <span className="gclamp three serif" lang="en" title={p.quote}>“{p.quote}”</span>
        </button>
        {p.quote_ja&&mode!=='en'&&<details className="gtrans"><summary><Bi en="Reference translation" ja="参考訳" inline/></summary><p lang="ja">{p.quote_ja}</p></details>}
       </div>)}
       {ghostPassages(c).map(p=><div key={'ghost-'+p.id} className="gcard passage ghost"><span className="glabel"><span className="gmark removed"><Bi en={`Removed since rev ${rev-1}`} ja={`rev ${rev-1} から削除`} inline/></span></span><span className="gclamp two serif" lang="en">“{p.quote}”</span></div>)}
      </div>})}
     {ghostColumns.map((c,i)=><div key={'ghost-'+c.id} className="gcol ghost" style={{gridColumn:view.columns.length+i+1,gridRow:2}}><div className="gcard claim ghost"><span className="glabel"><span className="gmark removed"><Bi en="Removed" ja="削除" inline/></span></span><span className="gclamp three serif"><Bi en={c.text} ja={c.text_ja}/></span></div></div>)}
     {!view.columns.length&&<div className="gcol" style={{gridColumn:1,gridRow:2}}><div className="gcard pending"><span className="glabel">{running?<><LoaderCircle size={12} className="spin"/><Bi en="Extracting claims from your text…" ja="文章から主張を取り出しています…" inline/></>:<Bi en="No claims" ja="主張はありません" inline/>}</span></div></div>}

     <h3 className="gv-band-label row sources"><span><Bi en="Sources · user-registered" ja="出典 · ユーザー登録" inline/></span></h3>
     {Array.from({length:cols},(_,i)=>{const list=view.sources.filter(x=>x.column===i),ghosts=i===0?ghostSources:[];if(!list.length&&!ghosts.length)return null;
      return <div key={'src-'+i} className="gsrc-cell" style={{gridColumn:i+1,gridRow:4}}>
       {list.map(x=><div key={x.id} className={'gcard source'+(x.active?'':' inactive')+dim(x.id)+(hit&&impact!.source_id===x.id?' impact':'')+(diff?.added.has(x.id)?' is-new':diff?.changed.has(x.id)?' is-changed':'')} data-node={x.id}>
        <button className="gmain" onClick={()=>onPick(x.node)} aria-label={both(`Source: ${x.title}, ${x.active?'active':'disabled'}`,`出典：${x.title}（${x.active?'有効':'無効'}）`)}>
         <span className="glabel"><Bi en={x.active?'Active':'Disabled'} ja={x.active?'有効':'無効'} inline/><Mark ids={[x.id]} diff={diff}/></span>
         <span className="gclamp two">{x.title}</span>{x.publisher&&<span className="gpub">{x.publisher}</span>}
        </button>
        {onLatest&&<button className="gtoggle text-button" disabled={running||busy} onMouseEnter={()=>x.active&&onImpact(x.id)} onFocus={()=>x.active&&onImpact(x.id)} onMouseLeave={()=>onImpact(null)} onBlur={()=>onImpact(null)} onClick={()=>onToggleSource(x.id,!x.active)}>{x.active?'Disable':'Enable'}</button>}
       </div>)}
       {ghosts.map(x=><div key={'ghost-'+x.id} className="gcard source ghost"><span className="glabel"><span className="gmark removed"><Bi en="Removed" ja="削除" inline/></span></span><span className="gclamp two">{x.title}</span></div>)}
      </div>})}
     {!view.sources.length&&!ghostSources.length&&<p className="gempty" style={{gridColumn:'1 / -1',gridRow:4}}><Bi en="No sources yet. Add evidence to give the claims something to stand on." ja="出典はまだありません。根拠を追加すると主張を確かめられます。"/></p>}
    </div>
   </div>
  </div>

  <div className="gv-legend"><span><i className="dash"/>LINKED_TO <Bi en="(candidate)" ja="（候補）" inline/></span><span><i className="ln supports"/>CITES · supports</span><span><i className="ln contradicts"/>contradicts</span><span><i className="ln context_only"/>context only</span></div>

  <details className="gv-stored">
   <summary><Database size={13}/><Bi en="Stored structure" ja="保存されている構造" inline/><span className="gchip-sub">{shown.node_count} nodes / {shown.relationship_count} relationships{state==='draft'||state==='unsaved'?' · draft, not yet written':''}</span></summary>
   <p className="gv-note"><Bi en="Region, Scope and ToolRun nodes, and explanations of observations, are stored in Neo4j but folded into the cards above." ja="Region・Scope・ToolRun のノードと、観察の説明は Neo4j に保存されていますが、上のカードにまとめて表示しています。"/></p>
   <div className="gv-tables">
    <table><caption><Bi en="Nodes by label" ja="ラベル別ノード" inline/></caption><tbody>{view.counts.labels.map(([k,v])=><tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
    <table><caption><Bi en="Relationships by type" ja="種類別の関係" inline/></caption><tbody>{view.counts.rels.map(([k,v])=><tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
   </div>
   <div className="gv-cypher"><code>{cypherFor(analysis.id,shown.revision)}</code><button className="text-button" onClick={copyCypher}><Copy size={13}/>{copied?<Bi en="Copied" ja="コピーしました" inline/>:<Bi en="Copy Cypher for Neo4j Browser" ja="Neo4j Browser 用の Cypher をコピー" inline/>}</button></div>
  </details>
 </div>;
}

