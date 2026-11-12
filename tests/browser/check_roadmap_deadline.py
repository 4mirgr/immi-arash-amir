"""Precise call expiry updates while reading; synthetic profile and GET-only APIs."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import json,subprocess,tempfile,threading,shutil
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 source="""import React from 'react';import{createRoot}from'react-dom/client';import{RoadmapPanel}from'./roadmap-panel';import'./workspace-style.css';createRoot(document.getElementById('root')).render(<div className="app amir-workspace"><main><div className="page"><RoadmapPanel person="amir" category="study"/></div></main></div>);"""
 config={'stdin':{'contents':source,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import{build}from"esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts');(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=work));threading.Thread(target=server.serve_forever,daemon=True).start()
 items=[{'id':'timed','group':'study','audience':'amir','title':'Synthetic timed scholarship','country':'AU','deadline':{'date':'2026-11-12T12:00:00Z'},'actions':[{'id':'action-timed','text':'Synthetic action','status':'todo'}]},{'id':'day','group':'study','audience':'amir','title':'Synthetic date-only scholarship','country':'AU','deadline':{'date':'2026-11-12'},'actions':[]}]
 requests=[];errors=[]
 def api(route):
  requests.append((route.request.method,route.request.url));assert route.request.method=='GET'
  route.fulfill(json={'profileId':'amir','checkedAt':'2026-11-12','analysis':{},'items':items})
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("window.__now=Date.parse('2026-11-12T11:59:00Z');Date.now=()=>window.__now;")
  page.route('**/api/**',api);page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle')
  timed=page.locator('article').filter(has_text='Synthetic timed scholarship');expect(timed).to_contain_text('بررسی مشروط')
  page.locator('details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)');page.locator('textarea').fill('Synthetic unsaved note')
  page.evaluate("window.__now=Date.parse('2026-11-12T12:00:00Z');document.dispatchEvent(new Event('visibilitychange'))")
  expect(timed).to_contain_text('بسته / مهلت‌گذشته');expect(page.locator('textarea')).to_have_value('Synthetic unsaved note')
  page.get_by_label('وضعیت برنامه',exact=True).select_option('followup');expect(page.locator('article')).to_have_count(1);expect(page.locator('article')).to_contain_text('Synthetic date-only scholarship')
  page.get_by_label('وضعیت برنامه',exact=True).select_option('closed');expect(page.locator('article')).to_have_count(1);expect(page.locator('textarea')).to_have_value('Synthetic unsaved note')
  assert len(requests)==1,requests;assert not errors,errors;assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');b.close()
 server.shutdown()
print('PASS exact timed expiry, date-only preservation, live filter update and retained private note; one GET and no writes.')
