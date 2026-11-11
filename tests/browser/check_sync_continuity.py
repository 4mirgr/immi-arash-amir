"""Optional real-component regression: python tests/browser/check_sync_continuity.py.
Requires Playwright Python + Chromium; all API/provider calls are synthetic.
"""
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from urllib.parse import urlparse,parse_qs
import threading,json,re,tempfile,subprocess,shutil
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
work=tempfile.TemporaryDirectory();root=Path(work.name)
(root/'index.html').write_text('<div id="root"></div><script type="module" src="/app.js"></script><link rel="stylesheet" href="/app.css">')
(root/'harness.jsx').write_text('import React,{useState} from '+json.dumps(str(repo/'node_modules/react/index.js'))+';import {createRoot} from '+json.dumps(str(repo/'node_modules/react-dom/client.js'))+';import {JobOpportunitiesPanel} from '+json.dumps(str(repo/'src/job-opportunities-panel.jsx'))+';import '+json.dumps(str(repo/'src/workspace-style.css'))+';function App(){const[person,setPerson]=useState("arash");window.__setOwner=setPerson;return <div className="app arash-workspace"><main className="main"><JobOpportunitiesPanel key={person} person={person} workspaceOwnerId={person==="arash"?"11111111-1111-4111-8111-111111111111":"22222222-2222-4222-8222-222222222222"} notify={()=>{}} onOpenSettings={()=>{}}/></main></div>};createRoot(document.getElementById("root")).render(<App/>);')
subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps({'entryPoints':[str(root/'harness.jsx')],'outfile':str(root/'app.js'),'bundle':True,'format':'esm','external':['/fonts/*'],'logLevel':'silent'})+');'],cwd=repo,check=True)
shutil.copytree(repo/'public/fonts',root/'fonts')
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
cv='11111111-1111-4111-8111-111111111111';cv2='22222222-2222-4222-8222-222222222222';preset='33333333-3333-4333-8333-333333333333';opp='opp_'+'a'*32
clinic='Synthetic clinic provides community general practice and teaching.';strength='Synthetic own CV clinical experience and continuity of care.'
body='Dear Practice Manager,\n\nI am a general practitioner with more than five years of clinical experience. This is synthetic text, not an actual application.\n\nSynthetic Coastal Practice provides community general practice and teaching. Its continuity of care and clinical team are relevant to my experience.\n\nMy synthetic own clinical experience would support the team.\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nKind regards,\nSynthetic Doctor'
calls=[];posts=[];missing=[];policy={'ready':False};approvals=[]
fail_poll=False;reorder=False
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(7000);page.clock.install()
 def route(r):
  u=urlparse(r.request.url);path=u.path;q=parse_qs(u.query);owner=q.get('profile',['arash'])[0];method=r.request.method;payload=json.loads(r.request.post_data or '{}');calls.append((method,path,owner));data={}
  if method!='GET':posts.append((path,payload))
  if path=='/api/opportunities' and fail_poll:
   r.fulfill(status=503,json={'error':'temporary_network_issue'});return
  if path=='/api/opportunities':data={'opportunities':[{'id':'opp_'+letter*32,'title':'General Practitioner — '+name,'organization':name,'state':'NSW' if letter=='a' else 'QLD','country':'AU','status':'open','kind':'vacancy','summary':'Synthetic clinical role.','url':'https://example.invalid/job/'+letter,'contactEvidence':[{'type':'email','value':'clinic@example.invalid'}],'gpApplicationPriority':{'tier':3,'stars':3,'label':'شواهد مرتبط برای بررسی'}} for letter,name in [('a','Synthetic Coastal Practice'),('b','Synthetic Rural Clinic')]],'total':2,'goalMode':'employment'}
  elif path=='/api/opportunities/sources':data={'sources':[],'automation':{'observed':True,'status':'completed','overdue':False}}
  elif path=='/api/cv/versions':data=[{'id':cv,'name':'Synthetic Current CV','isDefault':True},{'id':cv2,'name':'Synthetic Alternate CV','isDefault':False}]
  elif path=='/api/presets':data=[{'id':preset,'name':'GP B — Independent practice enquiry','subject':'Synthetic subject one','isDefault':True}]
  elif path=='/api/gp-workflow/settings':data={'goalMode':'employment'}
  elif path.startswith('/api/gp-workflow/opportunities/'):data={'opportunityId':path.rsplit('/',1)[1],'stage':'clinic_identified','note':'','assessment':{'tier':3,'stars':3,'label':'Synthetic fit','nextSteps':[]},'stages':[]}
  elif '/package' in path:
   id=path.split('/')[-2];chosen=payload.get('cvVersionId',q.get('cvVersionId',[cv])[0]);data={'profileId':owner,'opportunityId':id,'cvVersionId':chosen,'variant':'B','recommendedVariant':'B','templateName':'GP B — Independent practice enquiry','subjects':['Synthetic subject one','Synthetic subject two','Synthetic subject three'],'body':body if method=='POST' else '{{clinicEvidence}} {{cvEvidence}}','previewBody':body,'previewStatus':'unreviewed_suggestion','paragraphs':{},'dossier':{'name':{'value':'Synthetic Coastal Practice','status':'source_statement','sourceUrl':'https://example.invalid/job/a'}},'recipients':['clinic@example.invalid'],'readyForReview':method=='POST','missingFields':[] if method=='POST' else ['clinic_quote_required','cv_quote_required','cv_confirmation_required'],'clinicEvidenceCandidates':[{'text':clinic,'sourceUrl':'https://example.invalid/job/a'}],'cvEvidenceCandidates':[{'text':strength,'source':'own_cv_self_reported'}],'suggestedSelection':{'clinicQuote':clinic,'cvQuote':strength},'provenance':[],'registrationCautions':[],'contactDiscovery':{'status':'found'},'namedContactCandidates':[]}
  elif path=='/api/google/status':data={'configured':True,'connected':True,'email':owner+('2' if q.get('mailbox')==['secondary'] else '')+'@example.invalid','capabilities':{'gmailSend':True}}
  elif path.endswith('/mail/preview'):data={'sender':owner+'@example.invalid','recipients':[{'recipient':'clinic@example.invalid','attachmentName':'Synthetic CV.pdf'}],'mailbox':payload['mailbox'],'opportunityId':path.split('/')[-3],'reviewHash':'synthetic-review','message':{'subject':'Synthetic subject two','body':body},'dailyLimit':3}
  elif path.endswith('/mail/schedule'):
   approval={'id':'approval-synthetic','jobId':'job-synthetic','status':'approved','sendAfter':payload['sendAfter'],'expiresAt':payload['sendAfter']};approvals.append(approval);data={'approval':approval,'items':[{'id':'job-synthetic','status':'queued','recipient':'clinic@example.invalid','sender':owner+'@example.invalid','cvVersionId':payload['cvVersionId'],'subject':'Synthetic subject two','attachmentName':'Synthetic CV.pdf','reused':False}],'opportunityId':opp,'mailbox':payload['mailbox'],'sent':False}
  elif path.endswith('/mail'):data={'opportunityId':path.split('/')[-2],'title':'Synthetic GP role','url':'https://example.invalid/job/a','publishedRecipients':['clinic@example.invalid'],'recipientDetails':[],'scheduling':{'enabled':True,'modeReady':policy['ready'],'maxHours':23.5,'approvals':approvals}}
  elif path=='/api/mail-automation/scheduler':data={'enabled':True,'approvals':approvals}
  elif path=='/api/mail-automation/settings':policy['ready']=True;data={'settings':{'requestedMode':'automatic'}}
  else:missing.append((method,path));data={}
  if path=='/api/opportunities' and reorder:data['opportunities']=data['opportunities'][1:];data['total']=1
  r.fulfill(json=data)

 page.route('**/api/**',route)
 def start():
  page.goto('http://127.0.0.1:'+str(server.server_port));page.locator('.arash-opportunity-row').first.wait_for()
 start();page.locator('.arash-opportunity-toggle').first.click();page.get_by_role('region',name='متن نامهٔ پیشنهادی',exact=True).wait_for()
 page.get_by_label('نسخهٔ رزومهٔ بستهٔ GP',exact=True).select_option(cv2);page.get_by_role('region',name='متن نامهٔ پیشنهادی',exact=True).wait_for();page.get_by_label('موضوع پیشنهادی نامه').select_option('1')
 page.wait_for_timeout(200)
 fail_poll=True;before=len(calls);page.clock.run_for(10050);page.wait_for_timeout(200);assert len(calls)>before
 assert page.locator('.arash-opportunity-inline').count()==1,'Poll failure discarded open letter'
 assert page.get_by_label('نسخهٔ رزومهٔ بستهٔ GP',exact=True).input_value()==cv2
 assert page.get_by_label('موضوع پیشنهادی نامه').input_value()=='1'
 fail_poll=False;page.evaluate('window.dispatchEvent(new Event("online"))');page.wait_for_timeout(250)
 page.get_by_label('متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.').check();page.get_by_role('button',name='تأیید متن و انتخاب فرستنده',exact=True).click();page.get_by_role('button',name='پیش‌نمایش نهایی ایمیل',exact=True).wait_for()
 fail_poll=True;page.clock.run_for(10050);page.wait_for_timeout(200);assert page.get_by_role('button',name='پیش‌نمایش نهایی ایمیل',exact=True).count()==1,'Poll failure discarded mail step'
 fail_poll=False;reorder=True;page.evaluate('window.dispatchEvent(new Event("online"))');page.wait_for_timeout(350)
 assert page.get_by_role('button',name='پیش‌نمایش نهایی ایمیل',exact=True).count()==1,'Successful list reordering discarded the current mail step'
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 reorder=False;page.reload();page.get_by_role('region',name='متن نامهٔ پیشنهادی',exact=True).wait_for()
 assert page.get_by_label('نسخهٔ رزومهٔ بستهٔ GP',exact=True).input_value()==cv2
 assert page.get_by_label('موضوع پیشنهادی نامه').input_value()=='1'
 assert not page.get_by_label('متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.').is_checked(),'Checkpoint restored send consent'
 page.evaluate("window.__setOwner('amir')");page.locator('.opportunity-result-card').first.wait_for();assert page.locator('.arash-opportunity-inline').count()==0
 assert not errors,errors
 assert not any('/queue' in path or '/schedule' in path or 'dispatch' in path for path,_ in posts),posts
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 print('PASS: transient poll preserves letter/mail; own UI selections resume after reload without consent; other owner isolated; no sends.')
 b.close();server.shutdown()
