import pytest
from fastapi.testclient import TestClient
from backend import main,store,graph

def analysis(revision=2):
 run=lambda id,tool,model:dict(id=id,tool=tool,model_id=model,latency_ms=900,started_at='2026-10-17T00:00:00+00:00')
 return dict(id='a',revision=revision,display_revision=revision,status='completed',text='Festival in July. Photo 1 in 2026.',input_hash='h',
  assets=[dict(id='a-1.jpg',index=1,mime_type='image/jpeg',width=10,height=10),dict(id='a-2.jpg',index=2,mime_type='image/jpeg',width=10,height=10)],
  runs=[run('r-obs','Image observation · 1','vision'),run('r-claims','Claim extraction','text'),run('r-link','Claim–observation linking','text'),run('r-verify','Evidence verification','text'),run('r-explain','Explanation writing','text'),run('r-unused','Quote translation','text'),run('r-write','Cultural notes · writer','writer'),run('r-glm','Cultural review · glm-5.3','glm')],
  observations=[dict(id='observation-1-1',asset_id='a-1.jpg',text='Lanterns',text_ja='提灯',bbox=[.1,.1,.2,.2],producer='VLM candidate',run_id='r-obs'),dict(id='observation-2-1',asset_id='a-2.jpg',text='Steps',text_ja='階段',bbox=None,producer='VLM candidate',run_id='r-obs')],
  claims=[dict(id='claim-1',text='Festival in July.',text_ja='祭りは7月。',kind='context',place='Kyoto',time_start=None,time_end=None,observation_ids=['observation-1-1'],run_id='r-claims',link_run_id='r-link'),dict(id='claim-2',text='Photo 1 in 2026.',text_ja='写真1は2026年。',kind='photo_identity',place=None,time_start='2026',time_end=None,observation_ids=[],run_id='r-claims',link_run_id='r-link')],
  sources=[dict(id='s1',title='FAQ',text='Held in July.',publisher='City',active=True,content_hash='c'),dict(id='s2',title='Other',text='Unrelated.',publisher='',active=True,content_hash='d')],
  assessments=[dict(id='assessment-claim-1',claim_id='claim-1',status='confirmed',reason_code='support_found',reason='r',reason_ja='理由',missing='',passages=[dict(id='passage-claim-1-1',source_id='s1',quote='Held in July.',quote_ja='7月に開催。',start=0,end=13,stance='supports',scope_match=True)],run_id='r-verify'),dict(id='assessment-claim-2',claim_id='claim-2',status='unresolved',reason_code='photo_provenance_missing',reason='r',reason_ja='理由',missing='m',passages=[],run_id='r-verify')],
  explanations=[dict(id='explanation-observation-1-1',section='see',text='Lanterns',text_ja='提灯',claim_ids=[],support_ids=[{'type':'Observation','id':'observation-1-1','revision':revision}],origin='observation',check=None,run_id=None),dict(id='explanation-claim-1',section='context',text='Supported.',text_ja='裏付けあり。',claim_ids=['claim-1'],support_ids=[{'type':'Assessment','id':'assessment-claim-1','revision':revision}],origin='model',check=dict(model_id='qwen/qwen3.8-27b',verdict='accepted'),run_id='r-explain'),dict(id='explanation-claim-2',section='unknown',text='Unknown.',text_ja='不明。',claim_ids=['claim-2'],support_ids=[{'type':'Assessment','id':'assessment-claim-2','revision':revision}],origin='template',check=None,run_id=None)],
  cultural_notes=[dict(id='note-1',about='observation-1-1',term=dict(ja='提灯',reading='chōchin',en='paper lantern'),summary=dict(id='note-1-s',en='Festival lanterns.',ja='祭りの提灯。',consensus=dict(status='agreed',agree=3,total=3,corrections=[])),points=[],consensus='agreed',run_id='r-write',
   reviews=[dict(model='glm',run_id='r-glm',failed=False,verdict='agree'),dict(model='qwen',run_id=None,failed=True,verdict=None)])],
  limitations=[],changes=[],stale_claim_ids=[],previous=None,error=None,created_at='',updated_at='',started_at='')

def test_labels_and_relationships_whitelisted():
 p=graph.payload(analysis())
 assert {n['label'] for n in p['nodes']}<=set(graph.LABELS);assert {e['type'] for e in p['edges']}<=set(graph.RELS)
 assert {n['label'] for n in p['nodes']}==set(graph.LABELS)
 assert all(n['key'].startswith('v2:a:2:') for n in p['nodes'])
 keys={n['key'] for n in p['nodes']};assert len(keys)==len(p['nodes'])
 assert all(e['a'] in keys and e['b'] in keys for e in p['edges'])
 # Neo4j properties must be primitives or lists of primitives.
 assert all(isinstance(v,(str,int,float,bool)) or (isinstance(v,list) and all(isinstance(x,(int,float)) for x in v)) for n in p['nodes'] for v in n['props'].values())
 with pytest.raises(ValueError):graph.write({'nodes':[{'key':'k','label':'Evil} DETACH DELETE n //','props':{}}],'edges':[]})

