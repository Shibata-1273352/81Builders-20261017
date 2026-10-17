// Pure functions that turn a Neo4j read-back (or an in-progress analysis) into the column view of the Graph tab.
export type Status='confirmed'|'contradicted'|'unresolved';
export type GNode={id:string;label:string;[key:string]:unknown};
export type GEdge={source:string;target:string;type:string;stance?:string;candidate?:boolean;[key:string]:unknown};
export type Graph={nodes:GNode[];edges:GEdge[];stored:string;revision:number;node_count:number;relationship_count:number};
export type Impact={source_id:string;passage_ids:string[];assessment_ids:string[];claim_ids:string[];explanation_ids:string[];stored?:string};

export function obsLabel(id:string){const m=id.match(/(\d+)-(\d+)$/);return m?`${m[1]}.${m[2]}`:id}
export function shortModel(id:string){return id.split('/').pop()||id}
const byNum=(a:{id:string},b:{id:string})=>a.id.localeCompare(b.id,undefined,{numeric:true});

// Six colours that stay apart on a projector. Each observation keeps its colour, by id order, on the image,
// in Meaning, on cultural notes and in the Graph.
export const PALETTE=['#f76707','#1c7ed6','#d6336c','#2f9e44','#7048e8','#0c8599'];
export function obsColors(ids:string[]):Record<string,string>{
 return Object.fromEntries([...new Set(ids)].map(id=>({id})).sort(byNum).map((o,i)=>[o.id,PALETTE[i%PALETTE.length]]));
}
// "24 × paper lanterns" when SAM3 counted several instances, otherwise the label alone.
export function countLabel(label?:string|null,count?:number){return label?count&&count>1?`${count} × ${label}`:label:''}
const str=(v:unknown)=>typeof v==='string'&&v?v:undefined;

// Crop box [x,y,w,h] in 0..1. A segmentation mask, when present, wins over the bbox; any other shape is ignored.
export function cropBox(bbox:unknown,mask?:unknown):number[]|null{
 let m=mask;
 if(typeof m==='string'){try{m=JSON.parse(m)}catch{m=null}}
 // Accepts [[x,y],…], a multi-polygon [[[x,y],…],…] or a flat [x1,y1,x2,y2,…].
 let pts:unknown[]=[];
 if(Array.isArray(m)){pts=Array.isArray(m[0])&&Array.isArray(m[0][0])?m.flat():Array.isArray(m[0])?m:m.flatMap((v,i)=>i%2?[]:[[v,m[i+1]]])}
 const ok=pts.filter((p):p is number[]=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
 if(ok.length>=3){const xs=ok.map(p=>p[0]),ys=ok.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys);return [x,y,Math.max(...xs)-x,Math.max(...ys)-y]}
 if(Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)&&bbox[2]>0&&bbox[3]>0)return bbox as number[];
 return null;
}

// Place, then the time range; an equal start and end is one year.
function scopeChips(s?:GNode){
 if(!s)return [];
 const a=str(s.time_start),b=str(s.time_end);
 return [str(s.place),a&&b&&a!==b?`${a}–${b}`:a||b].filter(Boolean) as string[];
}
export type ObsView={id:string;assetId:string;assetIndex:number;text:string;text_ja?:string;crop:number[]|null;masked:boolean;model?:string;regionModel?:string;terms:string[];node:GNode};
export type PassageView={id:string;quote:string;quote_ja?:string;stance:string;scopeMatch:boolean;sourceId:string;node:GNode};
export type Column={id:string;claim:GNode;text:string;text_ja?:string;kind:string;scope:string[];model?:string;
 assessment?:GNode;status?:Status;reason?:string;reason_ja?:string;assessModel?:string;
 explanation?:GNode;expText?:string;expText_ja?:string;check?:{model:string;verdict:string};expModel?:string;
 passages:PassageView[];observationIds:string[]};
export type SourceView={id:string;title:string;publisher?:string;active:boolean;column:number;node:GNode};
export type AssetView={id:string;index:number;node:GNode;observations:ObsView[]};
export type View={assets:AssetView[];columns:Column[];sources:SourceView[];
 counts:{labels:[string,number][];rels:[string,number][]};summary:{claims:number;confirmed:number;contradicted:number;unresolved:number;sources:number;active:number}};

