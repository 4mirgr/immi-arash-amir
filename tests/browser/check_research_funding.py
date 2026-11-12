"""Synthetic research funding workflow: private preparation, filters, locale and owner isolation."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
import tempfile,subprocess,json,threading,shutil,re
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 harness="""import React,{useState,useLayoutEffect,useRef} from 'react';import{createRoot}from'react-dom/client';import{ResearchFundingPanel}from'./research-funding-panel';import{translateInterface,UI_TRANSLATIONS}from'./ui-translations.mjs';import{EN_RESEARCH_FUNDING}from'./locales/en-research-funding.mjs';import'./workspace-style.css';function App(){const[person,setPerson]=useState('amir'),[en,setEn]=useState(false),ref=useRef();window.__person=setPerson;window.__english=setEn;useLayoutEffect(()=>{document.documentElement.dataset.language=en?'en':'fa';document.documentElement.lang=en?'en':'fa';document.documentElement.dir=en?'ltr':'rtl';window.dispatchEvent(new Event('masir-language-change'));return en?translateInterface(ref.current,{dictionary:{...UI_TRANSLATIONS,...EN_RESEARCH_FUNDING}}):undefined},[en]);return <div className={'app '+person+'-workspace'}><main><div className="page" ref={ref}><ResearchFundingPanel person={person}/></div></main></div>};createRoot(document.getElementById('root')).render(<App/>);"""
 config={'stdin':{'contents':harness,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts');(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=work));threading.Thread(target=server.serve_forever,daemon=True).start()
 taskids=['english','research_cv','transcript','degree_translation','proposal','writing_sample','referees','supervisor','eligibility','funding_budget','visa_conditions','clinical_plan']
 plan={'preferredDegree':'either','tasks':[{'id':x,'status':'todo'} for x in taskids]}
 fixture={'profileId':'amir','profileReview':{'available':True,'cvReviewed':True,'trainingIncomplete':True,'boardPending':True,'languageUncertified':True},'plan':plan,'catalog':[{'id':'programme','title':'Synthetic scholarship programme','institution':'Synthetic University','url':'https://university.example/scholarships','status':'program','degreeTypes':['phd','research_masters'],'fundingCoverage':'fees_and_stipend','internationalEligibility':'conditional','summary':'A competitive research programme.','requirements':['Research proposal and academic references.'],'reading':{'status':'read','readAt':'2026-11-12T00:00:00Z'}}],'opportunities':[{'id':'live-call','title':'Synthetic epidemiology PhD call','url':'https://university.example/call','status':'open','deadline':'2099-01-01T00:00:00Z','degreeTypes':['phd'],'fundingCoverage':'unknown'},{'id':'expired','title':'Synthetic expired project','url':'https://university.example/past','status':'open','deadline':'2000-01-01T12:00:00Z','degreeTypes':['phd'],'fundingCoverage':'partial'}],'strategy':{'decision':{'summary':'A research degree requires a real research purpose.','reasonableWhen':['Funding covers tuition and living costs.'],'notGuaranteed':['Research admission is separate from medical registration.']},'requirements':[],'tracks':[{'id':'clinical','title':'Medical registration','claims':['Registration requirements remain separate.'],'actions':['Check the current official pathway.']}],'jointActions':[{'id':'language','title':'Joint English practice','benefitForBoth':'Practise together.','privacyBoundary':'Keep all accounts separate.'}],'sources':[{'id':'source','title':'Synthetic official source','url':'https://university.example/source','summary':'Research admission requirements.'}]}}
 fixture['catalog'].append({'id':'closed-programme','title':'Synthetic closed programme','status':'closed','catalogKind':'program','deadline':'2000-01-01','degreeTypes':['phd'],'fundingCoverage':'fees_and_stipend'})
 writes=[];reads=[];errors=[];fail={'value':False};hold={'value':False};pending=[]
 def route(r):
  reads.append((r.request.method,r.request.url))
  if r.request.method=='POST':
   payload=r.request.post_data_json;writes.append((urlparse(r.request.url).path,payload));r.fulfill(json={'plan':{**payload,'updatedAt':'2026-11-12T00:00:00Z'}});return
  if hold['value']:pending.append(r);return
  if fail['value']:r.fulfill(status=503,json={'error':'synthetic_unavailable'});return
  r.fulfill(json=fixture)
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/**',route)
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle');expect(page.locator('.research-funding-card')).to_have_count(2);assert not writes
  # Programme is not an open call; expired timestamp is excluded until explicitly requested.
  expect(page.locator('.research-funding-card').filter(has_text='Synthetic scholarship programme')).to_contain_text('برنامهٔ بورس؛ فراخوان مشخص نیست')
  page.locator('.research-funding-filters .checkline input').check();expect(page.locator('.research-funding-card')).to_have_count(4)
  kind=page.locator('.research-funding-filters select').nth(2);kind.select_option('calls');expect(page.locator('.research-funding-card')).to_have_count(2);assert 'Synthetic closed programme' not in page.locator('.research-funding-results').inner_text();kind.select_option('programs');expect(page.locator('.research-funding-card')).to_have_count(2);kind.select_option('all');page.locator('.research-funding-filters .checkline input').uncheck()
  page.locator('.research-degree-preference select').select_option('phd');page.locator('.research-requirement select').first.select_option('in_progress');page.evaluate("window.dispatchEvent(new Event('online'))");page.wait_for_timeout(150);assert page.locator('.research-degree-preference select').input_value()=='phd';assert page.locator('.research-requirement select').first.input_value()=='in_progress';assert not writes
  fail['value']=True;page.evaluate("window.dispatchEvent(new Event('online'))");expect(page.locator('.research-funding-intro .notice[role=status]')).to_be_visible();expect(page.locator('.research-funding-card')).to_have_count(2);assert page.locator('.research-requirement select').first.input_value()=='in_progress';fail['value']=False
  hold['value']=True;page.evaluate("window.dispatchEvent(new Event('online'))");page.wait_for_timeout(100);assert len(pending)==1
  page.locator('.research-plan-save button').click();expect(page.locator('.research-plan-save button')).to_be_disabled();assert len(writes)==1;assert writes[0][0]=='/api/research-funding/plan';assert writes[0][1]['preferredDegree']=='phd';assert next(x for x in writes[0][1]['tasks'] if x['id']=='english')['status']=='in_progress';assert set(writes[0][1])=={'preferredDegree','tasks'} # Progress only, never CV/provider credentials.
  pending.pop().fulfill(json=fixture);hold['value']=False;page.wait_for_timeout(150);expect(page.locator('.research-degree-preference select')).to_have_value('phd');expect(page.locator('.research-requirement select').first).to_have_value('in_progress') # A delayed pre-save read cannot erase the saved edit.
  page.evaluate('window.__english(true)');page.wait_for_timeout(150);page.locator('details').evaluate_all('(nodes)=>nodes.forEach(x=>x.open=true)');page.wait_for_timeout(50)
  body=page.locator('body').inner_text();assert not re.search(r'[\u0600-\u06ff]',body),body
  # Render the actual public strategy and publisher snapshots, not only empty mock labels.
  fixture['strategy']=json.loads((repo/'cloud/research-bridge-evidence.json').read_text())
  seedpaths=list((repo/'data/au-funding-readings').glob('au-funding-*.json'))
  if seedpaths:
   fixture['catalog']=[];fixture['opportunities']=[]
   for source in seedpaths:
    row=json.loads(source.read_text());item=json.loads(row['data']);item['fundingCoverageEvidence']=item.get('fundingCoverage',{}).get('evidence',[]);item['fundingCoverage']=item.get('fundingCoverage',{}).get('classification','unknown');item['degreeTypes']=['phd' if 'phd' in x.lower() else 'research_masters' for x in item.get('degreeTypes',[])];item['reading']={'status':'read','readAt':row['read_at']};item['profileMatch']={'matchedTopics':[{'id':'internal_medicine','label':'پزشکی داخلی'}],'eligibilityConfirmed':False};fixture['catalog'].append(item)
   page.evaluate("window.dispatchEvent(new Event('online'))");page.wait_for_timeout(200)
   page.locator('details').evaluate_all('(nodes)=>nodes.forEach(x=>x.open=true)');page.wait_for_timeout(150)
   actual=page.locator('body').inner_text();assert not re.search(r'[\u0600-\u06ff]',actual),actual
   assert '36,800' in actual or '36800' in actual
  for width in [320,390,1440]:
   page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
  initial=len(reads);page.evaluate("window.__person('arash')");expect(page.locator('.research-funding-access')).to_be_visible();assert 'Synthetic epidemiology' not in page.locator('body').inner_text();page.wait_for_timeout(100);assert len(reads)==initial;assert not errors,errors;b.close()
 server.shutdown()
print('PASS funding programme/call distinction, expired-call filter, preparation save only on explicit action, preserved edits/polls/failure, English320/390/1440 and owner guard; no provider actions.')
