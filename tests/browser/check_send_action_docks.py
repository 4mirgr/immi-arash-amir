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
harness="""import React,{useState} from 'REPO/node_modules/react/index.js';import {createRoot} from 'REPO/node_modules/react-dom/client.js';import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';import {OpportunityBulkMail} from 'REPO/src/opportunity-bulk-mail.jsx';import 'REPO/src/workspace-style.css';const opportunities=['a','b'].map(x=>({id:'opp_'+x.repeat(32),title:'Synthetic vacancy '+x,organization:'Synthetic clinic '+x}));function App(){const[bulk,setBulk]=useState(false),[single,setSingle]=useState('a');window.setBulk=setBulk;window.setSingle=setSingle;return <main><div style={{height:80}}/><div style={{overflow:'hidden',transform:'translateZ(0)'}}>{bulk?<OpportunityBulkMail person='arash' opportunities={opportunities} onClose={()=>{}} onOpenSettings={()=>{}}/>:<OpportunityMail key={single} person='arash' opportunity={{id:'opp_'+single.repeat(32),title:'Synthetic vacancy '+single,organization:'Synthetic clinic '+single}}/>}</div></main>}createRoot(document.getElementById('root')).render(<App/>);""".replace('REPO',repo.as_posix())
script='import {build} from "esbuild";await build('+json.dumps({'stdin':{'contents':harness,'resolveDir':str(repo),'sourcefile':'send-docks.jsx','loader':'jsx'},'outfile':str(root/'app.js'),'bundle':True,'format':'esm','external':['/fonts/*'],'logLevel':'silent'})+');'
subprocess.run(['node','--input-type=module','-e',script],cwd=repo,check=True)
(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo/'public/fonts',root/'fonts');server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
cv='11111111-1111-4111-8111-111111111111';preset='22222222-2222-4222-8222-222222222222';writes=[];errors=[];sender='arash@example.invalid';template='GP B — Independent practice enquiry';quote='Synthetic clinic continuity of care.';cvquote='Synthetic GP experience.';body='Synthetic evidence-based letter.\n\n'+'Synthetic practice detail.\n'*40
scenario='normal';pending=[]

def route(r):
 u=urlparse(r.request.url);path=u.path;payload=json.loads(r.request.post_data or '{}');id=next((s for s in path.split('/') if s.startswith('opp_')),'opp_'+'a'*32);recipient=payload.get('recipient') or 'manager'+id[-1]+'@example.invalid'
 if r.request.method!='GET':writes.append(path)
 if path.endswith('/cv/versions'):d=[{'id':cv,'name':'Synthetic CV','isDefault':True}]
 elif path.endswith('/presets'):d=[{'id':preset,'name':template,'isDefault':True}]
 elif path.endswith('/google/status'):d={'connected':True,'email':sender,'capabilities':{'gmailSend':True}}
 elif path.endswith('/mail'):d={'opportunityId':id,'url':'https://example.invalid/job','trust':'official','publishedRecipients':[recipient]+(['manager2'+id[-1]+'@example.invalid'] if scenario=='partial' else []),'scheduling':{'enabled':False,'approvals':[]}}
 elif path.endswith('/package'):d={'profileId':'arash','opportunityId':id,'cvVersionId':cv,'variant':'B','templateName':template,'previewBody':body,'body':body,'readyForReview':True,'subjects':['Synthetic application'],'suggestedSelection':{'clinicQuote':quote,'cvQuote':cvquote}}
 elif path.endswith('/preview'):d={'opportunityId':id,'mailbox':payload['mailbox'],'presetId':preset,'cvVersionId':cv,'sender':sender,'message':{'subject':'Synthetic application','body':body},'reviewHash':'synthetic-hash','recipients':[{'recipient':recipient,'status':'preview','cvVersionId':cv,'subject':'Synthetic application','attachmentName':'synthetic.docx'}],'excluded':[]}
 elif path.endswith('/queue'):
  assert payload['confirmReviewed'] is True and payload['reviewHash']=='synthetic-hash'
  d={'opportunityId':id,'mailbox':'primary','items':[{'id':'queue-'+recipient,'recipient':recipient,'sender':sender,'cvVersionId':cv,'subject':'Synthetic application','attachmentName':'synthetic.docx','status':'queued','reused':False}]}
 elif path.endswith('/dispatch'):
  if scenario=='partial' and 'manager2' in payload['ids'][0]:pending.append((r,payload['ids'][0]));return
  d={'items':[{'id':payload['ids'][0],'status':'sent'}]}
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
  for font_size in ['100%','140%']:
   page.set_viewport_size({'width':width,'height':780});page.evaluate("document.documentElement.style.fontSize="+json.dumps(font_size)+";window.scrollTo(0,document.body.scrollHeight)");expect(floating).to_be_in_viewport();assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 floating.locator('button').click();expect(floating.locator('button')).to_be_disabled();page.wait_for_timeout(250);assert sum('/dispatch' in x for x in writes)==3,writes;assert not errors,errors
 scenario='partial';page.evaluate("window.setBulk(false);window.setSingle('c')");dock=page.locator('.send-action-dock-inline');dock.locator('button').click();expect(page.locator('.opportunity-recipient-preview')).to_have_count(2);page.locator('.opportunity-mail-review>.checkline input').check()
 with page.expect_request(lambda request:'/dispatch' in request.url and 'manager2' in (request.post_data or '')):
  dock.locator('button').click()
 expect(dock.locator('button')).to_have_text('در حال ارسال…');expect(dock.locator('button')).to_be_disabled();expect(dock.locator('.send-progress-summary')).to_contain_text('۱ از ۲')
 assert len(pending)==1;pending[0][0].fulfill(json={'items':[{'id':pending[0][1],'status':'delivery_unknown'}]});expect(dock.locator('button')).to_have_text('نتیجهٔ ارسال را بررسی کنید');expect(dock.locator('.send-progress-summary')).to_contain_text('۱ از ۲');assert dock.locator('button').get_attribute('data-delivery-state')=='unknown';assert sum('/dispatch' in x for x in writes)==5;expect(dock.get_by_text('ارسال شد',exact=True)).to_have_count(0);expect(dock.locator('button')).to_be_disabled()
 assert not errors,errors
 browser.close();server.shutdown()
print('PASS viewport-green individual/batch actions: explicit review, one final send, clipped-parent escape, large-font mobile/desktop, pending and partial-unknown outcomes, no replay. Synthetic transport only.')
