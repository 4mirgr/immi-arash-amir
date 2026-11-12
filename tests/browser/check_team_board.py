"""Shared board requires explicit publishing, preserves drafts and separates owner state."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import tempfile,subprocess,json,threading,shutil,re
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 harness="""import React,{useState,useLayoutEffect,useRef} from 'react';import{createRoot}from'react-dom/client';import{TeamBoard}from'./team-board';import{translateInterface,UI_TRANSLATIONS}from'./ui-translations.mjs';import{EN_TEAM_BOARD}from'./locales/en-team-board.mjs';import'./workspace-style.css';function App(){const[person,setPerson]=useState('amir'),[en,setEn]=useState(false),ref=useRef();window.__person=setPerson;window.__english=setEn;useLayoutEffect(()=>{document.documentElement.dataset.language=en?'en':'fa';document.documentElement.lang=en?'en':'fa';document.documentElement.dir=en?'ltr':'rtl';window.dispatchEvent(new Event('masir-language-change'));return en?translateInterface(ref.current,{dictionary:{...UI_TRANSLATIONS,...EN_TEAM_BOARD}}):undefined},[en]);return <div className={'app '+person+'-workspace'}><main><div className="page" ref={ref}><TeamBoard person={person}/></div></main></div>};createRoot(document.getElementById('root')).render(<App/>);"""
 config={'stdin':{'contents':harness,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts');(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=work));threading.Thread(target=server.serve_forever,daemon=True).start()
 tasks=[];writes=[];errors=[];reads=[]
 def route(r):
  owner='arash' if 'profile=arash' in r.request.url else 'amir'
  if r.request.method=='POST':
   payload=r.request.post_data_json;writes.append((r.request.url,payload));task={'id':'afbbf27c-d519-4490-8838-e16910c36631',**payload,'creatorProfile':owner,'status':'todo','canUpdate':True,'createdAt':'2026-11-12T00:00:00Z','updatedAt':'2026-11-12T00:00:00Z'};tasks.append(task);r.fulfill(json={'task':task});return
  reads.append(owner);r.fulfill(json={'profileId':owner,'tasks':tasks,'taskLimit':40,'canCreate':True})
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/**',route)
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle');assert reads==['amir'];assert not writes
  title=page.locator('.team-create input:not([type=checkbox])').first;consent=page.locator('.team-create .checkline input');publish=page.locator('.team-create form > button.primary')
  title.fill('Shared English practice');expect(publish).to_be_disabled();consent.check();expect(publish).to_be_enabled();title.fill('Shared clinical English practice');expect(consent).not_to_be_checked();assert not writes
  consent.check();publish.click();expect(page.locator('.team-task')).to_have_count(1);assert len(writes)==1;assert writes[0][1]['confirmShared'] is True;assert set(writes[0][1])=={'title','description','assignee','dueAt','confirmShared'};expect(title).to_have_value('')
  title.fill('Private unsaved draft');page.evaluate("window.__person('arash')");expect(title).to_have_value('');expect(page.locator('.team-task')).to_have_count(1);assert reads==['amir','arash'];assert len(writes)==1
  page.evaluate('window.__english(true)');page.locator('details').evaluate_all('(nodes)=>nodes.forEach(x=>x.open=true)');page.wait_for_timeout(200);body=page.locator('body').inner_text();assert not re.search(r'[\u0600-\u06ff]',body),body
  for width in [320,390,1440]:
   page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
  assert not errors,errors;b.close()
 server.shutdown()
print('PASS explicit sharing consent, edit invalidation, publication only on click, owner-isolated draft, English and 320/390/1440 reflow; no provider writes.')
