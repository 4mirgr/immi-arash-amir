"""Responsive real home views with synthetic data; no provider access or writes."""
from pathlib import Path
import json,subprocess,tempfile,shutil,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 source='''import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ArashHome}from'./arash-workspace';import{AmirHome}from'./amir-workspace';import'./workspace-style.css';function App(){const[owner,setOwner]=useState('arash');window.__owner=setOwner;return <div className={'app '+owner+'-workspace'}><main className="main"><div className="page">{owner==='arash'?<ArashHome onNavigate={()=>{}} online googleConnected leadCount={42} draftCount={5} hasCV/>:<AmirHome onNavigate={()=>{}}/>}</div></main></div>};createRoot(document.getElementById('root')).render(<App/>);'''
 config={'stdin':{'contents':source,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+')'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts');(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
 errors=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle')
  count=0
  for owner in ['arash','amir']:
   page.evaluate('window.__owner('+json.dumps(owner)+')')
   for width in [320,390,1440]:
    page.set_viewport_size({'width':width,'height':1100})
    for theme in ['light','dark']:
     for direction in ['rtl','ltr']:
      page.evaluate('([theme,dir])=>{document.documentElement.dataset.theme=theme;document.documentElement.dir=dir}',[theme,direction]);page.wait_for_timeout(30)
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),(owner,width,theme,direction)
      cards=page.locator('.arash-route');assert cards.count()==(2 if owner=='arash' else 3)
      assert all(x['width']>=200 for x in cards.evaluate_all('(els)=>els.map(e=>({width:e.getBoundingClientRect().width}))')),(owner,width)
      count+=1
  assert not errors,errors;browser.close()
 server.shutdown()
 print('PASS',count,'real home views across both doctors,320/390/1440,dark/light,RTL/LTR; no horizontal overflow or JS errors.')
