"""Public application previews distinguish email, cover letter and both PDFs.

Synthetic API responses only; never queues, schedules or sends a real message.
Run: python tests/browser/check_public_application_documents.py
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import shutil
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

REPO = Path(__file__).resolve().parents[2]
CV = '11111111-1111-4111-8111-111111111111'
PRESET = '22222222-2222-4222-8222-222222222222'
SHORT = 'Dear Practice Manager,\nPlease find my CV and cover letter attached for this role.\nKind regards,\nSynthetic Doctor'
COVER = 'Dear Practice Manager,\n\nSynthetic complete clinic-specific cover letter.\n\nSynthetic experience and source evidence.\n\nKind regards,\nSynthetic Doctor'
ATTACHMENTS = [{'name':'Synthetic_CV.pdf','mimeType':'application/pdf','hash':'a'*64,'size':1800},{'name':'Synthetic_cover_letter.pdf','mimeType':'application/pdf','hash':'b'*64,'size':2200}]
with tempfile.TemporaryDirectory(prefix='public-application-documents-') as work:
    root = Path(work)
    harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';
import {OpportunityBulkMail} from 'REPO/src/opportunity-bulk-mail.jsx';
import {LanguageControl} from 'REPO/src/language-control.jsx';
import 'REPO/src/workspace-style.css';
const opportunity={id:'opp_'+'a'.repeat(32),title:'Synthetic advertised GP vacancy',organization:'Synthetic Clinic'};
function Harness(){const [mode,setMode]=useState('single');window.__mode=setMode;return <div><LanguageControl personId="arash"/><main>{mode==='bulk'?<OpportunityBulkMail person="arash" opportunities={[opportunity]} onClose={()=>{}} onOpenSettings={()=>{}}/>:<OpportunityMail key={mode} compact person="arash" opportunity={{...opportunity,id:'opp_'+(mode==='scheduled'?'b':'a').repeat(32)}}/>}</main></div>;}
createRoot(document.getElementById('root')).render(<Harness/>);
""".replace('REPO', REPO.as_posix())
    build = {'stdin':{'contents':harness,'resolveDir':str(REPO),'sourcefile':'public-application-documents.jsx','loader':'jsx'},'outfile':str(root/'app.js'),'bundle':True,'format':'esm','external':['/fonts/*'],'logLevel':'silent'}
    subprocess.run(['node','--input-type=module','-e','import {build} from "esbuild";await build('+json.dumps(build)+');'],cwd=REPO,check=True)
    (root/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>')
    shutil.copytree(REPO/'public/fonts',root/'fonts')
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=work))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    writes, errors = [], []
    fail_pdf={'active':False}
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.on('pageerror',lambda e:errors.append(str(e)))
        def route(r):
            path=urlparse(r.request.url).path
            payload=json.loads(r.request.post_data or '{}')
            oid=next((part for part in path.split('/') if part.startswith('opp_')),'opp_'+'a'*32)
            if r.request.method!='GET':
                writes.append(path)
                assert path.endswith('/preview') or path.endswith('/package'),path
            if path.endswith('/preview') and fail_pdf['active']:
                r.fulfill(status=422,json={'error':'gp_application_pdf_text_unsupported'})
                return
            if path.endswith('/cv/versions'): data=[{'id':CV,'name':'Synthetic own CV','isDefault':True}]
            elif path.endswith('/presets'): data=[{'id':PRESET,'name':'GP B — Independent practice enquiry','isDefault':True}]
            elif path.endswith('/google/status'): data={'connected':True,'configured':True,'email':'arash@example.invalid','capabilities':{'gmailSend':True}}
            elif path.endswith('/mail'):
                approvals=[]
                if oid.endswith('b'*32):
                    base={'status':'cancelled','sender':'arash@example.invalid','recipient':'manager@example.invalid','sendAfter':'2026-11-28T12:00:00Z'}
                    approvals=[{**base,'id':'new-scheduled','message':{'subject':'Synthetic new scheduled','body':SHORT},'coverLetter':COVER,'attachments':ATTACHMENTS},{**base,'id':'legacy-scheduled','message':{'subject':'Synthetic legacy scheduled','body':'Original legacy email text'},'attachmentName':'Legacy_CV.docx'}]
                data={'opportunityId':oid,'url':'https://synthetic.example.invalid/job','publishedRecipients':['manager@example.invalid'],'scheduling':{'enabled':True,'ready':True,'approvals':approvals}}
            elif path.endswith('/package'): data={'profileId':'arash','opportunityId':oid,'cvVersionId':CV,'variant':'B','recommendedVariant':'B','templateName':'GP B — Independent practice enquiry','subjects':['Synthetic application'],'body':COVER,'previewBody':COVER,'emailBody':SHORT,'readyForReview':r.request.method=='POST','missingFields':[],'suggestedSelection':{'clinicQuote':'Synthetic clinic evidence','cvQuote':'Synthetic own CV experience'}}
            elif path.endswith('/preview'): data={'opportunityId':oid,'presetId':PRESET,'cvVersionId':CV,'mailbox':payload['mailbox'],'sender':'arash@example.invalid','reviewHash':'synthetic-review','message':{'subject':'Synthetic application','body':SHORT},'coverLetter':COVER,'attachments':ATTACHMENTS,'recipients':[{'recipient':payload['recipient'],'subject':'Synthetic application','cvVersionId':CV,'attachmentName':ATTACHMENTS[0]['name'],'status':'preview','existingId':None}],'dailyLimit':20,'reservedToday':0,'excluded':[]}
            else: raise AssertionError(path)
            r.fulfill(json=data)
        page.route('**/api/**',route)
        page.goto('http://127.0.0.1:'+str(server.server_port))
        page.locator('.send-action-dock-inline button').click()
        preview=page.locator('.opportunity-recipient-preview')
        expect(preview).to_be_visible()
        expect(preview.locator('.opportunity-mail-body')).to_have_text(SHORT)
        expect(preview.get_by_role('heading',name='متن کوتاه ایمیل',exact=True)).to_be_visible()
        expect(preview.locator('.application-cover-preview')).to_have_count(1)
        assert preview.locator('.application-cover-preview').get_attribute('open') is None
        preview.locator('.application-cover-preview summary').click()
        expect(preview.locator('.application-cover-preview pre')).to_have_text(COVER)
        expect(preview.locator('.application-attachment-list li')).to_have_count(2)
        expect(preview.get_by_text('Synthetic_CV.pdf',exact=True)).to_have_count(1)
        expect(preview.get_by_text('Synthetic_cover_letter.pdf',exact=True)).to_have_count(1)
        preview.locator('.application-attachment-list details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)')
        expect(preview.locator('code').first).to_have_text('a'*64)
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert len(writes)==1 and writes[0].endswith('/preview')
        # Frozen new and legacy scheduled messages are rendered exactly as recorded.
        page.evaluate("window.__mode('scheduled')")
        scheduled=page.locator('.opportunity-mail-scheduled')
        expect(scheduled).to_be_visible()
        scheduled.locator('details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)')
        expect(scheduled.get_by_text('Legacy_CV.docx',exact=True)).to_have_count(1)
        expect(scheduled.get_by_text('Original legacy email text',exact=True)).to_have_count(1)
        expect(scheduled.locator('.application-cover-preview')).to_have_count(1)
        expect(scheduled.locator('.application-attachment-list li')).to_have_count(2)
        # Draft stage and final per-recipient bulk preview use the same distinction.
        page.evaluate("window.__mode('bulk')")
        page.get_by_role('button',name='آماده‌کردن نامه‌ها و گیرنده‌ها',exact=True).click()
        draft=page.locator('.bulk-mail-draft')
        expect(draft).to_have_count(1)
        draft.evaluate('(node)=>node.open=true')
        expect(draft.locator('.opportunity-mail-body')).to_have_text(SHORT)
        expect(draft.locator('.application-cover-preview pre')).to_have_text(COVER)
        expect(draft.locator('.application-attachment-list')).to_have_count(0)
        draft.locator(':scope > .checkline input').check()
        page.get_by_role('button',name='پیش‌نمایش نهایی منتخب‌ها',exact=True).click()
        final=page.locator('.bulk-mail-final')
        expect(final).to_be_visible()
        final.locator('details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)')
        expect(final.locator('.opportunity-mail-body')).to_have_text(SHORT)
        expect(final.locator('.application-cover-preview pre')).to_have_text(COVER)
        expect(final.locator('.application-attachment-list li')).to_have_count(2)
        assert all(path.endswith('/preview') or path.endswith('/package') for path in writes)
        # Human labels switch; private document text and review state are untouched.
        page.get_by_role('button',name='تغییر زبان رابط به انگلیسی',exact=True).click()
        expect(final.get_by_role('heading',name='Short email body',exact=True)).to_be_visible()
        expect(final.get_by_role('heading',name='Attachments for this message',exact=True)).to_be_visible()
        expect(final.locator('.opportunity-mail-body')).to_have_text(SHORT)
        expect(final.locator('.application-cover-preview pre')).to_have_text(COVER)
        expect(final.locator('.checkline input')).not_to_be_checked()
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        fail_pdf['active']=True
        page.evaluate("window.__mode('single')")
        page.locator('.send-action-dock-inline button').click()
        expect(page.get_by_text('The CV or cover-letter text cannot be rendered as a PDF. Review it and request a fresh preview.',exact=True)).to_be_visible()
        page.get_by_role('button',name='Switch interface to Persian',exact=True).click()
        expect(page.locator('.opportunity-mail-review')).to_contain_text('متن رزومه یا کاورلتر برای ساخت PDF قابل پردازش نیست؛ متن را بررسی و پیش‌نمایش تازه بگیرید.')
        assert all(path.endswith('/preview') or path.endswith('/package') for path in writes)
        assert not errors,errors
        browser.close()
    server.shutdown()
print('PASS public application documents: distinct short email and cover letter, two attachment metadata records, frozen legacy schedule, individual/bulk, FA/EN1440/390; no queue, schedule or send.')
