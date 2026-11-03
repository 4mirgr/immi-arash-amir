"""Local development API. NOT an internet-facing authenticated service."""
import json, os, sqlite3, uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
PROFILES=('arash','amir')
DEFAULT_SETTINGS={'emailPolicy':'auto_after_connection','defaultTemplate':'','notifications':False}
STATIONS=[{'id':'PESCI-EDU-001','title':'Chest pain in a rural clinic','prompt':'A 58-year-old patient presents with 30 minutes of central chest pressure and diaphoresis. You are the GP in a rural clinic. Describe your immediate assessment, emergency escalation and safe handover.','questions':['What immediate threats will you assess?','How will you activate emergency assistance?','What clinical information will you communicate at handover?'],'rubric':['Recognises potential acute coronary syndrome and prioritises ABC assessment.','Arranges urgent emergency transfer and follows current local emergency protocols.','Communicates clearly, considers consent and documents actions.'],'minutes':10,'educational':True,'disclaimer':'Original educational practice case. Timing is configurable practice timing, not a verified official PESCI format. Not clinical advice.'}]

def load_stations(directory=None):
    """Adapt versioned repository exercises to the UI contract without losing metadata."""
    folder=Path(directory) if directory is not None else Path(__file__).resolve().parents[1]/'library'/'pesci'
    stations=[]
    for path in sorted(folder.glob('*.json')):
        item=json.loads(path.read_text(encoding='utf-8'))
        stations.append({**item,'prompt':item['case'],'questions':item['prompts'],
                         'rubric':item['reflection_rubric'],
                         'minutes':item['timing']['practice_seconds']/60,'educational':True})
    return stations or STATIONS

def connect(data_dir=None):
    directory=Path(data_dir or os.getenv('IMMI_DATA_DIR','private')); directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    db=sqlite3.connect(directory/'immi.sqlite3'); db.execute('pragma foreign_keys=on'); return db

def initialize(db):
    for table in ('clinics','profiles'):
        db.execute(f'create table if not exists {table}(id text primary key,data text not null)')
    db.execute('create table if not exists drafts(id text primary key,profile_id text not null,data text not null)')
    db.execute('create table if not exists settings(profile_id text primary key,data text not null)')
    for id,name,role in [('arash','Dr Arash Entezar','GP / PESCI'),('amir','Dr Amir Houshang Gerami','Internal medicine / specialist pathways')]:
        db.execute('insert or ignore into profiles values (?,?)',(id,json.dumps(dict(id=id,name=name,role=role,cvText='',verification='user_supplied_unverified'))))
    db.commit()

def profile_id(value):
    if value not in PROFILES: raise ValueError('Unknown profile')
    return value

def save_draft(db,payload):
    profile=profile_id(payload.get('profileId'))
    subject=payload.get('subject',''); body=payload.get('body',''); clinics=payload.get('clinicIds',[])
    if not isinstance(subject,str) or not isinstance(body,str) or not subject.strip() or not body.strip(): raise ValueError('Subject and body are required')
    if not isinstance(clinics,list) or len(clinics)>200 or any(not isinstance(i,str) for i in clinics): raise ValueError('Invalid recipients')
    for id in clinics:
        if not db.execute('select 1 from clinics where id=?',(id,)).fetchone(): raise ValueError('Unknown clinic')
    item=dict(id=str(uuid.uuid4()),profileId=profile,clinicIds=list(dict.fromkeys(clinics)),subject=subject[:500],body=body[:50000],status='draft')
    db.execute('insert into drafts values (?,?,?)',(item['id'],profile,json.dumps(item)));db.commit(); return item

def list_drafts(db,profile):
    return [json.loads(r[0]) for r in db.execute('select data from drafts where profile_id=?',(profile_id(profile),))]

class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): pass # Do not log private request content.
    def send(self,data,status=200):
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(raw)
    def do_GET(self): self.handle_api('GET')
    def do_POST(self): self.handle_api('POST')
    def do_PUT(self): self.handle_api('PUT')
    def handle_api(self,method):
        # Local-only prototype: profile selector is NOT authorization.
        host=self.headers.get('Host','').split(':')[0]
        if host not in ('127.0.0.1','localhost'): return self.send({'error':'Local development only'},403)
        origin=self.headers.get('Origin')
        if origin and urlparse(origin).hostname not in ('localhost','127.0.0.1'): return self.send({'error':'Origin rejected'},403)
        db=connect()
        try:
            parsed=urlparse(self.path); path=parsed.path; profile=profile_id(parse_qs(parsed.query).get('profile',['arash'])[0])
            def rows(table):return [json.loads(r[0]) for r in db.execute(f'select data from {table}')]
            settings_row=db.execute('select data from settings where profile_id=?',(profile,)).fetchone(); settings=json.loads(settings_row[0]) if settings_row else dict(DEFAULT_SETTINGS)
            if method=='GET':
                integrations={k:{'connected':False,'status':'setup_required'} for k in ('gmail','drive','calendar','telegram','ai','crawler')}
                data={'/api/health':{'ok':True,'mode':'local_demo','authenticated':False},'/api/clinics':lambda:rows('clinics'),'/api/profiles':lambda:rows('profiles'),'/api/stations':load_stations,'/api/settings':settings,'/api/drafts':lambda:list_drafts(db,profile),'/api/bootstrap':lambda:dict(clinics=rows('clinics'),profiles=rows('profiles'),stations=load_stations(),settings=settings,integrations=integrations)}
                if path not in data:return self.send({'error':'Not found'},404)
                value=data[path];return self.send(value() if callable(value) else value)
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>100000:return self.send({'error':'Invalid payload size'},413)
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):raise ValueError('Object required')
            if method=='POST' and path=='/api/drafts':return self.send(save_draft(db,payload),201)
            if method=='PUT' and path=='/api/settings':
                if payload.get('emailPolicy','auto_after_connection') not in ('approval_required','auto_after_connection'):raise ValueError('Unknown email policy')
                settings.update({k:payload[k] for k in DEFAULT_SETTINGS if k in payload});db.execute('insert or replace into settings values (?,?)',(profile,json.dumps(settings)));db.commit();return self.send(settings)
            return self.send({'error':'Not found'},404)
        except (ValueError,TypeError,KeyError) as e:self.send({'error':str(e)},400)
        finally:db.close()

def main():
    host=os.getenv('IMMI_HOST','127.0.0.1')
    if host!='127.0.0.1':raise SystemExit('Refusing non-loopback binding: implement real authentication and authorization before public deployment.')
    db=connect();initialize(db);db.close()
    server=ThreadingHTTPServer((host,int(os.getenv('IMMI_PORT','8787'))),Handler)
    print('Local development API: http://127.0.0.1:8787',flush=True);server.serve_forever()
if __name__=='__main__':main()