export function buildView(g:Graph):View{
 const byId=new Map(g.nodes.map(n=>[n.id,n]));
 const out=new Map<string,GEdge[]>(),into=new Map<string,GEdge[]>();
 for(const e of g.edges){(out.get(e.source)??out.set(e.source,[]).get(e.source)!).push(e);(into.get(e.target)??into.set(e.target,[]).get(e.target)!).push(e)}
 const from=(id:string,type:string)=>(out.get(id)||[]).filter(e=>e.type===type);
 const to=(id:string,type:string)=>(into.get(id)||[]).filter(e=>e.type===type);
 const model=(id:string)=>{const r=byId.get(from(id,'GENERATED_BY')[0]?.target||'');return r?shortModel(String(r.model_id||r.tool||'')):undefined};
 const of=(label:string)=>g.nodes.filter(n=>n.label===label).sort(byNum);
 const assets=of('Asset').map(a=>({id:a.id,index:Number(a.index)||0,node:a,observations:[] as ObsView[]})).sort((a,b)=>a.index-b.index);
 const assetOf=new Map(assets.map(a=>[a.id,a]));
 // Region and Observation are one-to-one: the region only contributes its crop and the model that drew it.
 for(const o of of('Observation')){
  const region=byId.get(to(o.id,'GROUNDS')[0]?.source||'');
  const asset=assetOf.get(String(o.asset_id||region?.asset_id||''))||assetOf.get(to(region?.id||'','HAS_REGION')[0]?.source||'');
  const view:ObsView={id:o.id,assetId:asset?.id||'',assetIndex:asset?.index||0,text:String(o.text||o.name||''),text_ja:str(o.text_ja),crop:cropBox(region?.bbox_normalized??o.bbox,region?.mask??o.mask),masked:Boolean(region?.segmenter||region?.mask||o.mask),model:model(o.id),regionModel:region?model(region.id):undefined,
   terms:to(o.id,'ABOUT').map(e=>str(byId.get(e.source)?.term_ja)).filter(Boolean) as string[],node:o};
  asset?.observations.push(view);
 }
 const columns:Column[]=of('Claim').map(c=>{
  const scope=byId.get(from(c.id,'HAS_SCOPE')[0]?.target||'');
  const x=byId.get(to(c.id,'EVALUATES')[0]?.source||'');
  const exp=x?to(x.id,'BASED_ON').map(e=>byId.get(e.source)).find(n=>n?.label==='Explanation'):undefined;
  const passages=x?from(x.id,'CITES').map(e=>{const p=byId.get(e.target);return p&&{id:p.id,quote:String(p.quote||''),quote_ja:str(p.quote_ja),stance:String(e.stance||'context_only'),scopeMatch:e.scope_match!==false,sourceId:String(p.source_id||to(p.id,'HAS_PASSAGE')[0]?.source||''),node:p}}).filter(Boolean).sort((a,b)=>byNum(a!,b!)) as PassageView[]:[];
  return {id:c.id,claim:c,text:String(c.text||c.name||''),text_ja:str(c.text_ja),kind:String(c.kind||''),
   scope:scopeChips(scope),model:model(c.id),
   assessment:x,status:x?.status as Status|undefined,reason:str(x?.reason),reason_ja:str(x?.reason_ja),assessModel:x&&model(x.id),
   explanation:exp,expText:str(exp?.text),expText_ja:str(exp?.text_ja),expModel:exp&&model(exp.id),
   check:exp?.check_verdict?{model:shortModel(String(exp.check_model||'')),verdict:String(exp.check_verdict)}:undefined,
   passages,observationIds:from(c.id,'LINKED_TO').map(e=>e.target)};
 });
 // Each source sits under the first column that cites it; uncited ones fill the remaining columns from the left.
 const taken=new Map<number,number>();
 const sources=of('Source').map(s=>{
  let column=columns.findIndex(c=>c.passages.some(p=>p.sourceId===s.id));
  if(column<0){column=0;while((taken.get(column)||0)>0&&column<columns.length-1)column++}
  taken.set(column,(taken.get(column)||0)+1);
  return {id:s.id,title:String(s.title||s.name||s.id),publisher:str(s.publisher),active:s.active!==false,column,node:s};
 });
 const tally=(keys:string[])=>[...keys.reduce((m,k)=>m.set(k,(m.get(k)||0)+1),new Map<string,number>())].sort((a,b)=>b[1]-a[1]);
 const st=columns.map(c=>c.status);
 return {assets,columns,sources,counts:{labels:tally(g.nodes.map(n=>n.label)),rels:tally(g.edges.map(e=>e.type))},
  summary:{claims:columns.length,confirmed:st.filter(s=>s==='confirmed').length,contradicted:st.filter(s=>s==='contradicted').length,unresolved:st.filter(s=>s==='unresolved').length,sources:sources.length,active:sources.filter(s=>s.active).length}};
}

