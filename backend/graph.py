import os, json, asyncio, threading, time
from neo4j import GraphDatabase
from .store import db

LABELS=['Asset','Region','Observation','Claim','Scope','Source','Passage','Assessment','Explanation','CulturalNote','ToolRun']
RELS=['HAS_REGION','GROUNDS','LINKED_TO','HAS_SCOPE','EVALUATES','CITES','HAS_PASSAGE','BASED_ON','ABOUT','GENERATED_BY','REVIEWED_BY']
# Labels and relationship types cannot be parameters, so each is a FOREACH branch built from the whitelist:
# all nodes of a revision are written in one statement and all relationships in another.
NODES='UNWIND $rows AS row MERGE (n:Tsumugi {key:row.key}) SET n += row.props '+' '.join(f"FOREACH (_ IN CASE WHEN row.label='{l}' THEN [1] ELSE [] END | SET n:{l})" for l in LABELS)
EDGES='UNWIND $rows AS row MATCH (a:Tsumugi {key:row.a}) MATCH (b:Tsumugi {key:row.b}) '+' '.join(f"FOREACH (_ IN CASE WHEN row.type='{t}' THEN [1] ELSE [] END | MERGE (a)-[r:{t}]->(b) SET r += row.props)" for t in RELS)
_driver=None;_lock=threading.Lock()

def driver():
 global _driver
 if not os.getenv('NEO4J_URI'):raise RuntimeError('Neo4j is not configured')
 with _lock:
  if _driver is None:_driver=GraphDatabase.driver(os.environ['NEO4J_URI'],auth=(os.environ['NEO4J_USERNAME'],os.environ['NEO4J_PASSWORD']),connection_timeout=5)
 return _driver
def session():return driver().session(database=os.getenv('NEO4J_DATABASE','neo4j'))
def close():
 global _driver
 if _driver:_driver.close();_driver=None
def ensure_schema():
 with session() as s:
  s.run('CREATE CONSTRAINT tsumugi_key IF NOT EXISTS FOR (n:Tsumugi) REQUIRE n.key IS UNIQUE').consume()
  s.run('CREATE INDEX tsumugi_revision IF NOT EXISTS FOR (n:Tsumugi) ON (n.analysis_id, n.revision)').consume()
  # Open a writer connection now so the first analysis does not pay the cold-start cost.
  s.execute_write(lambda tx:tx.run('RETURN 1').consume())

def write(payload):
 if any(n['label'] not in LABELS for n in payload['nodes']) or any(e['type'] not in RELS for e in payload['edges']):raise ValueError('Graph label or relationship is not whitelisted')
 with session() as s:
  def transaction(tx):
   tx.run(NODES,rows=payload['nodes']).consume()
   tx.run(EDGES,rows=payload['edges']).consume()
  s.execute_write(transaction)

def key(a,id):return f"v2:{a['id']}:{a['revision']}:{id}"
def payload(a):
 nodes=[];edges=[];runs={r['id']:r for r in a['runs']};used=set()
 def node(label,id,**props):nodes.append({'key':key(a,id),'label':label,'props':{'id':id,'analysis_id':a['id'],'revision':a['revision'],**{k:v for k,v in props.items() if v is not None}}})
 def edge(type,x,y,**props):edges.append({'a':key(a,x),'b':key(a,y),'type':type,'props':props})
 def generated(id,run_id):
  if run_id in runs:used.add(run_id);edge('GENERATED_BY',id,run_id)
 for asset in a['assets']:node('Asset',asset['id'],name=f"Image {asset['index']}",index=asset['index'],mime_type=asset['mime_type'],width=asset.get('width'),height=asset.get('height'),content_hash=a['input_hash'])
 for o in a['observations']:
  region='region-'+o['id']
  m=o.get('mask') or {}
  node('Region',region,name='Whole image' if not o['bbox'] else 'Region '+o['id'].split('-',1)[1],bbox_normalized=o['bbox'],asset_id=o['asset_id'],producer=o['producer'],prompt=o.get('label'),segmenter=m.get('segmenter'),mask_score=m.get('score'),instance_count=m.get('instance_count'),mask_area=m.get('area'))
  node('Observation',o['id'],name=o['text'][:48],text=o['text'],text_ja=o.get('text_ja'),asset_id=o['asset_id'])
  edge('HAS_REGION',o['asset_id'],region);edge('GROUNDS',region,o['id']);generated(o['id'],o.get('run_id'));generated(region,m.get('run_id'))
 for c in a['claims']:
  node('Claim',c['id'],name=c['text'][:48],text=c['text'],text_ja=c.get('text_ja'),kind=c['kind'])
  scope='scope-'+c['id']
  node('Scope',scope,name=' · '.join(str(c[k]) for k in ['place','time_start','time_end'] if c.get(k)) or 'Unspecified',place=c.get('place'),time_start=c.get('time_start'),time_end=c.get('time_end'))
  edge('HAS_SCOPE',c['id'],scope);generated(c['id'],c.get('run_id'))
  for oid in c.get('observation_ids',[]):edge('LINKED_TO',c['id'],oid,candidate=True,model_id=runs.get(c.get('link_run_id'),{}).get('model_id',''))
 for s in a['sources']:node('Source',s['id'],name=s['title'][:48],title=s['title'],publisher=s.get('publisher'),place=s.get('place'),active=s['active'],url=s.get('url_optional'),content_hash=s.get('content_hash'))
 for x in a['assessments']:
  node('Assessment',x['id'],name=x['status'],status=x['status'],reason_code=x['reason_code'],reason=x['reason'],reason_ja=x.get('reason_ja'))
  edge('EVALUATES',x['id'],x['claim_id']);generated(x['id'],x.get('run_id'))
  for p in x['passages']:
   node('Passage',p['id'],name=p['quote'][:48],quote=p['quote'],quote_ja=p.get('quote_ja'),start=p['start'],end=p['end'],source_id=p['source_id'])
   edge('CITES',x['id'],p['id'],stance=p['stance'],scope_match=p['scope_match']);edge('HAS_PASSAGE',p['source_id'],p['id'])
 for e in a['explanations']:
  node('Explanation',e['id'],name=e['text'][:48],text=e['text'],text_ja=e.get('text_ja'),section=e['section'],origin=e.get('origin'),check_model=(e.get('check') or {}).get('model_id'),check_verdict=(e.get('check') or {}).get('verdict'))
  for ref in e['support_ids']:edge('BASED_ON',e['id'],ref['id'])
  generated(e['id'],e.get('run_id'))
 # Cultural notes are model background: linked to what they describe and to the runs that wrote and reviewed them, never to an assessment.
 observed={o['id'] for o in a['observations']}
 for n in a.get('cultural_notes') or []:
  node('CulturalNote',n['id'],name=n['term']['ja'],term_ja=n['term']['ja'],term_en=n['term']['en'],reading=n['term'].get('reading'),summary=n['summary']['en'],summary_ja=n['summary'].get('ja'),consensus=n['consensus'])
  if n.get('about') in observed:edge('ABOUT',n['id'],n['about'])
  generated(n['id'],n.get('run_id'))
  for rv in n.get('reviews',[]):
   if rv.get('run_id') in runs:used.add(rv['run_id']);edge('REVIEWED_BY',n['id'],rv['run_id'],verdict=rv['verdict'],model_id=rv['model'])
 for rid in used:node('ToolRun',rid,name=runs[rid]['tool'],tool=runs[rid]['tool'],model_id=runs[rid]['model_id'],latency_ms=runs[rid].get('latency_ms'),started_at=runs[rid].get('started_at'))
 return {'version':2,'nodes':nodes,'edges':edges}

