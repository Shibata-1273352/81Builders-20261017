import asyncio, base64, io
import pytest
from PIL import Image
from backend import segment, graph
from test_pipeline import run, base

def png(w,h):
 f=io.BytesIO();Image.new('1',(w,h),1).save(f,'PNG');return base64.b64encode(f.getvalue()).decode()
def instance(box,score=.9):
 x0,y0,x1,y1=box;return dict(score=score,box=box,offset=[round(x0*100),round(y0*100)],mask=png(round((x1-x0)*100),round((y1-y0)*100)))
# Observation 1-1 is the box [0.33,0.68,0.39,0.21]; image 2's lantern box is [0.1,0.1,0.4,0.2].
INSIDE=instance([.4,.7,.5,.85]);OUTSIDE=instance([0,0,.1,.1]);WEAK=instance([.5,.7,.6,.85],.3)
def labelled(tool,data):
 value=base(tool,data)
 if tool=='Image observation · 1':value['observations'][0]['label']='person';value['observations'][1]['label']='thing'
 if tool=='Image observation · 2':value['observations'][0]['label']='lantern'
 return value

@pytest.fixture
def sam(monkeypatch):
 monkeypatch.setenv('SAM3_URL','http://sam3.test')
 calls=[]
 async def post(path,body,timeout):
  calls.append((path,body))
  if sam.fail:raise RuntimeError('SAM3 /segment failed (HTTP 500)')
  if path=='/segment':
   await asyncio.sleep(sam.delay)
   return dict(width=100,height=100,encode_ms=1,decode_ms=1,results={'person':[INSIDE,OUTSIDE,WEAK],'lantern':[instance([.2,.15,.3,.25])]})
  return {'encode_ms':1}
 monkeypatch.setattr(segment,'post',post)
 sam.calls=calls;sam.fail=False;sam.delay=0
 return sam

def test_select_keeps_confident_instances_inside_the_box():
 assert segment.select([INSIDE,OUTSIDE,WEAK],[.33,.68,.39,.21])==[INSIDE]
 # Mostly outside the candidate box: not this observation's instance.
 assert segment.select([instance([.6,.6,.9,.7])],[.33,.68,.39,.21])==[]

def test_compose_unions_instances_as_alpha():
 image,area=segment.compose([INSIDE,instance([.45,.7,.55,.85])],100,100)
 assert image.mode=='LA' and image.size==(100,100)
 assert area==.0225  # union of 15 columns × 15 rows out of 100×100
 assert image.getpixel((42,72))[1]==255 and image.getpixel((5,5))[1]==0

def test_masks_follow_observations(run,sam,tmp_path):
 a=run(labelled)
 o={x['id']:x for x in a['observations']}
 assert o['observation-1-1']['mask']['instance_count']==1 and o['observation-1-1']['producer']=='SAM3 mask from VLM candidate'
 assert (tmp_path/'a-observation-1-1-mask.png').is_file() and o['observation-2-1']['mask']['segmenter']=='facebook/sam3'
 # No valid box: the label alone never creates a region.
 assert o['observation-1-2']['mask'] is None and o['observation-1-2']['producer']=='VLM candidate'
 assert [b['labels'] for p,b in sam.calls if p=='/segment']==[['person'],['lantern']] or [b['labels'] for p,b in sam.calls if p=='/segment']==[['lantern'],['person']]
 assert sorted(b['image'] for p,b in sam.calls if p=='/encode')==['a-1-model.jpg','a-2-model.jpg']
 runs=[r for r in a['runs'] if r['tool'].startswith('Image segmentation')]
 assert len(runs)==2 and all(r['status']=='completed' and r['model_id']=='facebook/sam3' for r in runs)
 assert a['status']=='completed'

def test_sidecar_failure_keeps_boxes(run,sam):
 sam.fail=True;a=run(labelled)
 assert all(o['mask'] is None for o in a['observations']) and [o['bbox'] for o in a['observations']][0]==[0.33,0.68,0.39,0.21]
 assert {l['text'] for l in a['limitations'] if l['text'].startswith('Image segmentation')}=={segment.SEG_FAILED[0].format(n=1),segment.SEG_FAILED[0].format(n=2)}
 assert a['status']=='partial' and a['assessments']

def test_slow_segmentation_is_cut_at_the_budget(run,sam,monkeypatch):
 monkeypatch.setattr(segment,'CAP',.05);sam.delay=5
 a=run(labelled)
 assert all(o['mask'] is None for o in a['observations'])
 assert any(l['text']==segment.SEG_FAILED[0].format(n=1) for l in a['limitations'])
 assert all(r['status']=='failed' for r in a['runs'] if r['tool'].startswith('Image segmentation'))

def test_disabled_without_url(run,sam,monkeypatch):
 monkeypatch.delenv('SAM3_URL');a=run(labelled)
 assert sam.calls==[] and all(o['mask'] is None for o in a['observations']) and a['status']=='completed'

def test_revisions_do_not_resegment(run,sam):
 a=run(labelled);sam.calls.clear()
 a['revision']+=1;run.again(a)
 assert sam.calls==[] and a['observations'][0]['mask']['instance_count']==1

def test_graph_region_records_mask(run,sam):
 a=run(labelled);a['input_hash']='h';p=graph.payload(a)
 region=next(n for n in p['nodes'] if n['props']['id']=='region-observation-1-1')['props']
 assert region['segmenter']=='facebook/sam3' and region['prompt']=='person' and region['instance_count']==1
 seg=next(r['id'] for r in a['runs'] if r['tool']=='Image segmentation · 1')
 assert any(e['type']=='GENERATED_BY' and e['a'].endswith(':region-observation-1-1') and e['b'].endswith(':'+seg) for e in p['edges'])
