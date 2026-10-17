import asyncio, copy, hashlib, io, json, os, uuid
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional, List
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1]/'.env')
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from PIL import Image, ImageOps, UnidentifiedImageError
ORIENTATION=0x0112
from . import store, graph, llm, segment, culture
from .pipeline import process

lock=asyncio.Lock();tasks=set()
@asynccontextmanager
async def lifespan(app):
 store.init()
 with store.db() as c:rows=c.execute('SELECT data FROM analyses').fetchall()
 for row in rows:
  a=json.loads(row[0])
  if a['status']=='running':
   a['status']='failed';a['error']='Analysis interrupted by a server restart. Retry to continue.';store.save(a);store.event(a,'analysis.completed',{'status':'failed'})
 try:await asyncio.to_thread(graph.ensure_schema)
 except Exception:pass
 await graph.replay()
 yield
 for t in tasks:t.cancel()
 graph.close()
app=FastAPI(title='TSUMUGI',lifespan=lifespan)
def find(aid):
 a=store.get(aid)
 if not a:raise HTTPException(404,'Analysis not found')
 return a
def response(a):return {'analysis_id':a['id'],'revision':a['revision'],'events_url':f"/api/analyses/{a['id']}/events"}
async def run(a):
 try:
  async with lock:
   await asyncio.wait_for(process(a),75)
 except Exception as e:
  # Preserve the prior verified view on any failed update.
  if a.get('previous'):
   for k in ['observations','claims','assessments','explanations']:a[k]=a['previous'][k]
  else:a['assessments']=[];a['explanations']=[]
  a['status']='failed';a['stale_claim_ids']=[];a['error']=str(e) if isinstance(e,ValueError) else 'Processing could not finish. Check model/database connectivity and retry.'
  store.save(a);store.event(a,'tool.failed',{'message':a['error']});store.event(a,'analysis.completed',{'status':'failed'})
def launch(a):
 store.save(a);store.event(a,'analysis.started')
 t=asyncio.create_task(run(a));tasks.add(t);t.add_done_callback(tasks.discard)
def busy():
 if any(not t.done() for t in tasks):raise HTTPException(503,'One analysis is already running. Please wait.')
@app.get('/api/health')
def health():return {'status':'ready','model':os.getenv('AIAND_MODEL'),'vision_model':os.getenv('AIAND_VISION_MODEL'),'check_model':llm.check_model(),'culture_model':culture.writer(),'review_models':culture.reviewers(),'configured':bool(os.getenv('AIAND_API_KEY')),'segmentation':segment.MODEL if segment.enabled() else None}
def check_image(raw):
 if len(raw)>10*1024*1024:raise HTTPException(413,'Each image must be 10 MB or less.')
 try:
  pic=Image.open(io.BytesIO(raw))
  if pic.format not in ['PNG','JPEG']:raise HTTPException(415,'Use JPEG or PNG images.')
  if pic.width*pic.height>25_000_000:raise HTTPException(413,'Image dimensions are too large.')
  pic.verify()
 except (UnidentifiedImageError,OSError,Image.DecompressionBombError):raise HTTPException(415,'Invalid image. Use JPEG or PNG.')
 return pic
def upright_image(raw,fmt):
 pic=Image.open(io.BytesIO(raw))
 if pic.getexif().get(ORIENTATION,1)==1:return raw,pic
 pic=ImageOps.exif_transpose(pic);out=io.BytesIO()
 if fmt=='PNG':pic.save(out,'PNG')
 else:pic.convert('RGB').save(out,'JPEG',quality=95)
 return out.getvalue(),pic