// The subset of the analysis API that the draft needs; mirrors backend/graph.py:payload.
type Ref={id:string;type?:string};
export type DraftInput={id:string;revision:number;assets:{id:string;index:number;mime_type?:string}[];
 observations:{id:string;asset_id:string;text:string;text_ja?:string|null;bbox:number[]|null;mask?:unknown;run_id?:string|null;[k:string]:unknown}[];
 claims:{id:string;text:string;text_ja?:string|null;kind:string;observation_ids?:string[];run_id?:string|null;link_run_id?:string|null;[k:string]:unknown}[];
 assessments:{id:string;claim_id:string;status:string;reason:string;reason_ja?:string|null;reason_code?:string;run_id?:string|null;passages:{id:string;source_id:string;quote:string;quote_ja?:string|null;stance:string;scope_match:boolean}[]}[];
 explanations:{id:string;section:string;text:string;text_ja?:string|null;support_ids:Ref[];origin?:string;run_id?:string|null;check?:{model_id:string;verdict:string}|null}[];
 sources:{id:string;title:string;publisher?:string;place?:string;active:boolean;url_optional?:string}[];
 cultural_notes?:{id:string;about:string|null;term:{ja:string;reading?:string|null;en:string};summary:{en:string;ja?:string|null};consensus:string;run_id?:string|null;reviews:{model:string;run_id?:string|null;verdict:string|null}[]}[]|null;
 runs:{id:string;tool:string;model_id:string;latency_ms?:number;started_at?:string}[]};
