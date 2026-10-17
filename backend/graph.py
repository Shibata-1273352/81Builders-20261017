import os, json, asyncio
from neo4j import GraphDatabase
from .store import db

def write(payload):
 if not os.getenv('NEO4J_URI'):raise RuntimeError('Neo4j is not configured')
 with GraphDatabase.driver(os.environ['NEO4J_URI'],auth=(os.environ['NEO4J_USERNAME'],os.environ['NEO4J_PASSWORD']),connection_timeout=5) as driver:
  with driver.session(database=os.getenv('NEO4J_DATABASE','neo4j')) as s:
   def transaction(tx):
    for node in payload['nodes']:
     tx.run('MERGE (n:Tsumugi {key: $key}) SET n += $props',key=node['key'],props=node['props']).consume()
    for edge in payload['edges']:
     tx.run('MATCH (a:Tsumugi {key:$a}),(b:Tsumugi {key:$b}) MERGE (a)-[r:RELATED {kind:$kind}]->(b) SET r.stance=$stance',a=edge['a'],b=edge['b'],kind=edge['kind'],stance=edge.get('stance','')).consume()
   s.execute_write(transaction)

def payload(a):
 nodes=[];edges=[];prefix=f"{a['id']}:{a['revision']}:"
 nodes.append({'key':prefix+a['asset_id'],'props':{'id':a['asset_id'],'kind':'asset','analysis_id':a['id'],'revision':a['revision'],'content_hash':a['input_hash']}})
 for o in a['observations']:
  if o.get('bbox'):
   region='region-'+o['id']
   nodes.append({'key':prefix+region,'props':{'id':region,'kind':'region','analysis_id':a['id'],'revision':a['revision'],'bbox_normalized':o['bbox'],'producer':'VLM candidate'}})
   edges.extend([{'a':prefix+a['asset_id'],'b':prefix+region,'kind':'HAS_REGION'},{'a':prefix+region,'b':prefix+o['id'],'kind':'GROUNDS'}])
 for claim in a['claims']:
  scope='scope-'+claim['id']
  nodes.append({'key':prefix+scope,'props':{'id':scope,'kind':'scope','analysis_id':a['id'],'revision':a['revision'],'data':json.dumps({k:claim.get(k) for k in ['place','time_start','time_end']})}})
  edges.append({'a':prefix+claim['id'],'b':prefix+scope,'kind':'HAS_SCOPE'})
 for kind in ['observations','claims','assessments','explanations','sources']:
  for v in a[kind]:nodes.append({'key':prefix+v['id'],'props':{'id':v['id'],'analysis_id':a['id'],'revision':a['revision'],'kind':kind,'data':json.dumps(v)}})
 for assessment in a['assessments']:
  edges.append({'a':prefix+assessment['id'],'b':prefix+assessment['claim_id'],'kind':'EVALUATES'})
  for p in assessment['passages']:
   nodes.append({'key':prefix+p['id'],'props':{'id':p['id'],'kind':'passage','analysis_id':a['id'],'revision':a['revision'],'data':json.dumps(p)}})
   edges.extend([{'a':prefix+assessment['id'],'b':prefix+p['id'],'kind':'CITES','stance':p['stance']},{'a':prefix+p['source_id'],'b':prefix+p['id'],'kind':'HAS_PASSAGE'}])
 for e in a['explanations']:
  for ref in e['support_ids']:edges.append({'a':prefix+e['id'],'b':prefix+ref['id'],'kind':'BASED_ON'})
 return {'nodes':nodes,'edges':edges}
async def persist(a):
 p=payload(a);mid=f"{a['id']}:{a['revision']}"
 with db() as c:c.execute('INSERT OR REPLACE INTO mutations(id,analysis_id,revision,data,done) VALUES(?,?,?,?,0)',(mid,a['id'],a['revision'],json.dumps(p)))
 await asyncio.to_thread(write,p)
 with db() as c:c.execute('UPDATE mutations SET done=1 WHERE id=?',(mid,))
async def replay():
 with db() as c:rows=c.execute('SELECT id,data FROM mutations WHERE done=0').fetchall()
 for r in rows:
  try:
   await asyncio.to_thread(write,json.loads(r['data']))
   with db() as c:c.execute('UPDATE mutations SET done=1 WHERE id=?',(r['id'],))
  except Exception:pass