@app.post('/api/analyses',status_code=202)
async def create(images:List[UploadFile]=File(...),text:str=Form(...),locale:str=Form('en')):
 busy()
 if not text.strip() or len(text)>5000 or locale not in ['en','ja']:raise HTTPException(422,'Enter 1–5,000 characters; locale must be en or ja.')
 if not 1<=len(images)<=4:raise HTTPException(422,'Upload 1–4 images.')
 raws=[await image.read(10*1024*1024+1) for image in images]
 pics=[check_image(raw) for raw in raws]
 busy()
 aid=str(uuid.uuid4());assets=[]
 for index,(raw,pic) in enumerate(zip(raws,pics),1):
  asset=f"{aid}-{index}"+('.png' if pic.format=='PNG' else '.jpg')
  # Camera photos often store pixels sideways with an EXIF orientation that browsers apply but models do not.
  # Store them upright so the page, the VLM boxes and the SAM3 masks all share one set of pixels.
  stored,upright=upright_image(raw,pic.format)
  (store.DATA/asset).write_bytes(stored)
  # Re-encode to strip metadata and cap external-model payload size.
  model=upright.convert('RGB');size=model.size;model.thumbnail((1600,1600));model.save(store.DATA/f"{aid}-{index}-model.jpg",'JPEG',quality=90)
  assets.append(dict(id=asset,index=index,mime_type='image/png' if pic.format=='PNG' else 'image/jpeg',width=size[0],height=size[1]))
 digest=hashlib.sha256()
 for raw in raws:digest.update(hashlib.sha256(raw).digest())
 digest.update(text.encode())
 a=dict(id=aid,revision=1,display_revision=0,status='running',text=text,locale=locale,assets=assets,input_hash=digest.hexdigest(),created_at=store.now(),started_at=store.now(),updated_at=store.now(),observations=[],claims=[],assessments=[],explanations=[],sources=[],runs=[],limitations=[],changes=[],stale_claim_ids=[],previous=None,error=None)
 launch(a);return response(a)
@app.get('/api/analyses/{aid}')
def retrieve(aid:str,revision:Optional[int]=None):
 a=find(aid)
 if revision is not None:
  a=store.get_snapshot(aid,revision)
  if not a:raise HTTPException(404,'Revision not found')
 return a
@app.get('/api/analyses/{aid}/assets/{asset}')
def asset(aid:str,asset:str):
 a=find(aid)
 # Only files registered to this analysis are served, never arbitrary paths.
 match=next((x for x in a.get('assets',[]) if x['id']==asset),None)
 if not match:raise HTTPException(404,'Asset not found')
 return FileResponse(store.DATA/match['id'],media_type=match['mime_type'])
@app.get('/api/analyses/{aid}/masks/{observation}')
def mask(aid:str,observation:str):
 a=find(aid)
 # Same rule as assets: only masks recorded on this analysis's observations.
 match=next((o for o in a.get('observations',[]) if o['id']==observation and o.get('mask')),None)
 path=store.DATA/segment.mask_name(a,match['id']) if match else None
 if not path or not path.is_file():raise HTTPException(404,'Mask not found')
 return FileResponse(path,media_type='image/png')
@app.get('/api/analyses/{aid}/graph')
async def read_graph(aid:str,revision:Optional[int]=None):
 a=find(aid);rev=a['display_revision'] if revision is None else revision
 snap=store.get_snapshot(aid,rev)
 if not snap:raise HTTPException(404,'No completed revision to show')
 try:result=await asyncio.to_thread(graph.read,aid,rev);result['stored']='neo4j'
 except Exception:result=graph.shape(graph.payload(snap));result['stored']='local'
 result.update(revision=rev,node_count=len(result['nodes']),relationship_count=len(result['edges']))
 return result
async def compute_impact(a,sid):
 snap=store.get_snapshot(a['id'],a['display_revision'])
 if not snap:return {'passage_ids':[],'assessment_ids':[],'claim_ids':[],'explanation_ids':[],'stored':'local'}
 try:result=await asyncio.to_thread(graph.impact,snap,sid);result['stored']='neo4j'
 except Exception:result=graph.local_impact(snap,sid);result['stored']='local'
 return result
@app.get('/api/analyses/{aid}/sources/{sid}/impact')
async def source_impact(aid:str,sid:str):
 a=find(aid)
 if not any(s['id']==sid for s in a['sources']):raise HTTPException(404,'Source not found')
 return {'source_id':sid,'revision':a['display_revision'],**await compute_impact(a,sid)}