export function draftGraph(a:DraftInput):Graph{
 const nodes:GNode[]=[],edges:GEdge[]=[],runs=new Map(a.runs.map(r=>[r.id,r])),used=new Set<string>();
 const node=(label:string,id:string,props:Record<string,unknown>)=>{nodes.push({id,label,...Object.fromEntries(Object.entries(props).filter(([,v])=>v!=null))})};
 const edge=(type:string,source:string,target:string,props:Record<string,unknown>={})=>{edges.push({source,target,type,...props})};
 const generated=(id:string,run?:string|null)=>{if(run&&runs.has(run)){used.add(run);edge('GENERATED_BY',id,run)}};
 for(const x of a.assets)node('Asset',x.id,{name:`Image ${x.index}`,index:x.index,mime_type:x.mime_type});
 for(const o of a.observations){
  const region='region-'+o.id;
  // A SAM3 mask arrives as metadata; the PNG itself is served separately.
  const m=(o.mask&&typeof o.mask==='object'&&!Array.isArray(o.mask)?o.mask:{}) as Record<string,unknown>;
  node('Region',region,{bbox_normalized:o.bbox,asset_id:o.asset_id,segmenter:m.segmenter,mask_score:m.score});
  node('Observation',o.id,{text:o.text,text_ja:o.text_ja,asset_id:o.asset_id});
  edge('HAS_REGION',o.asset_id,region);edge('GROUNDS',region,o.id);generated(o.id,o.run_id);generated(region,m.run_id as string|undefined);
 }
 for(const c of a.claims){
  node('Claim',c.id,{text:c.text,text_ja:c.text_ja,kind:c.kind});
  node('Scope','scope-'+c.id,{place:c.place,time_start:c.time_start,time_end:c.time_end});
  edge('HAS_SCOPE',c.id,'scope-'+c.id);generated(c.id,c.run_id);
  for(const oid of c.observation_ids||[])edge('LINKED_TO',c.id,oid,{candidate:true});
 }
 for(const s of a.sources)node('Source',s.id,{title:s.title,publisher:s.publisher,place:s.place,active:s.active,url:s.url_optional});
 for(const x of a.assessments){
  node('Assessment',x.id,{status:x.status,reason_code:x.reason_code,reason:x.reason,reason_ja:x.reason_ja});
  edge('EVALUATES',x.id,x.claim_id);generated(x.id,x.run_id);
  for(const p of x.passages){node('Passage',p.id,{quote:p.quote,quote_ja:p.quote_ja,source_id:p.source_id});edge('CITES',x.id,p.id,{stance:p.stance,scope_match:p.scope_match});edge('HAS_PASSAGE',p.source_id,p.id)}
 }
 for(const e of a.explanations){
  node('Explanation',e.id,{text:e.text,text_ja:e.text_ja,section:e.section,origin:e.origin,check_model:e.check?.model_id,check_verdict:e.check?.verdict});
  for(const r of e.support_ids)edge('BASED_ON',e.id,r.id);
  generated(e.id,e.run_id);
 }
 for(const n of a.cultural_notes||[]){
  node('CulturalNote',n.id,{term_ja:n.term.ja,term_en:n.term.en,reading:n.term.reading,summary:n.summary.en,summary_ja:n.summary.ja,consensus:n.consensus});
  if(n.about&&a.observations.some(o=>o.id===n.about))edge('ABOUT',n.id,n.about);
  generated(n.id,n.run_id);
  for(const rv of n.reviews)if(rv.run_id&&runs.has(rv.run_id)){used.add(rv.run_id);edge('REVIEWED_BY',n.id,rv.run_id,{verdict:rv.verdict,model_id:rv.model})}
 }
 for(const id of used){const r=runs.get(id)!;node('ToolRun',id,{tool:r.tool,model_id:r.model_id,latency_ms:r.latency_ms,started_at:r.started_at})}
 return {nodes,edges,stored:'draft',revision:a.revision,node_count:nodes.length,relationship_count:edges.length};
}

export type Change={field:string;from:string;to:string};
export type Diff={added:Set<string>;changed:Map<string,Change[]>;removed:GNode[];addedEdges:number;removedEdges:number};
const FIELDS:[string,(n:GNode)=>string|undefined][]=[['status',n=>str(n.status)],['active',n=>n.active==null?undefined:n.active===false?'Disabled':'Active'],['text',n=>str(n.text)],['check_verdict',n=>str(n.check_verdict)]];
export function diffGraphs(prev:Graph,cur:Graph):Diff{
 const old=new Map(prev.nodes.map(n=>[n.id,n])),now=new Set(cur.nodes.map(n=>n.id));
 const added=new Set<string>(),changed=new Map<string,Change[]>();
 for(const n of cur.nodes){
  const p=old.get(n.id);if(!p){added.add(n.id);continue}
  const cs=FIELDS.map(([field,get])=>({field,from:get(p)||'',to:get(n)||''})).filter(c=>c.from!==c.to);
  if(cs.length)changed.set(n.id,cs);
 }
 const key=(e:GEdge)=>`${e.source}|${e.type}|${e.target}`;
 const a=new Set(prev.edges.map(key)),b=new Set(cur.edges.map(key));
 return {added,changed,removed:prev.nodes.filter(n=>!now.has(n.id)),addedEdges:[...b].filter(k=>!a.has(k)).length,removedEdges:[...a].filter(k=>!b.has(k)).length};
}

export function cypherFor(analysisId:string,revision:number){
 return `MATCH (n:Tsumugi {analysis_id:'${analysisId.replace(/'/g,"\\'")}', revision:${revision}}) WHERE n.key STARTS WITH 'v2:' OPTIONAL MATCH (n)-[r]->(m) RETURN n,r,m`;
}
