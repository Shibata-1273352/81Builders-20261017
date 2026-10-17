'use client';
import { useState, useEffect, useRef, FormEvent } from 'react';
import { ArrowUpRight, ArrowRight, Plus, X, Upload, Check, CircleHelp, AlertCircle, ChevronDown, ChevronLeft, ExternalLink, BookOpen, Eye, RefreshCw, Minus, LoaderCircle, History, Network, ShieldCheck } from 'lucide-react';
import exampleSource from '../public/demo/source.json';
import credits from '../public/demo/attribution.json';
import { Lang, Bi, Mode } from './i18n';
import GraphView from './graph/GraphView';
import { obsLabel, shortModel, Graph, GNode, Impact } from './graph/model';

type Status='confirmed'|'contradicted'|'unresolved';
type Asset={id:string;index:number;mime_type:string;width?:number;height?:number};
type Observation={id:string;asset_id:string;text:string;text_ja?:string|null;bbox:number[]|null};
type Claim={id:string;text:string;text_ja?:string|null;input_start:number;input_end:number;kind:string;observation_ids?:string[]};
type Passage={id:string;source_id:string;quote:string;quote_ja?:string|null;stance:string;scope_match:boolean};
type Assessment={id:string;claim_id:string;status:Status;reason:string;reason_ja?:string|null;reason_code:string;missing:string;missing_ja?:string|null;passages:Passage[]};
type Explanation={id:string;section:string;text:string;text_ja?:string|null;claim_ids:string[];support_ids:{id:string;type:string;revision:number}[];origin?:string;check?:{model_id:string;verdict:string}|null};
type Source={id:string;title:string;text:string;url_optional?:string;publisher:string;place?:string;time_start?:string;time_end?:string;active:boolean;origin:string;retrieved_at:string};
type Run={id:string;tool:string;model_id:string;latency_ms?:number;status:string;started_at?:string};
type Limitation=string|{text:string;text_ja?:string};
type Analysis={id:string;revision:number;display_revision:number;status:string;text:string;assets:Asset[];created_at:string;started_at?:string;updated_at:string;claims:Claim[];observations:Observation[];assessments:Assessment[];explanations:Explanation[];sources:Source[];limitations:Limitation[];error?:string;stale_claim_ids?:string[];runs:Run[];changes:{claim_id:string;before:string;before_ja?:string|null;after:string;after_ja?:string|null;from_status:Status;to_status:Status;changed:boolean}[]};
type Event={event_id:number;revision:number;type:string;timestamp:string;payload:Record<string,unknown>};
const sampleText='Gion Matsuri is held throughout July. Both photographs were taken in Kyoto in 2026.';
const sampleImages=['/demo/gion.jpg','/demo/gion-1905.jpg'];
// Fixed interface wording in both languages; model output carries its own text_ja.
const T={
 see:['What you can see','見えること'],context:['What needs context','文脈が必要なこと'],unknown:['What remains unknown','まだ分からないこと'],
 confirmed:['Confirmed','確認済み'],contradicted:['Contradicted','反証あり'],unresolved:['Unresolved','未解決'],stale:['Re-evaluating','再評価中'],
 closer:['A closer look','もう少し、よく見る'],meaning:['Meaning','意味'],graph:['Graph','グラフ'],original:['Original','原本'],
 originalWords:['The original words','元の文章'],visual:['Visual observation','画像の観察'],locate:['Locate in the image','画像で場所を見る'],follow:['Follow the evidence','根拠をたどる'],
 lookClosely:['Look closely.','よく見る。'],followEvidence:['Follow the evidence.','根拠をたどる。'],yourSources:['Your sources.','登録した出典。'],
 selectedClaim:['Selected claim','選択した主張'],why:['Why this status?','この判定の理由'],help:['What would help','あれば判断できるもの'],
 refTranslation:['Reference translation (not the source text)','参考訳（出典の原文ではありません）'],noEvidence:['No supporting excerpt yet.','裏付けとなる抜粋はまだありません。'],
 addSourceHint:['Add a source to give this claim more context.','出典を追加すると、この主張の文脈を確かめられます。'],
 obsNote:['Observed in the image by ai&. This is a visual candidate; it does not establish location, date, or cultural meaning.','ai& が画像から観察した候補です。場所・日付・文化的な意味を確定するものではありません。'],
 regionNote:['Outlined regions are AI observation candidates, not proof of cultural meaning.','枠は AI による観察の候補で、文化的な意味の証明ではありません。'],
 linkNote:['Highlighted regions are candidate links proposed by ai& to guide your reading. They are not evidence.','強調された領域は、読む手がかりとして ai& が提案した対応の候補です。証拠ではありません。'],
 noRegion:['Image observations do not establish the photograph’s location or date.','画像の観察は、写真の場所や日付を確定しません。'],
 scope:['Conclusions apply only to the registered evidence. Select any explanation to inspect its sources.','結論は登録された証拠の範囲に限られます。説明を選ぶと出典を確認できます。'],
 changed:['What changed','変わったこと'],stillUnresolved:['Still unresolved. More evidence is needed.','未解決のままです。さらに証拠が必要です。'],seeWhy:['See why','理由を見る'],
 checked:['Independent check','独立検証'],rejected:['Template wording: model text was rejected by the independent check','定型文：モデルの文は独立検証で却下されました'],
 updating:['Updating with new evidence. Showing the last verified revision until verification finishes.','新しい証拠で更新中です。検証が終わるまで、直前に検証済みの版を表示しています。'],
};
const stanceNames:Record<string,[string,string]>={supports:['supports','支持'],contradicts:['contradicts','反証'],context_only:['context only','文脈のみ']};
const eventLabels:Record<string,string>={'tool.started':'Working with ai&','tool.completed':'Model step completed','analysis.started':'Untangling the images and words','observations.ready':'Image observations ready','claims.ready':'Claims extracted from your text','claims.linked':'Claims linked to image candidates','evidence.retrieved':'Checking the registered sources','claim.assessed':'Claim checked against evidence','explanation.updated':'Explanation updated','analysis.completed':'Analysis finished','tool.failed':'A step needs attention'};
function Tx({k,inline}:{k:keyof typeof T;inline?:boolean}){return <Bi en={T[k][0]} ja={T[k][1]} inline={inline}/>}
function Logo(){return <a className="logo" href="/" aria-label="TSUMUGI home"><svg viewBox="0 0 32 32" width="30" height="30" fill="none" aria-hidden="true"><path d="M6 2v28M16 2v28M26 2v28M2 6h28M2 16h28M2 26h28" stroke="currentColor" strokeWidth="1.7"/><path d="M6 6l20 20M6 26L26 6" stroke="currentColor" strokeWidth="1"/></svg><span>TSUMUGI</span></a>}
function Badge({status}:{status:Status}){const Icon=status==='confirmed'?Check:status==='contradicted'?AlertCircle:CircleHelp;return <span className={'badge '+status}><Icon size={13}/><Tx k={status} inline/></span>}
function Stale(){return <span className="badge stale"><LoaderCircle size={12} className="spin"/><Tx k="stale" inline/></span>}
function ImageLabel({n}:{n:number}){return <Bi en={`Image ${n}`} ja={`画像${n}`} inline/>}
async function api(path:string,options?:RequestInit){const r=await fetch(path,options);const value=await r.json();if(!r.ok)throw new Error(typeof value.detail==='string'?value.detail:'The request could not be completed. Please check your input.');return value;}

