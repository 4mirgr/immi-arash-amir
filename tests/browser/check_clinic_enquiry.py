"""Synthetic read-only enquiry preparation, copy consent and owner isolation."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import tempfile,subprocess,json,threading,shutil,re
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 harness="""import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ClinicEnquiry}from'./clinic-enquiry';import'./workspace-style.css';function App(){const[p,setP]=useState('arash');window.__owner=setP;return <div className="app arash-workspace"><main><div className="page"><ClinicEnquiry person={p} itemId={'bank_'+'a'.repeat(32)}/></div></main></div>};createRoot(document.getElementById('root')).render(<App/>);"""
 config={'stdin':{'contents':harness,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts');(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=work));threading.Thread(target=server.serve_forever,daemon=True).start()
 fixture={'profileId':'arash','leadId':'bank_'+'a'*32,'clinic':{'name':'Synthetic Medical Practice'},'source':{'status':'current_public_observation','readAt':'2026-11-13T09:00:00Z'},'recipients':[{'value':'jobs@clinic.example','sourceURL':'https://clinic.example/contact'}],'draft':{'subject':'GP expression of interest — Synthetic Medical Practice','body':None,'paragraphs':{'opening':'Synthetic fixed opening with source-owned claims.','clinic':None,'value':'Synthetic own CV clinical experience.','closing':'Please let me know a convenient time to discuss how I can support your practice.'},'doctorName':'Synthetic Doctor','cvQuote':'Synthetic own CV clinical experience.'},'missingEvidence':['clinic_services_quote_required'],'automaticSending':False}
 reads=[];writes=[];errors=[]
 def route(r):
  if r.request.method!='GET':writes.append(r.request.method);r.fulfill(status=403,json={'error':'forbidden'});return
  reads.append(r.request.url);r.fulfill(json=fixture)
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/**',route)
  page.add_init_script("window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)},configurable:true});")
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle');assert not reads
  page.locator('.clinic-enquiry').evaluate('(node)=>node.open=true');page.wait_for_timeout(100);assert not reads,'Opening the row alone must not create background requests'
  page.locator('.clinic-enquiry-body > button').click();expect(page.locator('.clinic-enquiry-body ul')).to_be_visible();assert len(reads)==1;assert not writes;assert page.locator('.clinic-enquiry-preview').count()==0
  note=page.locator('.clinic-enquiry-body > label textarea:not([readonly])');note.fill('Your published teaching environment interests me.\n\nI would welcome a discussion of a supervised role.')
  preview=page.locator('.clinic-enquiry-preview');expect(preview).to_be_visible();copy=page.get_by_role('button',name='کپی متن معرفی',exact=True);expect(copy).to_be_disabled()
  checkbox=page.locator('.clinic-enquiry-body .checkline input');checkbox.check();note.fill('Your published teaching environment interests me. I would welcome a discussion of a supervised role.');expect(checkbox).not_to_be_checked();checkbox.check();copy.click()
  page.wait_for_function('window.__copied.length===1');text=page.evaluate('window.__copied[0]');assert text.count('\n\n')==5;assert 'Synthetic fixed opening' in text;assert not writes;assert len(reads)==1
  # A newly captured public service excerpt enables an automatic complete draft.
  fixture['draft']['paragraphs']['clinic']='Synthetic Medical Practice provides chronic disease care. I value continuity of care.'
  fixture['draft']['clinicQuote']='Our clinic provides chronic disease care.';fixture['draft']['clinicQuoteSourceURL']='https://clinic.example/'
  fixture['draft']['body']='Dear Practice Manager,\n\n'+'\n\n'.join(fixture['draft']['paragraphs'].values())+'\n\nKind regards,\nSynthetic Doctor';fixture['missingEvidence']=[]
  page.locator('.clinic-enquiry-body > button').first.click();expect(preview).to_have_value(fixture['draft']['body']);expect(checkbox).not_to_be_checked();assert len(reads)==2;assert not writes
  # Local English rendering must cover every interface label without translating private text.
  page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
  page.locator('.clinic-enquiry details').evaluate_all('(nodes)=>nodes.forEach(x=>x.open=true)');page.wait_for_timeout(100);assert not re.search(r'[\u0600-\u06ff]',page.locator('body').inner_text())
  for width in [320,390,1440]:
   page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
  page.evaluate("window.__owner('amir')");expect(page.locator('.clinic-enquiry-body')).to_contain_text('only in Arash');assert page.locator('.clinic-enquiry-preview').count()==0;assert not writes;assert len(reads)==2;assert not errors,errors;b.close()
 server.shutdown()
print('PASS explicit read-only preparation, no mount/poll fetches, missing-source caution, local reviewed note, consent reset, copy only, English/mobile and owner guard; no provider writes.')
