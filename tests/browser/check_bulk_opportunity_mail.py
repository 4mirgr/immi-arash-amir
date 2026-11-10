"""Optional real-component regression: python tests/browser/check_bulk_opportunity_mail.py.
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
(root/'harness.jsx').write_text('import React,{useState} from '+json.dumps(str(repo/'node_modules/react/index.js'))+';import {createRoot} from '+json.dumps(str(repo/'node_modules/react-dom/client.js'))+';import {JobOpportunitiesPanel} from '+json.dumps(str(repo/'src/job-opportunities-panel.jsx'))+';import '+json.dumps(str(repo/'src/style.css'))+';function App(){const[person,setPerson]=useState("arash");window.__setOwner=setPerson;return <div className="app arash-workspace"><main className="main"><JobOpportunitiesPanel key={person} person={person} workspaceOwnerId={person==="arash"?"11111111-1111-4111-8111-111111111111":"22222222-2222-4222-8222-222222222222"} notify={()=>{}} onOpenSettings={()=>{}}/></main></div>};createRoot(document.getElementById("root")).render(<App/>);')
subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps({'entryPoints':[str(root/'harness.jsx')],'outfile':str(root/'app.js'),'bundle':True,'format':'esm','external':['/fonts/*'],'logLevel':'silent'})+');'],cwd=repo,check=True)
shutil.copytree(repo/'public/fonts',root/'fonts')
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
cv='11111111-1111-4111-8111-111111111111';cv2='22222222-2222-4222-8222-222222222222';preset='33333333-3333-4333-8333-333333333333';opp='opp_'+'a'*32
clinic='Synthetic clinic provides community general practice and teaching.';strength='Synthetic own CV clinical experience and continuity of care.'
body='Dear Practice Manager,\n\nI am a general practitioner with more than five years of clinical experience. This is synthetic text, not an actual application.\n\nSynthetic Coastal Practice provides community general practice and teaching. Its continuity of care and clinical team are relevant to my experience.\n\nMy synthetic own clinical experience would support the team.\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nKind regards,\nSynthetic Doctor'
calls=[];posts=[];missing=[];policy={'ready':False};approvals=[];queue_rows={}
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
   id=path.split('/')[-2];clinic_name='Synthetic Coastal Practice' if id=='opp_'+'a'*32 else 'Synthetic Rural Clinic';current_body=body.replace('Synthetic Coastal Practice',clinic_name);current_quote=clinic.replace('Synthetic clinic',clinic_name);chosen=payload.get('cvVersionId',q.get('cvVersionId',[cv])[0]);data={'profileId':owner,'opportunityId':id,'cvVersionId':chosen,'variant':'B','recommendedVariant':'B','templateName':'GP B — Independent practice enquiry','subjects':[clinic_name+' — enquiry','Synthetic subject two','Synthetic subject three'],'body':current_body if method=='POST' else '{{clinicEvidence}} {{cvEvidence}}','previewBody':current_body,'previewStatus':'unreviewed_suggestion','paragraphs':{},'dossier':{'name':{'value':'Synthetic Coastal Practice','status':'source_statement','sourceUrl':'https://example.invalid/job/a'}},'recipients':['clinic@example.invalid'],'readyForReview':method=='POST','missingFields':[] if method=='POST' else ['clinic_quote_required','cv_quote_required','cv_confirmation_required'],'writingStatus':{'issues':[{'code':'synthetic_conflict','message':'Synthetic review note: confirm dates.'}]},'clinicEvidenceCandidates':[{'text':current_quote,'sourceUrl':'https://example.invalid/job/a'}],'cvEvidenceCandidates':[{'text':strength,'source':'own_cv_self_reported'}],'suggestedSelection':{'clinicQuote':current_quote,'cvQuote':strength},'provenance':[],'registrationCautions':[],'contactDiscovery':{'status':'found'},'namedContactCandidates':[]}
  elif path=='/api/google/status':data={'configured':True,'connected':True,'email':owner+('2' if q.get('mailbox')==['secondary'] else '')+'@example.invalid','capabilities':{'gmailSend':True}}
  elif path.endswith('/mail/preview'):
   oid=path.split('/')[-3];recipient=payload['recipient'];clinic_name='Synthetic Coastal Practice' if oid=='opp_'+'a'*32 else 'Synthetic Rural Clinic';subject=clinic_name+' — enquiry';assert payload['application']['clinicQuote']==clinic.replace('Synthetic clinic',clinic_name);data={'sender':owner+'@example.invalid','recipients':[{'recipient':recipient,'attachmentName':'Synthetic CV.pdf','subject':subject,'cvVersionId':payload['cvVersionId'],'status':'preview','existingId':None}],'mailbox':payload['mailbox'],'opportunityId':oid,'presetId':payload['presetId'],'cvVersionId':payload['cvVersionId'],'reviewHash':'synthetic-review-'+recipient,'message':{'subject':subject,'body':body.replace('Synthetic Coastal Practice',clinic_name)},'dailyLimit':20,'reservedToday':0}
  elif path.endswith('/mail/queue'):
   oid=path.split('/')[-3];recipient=payload['recipient'];clinic_name='Synthetic Coastal Practice' if oid=='opp_'+'a'*32 else 'Synthetic Rural Clinic';qid='queue-'+str(len(queue_rows)+1);item={'id':qid,'recipient':recipient,'sender':owner+'@example.invalid','cvVersionId':payload['cvVersionId'],'subject':clinic_name+' — enquiry','attachmentName':'Synthetic CV.pdf','status':'queued','reused':False};queue_rows[qid]=item;data={'opportunityId':oid,'mailbox':payload['mailbox'],'items':[item]}
  elif path=='/api/google/mail/dispatch':
   item=queue_rows[payload['ids'][0]];data={'items':[{**item,'status':'sent','gmailMessageId':'synthetic-gmail'}]}
  elif path.endswith('/mail/schedule'):
   approval={'id':'approval-synthetic','jobId':'job-synthetic','status':'approved','sendAfter':payload['sendAfter'],'expiresAt':payload['sendAfter']};approvals.append(approval);data={'approval':approval,'items':[{'id':'job-synthetic','status':'queued','recipient':'clinic@example.invalid','sender':owner+'@example.invalid','cvVersionId':payload['cvVersionId'],'subject':'Synthetic subject two','attachmentName':'Synthetic CV.pdf','reused':False}],'opportunityId':opp,'mailbox':payload['mailbox'],'sent':False}
  elif path.endswith('/mail'):data={'opportunityId':path.split('/')[-2],'title':'Synthetic GP role','url':'https://example.invalid/job/a','publishedRecipients':[(('coastal' if path.split('/')[-2]=='opp_'+'a'*32 else 'rural')+'@example.invalid'),'network@example.invalid'],'recipientDetails':[],'scheduling':{'enabled':True,'modeReady':policy['ready'],'maxHours':23.5,'approvals':approvals}}
  elif path=='/api/mail-automation/scheduler':data={'enabled':True,'approvals':approvals}
  elif path=='/api/mail-automation/settings':policy['ready']=True;data={'settings':{'requestedMode':'automatic'}}
  else:missing.append((method,path));data={}
  if path=='/api/opportunities' and reorder:data['opportunities']=data['opportunities'][1:];data['total']=1
  r.fulfill(json=data)

 page.route('**/api/**',route)
 page.goto('http://127.0.0.1:'+str(server.server_port));page.locator('.arash-opportunity-row').first.wait_for()
 assert page.get_by_role('checkbox',name='انتخاب این آگهی برای ارسال دسته‌ای').count()==2
 assert page.get_by_role('checkbox',name='انتخاب این آگهی برای ارسال دسته‌ای').evaluate_all('(nodes)=>nodes.every(node=>!node.checked)')
 page.get_by_role('checkbox',name='انتخاب موارد این صفحه برای ارسال دسته‌ای').check()
 page.get_by_role('button',name='نامه و ارسال دسته‌ای (۲)').click()
 page.get_by_role('button',name='آماده‌کردن نامه‌ها و گیرنده‌ها',exact=True).click()
 page.locator('.bulk-mail-draft').nth(1).wait_for()
 for draft in page.locator('.bulk-mail-draft').all():
  draft.locator('summary').first.click()
  assert draft.locator('.bulk-mail-recipients input').evaluate_all('(nodes)=>nodes.length===2&&nodes.every(node=>node.checked)'), 'Published recipients not selected by default'
  draft.get_by_role('checkbox',name='متن این مرکز، جملهٔ رزومه و گیرنده‌ها را بررسی کردم.').check()
 assert page.get_by_text('Synthetic review note: confirm dates.').count()==2
 assert not any('/queue' in path or 'dispatch' in path for path,_ in posts)
 page.get_by_role('button',name='پیش‌نمایش نهایی منتخب‌ها',exact=True).click()
 page.locator('.bulk-mail-final').wait_for()
 assert page.locator('.bulk-mail-final>details').count()>=3
 assert not page.get_by_role('button',name='ارسال پیام‌های بازبینی‌شده',exact=True).is_enabled()
 page.get_by_role('checkbox',name='متن، گیرنده و رزومهٔ همهٔ پیام‌های آماده را بررسی کردم؛ فقط همین ۳ پیام ارسال شوند.').check()
 page.screenshot(path='/workspace/scratch/bulk-opportunity-ui/preview-390.png',full_page=True)
 page.get_by_role('button',name='ارسال پیام‌های بازبینی‌شده',exact=True).click()
 page.get_by_text('این نوبت مصرف شد؛ پیام قبلی یا نتیجهٔ نامشخص خودکار دوباره ارسال نمی‌شود. وضعیت هر نشانی را پیش از اقدام تازه بررسی کنید.').wait_for()
 page.wait_for_function('document.querySelectorAll(".bulk-mail-results p").length===3')
 assert len([x for x in posts if x[0]=='/api/google/mail/dispatch'])==3
 assert len(queue_rows)==3
 assert not page.get_by_role('button',name='ارسال پیام‌های بازبینی‌شده',exact=True).count()
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.get_by_role('button',name='بستن ارسال دسته‌ای',exact=True).click()
 page.get_by_label('ایالت فرصت',exact=True).select_option('NSW');page.wait_for_timeout(200)
 assert page.get_by_role('button',name=re.compile('نامه و ارسال دسته‌ای')).count()==0
 page.evaluate("window.__setOwner('amir')");page.locator('.opportunity-result-card').first.wait_for()
 assert page.locator('.opportunity-bulk-mail').count()==0
 assert page.get_by_role('checkbox',name='انتخاب این آگهی برای ارسال دسته‌ای').count()==2
 assert page.get_by_role('checkbox',name='انتخاب این آگهی برای ارسال دسته‌ای').evaluate_all('(nodes)=>nodes.every(node=>!node.checked)')
 assert not errors,errors
 print('PASS bulk list/default-all recipients/individual review/network dedup/explicit send/owner+filter resets/mobile layout. All provider calls synthetic.');b.close();server.shutdown()
