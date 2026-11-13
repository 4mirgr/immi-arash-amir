"""Synthetic owner-only paged backup download/verification; no cloud/provider writes."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
import tempfile,subprocess,json,threading,shutil,re,hashlib
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory)
 harness="""import React,{useState,useLayoutEffect,useRef}from'react';import{createRoot}from'react-dom/client';import{PagedBackup}from'./paged-backup.jsx';import{translateInterface,UI_TRANSLATIONS}from'./ui-translations.mjs';import{EN_PAGED_BACKUP}from'./locales/en-paged-backup.mjs';import'./workspace-style.css';function App(){const[person,setPerson]=useState('amir'),[english,setEnglish]=useState(false),ref=useRef();window.__person=setPerson;window.__english=setEnglish;useLayoutEffect(()=>{document.documentElement.lang=english?'en':'fa';document.documentElement.dataset.language=english?'en':'fa';document.documentElement.dir=english?'ltr':'rtl';window.dispatchEvent(new Event('masir-language-change'));return english?translateInterface(ref.current,{dictionary:{...UI_TRANSLATIONS,...EN_PAGED_BACKUP}}):undefined;},[english]);return <div className={'app '+person+'-workspace'}><main><div className="page" ref={ref}><PagedBackup person={person}/></div></main></div>};createRoot(document.getElementById('root')).render(<App/>);"""
 config={'stdin':{'contents':harness,'resolveDir':str(repo/'src'),'loader':'jsx'},'bundle':True,'format':'esm','outfile':str(root/'app.js'),'external':['/fonts/*'],'logLevel':'silent'}
 subprocess.run(['node','--input-type=module','-e','import{build}from"esbuild";await build('+json.dumps(config)+');'],cwd=repo,check=True)
 shutil.copytree(repo/'public/fonts',root/'fonts');(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=directory));threading.Thread(target=server.serve_forever,daemon=True).start()
 reads=[];writes=[];errors=[];downloads=[];hold={'enabled':False,'route':None}
 recovery={'providerReconnectRequired':True,'scheduledApprovalsExcluded':True,'automaticJobsRequireReview':True,'transportRecordsReferenceOnly':True,'productionRestoreImplemented':False}
 def response(url):
  profile=parse_qs(url.query).get('profile',['amir'])[0]
  if url.path.endswith('/manifest'):return {'format':'masir-owner-paged-export','version':2,'profileId':profile,'generatedAt':'2026-11-13T12:00:00Z','collections':[{'id':'d1.clinic_bank_leads','available':True},{'id':'d1.unavailable_table','available':False}],'exclusions':['provider_credentials_and_oauth_state'],'limits':{'pageRows':50,'pageBytes':500000,'cursorMinutes':30},'coverage':{'complete':False,'atomicSnapshot':False,'automaticCloudBackup':False},'recovery':recovery}
  payload={'collection':'d1.clinic_bank_leads','exportId':'synthetic-export','page':0,'rows':[{'id':'synthetic','note':'Synthetic private clinic record'}],'collectionComplete':True}
  sha=hashlib.sha256(json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
  return {'format':'masir-owner-paged-export','version':2,'profileId':profile,'startedAt':'2026-11-13T12:00:00Z',**payload,'rowCount':1,'sha256':sha,'nextCursor':None,'coverage':{'atomicSnapshot':False,'fullBackupComplete':False,'automaticCloudBackup':False},'recovery':recovery}
 def route(r):
  url=urlparse(r.request.url)
  if r.request.method!='GET':writes.append(url.path);r.fulfill(status=403,json={'error':'unexpected_write'});return
  reads.append(r.request.url)
  if hold['enabled'] and url.path.endswith('/manifest'):hold['route']=r;return
  r.fulfill(json=response(url))
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:errors.append(str(e)));page.on('download',lambda d:downloads.append(d));page.route('**/api/**',route)
  page.goto('http://127.0.0.1:'+str(server.server_port),wait_until='networkidle');assert not reads
  page.locator('.paged-backup-panel>summary').click();assert not reads
  password='Synthetic private export password 123'
  page.get_by_label('گذرواژهٔ فایل چندبخشی',exact=True).fill(password);page.get_by_label('تکرار گذرواژه برای دریافت',exact=True).fill(password)
  with page.expect_download() as pending:page.get_by_role('button',name='دریافت رمزگذاری‌شدهٔ همهٔ صفحه‌ها',exact=True).click()
  target=root/'synthetic-paged.encrypted';pending.value.save_as(target)
  envelope=json.loads(target.read_text());assert set(envelope)=={'format','version','parts','manifest'};assert 'Synthetic private clinic record' not in target.read_text();assert password not in target.read_text();assert len(reads)==2;assert not writes
  expect(page.get_by_label('گذرواژهٔ فایل چندبخشی',exact=True)).to_have_value('')
  page.get_by_text('بررسی فایل چندبخشی روی دستگاه',exact=True).click();page.get_by_label('انتخاب فایل چندبخشی',exact=True).set_input_files(target);page.get_by_label('گذرواژهٔ فایل چندبخشی',exact=True).fill(password);page.get_by_role('button',name='بررسی تمام بخش‌های فایل',exact=True).click();expect(page.locator('.paged-backup-content>[role=status]')).to_contain_text('همهٔ صفحه');assert len(reads)==2
  page.evaluate('window.__english(true)');page.wait_for_timeout(100)
  assert not re.search(r'[\u0600-\u06ff]',page.locator('body').inner_text()),page.locator('body').inner_text()
  for width in [320,390,1440]:
   page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
  # A late read after owner change must not download or display the prior account.
  page.get_by_label('Paged-file passphrase',exact=True).fill(password);page.get_by_label('Repeat passphrase for download',exact=True).fill(password);hold['enabled']=True
  page.get_by_role('button',name='Download all pages encrypted',exact=True).click();page.wait_for_timeout(80);assert hold['route'] is not None
  page.evaluate("window.__person('arash')");held=hold['route'];held.fulfill(json=response(urlparse(held.request.url)));page.wait_for_timeout(150);assert len(downloads)==1;expect(page.get_by_label('Paged-file passphrase',exact=True)).to_have_value('');assert not page.locator('.paged-backup-content>[role=status]').count();assert not writes;assert not errors,errors;browser.close()
 server.shutdown()
print('PASS explicit paged encryption/download, all-part local verification, no plaintext or provider writes, owner-switch cancellation, English and320/390/1440 reflow.')
