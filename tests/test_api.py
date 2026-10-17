import io, json, asyncio
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from backend import main,store,graph

@pytest.fixture
def client(tmp_path,monkeypatch):
 monkeypatch.setattr(store,'DATA',tmp_path)
 async def replay():pass
 monkeypatch.setattr(graph,'replay',replay)
 monkeypatch.setattr(graph,'ensure_schema',lambda:None)
 main.tasks.clear()
 async def process(a):
  a['status']='completed';a['display_revision']=a['revision'];store.save(a);store.snapshot(a);store.event(a,'analysis.completed')
 monkeypatch.setattr(main,'process',process)
 with TestClient(main.app) as c:yield c

def photo():
 f=io.BytesIO();Image.new('RGB',(20,20),'red').save(f,'JPEG');return f.getvalue()
def create(c,count=1):
 r=c.post('/api/analyses',files=[('images',(f'x{i}.jpg',photo(),'image/jpeg')) for i in range(count)],data={'text':'A festival in July.'});assert r.status_code==202;return r.json()['analysis_id']
def test_invalid_inputs(client):
 assert client.post('/api/analyses',files={'images':('x.jpg',b'invalid','image/jpeg')},data={'text':'hello'}).status_code==415
 assert client.post('/api/analyses',files={'images':('x.jpg',b'x'*(10*1024*1024+1),'image/jpeg')},data={'text':'hello'}).status_code==413
 assert client.post('/api/analyses',files={'images':('x.jpg',photo(),'image/jpeg')},data={'text':'x'*5001}).status_code==422

def test_multiple_images(client):
 aid=create(client,3);a=client.get(f'/api/analyses/{aid}').json()
 assert [x['index'] for x in a['assets']]==[1,2,3];assert len({x['id'] for x in a['assets']})==3
 for x in a['assets']:assert client.get(f"/api/analyses/{aid}/assets/{x['id']}").status_code==200
 assert (store.DATA/f'{aid}-3-model.jpg').exists()
 one=create(client);assert store.get(one)['input_hash']!=a['input_hash']

def test_image_limits(client):
 files=[('images',(f'x{i}.jpg',photo(),'image/jpeg')) for i in range(5)]
 assert client.post('/api/analyses',files=files,data={'text':'hello'}).status_code==422
 # One bad image rejects the whole request before anything is stored.
 files=[('images',('a.jpg',photo(),'image/jpeg')),('images',('b.jpg',b'invalid','image/jpeg'))]
 assert client.post('/api/analyses',files=files,data={'text':'hello'}).status_code==415
 assert not list(store.DATA.glob('*.jpg'))

def test_asset_of_other_analysis_rejected(client):
 first=create(client);second=create(client)
 other=store.get(second)['assets'][0]['id']
 assert client.get(f'/api/analyses/{first}/assets/{other}').status_code==404
 assert client.get(f'/api/analyses/{first}/assets/..%2Ftsumugi.sqlite').status_code==404

def test_revision_and_idempotency(client):
 aid=create(client)
 r=client.post(f'/api/analyses/{aid}/sources',json={'title':'Source','text':'In July.','expected_revision':1},headers={'Idempotency-Key':'k'})
 assert r.status_code==202
 again=client.post(f'/api/analyses/{aid}/sources',json={'title':'Source','text':'In July.','expected_revision':1},headers={'Idempotency-Key':'k'})
 assert again.json()==r.json();assert len(store.get(aid)['sources'])==1
 assert client.post(f'/api/analyses/{aid}/sources',json={'title':'Other','text':'In July.','expected_revision':1},headers={'Idempotency-Key':'k'}).status_code==409
 assert client.post(f'/api/analyses/{aid}/sources',json={'title':'Other','text':'In July.','expected_revision':1},headers={'Idempotency-Key':'k2'}).status_code==409

def test_T10_sse_replay(client):
 aid=create(client)
 data=client.get(f'/api/analyses/{aid}/events').text
 ids=[int(l[4:]) for l in data.splitlines() if l.startswith('id: ')]
 assert ids==sorted(set(ids))
 replay=client.get(f'/api/analyses/{aid}/events',headers={'Last-Event-ID':str(ids[-1])}).text
 assert replay==''
 assert client.get(f'/api/analyses/{aid}/assets/not-owned.jpg').status_code==404

def test_T09_failure_not_completed(client,monkeypatch):
 async def fail(a):raise RuntimeError('Database offline')
 monkeypatch.setattr(main,'process',fail)
 aid=create(client)
 # TestClient background task finishes before the next read.
 a=client.get(f'/api/analyses/{aid}').json()
 assert a['status']=='failed';assert a['explanations']==[]
 events=store.events(aid,0)
 assert not any(e['type']=='explanation.updated' for e in events)
 assert events[-1]['payload']['status']=='failed'
