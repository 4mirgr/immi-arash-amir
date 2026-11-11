"""Real-component send controls with synthetic provider endpoints only.
Checks reachable mobile/desktop actions, explicit review and no accidental replay.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from urllib.parse import urlparse,parse_qs
import tempfile,subprocess,json,shutil,threading
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2];work=tempfile.TemporaryDirectory();root=Path(work.name)
harness="""import React,{useState} from 'REPO/node_modules/react/index.js';import {createRoot} from 'REPO/node_modules/react-dom/client.js';import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';import {OpportunityBulkMail} from 'REPO/src/opportunity-bulk-mail.jsx';import 'REPO/src/workspace-style.css';const opportunities=['a','b'].map(x=>({id:'opp_'+x.repeat(32),title:'Synthetic vacancy '+x,organization:'Synthetic clinic '+x}));function App(){const[bulk,setBulk]=useState(false);window.setBulk=setBulk;return <main><div style={{height:80}}/>{bulk?<OpportunityBulkMail person='arash' opportunities={opportunities} onClose={()=>{}} onOpenSettings={()=>{}}/>:<OpportunityMail person='arash' opportunity={opportunities[0]}/>}</main>}createRoot(document.getElementById('root')).render(<App/>);""".replace('REPO',repo.as_posix())
script='import {build} from "esbuild";await build('+json.dumps({'stdin':{'contents':harness,'resolveDir':str(repo),'sourcefile':'send-docks.jsx','loader':'jsx'},'outfile':str(root/'app.js'),'bundle':True,'format':'esm','external':['/fonts/*'],'logLevel':'silent'})+');'
subprocess.run(['node','--input-type=module','-e',script],cwd=repo,check=True)
(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo/'public/fonts',root/'fonts');server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
cv='11111111-1111-4111-8111-111111111111';preset='22222222-2222-4222-8222-222222222222';writes=[];errors=[];sender='arash@example.invalid';template='GP B — Independent practice enquiry';quote='Synthetic clinic continuity of care.';cvquote='Synthetic GP experience.';body='Synthetic evidence-based letter.\n\n'+'Synthetic practice detail.\n'*40

def route(r):
 u=urlparse(r.request.url);path=u.path;payload=json.loads(r.request.post_data or '{}');id=next((s for s in path.split('/') if s.startswith('opp_')),'opp_'+'a'*32);recipient='manager'+id[-1]+'@example.invalid'
 if r.request.method!='GET':writes.append(path)
 if path.endswith('/cv/versions'):d=[{'id':cv,'name':'Synthetic CV','isDefault':True}]
 elif path.endswith('/presets'):d=[{'id':preset,'name':template,'isDefault':True}]
 elif path.endswith('/google/status'):d={'connected':True,'email':sender,'capabilities':{'gmailSend':True}}
 elif path.endswith('/mail'):d={'opportunityId':id,'url':'https://example.invalid/job','trust':'official','publishedRecipients':[recipient],'scheduling':{'enabled':False,'approvals':[]}}
 elif path.endswith('/package'):d={'profileId':'arash','opportunityId':id,'cvVersionId':cv,'variant':'B','templateName':template,'previewBody':body,'body':body,'readyForReview':True,'subjects':['Synthetic application'],'suggestedSelection':{'clinicQuote':quote,'cvQuote':cvquote}}
 elif path.endswith('/preview'):d={'opportunityId':id,'mailbox':payload['mailbox'],'presetId':preset,'cvVersionId':cv,'sender':sender,'message':{'subject':'Synthetic application','body':body},'reviewHash':'synthetic-hash','recipients':[{'recipient':recipient,'status':'preview','cvVersionId':cv,'subject':'Synthetic application','attachmentName':'synthetic.docx'}],'excluded':[]}
 elif path.endswith('/queue'):
  assert payload['confirmReviewed'] is True and payload['reviewHash']=='synthetic-hash'
  d={'opportunityId':id,'mailbox':'primary','items':[{'id':'queue-'+id[-1],'recipient':recipient,'sender':sender,'cvVersionId':cv,'subject':'Synthetic application','attachmentName':'synthetic.docx','status':'queued','reused':False}]}
 elif path.endswith('/dispatch'):d={'items':[{'id':payload['ids'][0],'status':'sent'}]}
 else:raise AssertionError(path)
 r.fulfill(json=d)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':780});page.route('**/api/**',route);page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:'+str(server.server_port));dock=page.locator('.send-action-dock-inline');expect(dock.locator('button')).to_be_enabled();dock.locator('button').click();expect(page.locator('.opportunity-recipient-preview')).to_be_visible();assert not any('/queue' in x or '/dispatch' in x for x in writes)
 dock.locator('button').click();assert not any('/queue' in x or '/dispatch' in x for x in writes)
 page.locator('.opportunity-mail-review>.checkline input').check();page.evaluate('window.scrollTo(0,document.body.scrollHeight)');expect(dock).to_be_in_viewport();dock.locator('button').click();expect(page.locator('.opportunity-mail-queued')).to_contain_text('Gmail ارسال را تأیید کرد');expect(dock.locator('button')).to_be_disabled();assert sum('/dispatch' in x for x in writes)==1
 page.evaluate('window.setBulk(true)');floating=page.locator('.send-action-dock-floating');expect(floating.locator('button')).to_be_enabled();floating.locator('button').click();expect(page.locator('.bulk-mail-draft')).to_have_count(2);floating.locator('button').click();assert sum('/dispatch' in x for x in writes)==1
 page.locator('.bulk-mail-draft>.checkline input').count()
 for node in page.locator('.bulk-mail-draft > .checkline input').all():node.check()
 floating.locator('button').click();expect(page.locator('.bulk-mail-final')).to_be_visible();floating.locator('button').click();assert sum('/dispatch' in x for x in writes)==1
 page.locator('.bulk-mail-final > .checkline input').check()
 for width in [390,1440]:
  page.set_viewport_size({'width':width,'height':780});page.evaluate('window.scrollTo(0,document.body.scrollHeight)');expect(floating).to_be_in_viewport();assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 floating.locator('button').click();expect(floating.locator('button')).to_be_disabled();page.wait_for_timeout(250);assert sum('/dispatch' in x for x in writes)==3,writes;assert not errors,errors
 browser.close();server.shutdown()
print('PASS mobile individual action and floating batch: preview + explicit review required; synthetic sends once; reachable after scroll, no overflow.')
