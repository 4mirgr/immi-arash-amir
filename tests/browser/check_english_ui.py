"""Optional real-component English UI audit.
Run: python tests/browser/check_english_ui.py (Playwright Python + Chromium required).
Uses public evidence with synthetic accounts and mocked APIs; never sends real messages.
"""
from pathlib import Path
import json,subprocess,shutil,tempfile
repo=Path(__file__).resolve().parents[2]
work=tempfile.TemporaryDirectory();root=Path(work.name)
s=(repo/'src/main.jsx').read_text();s=s[:s.rfind('createRoot(document.getElementById("root"))')]
s=s.replace('const [automationTab,setAutomationTab]=useState("operations");','const [automationTab,setAutomationTab]=useState("operations");window.__tab=setTab;window.__automation=setAutomationTab;')
s+='\nfunction Harness(){const[owner,setOwner]=useState("arash");window.__owner=setOwner;return <App key={owner} cloud initialPerson={owner} workspaceOwnerId={owner==="arash"?"11111111-1111-4111-8111-111111111111":"22222222-2222-4222-8222-222222222222"} onSignOut={()=>{}}/>};createRoot(document.getElementById("root")).render(<Harness/>);'
script='import {build} from "esbuild";await build('+json.dumps({'stdin':{'contents':s,'resolveDir':str(repo/'src'),'sourcefile':'english-audit.jsx','loader':'jsx'},'outfile':str(root/'app.js'),'bundle':True,'format':'esm','external':['/fonts/*'],'logLevel':'silent'})+');'
subprocess.run(['node','--input-type=module','-e',script],cwd=repo,check=True)
(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo/'public/fonts',root/'fonts',dirs_exist_ok=True)

subprocess.run(["node","--input-type=module","-e","import {handleRoadmapRequest} from './cloud/roadmap.mjs';import {writeFile} from 'node:fs/promises';const data={};for(const profileId of ['arash','amir']){const profile={id:profileId,cvText:'Synthetic private CV',planning:profileId==='amir'?{training:{completionStatus:'uncertain'},board:{status:'pending'},language:{level:'B2',levelEvidence:'self_reported',examStatus:'not_taken',preferredExam:'IELTS'}}:{}};const env={GOOGLE_DB:{prepare(){return{bind(){return{all:async()=>({results:[]})}}}}}};const context={userId:'synthetic-'+profileId,profileId,rest:async()=>[{data:profile}]};const response=await handleRoadmapRequest(new Request('https://synthetic.invalid/api/roadmap?profile='+profileId),env,context);data[profileId]=await response.json();}await writeFile(process.argv[1],JSON.stringify(data));",str(root/"roadmap-fixtures.json")],cwd=repo,check=True)


