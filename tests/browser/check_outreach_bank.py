"""Real UI regression using synthetic owners, ads and private clinic URLs; no sends."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import json,subprocess,tempfile,threading,shutil,re
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 harness="""import React from 'react';import {createRoot} from 'react-dom/client';import {JobOpportunitiesPanel} from './job-opportunities-panel';import {LanguageControl} from './language-control';import './style.css';createRoot(document.getElementById('root')).render(<div className="app arash-workspace"><main className="main"><LanguageControl personId="arash"/><JobOpportunitiesPanel person="arash" notify={()=>{}}/></main></div>);"""
 config={'stdin':{'contents':harness,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts',dirs_exist_ok=True)
 (root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=work));threading.Thread(target=server.serve_forever,daemon=True).start()
 ad={'id':'opp_'+'a'*32,'title':'General Practitioner','organization':'Synthetic Clinic','url':'https://clinic.example/careers','country':'AU','state':'NSW','status':'open','trust':'official','opportunityType':'job','publishedRecipientCount':1,'firstParty':True}
 writes=[];cadences=[];errors=[]
 def route(r):
  u=urlparse(r.request.url);q=parse_qs(u.query);path=u.path
  if r.request.method!='GET':writes.append(path);r.fulfill(status=403,json={'error':'No writes allowed in this test'});return
  if path=='/api/opportunities':data={'opportunities':[ad],'total':1}
  elif path=='/api/opportunities/sources':data={'sources':[],'automation':{}}
  elif path=='/api/mail-automation/suggestions':cadences.append(q.get('cadence'));data={'suggestions':[ad],'profileId':'arash','automaticSending':False}
  elif path=='/api/clinic-bank/status':data={'counts':{'total':5233,'read':2,'withContacts':1,'pending':5231},'enabled':True}
  elif path=='/api/clinic-bank/items':data={'items':[{'id':'bank_a','name':'Synthetic Clinic','url':'https://clinic.example/','status':'public_contacts_found','stale':False,'contacts':[{'type':'email','value':'jobs@clinic.example','sourceURL':'https://clinic.example/contact'}]}]}
  elif path=='/api/opportunities/'+ad['id']+'/mail':data={'opportunityId':ad['id'],'publishedRecipients':['jobs@clinic.example'],'url':ad['url'],'trust':'official','scheduling':{'enabled':False}}
  elif path=='/api/google/status':data={'connected':False}
  elif path in ['/api/cv/versions','/api/presets']:data=[]
  else:data={}
  r.fulfill(json=data)
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:errors.append(str(e)));page.add_init_script("localStorage.setItem('masir:language:v1:arash','en')");page.route('**/api/**',route)
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle')
  expect(page.locator('.arash-row-quick-actions button')).to_be_visible();expect(page.locator('.arash-row-quick-actions button')).to_have_text('Send email')
  page.locator('.periodic-outreach select').select_option('weekly');expect(page.locator('.periodic-outreach-items article')).to_have_count(1)
  page.locator('.opportunity-bulk-choice input').check();expect(page.locator('.opportunity-batch-launcher')).to_be_visible();page.evaluate('window.scrollTo(0,document.body.scrollHeight)');box=page.locator('.opportunity-batch-launcher button').bounding_box();assert box and 0<=box['y']<844
  page.locator('.clinic-bank-panel>summary').click();expect(page.locator('.clinic-bank-counts')).to_contain_text('5,233');expect(page.locator('.clinic-bank-items article')).to_have_count(1)
  page.locator('.clinic-bank-items details').evaluate('(e)=>e.open=true');expect(page.locator('.clinic-bank-contact')).to_contain_text('jobs@clinic.example')
  assert not re.search(r'[\u0600-\u06ff]',page.locator('.clinic-bank-panel').inner_text()),page.locator('.clinic-bank-panel').inner_text()
  assert not re.search(r'[\u0600-\u06ff]',page.locator('.periodic-outreach').inner_text()),page.locator('.periodic-outreach').inner_text()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.locator('.arash-row-quick-actions button').click();expect(page.locator('.send-action-dock-inline')).to_be_visible()
  assert ['weekly'] in cadences;assert not writes,writes;assert not errors,errors;b.close()
 server.shutdown()
print('PASS direct per-ad CTA, floating selection launcher, periodic suggestions, private bank source details and English mobile layout; GET-only.')
