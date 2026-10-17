import os, io, base64, asyncio, time, uuid
import httpx
from PIL import Image
from . import store
from .store import now

MODEL='facebook/sam3'
# Masks are waited for until DEADLINE seconds into the 75 s job, and never longer than CAP seconds.
DEADLINE,CAP=60,25
SEG_FAILED=('Image segmentation was unavailable for image {n}; outlined boxes are shown instead.','画像{n}のセグメンテーションを利用できなかったため、枠のみを表示しています。')
def url():return os.getenv('SAM3_URL','').rstrip('/')
def enabled():return bool(url())
def model_name(a,asset):return f"{a['id']}-{asset['index']}-model.jpg"
def mask_name(a,observation_id):return f"{a['id']}-{observation_id}-mask.png"

async def post(path,body,timeout):
 async with httpx.AsyncClient() as c:
  r=await c.post(url()+path,json=body,timeout=timeout)
  if not r.is_success:raise RuntimeError(f'SAM3 {path} failed (HTTP {r.status_code})')
  return r.json()

def select(instances,bbox,score=.5,inside=.5):
 # A SAM3 instance belongs to an observation when most of its box lies inside the VLM candidate box.
 x,y,w,h=bbox;kept=[]
 for i in instances:
  x0,y0,x1,y1=i['box'];area=max(x1-x0,0)*max(y1-y0,0)
  overlap=max(min(x1,x+w)-max(x0,x),0)*max(min(y1,y+h)-max(y0,y),0)
  if i['score']>=score and area>0 and overlap/area>=inside:kept.append(i)
 return kept

def compose(instances,width,height):
 # Union of the instance masks as an alpha PNG: CSS mask-image paints only the segmented pixels.
 alpha=Image.new('L',(width,height),0)
 for i in instances:
  crop=Image.open(io.BytesIO(base64.b64decode(i['mask']))).convert('L')
  alpha.paste(255,tuple(i['offset']),crop)
 out=Image.new('LA',(width,height),0);out.putalpha(alpha)
 area=sum(alpha.histogram()[1:])/(width*height)
 return out,round(area,4)

class Job:
 """Segments each image's boxed observations with SAM3 while the rest of the analysis runs."""
 def __init__(self,a,limit):
  self.a=a;self.limit=limit;self.started=time.monotonic();self.warm={};self.tasks={}
  self.on=enabled() and not a['claims']
  # Image encoding dominates (about 7 s per image on an M4), so it starts before the VLM has answered.
  if self.on:self.warm={x['id']:asyncio.ensure_future(post('/encode',{'image':model_name(a,x)},40)) for x in a['assets']}
  for t in self.warm.values():t.add_done_callback(lambda t:t.cancelled() or t.exception())
 def observed(self,asset):
  if self.on:self.tasks[asset['id']]=asyncio.ensure_future(self.run(asset))
 async def run(self,asset):
  a=self.a;todo=[o for o in a['observations'] if o['asset_id']==asset['id'] and o['bbox'] and o.get('label')]
  if not todo:return
  tool=f"Image segmentation · {asset['index']}"
  run=dict(id=str(uuid.uuid4()),tool=tool,model_id=MODEL,effort='none',status='running',cached=False,prompt_version='sam3-1',created_at=now(),started_at=now())
  a['runs'].append(run);store.event(a,'tool.started',{'tool':tool});started=time.monotonic()
  try:
   try:await self.warm[asset['id']]
   except Exception:pass  # /segment encodes on its own if warming failed
   raw=await post('/segment',{'image':model_name(a,asset),'labels':[o['label'] for o in todo]},40)
   for o in todo:
    picked=select(raw['results'].get(o['label'],[]),o['bbox'])
    if not picked:continue
    image,area=compose(picked,raw['width'],raw['height'])
    image.save(store.DATA/mask_name(a,o['id']),'PNG')
    o['mask']=dict(score=max(i['score'] for i in picked),instance_count=len(picked),area=area,segmenter=MODEL,run_id=run['id'])
    o['producer']='SAM3 mask from VLM candidate'
   run.update(status='completed',latency_ms=round((time.monotonic()-started)*1000),output_valid=True,encode_ms=raw.get('encode_ms'),decode_ms=raw.get('decode_ms'))
   store.save(a);store.event(a,'tool.completed',{'tool':tool});store.event(a,'regions.segmented',{'asset_id':asset['id']})
  except asyncio.CancelledError:
   run.update(status='failed',latency_ms=round((time.monotonic()-started)*1000),error_code='Timeout');raise
  except Exception as e:
   run.update(status='failed',latency_ms=round((time.monotonic()-started)*1000),output_valid=False,error_code=type(e).__name__)
   store.event(a,'tool.failed',{'tool':tool});self.limit(self.a,SEG_FAILED,'image',n=asset['index'])
 async def finish(self):
  # Masks are optional: wait only while the job deadline allows, then keep boxes for the rest.
  if not self.tasks:return
  budget=min(CAP,max(0,DEADLINE-(time.monotonic()-self.started)))
  _,pending=await asyncio.wait(self.tasks.values(),timeout=budget)
  for t in pending:t.cancel()
  await asyncio.gather(*pending,return_exceptions=True)
  for asset in self.a['assets']:
   if self.tasks.get(asset['id']) in pending:self.limit(self.a,SEG_FAILED,'image',n=asset['index'])
 def cancel(self):
  for t in [*self.warm.values(),*self.tasks.values()]:
   if not t.done():t.cancel()