@app.get('/api/analyses/{aid}/events')
async def events(aid:str,request:Request,last_event_id:Optional[str]=Header(None),after:int=0):
 find(aid)
 try:cursor=max(0,int(last_event_id or after))
 except ValueError:raise HTTPException(422,'Invalid event ID')
 async def stream():
  nonlocal cursor
  while not await request.is_disconnected():
   for e in store.events(aid,cursor):
    cursor=e['event_id'];yield f"id: {cursor}\ndata: {json.dumps(e)}\n\n"
   a=find(aid)
   if a['status']!='running':return
   yield ': heartbeat\n\n';await asyncio.sleep(.4)
 # no-transform stops the Next.js proxy from gzip-buffering the stream until the job ends.
 return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})
class SourceInput(BaseModel):
 title:str=Field(min_length=1,max_length=200)
 text:str=Field(min_length=1,max_length=12000)
 url_optional:Optional[str]=None
 publisher:str=Field(default='',max_length=200)
 place:Optional[str]=None
 time_start:Optional[str]=None
 time_end:Optional[str]=None
 expected_revision:int
 @field_validator('url_optional')
 @classmethod
 def url_check(cls,v):
  if v and not v.startswith(('https://','http://')):raise ValueError('Source URL must use HTTP(S)')
  return v
class SourcePatch(BaseModel):
 active:bool
 expected_revision:int
class RetryInput(BaseModel):expected_revision:int

def prepare(a,expected):
 busy()
 if expected!=a['revision']:raise HTTPException(409,'Revision changed. Reload before editing.')
 previous={k:copy.deepcopy(a[k]) for k in ['observations','claims','assessments','explanations']}
 if a['status']=='failed' and a.get('previous'):previous=a['previous']
 a['started_at']=store.now();a['previous']=previous;a['revision']+=1;a['status']='running';a['error']=None;a['changes']=[];a['reuse_unaffected']=False;a['stale_claim_ids']=[]
 return a
@app.post('/api/analyses/{aid}/sources',status_code=202)
async def add_source(aid:str,body:SourceInput,idempotency_key:str=Header(...)):
 a=find(aid);digest=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
 with store.db() as c:r=c.execute('SELECT request_hash,response FROM idempotency WHERE analysis_id=? AND key=?',(aid,idempotency_key)).fetchone()
 if r:
  if r['request_hash']!=digest:raise HTTPException(409,'Idempotency key already used for another request.')
  return json.loads(r['response'])
 prepare(a,body.expected_revision)
 source=body.model_dump(exclude={'expected_revision'})
 source.update(id=str(uuid.uuid4()),active=True,origin='user',retrieved_at=store.now(),content_hash=hashlib.sha256(body.text.encode()).hexdigest())
 a['sources'].append(source)
 # Persist source, revision, and idempotency record atomically before scheduling.
 result=response(a)
 with store.db() as c:
  c.execute('INSERT OR REPLACE INTO analyses VALUES(?,?)',(aid,json.dumps(a)))
  c.execute('INSERT INTO idempotency VALUES(?,?,?,?)',(aid,idempotency_key,digest,json.dumps(result)))
 launch(a);return result
@app.patch('/api/analyses/{aid}/sources/{sid}',status_code=202)
async def patch_source(aid:str,sid:str,body:SourcePatch):
 a=find(aid)
 source=next((s for s in a['sources'] if s['id']==sid),None)
 if not source:raise HTTPException(404,'Source not found')
 if body.expected_revision!=a['revision']:raise HTTPException(409,'Revision changed. Reload before editing.')
 # Disabling only re-evaluates what cites the source; enabling may affect any claim.
 stale=(await compute_impact(a,sid))['claim_ids'] if not body.active else [c['id'] for c in a['claims']]
 prepare(a,body.expected_revision);source['active']=body.active;a['stale_claim_ids']=stale;a['reuse_unaffected']=not body.active;launch(a);return response(a)
@app.post('/api/analyses/{aid}/retry',status_code=202)
async def retry(aid:str,body:RetryInput):
 a=find(aid);prepare(a,body.expected_revision);launch(a);return response(a)
