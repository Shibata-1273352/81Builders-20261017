import asyncio, copy, hashlib, io, json, os, uuid
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1]/'.env')
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from PIL import Image, UnidentifiedImageError
from . import store, graph
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
 await graph.replay()
 yield
 for t in tasks:t.cancel()
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
  a['status']='failed';a['error']=str(e) if isinstance(e,ValueError) else 'Processing could not finish. Check model/database connectivity and retry.'
  store.save(a);store.event(a,'tool.failed',{'message':a['error']});store.event(a,'analysis.completed',{'status':'failed'})
def launch(a):
 store.save(a);store.event(a,'analysis.started')
 t=asyncio.create_task(run(a));tasks.add(t);t.add_done_callback(tasks.discard)
def busy():
 if any(not t.done() for t in tasks):raise HTTPException(503,'One analysis is already running. Please wait.')
@app.get('/api/health')
def health():return {'status':'ready','model':os.getenv('AIAND_MODEL'),'vision_model':os.getenv('AIAND_VISION_MODEL'),'configured':bool(os.getenv('AIAND_API_KEY'))}
@app.post('/api/analyses',status_code=202)
async def create(image:UploadFile=File(...),text:str=Form(...),locale:str=Form('en')):
 busy()
 if not text.strip() or len(text)>5000 or locale!='en':raise HTTPException(422,'Enter 1–5,000 characters; locale must be en.')
 raw=await image.read(10*1024*1024+1)
 if len(raw)>10*1024*1024:raise HTTPException(413,'Image must be 10 MB or less.')
 try:
  pic=Image.open(io.BytesIO(raw))
  if pic.format not in ['PNG','JPEG']:raise HTTPException(415,'Use a JPEG or PNG image.')
  if pic.width*pic.height>25_000_000:raise HTTPException(413,'Image dimensions are too large.')
  pic.verify()
 except (UnidentifiedImageError,OSError,Image.DecompressionBombError):raise HTTPException(415,'Invalid image. Use JPEG or PNG.')
 busy()
 aid=str(uuid.uuid4());asset=aid+('.png' if pic.format=='PNG' else '.jpg')
 (store.DATA/asset).write_bytes(raw)
 # Re-encode to strip metadata and cap external-model payload size.
 pic=Image.open(io.BytesIO(raw)).convert('RGB');pic.thumbnail((1600,1600));pic.save(store.DATA/(aid+'-model.jpg'),'JPEG',quality=90)
 a=dict(id=aid,revision=1,display_revision=0,status='running',text=text,locale=locale,asset_id=asset,mime_type='image/png' if asset.endswith('.png') else 'image/jpeg',input_hash=hashlib.sha256(raw+text.encode()).hexdigest(),created_at=store.now(),started_at=store.now(),updated_at=store.now(),observations=[],claims=[],assessments=[],explanations=[],sources=[],runs=[],limitations=[],changes=[],previous=None,error=None)
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
 if a['asset_id']!=asset:raise HTTPException(404,'Asset not found')
 return FileResponse(store.DATA/asset,media_type=a['mime_type'])
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
 return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})
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
 a['started_at']=store.now();a['previous']=previous;a['revision']+=1;a['status']='running';a['error']=None;a['changes']=[]
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
 prepare(a,body.expected_revision);source['active']=body.active;launch(a);return response(a)
@app.post('/api/analyses/{aid}/retry',status_code=202)
async def retry(aid:str,body:RetryInput):
 a=find(aid);prepare(a,body.expected_revision);launch(a);return response(a)