(root/"extra-harness.jsx").write_text('import React,{useState} from \'@@REPO@@/node_modules/react/index.js\';\nimport {createRoot} from \'@@REPO@@/node_modules/react-dom/client.js\';\nimport {LanguageControl} from \'@@REPO@@/src/language-control.jsx\';\nimport {OpportunityMail} from \'@@REPO@@/src/opportunity-mail.jsx\';\nimport {OpportunityBulkMail} from \'@@REPO@@/src/opportunity-bulk-mail.jsx\';\nimport {GpApplicationWorkspace} from \'@@REPO@@/src/gp-application-workspace.jsx\';\nimport \'@@REPO@@/src/workspace-style.css\';\nconst cv=\'11111111-1111-4111-8111-111111111111\';\nconst opportunities=[\'a\',\'b\'].map(x=>({id:\'opp_\'+x.repeat(32),title:\'Synthetic GP vacancy \'+x,organization:\'Synthetic clinic \'+x,country:\'AU\',state:\'NSW\',status:\'open\'}));\nconst selection={variant:\'B\',subjectIndex:0,cvVersionId:cv,clinicQuote:\'Synthetic clinic a provides continuity of care.\',cvQuote:\'Synthetic prior general practice experience.\',confirmCvQuote:true,templateName:\'GP B — Independent practice enquiry\'};\nfunction Harness(){const [view,setView]=useState(\'gp\'),[person,setPerson]=useState(\'arash\');window.__view=setView;window.__person=setPerson;return <div className={\'app \'+person+\'-workspace\'}><main className="main"><div className="page"><LanguageControl personId={person}/>{view===\'gp\'?<GpApplicationWorkspace key={person+view} compact person={person} opportunity={opportunities[0]} notify={()=>{}}/>:view===\'mail\'?<OpportunityMail key={person+view} compact person={person} opportunity={opportunities[0]} gpApplication={person===\'arash\'?selection:null} notify={()=>{}}/>:<OpportunityBulkMail key={person+view} person={person} opportunities={opportunities} notify={()=>{}}/>}</div></main></div>};createRoot(document.getElementById(\'root\')).render(<Harness/>);\n'.replace("@@REPO@@",repo.as_posix()))
subprocess.run(["node","--input-type=module","-e",'import {build} from "esbuild";await build('+json.dumps({"entryPoints":[str(root/"extra-harness.jsx")],"outfile":str(root/"extra.js"),"bundle":True,"format":"esm","external":["/fonts/*"],"logLevel":"silent"})+');'],cwd=repo,check=True)
(root/"extra.html").write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="extra.css"><div id="root"></div><script type="module" src="extra.js"></script>')
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from urllib.parse import urlparse,parse_qs
from pathlib import Path
import threading,json,re
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
errors=[];writes=[];requests=[];owner={'name':'arash'};reports=[];roadmaps=json.loads((root/'roadmap-fixtures.json').read_text())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(3000)
 page.add_init_script("localStorage.setItem('masir:language:v1:public','en');localStorage.setItem('masir:language:v1:arash','en');localStorage.setItem('masir:language:v1:amir','en');")
 def route(r):
  u=urlparse(r.request.url);path=u.path;q=parse_qs(u.query);who=q.get('profile',[owner['name']])[0];requests.append((r.request.method,path))
  if r.request.method!='GET':writes.append(path)
  if path=='/api/bootstrap':data={'profiles':[{'id':who,'name':'Synthetic doctor','cvText':'Synthetic private CV text','verification':'pending_documents'}],'clinics':[],'stations':[],'revision':'synthetic','settings':{}}
  elif path=='/api/updates':data={'revision':'synthetic'}
  elif path=='/api/google/status':data={'configured':True,'connected':False,'status':'not_connected','capabilities':{}}
  elif path=='/api/opportunities':data={'opportunities':[],'total':0}
  elif path=='/api/opportunities/sources':data={'sources':[],'automation':{'observed':True,'status':'completed','overdue':False}}
  elif path=='/api/roadmap':data=roadmaps[who]
  elif path=='/api/pesci/practice':data={'profileId':who,'cases':[],'attempts':[],'library':[]}
  elif path in ['/api/cv/versions','/api/presets','/api/drafts']:data=[]
  elif path=='/api/ai/status':data={'configured':False,'enabled':False,'limits':{},'usage':{}}
  elif path=='/api/linkedin/status':data={'configured':True,'connected':False,'canPublish':False,'capabilities':{}}
  elif path=='/api/operations/status':data={'pending':{'mail':0,'linkedin':0},'membershipGateConfigured':True}
  else:
   r.fulfill(status=503,json={'error':'Synthetic service unavailable'});return
  r.fulfill(json=data)
 page.route('**/api/**',route);page.goto('http://127.0.0.1:'+str(server.server_port));page.wait_for_timeout(450)
 def snapshot(tab,width):
  page.wait_for_timeout(100)
  entries=page.evaluate("""()=>{const out=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode,e=n.parentElement,t=n.nodeValue.trim();if(!t||!/[\\u0600-\\u06ff]/.test(t)||e.closest('script,style,pre,blockquote,textarea,.message-body,.message-snippet,.cv-preview'))continue;const r=document.createRange();r.selectNodeContents(n);if(!r.getBoundingClientRect().width||!e.checkVisibility())continue;out.push({text:t,tag:e.tagName,dir:e.getAttribute('dir'),parent:e.parentElement?.tagName,closestSkip:!!e.closest('[data-no-translate]')});}return out}""")
  attributes=page.evaluate("""()=>[...document.querySelectorAll('[aria-label],[placeholder],[title]')].filter(e=>e.checkVisibility()).flatMap(e=>['aria-label','placeholder','title'].map(k=>({attribute:k,value:e.getAttribute(k),tag:e.tagName})).filter(x=>x.value&&/[\\u0600-\\u06ff]/.test(x.value)))""")
  options=page.evaluate("""()=>[...document.querySelectorAll('select')].filter(e=>e.checkVisibility()).flatMap(e=>[...e.options].filter(o=>/[\\u0600-\\u06ff]/.test(o.textContent)&&!o.hasAttribute('data-private')).map(o=>({text:o.textContent,value:o.value})))""")
  reports.append({'owner':owner['name'],'tab':tab,'width':width,'persian':entries,'attributes':attributes,'options':options,'overflow':page.evaluate('document.documentElement.scrollWidth>innerWidth')})

 for who in ['arash','amir']:
  owner['name']=who;page.evaluate('window.__owner('+json.dumps(who)+')');page.wait_for_timeout(150)
  for width in [1440,390]:
   page.set_viewport_size({'width':width,'height':1000})
   for tab in ['overview','opportunities','mail','cv','pesci' if who=='arash' else 'study','linkedin','roadmap','development','sources','automation','settings']:
    page.evaluate('window.__tab('+json.dumps(tab)+')');page.wait_for_timeout(150)
    # All secondary UI prose belongs to the selected screen; no provider buttons clicked.
    page.locator('details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)');snapshot(tab,width)
   for sub in ['ai','mail','telegram','backup']:
    page.evaluate('window.__automation('+json.dumps(sub)+');window.__tab("automation")');page.wait_for_timeout(150);page.locator('details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)');snapshot('automation-'+sub,width)
 print('screens',len(reports),'PersianUItextnodes',sum(len(r['persian']) for r in reports),'errors',errors,'writes',writes)
 print('largest',[(r['owner'],r['tab'],len(r['persian'])) for r in sorted(reports,key=lambda x:len(x['persian']),reverse=True)[:8]])
 missing=[{'owner':r['owner'],'tab':r['tab'],'width':r['width'],'text':[x['text'] for x in r['persian']],'attributes':r['attributes'],'options':r['options']} for r in reports if r['persian'] or r['attributes'] or r['options']]
 assert not errors,errors
 assert not writes,writes
 assert not missing,json.dumps(missing,ensure_ascii=False)[:12000]
 assert not any(r['overflow'] for r in reports),[(r['owner'],r['tab'],r['width']) for r in reports if r['overflow']]
 print('PASS: both owners, desktop/mobile, all tabs and automation sections use English labels, help, attributes and options; no provider writes or overflow.')
 # Read-only application flows also exercise the lazy inline editors and calendars.
 cv='11111111-1111-4111-8111-111111111111';preset='22222222-2222-4222-8222-222222222222';extra_reports=[]
 page.unroute('**/api/**',route)
 def extraRoute(r):
  u=urlparse(r.request.url);path=u.path;q=parse_qs(u.query);person=q.get('profile',['arash'])[0];mailbox=q.get('mailbox',['primary'])[0];payload=json.loads(r.request.post_data or '{}');id=next((x for x in path.split('/')if x.startswith('opp_')),'opp_'+'a'*32);letter=id[-1];clinic='Synthetic clinic '+letter;quote=clinic+' provides continuity of care.';body='Dear Practice Manager,\n\nI am a synthetic doctor.\n\n'+quote+'\n\nI have synthetic general practice experience.\n\nPlease contact me to discuss.\n\nKind regards,\nSynthetic Doctor';sender=person+('2'if mailbox=='secondary'else'')+'@example.invalid';data={}
  if r.request.method!='GET':writes.append(path)
  if path.endswith('/cv/versions'):data=[{'id':cv,'name':'Synthetic CV','isDefault':True}]
  elif path.endswith('/presets'):data=[{'id':preset,'name':'GP B — Independent practice enquiry','isDefault':True}]
  elif path.endswith('/google/status'):data={'connected':True,'configured':True,'email':sender,'capabilities':{'gmailSend':True}}
  elif path=='/api/gp-workflow/settings':data={'goalMode':'employment'}
  elif '/gp-workflow/opportunities/' in path:data={'opportunityId':id,'stage':'clinic_identified','stages':[],'assessment':{'stars':3,'tier':3}}
  elif path.endswith('/package'):data={'profileId':person,'opportunityId':id,'cvVersionId':cv,'variant':'B','recommendedVariant':'B','templateName':'GP B — Independent practice enquiry','subjects':['Synthetic GP application '+letter]*3,'previewBody':body,'body':body,'readyForReview':r.request.method=='POST','missingFields':['cv_confirmation_required']if r.request.method=='GET'else[],'suggestedSelection':{'clinicQuote':quote,'cvQuote':'Synthetic prior general practice experience.'},'clinicEvidenceCandidates':[{'text':quote,'sourceUrl':'https://example.invalid/job/'+letter}],'cvEvidenceCandidates':[{'text':'Synthetic prior general practice experience.'}],'dossier':{'name':{'value':clinic,'sourceUrl':'https://example.invalid/job/'+letter}},'recipients':['clinic@example.invalid','manager@example.invalid'],'writingStatus':{'issues':['Synthetic pending document discrepancy']},'contactDiscovery':{'status':'partial'},'registrationCautions':[]}
  elif path.endswith('/mail'):data={'opportunityId':id,'url':'https://example.invalid/job/'+letter,'trust':'official','lastSeenAt':'2026-11-10T12:00:00Z','publishedRecipients':['clinic@example.invalid','manager@example.invalid'],'recipientDetails':[],'scheduling':{'enabled':True,'modeReady':True,'sourceEligible':True,'approvals':[]}}
  elif path.endswith('/mail/preview'):data={'opportunityId':id,'mailbox':payload['mailbox'],'presetId':payload['presetId'],'cvVersionId':cv,'sender':sender,'url':'https://example.invalid/job/'+letter,'lastSeenAt':'2026-11-10T12:00:00Z','reading':None,'message':{'subject':'Synthetic GP application '+letter,'body':body},'reviewHash':'synthetic'+payload['recipient'],'recipients':[{'recipient':payload['recipient'],'status':'preview','existingId':None,'cvVersionId':cv,'subject':'Synthetic GP application '+letter,'attachmentName':'synthetic.docx'}],'excluded':[],'dailyLimit':20,'reservedToday':0}
  else:r.fulfill(status=503,json={'error':'Synthetic service unavailable'});return
  r.fulfill(json=data)
 page.route('**/api/**',extraRoute);page.goto('http://127.0.0.1:'+str(server.server_port)+'/extra.html');page.wait_for_timeout(350)
 def extraSnapshot(name):
  page.wait_for_timeout(250);page.locator('details:not(.opportunity-mail-schedule)').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)');page.wait_for_timeout(150)
  x=page.evaluate("""()=>{const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(w.nextNode()){const n=w.currentNode,e=n.parentElement,t=n.nodeValue.trim();if(!t||!/[\u0600-\u06ff]/.test(t)||e.closest('script,style,pre,blockquote,textarea,[data-private]'))continue;const r=document.createRange();r.selectNodeContents(n);if(r.getBoundingClientRect().width&&e.checkVisibility())out.push(t)}return out}""");extra_attributes=page.evaluate("()=>[...document.querySelectorAll('[aria-label],[placeholder],[title]')].filter(e=>e.checkVisibility()).flatMap(e=>['aria-label','placeholder','title'].map(k=>e.getAttribute(k)).filter(v=>v&&/[\\u0600-\\u06ff]/.test(v)))");extra_options=page.evaluate("()=>[...document.querySelectorAll('select')].filter(e=>e.checkVisibility()).flatMap(e=>[...e.options].filter(o=>/[\\u0600-\\u06ff]/.test(o.textContent)&&!o.hasAttribute('data-private')).map(o=>o.textContent))");extra_reports.append({'view':name,'remaining':x,'attributes':extra_attributes,'options':extra_options,'overflow':page.evaluate('document.documentElement.scrollWidth>innerWidth')});None
 extraSnapshot('gp')
 for person in ['arash','amir']:
  page.evaluate('window.__person('+json.dumps(person)+');window.__view("mail")');page.locator('.opportunity-recipient-list').wait_for();extraSnapshot(person+'-mail');page.locator('.opportunity-mail-actions button.secondary').last.click();page.locator('.opportunity-recipient-preview').first.wait_for();page.locator('.opportunity-mail-schedule summary').click();page.wait_for_timeout(150);extraSnapshot(person+'-schedule')
  page.evaluate('window.__view("bulk")');page.locator('.bulk-mail-settings').wait_for();page.locator('.opportunity-bulk-mail > button.secondary').click();page.locator('.bulk-mail-draft').first.wait_for();extraSnapshot(person+'-bulk')

 assert not errors,errors
 assert not any('/dispatch' in x or '/queue' in x or '/schedule' in x for x in writes),writes
 assert all(not item['remaining'] and not item['attributes'] and not item['options'] and not item['overflow'] for item in extra_reports),extra_reports
 print('PASS: seven GP editor, recipient preview, calendar and bulk-composer views use English for both owners; no transport writes.')
 b.close();server.shutdown()
