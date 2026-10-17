import time,json,uuid
from pathlib import Path
import httpx
root='http://127.0.0.1:8000'
c=httpx.Client(timeout=90)
def await_result(aid):
 while True:
  a=c.get(root+'/api/analyses/'+aid).json()
  if a['status']!='running':return a
  time.sleep(.4)
start=time.monotonic()
r=c.post(root+'/api/analyses',files={'image':('demo.jpg',Path('public/demo/gion.jpg').read_bytes(),'image/jpeg')},data={'text':'Gion Matsuri is held throughout July. This photograph was taken in Kyoto in 2026.','locale':'en'})
r.raise_for_status();aid=r.json()['analysis_id'];a=await_result(aid)
print('INITIAL',a['status'],round(time.monotonic()-start,2),[(x['status'],x['reason_code']) for x in a['assessments']],flush=True)
assert a['status'] in ['completed','partial'],a.get('error')
assert all(x['status']=='unresolved' for x in a['assessments'])
s=json.loads(Path('public/demo/source.json').read_text());s['url_optional']=s.pop('url');s['expected_revision']=a['revision']
start=time.monotonic();r=c.post(root+f'/api/analyses/{aid}/sources',json=s,headers={'Idempotency-Key':str(uuid.uuid4())});r.raise_for_status();a=await_result(aid)
print('ADDED',a['status'],round(time.monotonic()-start,2),[(x['status'],x['reason_code']) for x in a['assessments']],flush=True)
assert a['status'] in ['completed','partial'],a.get('error')
assert any(x['status']=='confirmed' for x in a['assessments'])
assert any(x['reason_code']=='photo_provenance_missing' for x in a['assessments'])
Path('.runtime/last-smoke.json').write_text(json.dumps(a,indent=2))
start=time.monotonic();r=c.patch(root+f"/api/analyses/{aid}/sources/{a['sources'][0]['id']}",json={'active':False,'expected_revision':a['revision']});r.raise_for_status();a=await_result(aid)
print('DISABLED',a['status'],round(time.monotonic()-start,2),[x['status'] for x in a['assessments']],flush=True)
assert all(x['status']=='unresolved' for x in a['assessments'])
e=c.get(root+f'/api/analyses/{aid}/events').text
ids=[int(l[4:]) for l in e.splitlines() if l.startswith('id: ')]
assert ids==sorted(set(ids))
resumed=c.get(root+f'/api/analyses/{aid}/events',headers={'Last-Event-ID':str(ids[-2])}).text
assert resumed.count('id: ')==1
print('SSE replay PASS; analysis',aid)
