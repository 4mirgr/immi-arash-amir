"""Optional Chromium audit of real workspaces at 130% text; synthetic GET-only APIs.
Checks both owners, languages, palettes and narrow/desktop layouts, keyboard
focus on disclosures, identity containment and light-button text contrast.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json, shutil, subprocess, tempfile, threading
from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as directory:
 root = Path(directory)
 source = (repo/'src/main.jsx').read_text()
 source = source[:source.rfind('createRoot(document.getElementById("root"))')]
 source = source.replace('const [automationTab,setAutomationTab]=useState("operations");', 'const [automationTab,setAutomationTab]=useState("operations");window.__tab=setTab;')
 source += '''
function Audit(){const[owner,setOwner]=useState('arash');window.__owner=setOwner;return location.search==='?access'?<AccessGate>{()=>null}</AccessGate>:<App key={owner} cloud initialPerson={owner} workspaceOwnerId={owner==='arash'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222'} onSignOut={()=>{}}/>};createRoot(document.getElementById('root')).render(<Audit/>);
'''
 config={'stdin':{'contents':source,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 (root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 shutil.copytree(repo/'public/fonts',root/'fonts');shutil.copyfile(repo/'public/brand-aa-64.png',root/'brand-aa-64.png')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=directory));threading.Thread(target=server.serve_forever,daemon=True).start()
 writes=[];errors=[];current={'owner':'arash'}
 def api(route):
  request=route.request;url=urlparse(request.url);path=url.path;who=parse_qs(url.query).get('profile',[current['owner']])[0]
  if request.method!='GET':writes.append(path);route.fulfill(status=403,json={'error':'No writes permitted'});return
  if path=='/api/bootstrap':data={'profiles':[{'id':who,'name':'Synthetic doctor','cvText':'Synthetic CV','verification':'pending_documents'}],'clinics':[],'stations':[],'revision':'synthetic','settings':{}}
  elif path=='/api/updates':data={'revision':'synthetic'}
  elif path=='/api/google/status':data={'configured':True,'connected':False,'capabilities':{}}
  elif path=='/api/opportunities':data={'opportunities':[],'total':0}
  elif path=='/api/opportunities/sources':data={'sources':[],'automation':{}}
  elif path in ['/api/cv/versions','/api/presets','/api/drafts']:data=[]
  elif path=='/api/linkedin/status':data={'configured':True,'connected':False,'capabilities':{}}
  elif path=='/api/roadmap':data={'profileId':who,'items':[],'analysis':{},'limitations':[]}
  elif path=='/api/public-config':data={'mode':'cloud','authRequired':True,'supabaseUrl':'https://example.invalid','publishableKey':'synthetic-public-key'}
  else:route.fulfill(status=503,json={'error':'Synthetic service unavailable'});return
  route.fulfill(json=data)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page(viewport={'width':1400,'height':1000})
  page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/**',api)
  page.add_init_script("localStorage.setItem('masir:text-size:v1:arash','130');localStorage.setItem('masir:text-size:v1:amir','130')")
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle');count=0
  for who in ['arash','amir']:
   current['owner']=who;page.evaluate('window.__owner('+json.dumps(who)+')');page.wait_for_timeout(100)
   for language in ['en','fa']:
    if page.locator('html').get_attribute('data-language')!=language:page.locator('.language-control').click()
    for theme in ['dark','light']:
     if page.locator('html').get_attribute('data-theme')!=theme:page.locator('.theme-control').click()
     for width in [320,390,1400]:
      page.set_viewport_size({'width':width,'height':1000})
      for tab in ['overview','opportunities','mail','linkedin']:
       page.evaluate('window.__tab('+json.dumps(tab)+')');page.wait_for_timeout(100)
       page.locator('.page details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)')
       assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),(who,language,theme,width,tab)
       if width==1400:
        assert page.locator('.profile').evaluate("e=>{const a=e.getBoundingClientRect();return [...e.querySelectorAll('strong,small')].every(c=>{const r=c.getBoundingClientRect();return r.top>=a.top&&r.bottom<=a.bottom})}"),(who,language,theme,'identity clipped')
       count+=1
  summary=page.locator('.page summary').first
  page.keyboard.press('Tab');summary.focus();assert summary.evaluate("e=>getComputedStyle(e).outlineStyle")=='solid'
  page.goto('http://127.0.0.1:'+str(server.server_port)+'/?access',wait_until='networkidle')
  page.locator('html').evaluate("e=>e.dataset.theme='light'");page.wait_for_timeout(250)
  contrast=page.locator('.access-card .primary').evaluate("""e=>{const c=getComputedStyle(e),parse=s=>s.match(/[\\d.]+/g).slice(0,3).map(Number),lum=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),a=lum(parse(c.color)),b=lum(parse(c.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}""")
  assert contrast>=4.5,contrast
  assert not writes,writes;assert not errors,errors;browser.close()
 server.shutdown()
print('PASS',count,'large-text workspace views: two owners/languages/palettes; no overflow, clipped identity text or provider writes; disclosure focus and login contrast pass.')
