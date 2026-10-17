import asyncio,sys,base64,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv,set_key
load_dotenv()
from backend.llm import call, check_model
async def main():
 image='data:image/jpeg;base64,'+base64.b64encode(Path('public/demo/gion.jpg').read_bytes()).decode()
 runs=[]
 result=await call('Describe only directly visible objects. JSON: {"objects": ["short label"]}',{},image=image,runs=runs)
 print(json.dumps({'vision':result,'runs':runs}))
 assert result.get('objects')
 set_key('.env','AIAND_VISION_MODEL',runs[0]['model_id'])
 runs=[]
 result=await call('Extract atomic claims. JSON: {"claims": ["claim"]}',{'text':'Gion Matsuri is held throughout July.'},runs=runs)
 print(json.dumps({'text':result,'runs':runs}))
 assert result.get('claims')
 # The independent checker must reject an explanation that adds an unsupported fact.
 runs=[]
 result=await call('Check whether the explanation is entailed by the passage only. JSON: {"grounded": true}',{'passage':'Gion Matsuri is held throughout July.','explanation':'Gion Matsuri has been held every July since 869 and attracts a million visitors.'},runs=runs,model=check_model(),effort='low')
 print(json.dumps({'check':result,'runs':runs},ensure_ascii=False))
 assert result.get('grounded') is False,'check model should reject a fabricated explanation'
asyncio.run(main())
