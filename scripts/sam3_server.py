"""Local SAM3 segmentation sidecar for the TSUMUGI backend.

Runs in its own Python 3.12 environment (torch + transformers), separate from the backend's .venv:
  $SAM3_PYTHON -I scripts/sam3_server.py --model $SAM3_MODEL_DIR --data .runtime --port 8010
Images are read only from the backend's data directory, by file name; the model and cached image
features stay resident so each text prompt costs a decoder pass, not a new image encoding.
"""
import argparse, base64, io, json, threading, time
from collections import OrderedDict
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import torch
from PIL import Image
from transformers import Sam3Model, Sam3Processor

p=argparse.ArgumentParser()
p.add_argument('--model',required=True);p.add_argument('--data',required=True)
p.add_argument('--port',type=int,default=8010);p.add_argument('--cache',type=int,default=8)
args=p.parse_args()
DATA=Path(args.data).resolve()
DEVICE='mps' if torch.backends.mps.is_available() else 'cuda' if torch.cuda.is_available() else 'cpu'
# One accelerator: requests take turns, so concurrent jobs queue instead of competing for memory.
gpu=threading.Lock();cache=OrderedDict();state={'status':'loading'}
processor=model=None

def image_path(name):
 # Only plain file names inside the backend data directory; never arbitrary paths.
 if not isinstance(name,str) or '/' in name or '\\' in name or name.startswith('.') or not name.endswith('-model.jpg'):raise ValueError('invalid image name')
 path=DATA/name
 if not path.is_file():raise FileNotFoundError(name)
 return path

def encode(name):
 path=image_path(name);key=(name,path.stat().st_mtime_ns)
 if key in cache:cache.move_to_end(key);return cache[key],0
 started=time.monotonic()
 image=Image.open(path).convert('RGB')
 pix=processor(images=image,return_tensors='pt').to(DEVICE)
 with torch.inference_mode():vision=model.get_vision_features(pixel_values=pix.pixel_values)
 cache[key]=dict(vision=vision,size=pix.get('original_sizes').tolist())
 while len(cache)>args.cache:cache.popitem(last=False)
 return cache[key],round((time.monotonic()-started)*1000)

def segment(name,labels,threshold=.5):
 entry,encode_ms=encode(name);started=time.monotonic();h,w=entry['size'][0];results={}
 for label in labels:
  text=processor(text=label,return_tensors='pt').to(DEVICE)
  with torch.inference_mode():out=model(vision_embeds=entry['vision'],input_ids=text.input_ids,attention_mask=text.attention_mask)
  res=processor.post_process_instance_segmentation(out,threshold=threshold,mask_threshold=.5,target_sizes=entry['size'])[0]
  items=[]
  for mask,score,box in zip(res['masks'][:50],res['scores'].tolist(),res['boxes'].tolist()):
   ys,xs=torch.nonzero(mask,as_tuple=True)
   if not len(xs):continue
   x0,y0,x1,y1=int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
   # Each instance travels as a 1-bit PNG cropped to its pixels, with its offset in the image.
   crop=Image.fromarray(mask[y0:y1,x0:x1].to('cpu',torch.uint8).numpy()*255).convert('1')
   buf=io.BytesIO();crop.save(buf,'PNG')
   items.append(dict(score=round(score,4),box=[round(x0/w,4),round(y0/h,4),round(x1/w,4),round(y1/h,4)],offset=[x0,y0],mask=base64.b64encode(buf.getvalue()).decode()))
  results[label]=items
 return dict(width=w,height=h,encode_ms=encode_ms,decode_ms=round((time.monotonic()-started)*1000),results=results)

class Handler(BaseHTTPRequestHandler):
 def reply(self,code,value):
  body=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path=='/health':return self.reply(200 if state['status']=='ready' else 503,dict(state,model='facebook/sam3',device=DEVICE))
  self.reply(404,{'error':'not found'})
 def do_POST(self):
  if state['status']!='ready':return self.reply(503,{'error':'model is loading'})
  try:
   body=json.loads(self.rfile.read(min(int(self.headers.get('Content-Length',0)),65536)) or b'{}')
   labels=body.get('labels',[])
   if self.path=='/encode':
    with gpu:_,ms=encode(body.get('image'))
    return self.reply(200,{'encode_ms':ms})
   if self.path=='/segment':
    if not isinstance(labels,list) or not 1<=len(labels)<=12 or not all(isinstance(l,str) and 0<len(l)<=60 for l in labels):raise ValueError('labels must be 1-12 short strings')
    with gpu:return self.reply(200,segment(body.get('image'),list(dict.fromkeys(labels))))
   self.reply(404,{'error':'not found'})
  except (ValueError,FileNotFoundError) as e:self.reply(400,{'error':str(e)})
  except Exception as e:self.reply(500,{'error':type(e).__name__})

def load():
 global processor,model
 started=time.monotonic()
 try:
  processor=Sam3Processor.from_pretrained(args.model)
  model=Sam3Model.from_pretrained(args.model).to(DEVICE).eval()
  # Warm up kernels so the first analysis does not pay the one-time compile cost.
  pix=processor(images=Image.new('RGB',(640,480),'gray'),return_tensors='pt').to(DEVICE)
  text=processor(text='object',return_tensors='pt').to(DEVICE)
  with torch.inference_mode():model(pixel_values=pix.pixel_values,input_ids=text.input_ids,attention_mask=text.attention_mask)
 except Exception as e:
  state.update(status='failed',error=type(e).__name__);print(f'SAM3 failed to load: {e!r}',flush=True);return
 state.update(status='ready',load_ms=round((time.monotonic()-started)*1000))
 print(f"SAM3 ready on {DEVICE} in {state['load_ms']} ms",flush=True)

if __name__=='__main__':
 server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
 threading.Thread(target=load,daemon=True).start()
 print(f'SAM3 sidecar on http://127.0.0.1:{args.port} (data: {DATA})',flush=True)
 server.serve_forever()
