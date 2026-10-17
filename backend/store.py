import sqlite3, json, os
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get('TSUMUGI_DATA_DIR',str(ROOT/'.runtime')))
DATA.mkdir(exist_ok=True,parents=True)
def now(): return datetime.now(timezone.utc).isoformat()
def db():
 c=sqlite3.connect(DATA/'tsumugi.sqlite'); c.row_factory=sqlite3.Row
 return c
def init():
 with db() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshots(analysis_id TEXT, revision INTEGER, data TEXT, PRIMARY KEY(analysis_id,revision));
  CREATE TABLE IF NOT EXISTS events(analysis_id TEXT, event_id INTEGER, revision INTEGER, data TEXT, PRIMARY KEY(analysis_id,event_id));
  CREATE TABLE IF NOT EXISTS mutations(id TEXT PRIMARY KEY, analysis_id TEXT, revision INTEGER, data TEXT, done INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS idempotency(analysis_id TEXT,key TEXT,request_hash TEXT,response TEXT,PRIMARY KEY(analysis_id,key));''')
def save(a):
 with db() as c:c.execute('INSERT OR REPLACE INTO analyses VALUES(?,?)',(a['id'],json.dumps(a)))
def get(aid):
 with db() as c:r=c.execute('SELECT data FROM analyses WHERE id=?',(aid,)).fetchone()
 return json.loads(r[0]) if r else None
def snapshot(a):
 with db() as c:c.execute('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)',(a['id'],a['revision'],json.dumps(a)))
def get_snapshot(aid,rev):
 with db() as c:r=c.execute('SELECT data FROM snapshots WHERE analysis_id=? AND revision=?',(aid,rev)).fetchone()
 return json.loads(r[0]) if r else None
def event(a,kind,payload=None):
 with db() as c:
  eid=c.execute('SELECT COALESCE(MAX(event_id),0)+1 FROM events WHERE analysis_id=?',(a['id'],)).fetchone()[0]
  e=dict(event_id=eid,analysis_id=a['id'],revision=a['revision'],type=kind,timestamp=now(),payload=payload or {})
  c.execute('INSERT INTO events VALUES(?,?,?,?)',(a['id'],eid,a['revision'],json.dumps(e)))
 return e
def events(aid,after):
 with db() as c:rows=c.execute('SELECT data FROM events WHERE analysis_id=? AND event_id>? ORDER BY event_id',(aid,after)).fetchall()
 return [json.loads(r[0]) for r in rows]