def test_linked_to_and_generated_by():
 p=graph.payload(analysis());edges={(e['a'].rsplit(':',1)[1],e['type'],e['b'].rsplit(':',1)[1]):e['props'] for e in p['edges']}
 assert edges[('claim-1','LINKED_TO','observation-1-1')]=={'candidate':True,'model_id':'text'}
 assert ('observation-1-1','GENERATED_BY','r-obs') in edges and ('claim-1','GENERATED_BY','r-claims') in edges and ('assessment-claim-1','GENERATED_BY','r-verify') in edges and ('explanation-claim-1','GENERATED_BY','r-explain') in edges
 assert edges[('assessment-claim-1','CITES','passage-claim-1-1')]=={'stance':'supports','scope_match':True}
 assert ('s1','HAS_PASSAGE','passage-claim-1-1') in edges and ('a-2.jpg','HAS_REGION','region-observation-2-1') in edges
 runs={n['props']['id']:n['props'] for n in p['nodes'] if n['label']=='ToolRun'}
 assert 'r-unused' not in runs and runs['r-obs']['latency_ms']==900
 assert next(n for n in p['nodes'] if n['props']['id']=='explanation-claim-1')['props']['check_model']=='qwen/qwen3.8-27b'

def test_cultural_notes_link_to_observation_and_runs():
 p=graph.payload(analysis());edges={(e['a'].rsplit(':',1)[1],e['type'],e['b'].rsplit(':',1)[1]):e['props'] for e in p['edges']}
 note=next(n['props'] for n in p['nodes'] if n['label']=='CulturalNote')
 assert (note['term_ja'],note['term_en'],note['consensus'])==('提灯','paper lantern','agreed')
 assert ('note-1','ABOUT','observation-1-1') in edges and ('note-1','GENERATED_BY','r-write') in edges
 # A reviewer that failed has no run to point at; it is simply absent.
 assert edges[('note-1','REVIEWED_BY','r-glm')]=={'verdict':'agree','model_id':'glm'} and sum(1 for k in edges if k[1]=='REVIEWED_BY')==1
 # Notes never feed an assessment or explanation.
 assert not any(k[0]=='note-1' and k[1] in ('BASED_ON','EVALUATES','CITES') for k in edges)

def test_local_impact_follows_citations():
 a=analysis()
 assert graph.local_impact(a,'s1')=={'passage_ids':['passage-claim-1-1'],'assessment_ids':['assessment-claim-1'],'claim_ids':['claim-1'],'explanation_ids':['explanation-claim-1']}
 assert graph.local_impact(a,'s2')['claim_ids']==[]

@pytest.fixture
def client(tmp_path,monkeypatch):
 monkeypatch.setattr(store,'DATA',tmp_path)
 async def replay():pass
 monkeypatch.setattr(graph,'replay',replay);monkeypatch.setattr(graph,'ensure_schema',lambda:None)
 main.tasks.clear()
 async def process(a):
  a['status']='completed';a['display_revision']=a['revision'];a['stale_claim_ids']=[];store.save(a);store.snapshot(a);store.event(a,'analysis.completed')
 monkeypatch.setattr(main,'process',process)
 with TestClient(main.app) as c:
  a=analysis();store.save(a);store.snapshot(a);yield c

def test_graph_endpoint_reads_neo4j(client,monkeypatch):
 monkeypatch.setattr(graph,'read',lambda aid,rev:{'nodes':[{'id':'claim-1','label':'Claim'}],'edges':[]})
 r=client.get('/api/analyses/a/graph').json()
 assert r['stored']=='neo4j' and r['revision']==2 and r['node_count']==1 and r['relationship_count']==0

def test_graph_endpoint_falls_back_locally(client,monkeypatch):
 def offline(*a):raise RuntimeError('offline')
 monkeypatch.setattr(graph,'read',offline)
 r=client.get('/api/analyses/a/graph?revision=2').json()
 assert r['stored']=='local';assert {n['label'] for n in r['nodes']}==set(graph.LABELS)
 assert {'source':'claim-1','target':'observation-1-1','type':'LINKED_TO','candidate':True,'model_id':'text'} in r['edges']
 assert client.get('/api/analyses/a/graph?revision=9').status_code==404

def test_impact_endpoint_and_stale_claims(client,monkeypatch):
 seen=[]
 def impact(snap,sid):seen.append((snap['revision'],sid));return {'passage_ids':['passage-claim-1-1'],'assessment_ids':['assessment-claim-1'],'claim_ids':['claim-1'],'explanation_ids':['explanation-claim-1']}
 monkeypatch.setattr(graph,'impact',impact)
 r=client.get('/api/analyses/a/sources/s1/impact').json()
 assert r['stored']=='neo4j' and r['claim_ids']==['claim-1'] and seen==[(2,'s1')]
 assert client.get('/api/analyses/a/sources/missing/impact').status_code==404
 captured={}
 async def process(a):captured['stale']=list(a['stale_claim_ids']);a['status']='completed';a['stale_claim_ids']=[];store.save(a)
 monkeypatch.setattr(main,'process',process)
 assert client.patch('/api/analyses/a/sources/s1',json={'active':False,'expected_revision':2}).status_code==202
 client.get('/api/analyses/a')
 assert captured['stale']==['claim-1']