function Timeline({runs,since,running}:{runs:Run[];since?:string;running:boolean}){
 // Gantt of this revision's model calls, from ToolRun started_at and latency.
 const items=runs.filter(r=>r.started_at&&(!since||r.started_at>=since));
 if(!items.length)return null;
 const t0=Math.min(...items.map(r=>Date.parse(r.started_at!)));
 const ends=items.map(r=>Date.parse(r.started_at!)+(r.latency_ms??(running?Date.now()-Date.parse(r.started_at!):0)));
 const total=Math.max(1000,Math.max(...ends)-t0);
 return <div className="timeline">{items.map((r,i)=>{const start=Date.parse(r.started_at!)-t0,len=ends[i]-t0-start;return <div key={r.id} className="timeline-row"><span className="timeline-tool">{r.tool}<small>{shortModel(r.model_id)}</small></span><span className="timeline-track"><span className={'timeline-bar '+r.status} style={{left:`${start/total*100}%`,width:`${Math.max(.8,len/total*100)}%`}}/></span><small className="timeline-time">{(start/1000).toFixed(1)}s +{(len/1000).toFixed(1)}s</small></div>})}<div className="timeline-axis"><span>0s</span><span>{(total/1000).toFixed(1)}s</span></div></div>
}

export default function Page(){
 const [files,setFiles]=useState<{file:File;url:string}[]>([]),[previewIndex,setPreviewIndex]=useState(0),[text,setText]=useState(''),[isExample,setExample]=useState(false),[mode,setMode]=useState<Mode>('both');
 const [analysis,setAnalysis]=useState<Analysis|null>(null),[selected,setSelected]=useState<string|null>(null),[activeAsset,setActiveAsset]=useState(''),[events,setEvents]=useState<Event[]>([]),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false),[sourceForm,setSourceForm]=useState(false),[showChanges,setShowChanges]=useState(true),[tab,setTab]=useState('meaning'),[,setTick]=useState(0),[title,setTitle]=useState(''),[sourceText,setSourceText]=useState(''),[sourceUrl,setSourceUrl]=useState(''),[publisher,setPublisher]=useState(''),[place,setPlace]=useState(''),[timeStart,setTimeStart]=useState(''),[timeEnd,setTimeEnd]=useState('');
 const [graph,setGraph]=useState<Graph|null>(null),[impact,setImpact]=useState<Impact|null>(null);
 const fileInput=useRef<HTMLInputElement>(null),eventSource=useRef<EventSource|null>(null),currentRevision=useRef(0),lastEvent=useRef(0),panel=useRef<HTMLElement>(null),evidenceButton=useRef<HTMLButtonElement>(null),impacts=useRef<Record<string,Impact>>({});
 const running=analysis?.status==='running';
 useEffect(()=>{try{const v=localStorage.getItem('tsumugi-lang');if(v==='en'||v==='ja'||v==='both')setMode(v)}catch{}},[]);
 function chooseMode(v:Mode){setMode(v);try{localStorage.setItem('tsumugi-lang',v)}catch{}}
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>setTick(x=>x+1),500);return()=>clearInterval(timer)},[running]);
 useEffect(()=>()=>{eventSource.current?.close()},[]);
 useEffect(()=>{if(selected)panel.current?.focus({preventScroll:true})},[selected]);
 useEffect(()=>{if(!analysis||!analysis.display_revision)return;let live=true;api(`/api/analyses/${analysis.id}/graph?revision=${analysis.display_revision}`).then(g=>{if(live)setGraph(g)}).catch(()=>{});return()=>{live=false}},[analysis?.id,analysis?.display_revision]);
 function subscribe(id:string,revision:number){
  eventSource.current?.close();currentRevision.current=revision;
  const es=new EventSource(`/api/analyses/${id}/events?after=${lastEvent.current}`);eventSource.current=es;
  es.onmessage=async message=>{
   const event:Event=JSON.parse(message.data);if(event.event_id<=lastEvent.current)return;lastEvent.current=event.event_id;
   if(event.revision<currentRevision.current)return;
   setEvents(items=>[...items,event]);
   try{const result:Analysis=await api(`/api/analyses/${id}`);if(result.revision>=currentRevision.current){setAnalysis(result);currentRevision.current=result.revision;}}
   catch(e){setError((e as Error).message)}
   if(event.type==='analysis.completed')es.close();
  };
  es.onerror=async()=>{try{const result:Analysis=await api(`/api/analyses/${id}`);if(result.revision>=currentRevision.current)setAnalysis(result);if(result.status!=='running')es.close();}catch{setError('Connection interrupted. Your saved results will remain available.')}};
 }
 function addFiles(list:File[]){
  const ok=list.filter(f=>['image/jpeg','image/png'].includes(f.type)&&f.size<=10*1024*1024);
  if(ok.length<list.length)setError('Choose JPEG or PNG images up to 10 MB each.');else setError('');
  if(isExample){files.forEach(f=>URL.revokeObjectURL(f.url))}
  const base=isExample?[]:files;const room=4-base.length;
  if(ok.length>room)setError('Up to 4 images per analysis.');
  const next=[...base,...ok.slice(0,Math.max(0,room)).map(file=>({file,url:URL.createObjectURL(file)}))];
  setFiles(next);setPreviewIndex(Math.max(0,next.length-1));setExample(false);
 }
 function removeFile(i:number){URL.revokeObjectURL(files[i].url);const next=files.filter((_,j)=>j!==i);setFiles(next);setPreviewIndex(p=>Math.min(p,Math.max(0,next.length-1)));if(!next.length)setExample(false)}
 async function useExample(){setError('');try{const blobs=await Promise.all(sampleImages.map(async u=>(await fetch(u)).blob()));files.forEach(f=>URL.revokeObjectURL(f.url));setFiles(blobs.map((b,i)=>{const file=new File([b],`example-${i+1}.jpg`,{type:'image/jpeg'});return {file,url:URL.createObjectURL(file)}}));setPreviewIndex(0);setText(sampleText);setExample(true)}catch{setError('The example images could not be loaded.')}}
 async function start(e:FormEvent){e.preventDefault();if(!files.length)return;setSubmitting(true);setError('');try{const form=new FormData();files.forEach(f=>form.append('images',f.file));form.append('text',text);form.append('locale','en');const result=await api('/api/analyses',{method:'POST',body:form});lastEvent.current=0;setEvents([]);setGraph(null);impacts.current={};const a:Analysis=await api(`/api/analyses/${result.analysis_id}`);setAnalysis(a);setActiveAsset(a.assets[0]?.id||'');subscribe(result.analysis_id,result.revision);}catch(e){setError((e as Error).message)}finally{setSubmitting(false)}}
 function reset(){eventSource.current?.close();setAnalysis(null);setSelected(null);setEvents([]);setError('');setSourceForm(false);setGraph(null);setImpact(null);lastEvent.current=0;}
 const selectedExplanation=analysis?.explanations.find(e=>e.id===selected);
 const selectedClaim=analysis?.claims.find(c=>c.id===selected||selectedExplanation?.claim_ids.includes(c.id));
 const assessment=analysis?.assessments.find(a=>a.claim_id===selectedClaim?.id);
 const observation=analysis?.observations.find(o=>o.id===selected||selectedExplanation?.support_ids.some(s=>s.id===o.id));
 // Selecting an observation on another image switches the large view to that image.
 useEffect(()=>{if(observation)setActiveAsset(observation.asset_id)},[observation?.id]);
 const linked=new Set(selectedClaim?.observation_ids||[]);
 const stale=new Set(running?analysis?.stale_claim_ids||[]:[]);
 const impacted=new Set(impact?.claim_ids||[]);
 function closePanel(){setSelected(null);evidenceButton.current?.focus()}
 async function mutate(path:string,body:unknown,method='POST'){
  if(!analysis)return;setSubmitting(true);setError('');setImpact(null);try{const result=await api(`/api/analyses/${analysis.id}/${path}`,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});setAnalysis(await api(`/api/analyses/${analysis.id}`));setSourceForm(false);setSelected(null);setTab(t=>t==='graph'?t:'meaning');setShowChanges(true);subscribe(analysis.id,result.revision);}catch(e){setError((e as Error).message)}finally{setSubmitting(false)}
 }
 async function showImpact(sid:string){
  if(!analysis)return;const key=`${sid}:${analysis.display_revision}`;
  try{impacts.current[key]??=await api(`/api/analyses/${analysis.id}/sources/${sid}/impact`);setImpact(impacts.current[key])}catch{}
 }
 function pickNode(n:GNode){
  if(!analysis)return;
  if(n.label==='Asset'){setActiveAsset(n.id);return}
  if(n.label==='Source'){setSelected('sources');setSourceForm(false);return}
  const claimOf=(id:string)=>analysis.assessments.find(a=>a.id===id||a.passages.some(p=>p.id===id))?.claim_id;
  const target=n.label==='Region'?n.id.replace('region-',''):n.label==='Assessment'||n.label==='Passage'?claimOf(n.id):n.id;
  if(target){setSourceForm(false);setSelected(target)}
 }
 const focusNode=observation&&!selectedClaim?observation.id:selectedExplanation?.id||selectedClaim?.id||null;
 async function addSource(e:FormEvent){e.preventDefault();await mutate('sources',{title,text:sourceText,url_optional:sourceUrl||null,publisher,place:place||null,time_start:timeStart||null,time_end:timeEnd||null,expected_revision:analysis?.revision});}
 function fillSource(){setTitle(exampleSource.title);setSourceText(exampleSource.text);setSourceUrl(exampleSource.url);setPublisher(exampleSource.publisher);setPlace(exampleSource.place);setTimeStart('');setTimeEnd('')}
 const elapsed=analysis?Math.max(0,Math.round((Date.now()-new Date(analysis.started_at||analysis.created_at).getTime())/1000)):0;
 const results=analysis?.explanations||[];
 const asset=analysis?.assets.find(a=>a.id===activeAsset)||analysis?.assets[0];
 const preview=files[previewIndex]?.url;
 const viewTab=tab==='original'?'meaning':tab;
 return <Lang.Provider value={mode}><div className="app-shell">
  <header className="header"><Logo/><span className="header-note">WEAVING CONTEXT, BEYOND TRANSLATION</span><div className="header-right"><div className="lang-switch" role="group" aria-label="Display language">{([['en','EN'],['ja','日本語'],['both','Both']] as [Mode,string][]).map(([v,l])=><button key={v} className={mode===v?'active':''} aria-pressed={mode===v} onClick={()=>chooseMode(v)}>{l}</button>)}</div><span className="aiand">with <b>ai&</b></span></div></header>
  {!analysis?<main className="landing">
   <div className="hero-top"><div className="overline"><span className="tiny-line"/> LOOK CLOSER. UNDERSTAND MORE.</div><span className="issue">FIELD NOTES / 001</span></div>
   <div className="hero-title"><h1>There’s more<br/>to the <em>picture.</em></h1><div className="hero-description"><span className="japanese" aria-hidden="true">紡ぐ</span><p><Bi en={<>A photograph tells part of a story.<br/>Uncover the context, follow the evidence,<br/>and leave room for what’s still unknown.</>} ja="写真が語るのは物語の一部です。文脈を掘り起こし、根拠をたどり、まだ分からないことには余白を残します。"/></p></div></div>
   <form onSubmit={start} className="capture-grid">
    <section className="image-capture"><div className="section-label"><span>01 / THE IMAGES</span><span>JPEG, PNG · UP TO 4 · 10 MB EACH</span></div><div className={'upload-area '+(preview?'has-image':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)addFiles(Array.from(e.dataTransfer.files))}}>
     <img src={preview||sampleImages[0]} alt={preview?`Image ${previewIndex+1} selected for analysis`:'Lanterns on a Gion Matsuri float in Kyoto'} className={'capture-photo'+(preview?' contain':'')}/>
     {!preview&&<div className="photo-shade"/>}
     <div className="image-corner">{!preview||isExample?<>KYOTO, JAPAN <span>祇園祭</span></>:<>YOUR PHOTOGRAPHS <span>観察</span></>}</div>
     {preview?(files.length<4&&<button type="button" className="change-image" onClick={()=>fileInput.current?.click()}><Plus size={15}/> <Bi en="Add image" ja="画像を追加" inline/></button>):<div className="upload-prompt"><div className="upload-icon"><Plus size={24}/></div><h2>Start with photographs</h2><p><Bi en="Drop up to four images here, or explore our example." ja="画像を4枚までドロップするか、例を試してください。"/></p><button type="button" className="button light" onClick={()=>fileInput.current?.click()}><Upload size={16}/> Choose images</button></div>}
    </div><input ref={fileInput} className="sr-only" type="file" multiple accept="image/jpeg,image/png" aria-label="Upload photographs" onChange={e=>{if(e.target.files?.length)addFiles(Array.from(e.target.files));e.target.value=''}}/>
    {files.length>0&&<div className="thumbs">{files.map((f,i)=><div key={f.url} className={'thumb '+(i===previewIndex?'active':'')}><button type="button" onClick={()=>setPreviewIndex(i)} aria-label={`Preview image ${i+1}`}><img src={f.url} alt=""/></button><span><ImageLabel n={i+1}/></span><button type="button" className="thumb-remove" onClick={()=>removeFile(i)} aria-label={`Remove image ${i+1}`}><X size={13}/></button></div>)}</div>}
    {(!preview||isExample)&&<div className="photo-credit">{(isExample?credits:credits.slice(0,1)).map((c,i)=><span key={c.source_url}>{isExample&&<>Image {i+1}: </>}Photograph by {c.author} · <a href={c.source_url} target="_blank" rel="noreferrer">Wikimedia Commons</a> · <a href={c.license_url} target="_blank" rel="noreferrer">{c.license}</a></span>)}</div>}
    </section>
    <section className="text-capture"><div className="section-label"><label htmlFor="caption">02 / THE WORDS</label><span>WHAT DOES THE CAPTION CLAIM?</span></div><div className="caption-field"><textarea id="caption" placeholder={'“This festival has been celebrated the same way for centuries…”'} maxLength={5000} value={text} onChange={e=>setText(e.target.value)} required/><div className="caption-footer"><span>A caption, a post, or something you’ve heard.</span><span>{text.length.toLocaleString()} / 5,000</span></div></div>
     {isExample&&<p className="sample-note"><CircleHelp size={15}/> <Bi en="Synthetic caption for a verification demo. Photo credits are not included as evidence." ja="検証デモ用の合成キャプションです。写真のクレジットは証拠として使いません。"/></p>}
     <div className="capture-actions"><button type="submit" className="button primary" disabled={!files.length||!text.trim()||submitting}>{submitting?<LoaderCircle className="spin" size={18}/>:null}Explore the context <ArrowRight size={18}/></button><button type="button" className="text-button" onClick={useExample}>Try an example <ArrowUpRight size={16}/></button></div>
     <p className="privacy"><Bi en="Your images and text are sent to ai& for analysis. Evidence stays visible, and uncertainty stays honest." ja="画像と文章は解析のため ai& に送信されます。根拠は見える形で示し、不確かさは不確かなまま伝えます。"/></p>
     <div className="three-promises"><span><Eye size={17}/> See what’s there</span><span><BookOpen size={17}/> Find the context</span><span><CircleHelp size={17}/> Know the limits</span></div>
    </section>
   </form>
   {error&&<div className="error" role="alert"><AlertCircle size={18}/>{error}</div>}
   <div className="landing-bottom"><span>FROM IMAGE TO UNDERSTANDING</span><p>Not every detail has an answer.<br/><em>Every explanation should have a reason.</em></p><span className="weave-caption">観察 → 文脈 → 理解</span></div>
  </main>:<main className={'workspace '+(selected?'panel-open ':'')+(viewTab==='graph'?'view-graph':'')}>
   <div className="workspace-heading"><div><button className="back-link" onClick={reset} disabled={running}><ChevronLeft size={14}/> New analysis</button><h1><Bi en={<>A closer look<span className="dot">.</span></>} ja="もう少し、よく見る。"/></h1></div><div className="workspace-meta"><span className={'live-state '+(running?'is-running':'')}><span/>{running?'Weaving context':analysis.status==='failed'?'Needs attention':analysis.status==='partial'?'Ready with limitations':'Ready to explore'}</span><span className="revision">REVISION {analysis.revision.toString().padStart(2,'0')}</span><button className="button outline small" ref={evidenceButton} onClick={()=>{setSelected('sources');setSourceForm(true)}} disabled={running}><Plus size={15}/> Add evidence</button></div></div>
   <nav className="mobile-tabs" aria-label="Result views">{(['original','meaning','graph'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}><Tx k={t} inline/></button>)}</nav>
   {error&&<div className="error" role="alert">{error}</div>}
   {analysis.error&&<div className="error" role="alert"><AlertCircle size={18}/><span>{analysis.error} {analysis.display_revision>0&&`Showing verified revision ${analysis.display_revision}.`}</span><button className="text-button" disabled={submitting} onClick={()=>mutate('retry',{expected_revision:analysis.revision})}><RefreshCw size={14}/> Retry</button></div>}
   {running&&analysis.display_revision>0&&<div className="updating" role="status"><LoaderCircle className="spin" size={15}/> <Tx k="updating"/></div>}
   <div className="result-grid">
    <section className={'original-column '+(tab==='original'?'mobile-visible':'')}><div className="section-label"><span>01 / ORIGINAL</span><span>THE STARTING POINT</span></div>
     {asset&&<div className="result-image"><img src={`/api/analyses/${analysis.id}/assets/${asset.id}`} alt={`Image ${asset.index} under analysis`}/>{analysis.observations.filter(o=>o.bbox&&o.asset_id===asset.id).map(o=><button key={o.id} className={'region '+(observation?.id===o.id?'chosen ':'')+(linked.has(o.id)?'linked':'')} style={{left:`${o.bbox![0]*100}%`,top:`${o.bbox![1]*100}%`,width:`${o.bbox![2]*100}%`,height:`${o.bbox![3]*100}%`}} aria-label={`Inspect: ${o.text}`} onClick={()=>setSelected(o.id)}><span>{obsLabel(o.id)}</span></button>)}<span className="image-tag"><ImageLabel n={asset.index}/></span></div>}
     {analysis.assets.length>1&&<div className="asset-strip">{analysis.assets.map(x=>{const count=analysis.observations.filter(o=>o.asset_id===x.id&&linked.has(o.id)).length;return <button key={x.id} className={x.id===asset?.id?'active':''} onClick={()=>setActiveAsset(x.id)} aria-label={`Show image ${x.index}`}><img src={`/api/analyses/${analysis.id}/assets/${x.id}`} alt=""/><span><ImageLabel n={x.index}/></span>{count>0&&<b className="link-count" title="Candidate regions linked to the selected claim">{count}</b>}</button>})}</div>}
     {isExample&&asset&&credits[asset.index-1]&&<p className="photo-credit">{credits[asset.index-1].author} · <a href={credits[asset.index-1].source_url} target="_blank" rel="noreferrer">Source</a> · <a href={credits[asset.index-1].license_url} target="_blank" rel="noreferrer">{credits[asset.index-1].license}</a></p>}
     <div className="original-caption"><div className="section-label"><span><Tx k="originalWords" inline/></span><span>{analysis.claims.length} CLAIMS</span></div><p>“{selectedClaim?<>{Array.from(analysis.text).slice(0,selectedClaim.input_start).join('')}<mark>{Array.from(analysis.text).slice(selectedClaim.input_start,selectedClaim.input_end).join('')}</mark>{Array.from(analysis.text).slice(selectedClaim.input_end).join('')}</>:analysis.text}”</p>{isExample&&<span className="synthetic-label">SYNTHETIC DEMO CAPTION</span>}<div className="claim-list">{analysis.claims.map((c,i)=><button key={c.id} className={(selectedClaim?.id===c.id?'selected ':'')+(impacted.has(c.id)?'impacted':'')} onClick={()=>setSelected(c.id)}><span>{String(i+1).padStart(2,'0')}</span><span className="claim-text"><Bi en={c.text} ja={c.text_ja}/>{stale.has(c.id)&&<Stale/>}</span><ArrowUpRight size={14}/></button>)}</div></div>
     <p className="region-note"><Tx k={selectedClaim&&linked.size?'linkNote':analysis.observations.some(o=>o.bbox)?'regionNote':'noRegion'}/></p>
    </section>
    <section className={'meaning-column '+(tab!=='original'?'mobile-visible':'')}><div className="section-label view-switch"><span>02 / {viewTab==='graph'?'GRAPH':'MEANING'}</span><span className="segmented" role="group" aria-label="Center view">{(['meaning','graph'] as const).map(v=><button key={v} className={viewTab===v?'active':''} aria-pressed={viewTab===v} onClick={()=>setTab(v)}>{v==='graph'&&<Network size={12}/>}<Tx k={v} inline/></button>)}</span></div>
     {viewTab==='graph'?<GraphView analysis={analysis} graph={graph} running={running} focus={focusNode} impact={impact} compact={!!selected} busy={submitting} onPick={pickNode} onImpact={sid=>sid?showImpact(sid):setImpact(null)} onToggleSource={(sid,active)=>mutate(`sources/${sid}`,{active,expected_revision:analysis.revision},'PATCH')}/>:<>
     {analysis.changes.length>0&&<div className="changes"><button className="changes-heading" onClick={()=>setShowChanges(!showChanges)}><span><History size={17}/> <Tx k="changed" inline/> <b>{analysis.changes.filter(c=>c.changed).length}</b></span><ChevronDown size={17} style={{transform:showChanges?'rotate(180deg)':''}}/></button>{showChanges&&<div className="changes-body">{analysis.changes.map(c=><div key={c.claim_id} className="change-item"><div className="change-status"><Badge status={c.from_status}/><ArrowRight size={13}/><Badge status={c.to_status}/></div>{c.changed?<><p className="before"><Minus size={13}/><Bi en={c.before} ja={c.before_ja}/></p><p className="after"><Plus size={13}/><Bi en={c.after} ja={c.after_ja}/></p></>:<p><Tx k="stillUnresolved"/></p>}<button className="text-button" onClick={()=>setSelected(c.claim_id)}><Tx k="seeWhy" inline/> <ArrowUpRight size={14}/></button></div>)}</div>}</div>}
     {(['see','context','unknown'] as const).map((section,index)=><div className={'meaning-section '+section} key={section}><div className="meaning-title"><span>{String(index+1).padStart(2,'0')}</span><h2><Tx k={section}/></h2>{section==='see'?<Eye size={18}/>:section==='context'?<BookOpen size={18}/>:<CircleHelp size={18}/>}</div><div className="explanation-list">{(section==='see'&&running&&!results.some(e=>e.section==='see')?analysis.observations.map(o=>({id:o.id,section:'see',text:o.text,text_ja:o.text_ja,claim_ids:[],support_ids:[{id:o.id,type:'Observation',revision:analysis.revision}]} as Explanation)):results.filter(e=>e.section===section)).map(e=>{const a=analysis.assessments.find(a=>e.claim_ids.includes(a.claim_id));const o=analysis.observations.find(o=>e.support_ids.some(s=>s.id===o.id));return <button className={'explanation '+(selected===e.id?'selected ':'')+(e.claim_ids.some(c=>impacted.has(c))?'impacted':'')} key={e.id} onClick={()=>setSelected(e.id)}><span className="explanation-badges">{a?<Badge status={a.status}/>:<span className="observation-label"><Tx k="visual" inline/>{o&&<> · <ImageLabel n={Number(o.id.split('-')[1])}/> · {obsLabel(o.id)}</>}</span>}{e.claim_ids.some(c=>stale.has(c))&&<Stale/>}</span><p><Bi en={e.text} ja={e.text_ja}/></p><span className="explanation-link">{section==='see'?<Tx k="locate" inline/>:<Tx k="follow" inline/>} <ArrowUpRight size={14}/>{e.check&&<span className={'check-note '+e.check.verdict}><ShieldCheck size={12}/>{e.check.verdict==='accepted'?<><Tx k="checked" inline/> · {shortModel(e.check.model_id)}</>:<Tx k="rejected" inline/>}</span>}</span></button>})}{!results.some(e=>e.section===section)&&!(section==='see'&&analysis.observations.length)&&(running?<div className="pending"><span className="skeleton"/><span className="skeleton short"/><p>{section==='see'?'Looking at the images…':section==='context'?'Connecting claims and sources…':'Checking what remains uncertain…'}</p></div>:<p className="empty-section">{section==='context'?'Add a source to explore the cultural context.':section==='unknown'?'No unresolved claims in the current evidence scope.':'No image observations available.'}</p>)}</div></div>)}
     </>}
     {analysis.limitations.map(l=>{const v=typeof l==='string'?{text:l}:l;return <p key={v.text} className="limitation"><CircleHelp size={15}/><Bi en={v.text} ja={v.text_ja}/></p>})}
     <p className="scope-note"><Tx k="scope"/></p>
    </section>
    {selected&&<aside className="evidence-panel" ref={panel} tabIndex={-1} aria-label="Evidence details" onKeyDown={e=>{if(e.key==='Escape')closePanel();if(e.key==='Tab'&&window.innerWidth<=1150){const els=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,a[href]');if(els?.length){const first=els[0],last=els[els.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}}}><div className="panel-top"><span>03 / EVIDENCE</span><button className="icon-button" onClick={closePanel} aria-label="Close evidence panel"><X size={20}/></button></div>
     {sourceForm?<form className="source-form" onSubmit={addSource}><span className="overline">ANOTHER THREAD TO FOLLOW</span><h2>Add evidence.</h2><p>Give this explanation something to stand on.</p><button type="button" className="example-source" onClick={fillSource}><BookOpen size={17}/><span>Use the Kyoto tourism excerpt<small>Official source · retrieved {exampleSource.retrieved_at}</small></span><Plus size={16}/></button><label>Source title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Exact source text<textarea required maxLength={12000} rows={5} value={sourceText} onChange={e=>setSourceText(e.target.value)}/></label><label>Source URL<input type="url" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)}/></label><label>Publisher<input value={publisher} onChange={e=>setPublisher(e.target.value)}/></label><label>Place, if specified<input value={place} onChange={e=>setPlace(e.target.value)} placeholder="Leave empty if unknown"/></label><div className="time-fields"><label>From<input value={timeStart} onChange={e=>setTimeStart(e.target.value)} placeholder="Year or date"/></label><label>To<input value={timeEnd} onChange={e=>setTimeEnd(e.target.value)} placeholder="Year or date"/></label></div><p className="form-note">Registered as user-provided evidence. A source does not automatically establish a claim. URLs are references; their content is not fetched.</p><button className="button primary" disabled={submitting||running}>{submitting?<LoaderCircle size={16} className="spin"/>:<Plus size={16}/>} Add & re-evaluate</button><button className="text-button" type="button" onClick={()=>setSourceForm(false)}>Cancel</button></form>:<>
      <span className="overline">THE REASON BEHIND THE WORDS</span><h2><Tx k={observation&&!selectedClaim?'lookClosely':selectedClaim?'followEvidence':'yourSources'}/></h2>
      {observation&&!selectedClaim&&<><div className="observation-icon"><Eye size={26}/> <span className="small-label"><ImageLabel n={Number(observation.id.split('-')[1])}/> · {obsLabel(observation.id)}</span></div><p><Bi en={observation.text} ja={observation.text_ja}/></p><div className="evidence-note"><Tx k="obsNote"/></div></>}
      {selectedClaim&&<div className="selected-claim"><span className="small-label"><Tx k="selectedClaim" inline/></span><p><Bi en={selectedClaim.text} ja={selectedClaim.text_ja}/></p>{assessment&&<Badge status={assessment.status}/>}{stale.has(selectedClaim.id)&&<Stale/>}{!!selectedClaim.observation_ids?.length&&<p className="linked-note"><Bi en={`Candidate image regions: ${selectedClaim.observation_ids.map(obsLabel).join(', ')}`} ja={`候補の画像領域：${selectedClaim.observation_ids.map(obsLabel).join('、')}`}/></p>}</div>}
      {assessment&&<><div className="reason"><h3><Tx k="why" inline/></h3><p><Bi en={assessment.reason} ja={assessment.reason_ja}/></p>{assessment.missing&&<div className="missing"><CircleHelp size={16}/><div><strong><Tx k="help" inline/></strong><p><Bi en={assessment.missing} ja={assessment.missing_ja}/></p></div></div>}</div>{assessment.passages.map(p=>{const s=analysis.sources.find(s=>s.id===p.source_id);return <div className="citation" key={p.id}><div className="citation-head"><BookOpen size={15}/><span>{p.scope_match?<Bi en={stanceNames[p.stance]?.[0]||p.stance} ja={stanceNames[p.stance]?.[1]} inline/>:<Bi en="different or unclear scope" ja="条件が異なる・不明" inline/>}</span></div><blockquote lang="en">“{p.quote}”</blockquote>{p.quote_ja&&mode!=='en'&&<div className="quote-ja"><span className="small-label"><Tx k="refTranslation" inline/></span><p lang="ja">{p.quote_ja}</p></div>}<p>{s?.publisher}</p><a href={s?.url_optional} target="_blank" rel="noreferrer">{s?.title}<ExternalLink size={13}/></a><dl><dt>Place</dt><dd>{s?.place||'Not specified'}</dd><dt>Time</dt><dd>{s?.time_start||'No specific year'}</dd><dt>Retrieved</dt><dd>{s?.retrieved_at?.slice(0,10)}</dd></dl></div>})}{!assessment.passages.length&&<div className="no-evidence"><BookOpen size={22}/><p><Tx k="noEvidence"/></p><span><Tx k="addSourceHint"/></span></div>}</>}
      <button className="button primary" disabled={running} onClick={()=>setSourceForm(true)}><Plus size={16}/> Add evidence</button>
      <div className="registered-sources"><h3>Registered sources <span>{analysis.sources.length}</span></h3>{analysis.sources.map(s=><div key={s.id} className={'source-row '+(!s.active?'inactive':'')}><p>{s.title}<small>{s.origin==='user'?'User-provided':'Registered'} · {s.active?'Active':'Disabled'}{s.active&&impact?.source_id===s.id&&<> · <Bi en={`affects ${impact.claim_ids.length} claim(s)`} ja={`影響：主張${impact.claim_ids.length}件`} inline/></>}</small></p><button className="text-button" disabled={running||submitting} onMouseEnter={()=>s.active&&showImpact(s.id)} onFocus={()=>s.active&&showImpact(s.id)} onMouseLeave={()=>setImpact(null)} onBlur={()=>setImpact(null)} onClick={()=>mutate(`sources/${s.id}`,{active:!s.active,expected_revision:analysis.revision},'PATCH')}>{s.active?'Disable':'Enable'}</button></div>)}</div>
     </>}
    </aside>}
   </div>
   <details className="activity" open><summary><span><span className={'activity-dot '+(running?'working':'')}/>{running&&(!events.length||events.at(-1)?.type==='analysis.completed')?'Starting analysis':(events.at(-1)?.payload.tool?String(events.at(-1)?.payload.tool):eventLabels[events.at(-1)?.type||''])||'Activity'}</span><span>{running?`${elapsed}s elapsed`:`${analysis.runs.length} model calls`}<ChevronDown size={14}/></span></summary><div className="activity-body"><Timeline runs={analysis.runs} since={analysis.started_at} running={running}/><details className="activity-log"><summary>Event log · {events.length}</summary>{events.map(e=><div key={e.event_id}><time>{new Date(e.timestamp).toLocaleTimeString()}</time><span>{e.payload.tool?`${String(e.payload.tool)} · ${e.type.split('.')[1]}`:eventLabels[e.type]||e.type}</span><small>rev {e.revision}</small></div>)}</details></div></details>
  </main>}
  <footer className="footer"><span>TSUMUGI <span className="footer-dot">·</span> A LITTLE MORE UNDERSTANDING.</span><span>BUILT WITH ai& <span className="footer-dot">/</span> TOKYO, 2026</span></footer>
 </div></Lang.Provider>
}
