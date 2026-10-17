import time,json,uuid,os,sys
from datetime import datetime
from pathlib import Path
import httpx
# Usage: scripts/smoke.py [label]  — label tags the timing record (e.g. phase1, phase2).
root=os.getenv('TSUMUGI_BACKEND_URL','http://127.0.0.1:8000')
label=sys.argv[1] if len(sys.argv)>1 else 'run'
c=httpx.Client(timeout=90)
timings={'label':label,'stages':{}}
def await_result(aid):
 while True:
  a=c.get(root+'/api/analyses/'+aid).json()
  if a['status']!='running':return a
  time.sleep(.2)
def stage(name,a,started):
 # Event offsets show when each step became visible to the UI, not only when the job ended.
 events=[e for e in (json.loads(l[6:]) for l in c.get(root+f"/api/analyses/{a['id']}/events").text.splitlines() if l.startswith('data: ')) if e['revision']==a['revision']]
 t0=datetime.fromisoformat(events[0]['timestamp'])
 offsets={}
 for e in events:offsets.setdefault(e['type'],round((datetime.fromisoformat(e['timestamp'])-t0).total_seconds(),2))
 runs=[dict(tool=r['tool'],model=r['model_id'],start=round((datetime.fromisoformat(r['started_at'])-t0).total_seconds(),2),latency=round(r.get('latency_ms',0)/1000,2),status=r['status']) for r in a['runs'] if r.get('started_at') and datetime.fromisoformat(r['started_at'])>=t0]
 record=dict(total=round(time.monotonic()-started,2),events={k:v for k,v in offsets.items() if k in ['observations.ready','claims.ready','claims.linked','claim.assessed','explanation.updated','analysis.completed']},graph_write=round(a.get('graph_write_ms',0)/1000,2),runs=runs)
 timings['stages'][name]=record
 print(f"{name:9} {a['status']:9} total {record['total']:>5}s  graph {record['graph_write']}s  events {record['events']}",flush=True)
 for r in runs:print(f"           {r['start']:>5}s +{r['latency']:>4}s  {r['tool']} · {r['model']} · {r['status']}",flush=True)
 return a

text='Gion Matsuri is held throughout July. Both photographs were taken in Kyoto in 2026.'
files=[('images',(name,Path('public/demo/'+name).read_bytes(),'image/jpeg')) for name in ['gion.jpg','gion-1905.jpg']]
start=time.monotonic()
r=c.post(root+'/api/analyses',files=files,data={'text':text,'locale':'en'})
r.raise_for_status();aid=r.json()['analysis_id']
a=stage('INITIAL',await_result(aid),start)
assert a['status'] in ['completed','partial'],a.get('error')
assert {o['asset_id'] for o in a['observations']}=={x['id'] for x in a['assets']},'observations from both images'
assert all(x['status']=='unresolved' for x in a['assessments'])
assert all(c_.get('text_ja') for c_ in a['claims']),'claims have Japanese'
print('claims:',[(x['id'],x['text'],x['text_ja'],x['observation_ids']) for x in a['claims']],flush=True)
g=c.get(root+f'/api/analyses/{aid}/graph').json()
print('GRAPH',g['stored'],g['node_count'],'nodes',g['relationship_count'],'relationships',sorted({n['label'] for n in g['nodes']}),sorted({e['type'] for e in g['edges']}),flush=True)
assert g['stored']=='neo4j' and {'Asset','Region','Observation','Claim','Scope','Assessment','Explanation','ToolRun'}<=({n['label'] for n in g['nodes']})
s=json.loads(Path('public/demo/source.json').read_text());s['url_optional']=s.pop('url');s['expected_revision']=a['revision']
start=time.monotonic();r=c.post(root+f'/api/analyses/{aid}/sources',json=s,headers={'Idempotency-Key':str(uuid.uuid4())});r.raise_for_status();a=stage('ADDED',await_result(aid),start)
assert a['status'] in ['completed','partial'],a.get('error')
print('assessments:',[(x['claim_id'],x['status'],x['reason_code']) for x in a['assessments']],flush=True)
print('explanations:',[(e['id'],e.get('origin'),(e.get('check') or {}).get('verdict'),e['text'],e.get('text_ja')) for e in a['explanations'] if e['claim_ids']],flush=True)
july=[x for x in a['assessments'] if x['status']=='confirmed']
assert july and all('July' in next(cl['text'] for cl in a['claims'] if cl['id']==x['claim_id']) for x in july),'only the July claim is confirmed'
assert all(x['status']=='unresolved' for x,cl in zip(a['assessments'],a['claims']) if cl['kind']=='photo_identity'),'photo claims stay unresolved'
assert any(x['reason_code']=='photo_provenance_missing' for x in a['assessments'])
assert all(p.get('quote_ja') for x in a['assessments'] for p in x['passages']),'quotes have reference translations'
Path('.runtime/last-smoke.json').write_text(json.dumps(a,indent=2,ensure_ascii=False))
sid=a['sources'][0]['id']
impact=c.get(root+f'/api/analyses/{aid}/sources/{sid}/impact').json()
print('IMPACT',impact,flush=True)
assert impact['stored']=='neo4j' and set(impact['claim_ids'])=={x['claim_id'] for x in july}
start=time.monotonic();r=c.patch(root+f"/api/analyses/{aid}/sources/{sid}",json={'active':False,'expected_revision':a['revision']});r.raise_for_status()
assert set(c.get(root+'/api/analyses/'+aid).json()['stale_claim_ids'])==set(impact['claim_ids'])
a=stage('DISABLED',await_result(aid),start)
assert all(x['status']=='unresolved' for x in a['assessments'])
assert a['stale_claim_ids']==[]
e=c.get(root+f'/api/analyses/{aid}/events').text
ids=[int(l[4:]) for l in e.splitlines() if l.startswith('id: ')]
assert ids==sorted(set(ids))
resumed=c.get(root+f'/api/analyses/{aid}/events',headers={'Last-Event-ID':str(ids[-2])}).text
assert resumed.count('id: ')==1
Path(f'.runtime/smoke-timings-{label}.json').write_text(json.dumps(timings,indent=2,ensure_ascii=False))
print('SSE replay PASS; analysis',aid,'; timings saved to',f'.runtime/smoke-timings-{label}.json')
