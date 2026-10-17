import asyncio, os

WRITE_PROMPT='''You write short cultural background notes for international visitors to Japan. Input: what is visibly in the photographs (observations with ids and short labels) and the claims in the user's caption. Choose up to 4 Japanese cultural things that the observations show or the claims name (an object, practice, garment or event), most useful first, and explain each from well-established general knowledge. Return {"notes":[{"about":"id of the observation the note is about, or null","term":{"ja":"Japanese term in kanji or kana","reading":"Hepburn romanization","en":"short English gloss"},"summary_en":"two plain sentences for a visitor","summary_ja":"the same in natural Japanese","points":[{"en":"one concrete, widely documented fact","ja":"the same in natural Japanese"}],"caution_en":"what this photograph alone cannot tell about the term","caution_ja":"the same in Japanese"}]}. 2 or 3 points per note. Never state where or when these photographs were taken, never identify people, and never present the caption's claims as true. Leave out anything you are not confident is widely documented.'''
REVIEW_PROMPT='''You independently review cultural background notes written for visitors to Japan. For each item judge, from well-established general knowledge, whether the statement is accurate as general background about the named term (not whether it describes any particular photograph). Return {"reviews":[{"item_id":"...","verdict":"agree or disagree or unsure","correction_en":"one short sentence when disagree or unsure, else empty","correction_ja":"the same in Japanese"}]}. Review every item.'''

# Fixed wording: the notes are background from models, never evidence about the photographs.
NOTE=('AI background from several models — general knowledge, not evidence about this photograph.','複数の AI による一般的な背景知識です。この写真についての証拠ではありません。')
FAILED=('Cultural background notes are unavailable for this analysis.','この解析では、文化の背景の解説を利用できません。')
VERDICTS=('agree','disagree','unsure')

def writer():return os.getenv('AIAND_CULTURE_MODEL','deepseek-ai/deepseek-v4-pro')
def reviewers():return [m.strip() for m in os.getenv('AIAND_REVIEW_MODELS','zai-org/glm-5.3,qwen/qwen3.8-27b').split(',') if m.strip()]
def text(v,n=600):return v.strip()[:n] if isinstance(v,str) and v.strip() else None

def validate(raw,observations):
 # Notes without a Japanese term, an English gloss or a summary are dropped; unknown observation ids become null.
 known={o['id'] for o in observations};notes=[]
 for item in raw.get('notes') if isinstance(raw.get('notes'),list) else []:
  if len(notes)==4:break
  if not isinstance(item,dict):continue
  term=item.get('term') if isinstance(item.get('term'),dict) else {}
  ja,en,summary=text(term.get('ja'),40),text(term.get('en'),80),text(item.get('summary_en'))
  if not ja or not en or not summary:continue
  nid=f'note-{len(notes)+1}'
  points=[p for p in item.get('points') or [] if isinstance(p,dict) and text(p.get('en'))][:3]
  notes.append(dict(id=nid,about=item.get('about') if item.get('about') in known else None,term=dict(ja=ja,reading=text(term.get('reading'),60),en=en),
   summary=dict(id=nid+'-s',en=summary,ja=text(item.get('summary_ja'))),points=[dict(id=f'{nid}-p{i+1}',en=text(p['en'],300),ja=text(p.get('ja'),300)) for i,p in enumerate(points)],
   caution_en=text(item.get('caution_en'),300),caution_ja=text(item.get('caution_ja'),300),run_id=raw.get('_run_id')))
 return notes

def consensus(items,reviews):
 """The writer counts as one vote for each item it wrote. Every reviewer that answered agrees → agreed;
 a majority of them disagree → the item is dropped; anything else → disputed, with their corrections.
 When no reviewer answered the item is shown unchecked."""
 answered=[r for r in reviews if not r.get('failed')];kept=[]
 for item in items:
  votes=[(r['model'],r['verdicts'].get(item['id']) or {}) for r in answered]
  verdicts=[v.get('verdict') if v.get('verdict') in VERDICTS else 'unsure' for _,v in votes]
  if not answered:status='unchecked'
  elif verdicts.count('disagree')*2>len(answered):continue
  elif all(v=='agree' for v in verdicts):status='agreed'
  else:status='disputed'
  corrections=[dict(model=m,verdict=x,en=text(v.get('correction_en'),300),ja=text(v.get('correction_ja'),300)) for (m,v),x in zip(votes,verdicts) if x!='agree' and text(v.get('correction_en'))]
  kept.append(dict(item,consensus=dict(status=status,agree=1+verdicts.count('agree'),total=1+len(answered),corrections=corrections)))
 return kept

def review_items(notes):
 label=lambda n:f"{n['term']['ja']} ({n['term'].get('reading') or ''}, {n['term']['en']})"
 return [dict(item_id=x['id'],term=label(n),statement=x['en']) for n in notes for x in [n['summary'],*n['points']]]

def combine(notes,reviews):
 # A note whose summary the reviewers reject is dropped as a whole; its points are judged one by one.
 out=[]
 for n in notes:
  summary=consensus([n['summary']],reviews)
  if not summary:continue
  points=consensus(n['points'],reviews)
  states={x['consensus']['status'] for x in [*summary,*points]}
  status='unchecked' if states=={'unchecked'} else 'agreed' if states=={'agreed'} else 'disputed'
  out.append(dict(n,summary=summary[0],points=points,consensus=status,writer=writer(),
   reviews=[dict(model=r['model'],run_id=r.get('run_id'),failed=bool(r.get('failed')),verdict=None if r.get('failed') else summarize(r,[n['summary'],*n['points']])) for r in reviews]))
 return out

def summarize(review,items):
 # One verdict per reviewer and note, for the REVIEWED_BY relationship.
 got=[(review['verdicts'].get(x['id']) or {}).get('verdict') for x in items]
 return 'disagree' if 'disagree' in got else 'agree' if all(v=='agree' for v in got) else 'unsure'

async def write(a,invoke):
 """Writer, then independent reviewers in parallel. Returns notes ready to store; raises if the writer fails."""
 observations=[dict(id=o['id'],image=int(o['id'].split('-')[1]),text=o['text'],label=o.get('label')) for o in a['observations']]
 raw=await invoke(WRITE_PROMPT,{'image_count':len(a['assets']),'observations':observations,'claims':[c['text'] for c in a['claims']]},runs=a['runs'],tool='Cultural notes · writer',model=writer(),timeout=30)
 notes=validate(raw,a['observations'])
 if not notes:return []
 items=review_items(notes)
 async def review(model):
  try:result=await invoke(REVIEW_PROMPT,{'items':items},runs=a['runs'],tool=f"Cultural review · {model.split('/')[-1]}",model=model,effort='low',timeout=10,attempts=1)
  except Exception:return dict(model=model,failed=True)
  verdicts={x['item_id']:x for x in result.get('reviews',[]) if isinstance(x,dict) and isinstance(x.get('item_id'),str)}
  return dict(model=model,run_id=result.get('_run_id'),verdicts=verdicts)
 return combine(notes,await asyncio.gather(*[review(m) for m in reviewers()]))
