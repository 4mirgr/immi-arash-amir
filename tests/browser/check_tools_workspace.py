"""Real workspace menus with synthetic independent owners and GET-only services."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
import json,shutil,subprocess,tempfile,threading
from playwright.sync_api import sync_playwright,expect

repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='aus-tools-menus-') as directory:
 root=Path(directory)
 source=(repo/'src/main.jsx').read_text()
 source="import {createRoot} from 'react-dom/client';"+"\n"+source
 source=source.replace('const [automationTab,setAutomationTab]=useState("operations");','const [automationTab,setAutomationTab]=useState("operations");window.__tab=setTab;window.__automation=setAutomationTab;')
 source+='''
function ToolsHarness(){const[owner,setOwner]=useState('arash');window.__owner=setOwner;return <App key={owner} cloud initialPerson={owner} workspaceOwnerId={owner==='arash'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222'} onSignOut={()=>{}}/>};createRoot(document.getElementById('root')).render(<ToolsHarness/>);
'''
 config={'stdin':{'contents':source,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 (root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 shutil.copytree(repo/'public/fonts',root/'fonts')
 for name in ['brand-aa-64.png','brand-aa-180.png']:shutil.copyfile(repo/'public'/name,root/name)
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=directory));threading.Thread(target=server.serve_forever,daemon=True).start()
 current={'owner':'arash'};requests=[];writes=[];errors=[]
 def api(route):
  request=route.request;url=urlparse(request.url);path=url.path;query=parse_qs(url.query);who=query.get('profile',[current['owner']])[0]
  requests.append((request.method,path,who))
  if request.method!='GET':writes.append(path);route.fulfill(status=403,json={'error':'Synthetic writes are not permitted'});return
  if path=='/api/bootstrap':data={'profiles':[{'id':who,'name':'Synthetic doctor','cvText':'Synthetic private CV','planning':{}}],'clinics':[],'stations':[],'revision':'synthetic','settings':{},'integrations':{'telegram':{'connected':True,'enabled':True}}}
  elif path=='/api/updates':data={'revision':'synthetic'}
  elif path=='/api/google/status':
   secondary=query.get('mailbox')==['secondary'];data={'configured':True,'connected':False,'status':'not_connected' if secondary else 'reconnect_required','email':who+('.secondary' if secondary else '.primary')+'@example.invalid','capabilities':{}}
  elif path=='/api/opportunities':data={'opportunities':[],'total':0}
  elif path=='/api/opportunities/sources':data={'sources':[],'automation':{'observed':True,'status':'completed'}}
  elif path=='/api/presets':data=[{'id':'33333333-3333-4333-8333-333333333333','name':'Synthetic '+who+' template','subject':'Synthetic subject','body':'Synthetic own letter','revision':1,'isDefault':True}]
  elif path in ['/api/cv/versions','/api/drafts']:data=[]
  elif path=='/api/operations/status':data={'pending':{'mail':0,'linkedin':0},'membershipGateConfigured':True}
  elif path in ['/api/linkedin/status','/api/linkedin/connection']:data={'configured':True,'connected':False,'capabilities':{}}
  elif path=='/api/telegram/status':data={'configured':True,'connected':True,'enabled':True,'botUsername':'SyntheticBot','webhookRegistered':True,'quietStart':'22:00','quietEnd':'08:00','verification':{'state':'not_checked'}}
  elif path=='/api/ai/status':data={'configured':False,'enabled':False,'limits':{},'usage':{}}
  elif path=='/api/backup/drive/status':data={'configured':False,'connected':False,'available':False}
  elif path=='/api/public-config':data={'mode':'cloud','authRequired':True,'supabaseUrl':'https://example.invalid','publishableKey':'synthetic-public-key'}
  else:route.fulfill(status=503,json={'error':'Synthetic service unavailable'});return
  route.fulfill(json=data)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':390,'height':1000});page.set_default_timeout(7000)
  page.route('**/api/**',api);page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle')
  checks=0
  for who in ['arash','amir']:
   current['owner']=who;page.evaluate('window.__owner('+json.dumps(who)+')');page.wait_for_timeout(120)
   for language in ['fa','en']:
    if page.locator('html').get_attribute('data-language')!=language:page.locator('.language-control').click()
    for width in [320,390,430,1440]:
     page.set_viewport_size({'width':width,'height':1100})
     page.evaluate("document.documentElement.style.setProperty('--workspace-text-scale','1.5')")
     for tab in ['settings','sources','automation']:
      page.evaluate('window.__tab('+json.dumps(tab)+')');page.locator('.tools-workspace').wait_for();page.wait_for_timeout(100)
      assert page.locator('.tools-workspace .tools-section[open]').count()==0,(who,language,width,tab)
      assert page.locator('.tools-workspace .tools-section-body').count()==0,'A closed menu mounted its tool'
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(who,language,width,tab,'overflow')
      sizes=page.locator('.tools-section>summary').evaluate_all('(nodes)=>nodes.map(node=>node.getBoundingClientRect().height)')
      assert all(60<=height<=230 for height in sizes),(who,language,width,tab,sizes)
      if language=='en':assert not page.locator('.tools-workspace-heading,.tools-section>summary').evaluate_all('(nodes)=>nodes.some(node=>/[\\u0600-\\u06ff]/.test(node.innerText))')
      checks+=1
      if who=='arash' and language=='fa' and width==390:page.locator('.tools-workspace').screenshot(path='/tmp/aus-tools-'+tab+'-fa-390.png')
      # Unmount each view to verify that summaries are quiet on the next visit.
      page.evaluate('window.__tab("opportunities")');page.wait_for_timeout(50)
  page.evaluate('window.__tab("settings")');page.locator('.tools-workspace').wait_for()
  expect(page.locator('.tools-attention')).to_be_visible()
  assert 'needs-attention' not in (page.locator('.tools-account-summary').nth(1).get_attribute('class') or '')
  page.locator('.tools-attention button').click();expect(page.locator('#service-connections')).to_have_attribute('open','')
  expect(page.locator('#service-connections .google-connection')).to_have_count(2)
  expect(page.locator('#service-connections')).to_contain_text('amir.primary')
  assert 'arash.primary' not in page.locator('.tools-workspace').inner_text()
  page.locator('.settings-shortcuts button').nth(1).click();expect(page.locator('#email-templates .email-template-editor')).to_be_visible()
  editor=page.locator('#email-templates .email-template-editor input').first;editor.fill('Synthetic unsaved edit')
  page.locator('#email-templates>summary').click();expect(editor).not_to_be_visible()
  page.locator('#email-templates>summary').click();expect(editor).to_have_value('Synthetic unsaved edit')
  page.locator('#email-templates>summary').focus();page.keyboard.press('Enter');expect(page.locator('#email-templates')).not_to_have_attribute('open','')
  before=sum(path=='/api/opportunities/sources' for _,path,_ in requests)
  page.evaluate('window.__tab("sources")');page.locator('#source-monitor>summary').wait_for();page.wait_for_timeout(100)
  assert sum(path=='/api/opportunities/sources' for _,path,_ in requests)==before
  page.locator('#source-monitor>summary').click();page.locator('#source-monitor .panel').wait_for()
  page.wait_for_timeout(100);assert sum(path=='/api/opportunities/sources' for _,path,_ in requests)==before+1
  page.evaluate('window.__automation("telegram");window.__tab("automation")');expect(page.locator('#automation-telegram')).to_have_attribute('open','')
  expect(page.locator('#automation-telegram .tools-section-body > section.panel')).to_be_visible()
  assert not writes,writes;assert not errors,errors
  page.screenshot(path='/tmp/aus-tools-telegram-en-1440.png',full_page=True)
  print('PASS tools workspace: '+str(checks)+' quiet collapsed layouts; explicit lazy opens, own-account reconnect action, editor retention, keyboard control, requested Telegram menu, English/mobile150%; no provider writes.')
  browser.close()
 server.shutdown()