async def persist(a):
 p=payload(a);mid=f"{a['id']}:{a['revision']}"
 with db() as c:c.execute('INSERT OR REPLACE INTO mutations(id,analysis_id,revision,data,done) VALUES(?,?,?,?,0)',(mid,a['id'],a['revision'],json.dumps(p)))
 started=time.monotonic()
 await asyncio.to_thread(write,p)
 a['graph_write_ms']=round((time.monotonic()-started)*1000)
 with db() as c:c.execute('UPDATE mutations SET done=1 WHERE id=?',(mid,))
async def replay():
 with db() as c:rows=c.execute('SELECT id,data FROM mutations WHERE done=0').fetchall()
 for r in rows:
  try:
   data=json.loads(r['data'])
   # Pre-v2 payloads used untyped RELATED edges and are no longer written.
   if data.get('version')==2:await asyncio.to_thread(write,data)
   with db() as c:c.execute('UPDATE mutations SET done=1 WHERE id=?',(r['id'],))
  except Exception:pass

def shape(p):
 # Same JSON shape for Neo4j reads and the local fallback.
 return {'nodes':[{'id':n['props']['id'],'label':n['label'],**{k:v for k,v in n['props'].items() if k not in ['analysis_id','revision']}} for n in p['nodes']],'edges':[{'source':e['a'].rsplit(':',1)[1],'target':e['b'].rsplit(':',1)[1],'type':e['type'],**e['props']} for e in p['edges']]}
def read(aid,revision):
 # One round trip: each node with its outgoing relationships.
 with session() as s:
  rows=s.run("MATCH (n:Tsumugi) WHERE n.analysis_id=$aid AND n.revision=$rev AND n.key STARTS WITH 'v2:' OPTIONAL MATCH (n)-[r]->(b:Tsumugi) RETURN [l IN labels(n) WHERE l<>'Tsumugi'][0] AS label, properties(n) AS props, collect(CASE WHEN r IS NULL THEN NULL ELSE {target:b.id, type:type(r), props:properties(r)} END) AS out",aid=aid,rev=revision).data()
 return {'nodes':[{'id':n['props']['id'],'label':n['label'],**{k:v for k,v in n['props'].items() if k not in ['key','analysis_id','revision']}} for n in rows],'edges':[{'source':n['props']['id'],'target':e['target'],'type':e['type'],**e['props']} for n in rows for e in n['out']]}
IMPACT='''MATCH (s:Source {key:$key})-[:HAS_PASSAGE]->(p:Passage)<-[:CITES]-(x:Assessment)-[:EVALUATES]->(c:Claim)
OPTIONAL MATCH (e:Explanation)-[:BASED_ON]->(x)
RETURN collect(DISTINCT p.id) AS passage_ids, collect(DISTINCT x.id) AS assessment_ids, collect(DISTINCT c.id) AS claim_ids, collect(DISTINCT e.id) AS explanation_ids'''
def impact(a,sid):
 with session() as s:r=s.run(IMPACT,key=key(a,sid)).single()
 return {k:sorted(r[k]) for k in ['passage_ids','assessment_ids','claim_ids','explanation_ids']}
def local_impact(a,sid):
 # Same traversal over the saved snapshot, used when Neo4j is unreachable.
 hit=[x for x in a['assessments'] if any(p['source_id']==sid for p in x['passages'])]
 ids={x['id'] for x in hit}
 return {'passage_ids':sorted(p['id'] for x in hit for p in x['passages'] if p['source_id']==sid),'assessment_ids':sorted(ids),'claim_ids':sorted(x['claim_id'] for x in hit),'explanation_ids':sorted(e['id'] for e in a['explanations'] if any(r['id'] in ids for r in e['support_ids']))}
