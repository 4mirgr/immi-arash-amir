"""Controlled read-only preparation: bounded parallelism, cancel and isolation."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

repo = Path(__file__).resolve().parents[2]
work = tempfile.TemporaryDirectory()
root = Path(work.name)
harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {OpportunityBulkMail} from 'REPO/src/opportunity-bulk-mail.jsx';
import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';
import {LanguageControl} from 'REPO/src/language-control.jsx';
import 'REPO/src/workspace-style.css';
const opportunities=['a','b','c','d'].map(x=>({id:'opp_'+x.repeat(32),organization:'Synthetic Practice '+x,title:'General Practitioner',url:'https://example.invalid/'+x}));
function App(){const [owner,setOwner]=useState('arash'),[view,setView]=useState('bulk');window.__owner=setOwner;window.__view=setView;
return <main className="app"><LanguageControl personId={owner}/>{view==='bulk'?<OpportunityBulkMail person={owner} opportunities={opportunities} onOpenSettings={()=>window.__settings++} onClose={()=>{}}/>:<OpportunityMail person={owner} opportunity={opportunities[0]} onOpenSettings={()=>window.__settings++}/>}</main>;}
window.__settings=0;createRoot(document.getElementById('root')).render(<App/>);
""".replace('REPO', repo.as_posix())
build = {'stdin': {'contents': harness, 'resolveDir': str(repo), 'sourcefile': 'parallel-drafts.jsx', 'loader': 'jsx'}, 'outfile': str(root / 'app.js'), 'bundle': True, 'format': 'esm', 'external': ['/fonts/*'], 'logLevel': 'silent'}
subprocess.run(['node', '--input-type=module', '-e', 'import {build} from "esbuild";await build(' + json.dumps(build) + ');'], cwd=repo, check=True)
(root / 'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo / 'public/fonts', root / 'fonts')
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
cv = '11111111-1111-4111-8111-111111111111'
cv2 = '22222222-2222-4222-8222-222222222222'
preset = '33333333-3333-4333-8333-333333333333'
pending, writes, requests, errors = [], [], [], []
status_failed, hold_owner_setup, hold_drafts, missing_phone = True, False, True, False
held_setup = []

def draft_response(route):
    u = urlparse(route.request.url)
    path, query = u.path, parse_qs(u.query)
    who = query['profile'][0]
    oid = next(part for part in path.split('/') if part.startswith('opp_'))
    name = 'Synthetic Practice ' + oid[-1]
    if path.endswith('/mail'):
        data = {'opportunityId': oid, 'publishedRecipients': [oid[-1] + '@example.invalid'], 'scheduling': {'approvals': []}}
    else:
        data = {'profileId': who, 'opportunityId': oid, 'cvVersionId': query['cvVersionId'][0], 'variant': 'B', 'templateName': 'GP B — Independent practice enquiry', 'subjects': [name + ' enquiry'], 'previewBody': who + ' private draft for ' + name, 'suggestedSelection': {'clinicQuote': name + ' provides chronic care.', 'cvQuote': 'My synthetic chronic care experience.'}}
    if path.endswith('/package') and missing_phone and oid[-1] == 'c':
        data['missingFields'] = ['signature_phone_required']
    route.fulfill(json=data)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 780})
    page.set_default_timeout(5000)
    page.add_init_script("Object.defineProperty(AbortSignal, 'any', {value:undefined, configurable:true})")
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route(request):
        u = urlparse(request.request.url)
        path, query = u.path, parse_qs(u.query)
        who = query.get('profile', ['arash'])[0]
        requests.append((request.request.method, path, who))
        if request.request.method != 'GET':
            writes.append(path)
        if path.endswith('/cv/versions'):
            if hold_owner_setup and who == 'amir':
                held_setup.append(request)
                return
            data = [{'id': cv, 'name': who + ' first CV', 'isDefault': True}, {'id': cv2, 'name': who + ' second CV'}]
        elif path.endswith('/presets'):
            data = [{'id': preset, 'name': 'GP B — Independent practice enquiry', 'isDefault': True}]
        elif path.endswith('/google/status'):
            if status_failed:
                request.fulfill(status=503, json={'error': 'temporary_network_error'})
                return
            data = {'connected': True, 'email': who + '@example.invalid', 'capabilities': {'gmailSend': True}}
        elif path.endswith('/mail') or path.endswith('/package'):
            if hold_drafts:
                pending.append(request)
            else:
                draft_response(request)
            return
        else:
            raise AssertionError('Unexpected request: ' + path)
        request.fulfill(json=data)

    def wait_count(count):
        for _ in range(100):
            if len(pending) >= count:
                return
            page.wait_for_timeout(25)
        raise AssertionError(('Draft requests stalled', len(pending), count))

    def release(letter):
        group = [r for r in pending if 'opp_' + letter * 32 in r.request.url]
        for request in group:
            pending.remove(request)
            draft_response(request)

    page.route('**/api/**', route)
    page.goto('http://127.0.0.1:' + str(server.server_port))
    retry = page.get_by_role('button', name='بررسی دوبارهٔ وضعیت Gmail', exact=True)
    expect(retry).to_be_visible()
    expect(page.locator('p.notice')).to_contain_text('وضعیت Gmail دریافت نشد؛ این خطا به معنی قطع اتصال نیست.')
    page.get_by_label('رزومهٔ ارسال دسته‌ای', exact=True).select_option(cv2)
    status_failed = False
    retry.click()
    expect(page.get_by_role('button', name='آماده‌کردن نامه‌ها و گیرنده‌ها', exact=True)).to_be_enabled()
    assert page.get_by_label('رزومهٔ ارسال دسته‌ای', exact=True).input_value() == cv2
    assert page.evaluate('window.__settings') == 0
    assert not any('google/start' in item[1] for item in requests)

    prepare = page.get_by_role('button', name='آماده‌کردن نامه‌ها و گیرنده‌ها', exact=True)
    prepare.click()
    wait_count(4)
    # Both independent reads for two clinics start before either clinic finishes.
    assert {next(p for p in urlparse(r.request.url).path.split('/') if p.startswith('opp_'))[-1] for r in pending} == {'a', 'b'}
    page.wait_for_timeout(100)
    assert len(pending) == 4, 'More than two clinics started concurrently'
    release('b')
    wait_count(4)  # a is still pending; c starts in the free slot.
    release('c')
    wait_count(4)  # a and d now pending.
    expect(page.locator('.bulk-mail-draft')).to_have_count(2)
    cancel = page.get_by_role('button', name='توقف آماده‌سازی نامه‌ها', exact=True)
    cancel.click()
    expect(page.locator('.bulk-mail-draft')).to_have_count(2)
    expect(prepare).to_be_enabled()
    assert 'Synthetic Practice b' in page.locator('.bulk-mail-draft').nth(0).inner_text()
    assert 'Synthetic Practice c' in page.locator('.bulk-mail-draft').nth(1).inner_text()
    # A late response from the aborted read-only run cannot reintroduce drafts.
    for item in list(pending):
        pending.remove(item)
        draft_response(item)
    page.wait_for_timeout(100)
    expect(page.locator('.bulk-mail-draft')).to_have_count(2)

    prepare.click()
    wait_count(4)
    release('b')
    wait_count(4)
    release('c')
    wait_count(4)
    release('d')
    release('a')
    expect(page.locator('.bulk-mail-draft')).to_have_count(4)
    assert [node.locator('summary').first.inner_text().split('\n')[0] for node in page.locator('.bulk-mail-draft').all()] == ['Synthetic Practice ' + x for x in 'abcd']
    assert not writes, writes

    # Missing signature contacts are actionable before reviewing every draft;
    # an unconfirmed quote alone remains part of the ordinary review stage.
    missing_phone = True
    prepare.click()
    wait_count(4)
    release('a')
    release('b')
    wait_count(4)
    release('c')
    release('d')
    expect(page.locator('.bulk-mail-draft')).to_have_count(4)
    missing_signature = page.locator('.bulk-mail-draft').nth(2)
    missing_signature.locator('summary').click()
    expect(missing_signature.locator('.notice')).to_have_text('تلفن تماسِ امضای نامه را در پروفایل آرش تکمیل کنید.')
    expect(missing_signature.locator('input[type=checkbox]')).to_have_count(0)
    missing_phone = False

    # Same mounted export, new owner: old account's content disappears before
    # the new private setup request has finished, not merely after it succeeds.
    hold_owner_setup = True
    page.evaluate("window.__owner('amir')")
    expect(page.locator('.bulk-mail-draft')).to_have_count(0)
    expect(page.get_by_role('button', name='در حال دریافت…', exact=True)).to_be_visible()
    assert 'arash private draft' not in page.locator('body').inner_text()
    for item in held_setup:
        item.fulfill(json=[{'id': cv, 'name': 'amir first CV', 'isDefault': True}])
    expect(page.get_by_label('رزومهٔ ارسال دسته‌ای', exact=True)).to_have_value(cv)
    # Individual mail status checks and ordinary reloads retain valid choices;
    # a temporary metadata failure must not push the user into OAuth setup.
    hold_owner_setup, hold_drafts, status_failed = False, False, True
    page.evaluate("window.__owner('arash');window.__view('single')")
    retry = page.get_by_role('button', name='بررسی دوبارهٔ وضعیت Gmail', exact=True)
    expect(retry).to_be_visible()
    page.locator('select[data-mail-cv]').select_option(cv2)
    page.locator('select[data-mail-sender]').select_option('secondary')
    page.locator('.opportunity-recipient-picker input[type=checkbox]').uncheck()
    status_failed = False
    retry.click()
    expect(retry).to_have_count(0)
    assert page.locator('select[data-mail-cv]').input_value() == cv2
    assert page.locator('select[data-mail-sender]').input_value() == 'secondary'
    expect(page.locator('.opportunity-recipient-picker input[type=checkbox]')).not_to_be_checked()
    page.get_by_role('button', name='بازخوانی وضعیت', exact=True).click()
    expect(page.get_by_role('button', name='بازخوانی وضعیت', exact=True)).to_be_enabled()
    assert page.locator('select[data-mail-cv]').input_value() == cv2
    assert page.locator('select[data-mail-sender]').input_value() == 'secondary'
    expect(page.locator('.opportunity-recipient-picker input[type=checkbox]')).not_to_be_checked()
    assert page.evaluate('window.__settings') == 0
    status_failed = True
    page.get_by_role('button', name='بازخوانی وضعیت', exact=True).click()
    expect(page.get_by_role('button', name='بررسی دوبارهٔ وضعیت Gmail', exact=True)).to_be_visible()
    page.get_by_role('button', name='تغییر زبان رابط به انگلیسی', exact=True).click()
    expect(page.get_by_role('button', name='Check Gmail status again', exact=True)).to_be_visible()
    expect(page.locator('p.notice')).to_contain_text('Gmail status could not be loaded. This does not establish a disconnected account.')
    status_failed, hold_drafts = False, True
    page.evaluate("window.__view('bulk')")
    page.get_by_role('button', name='Prepare letters and recipients', exact=True).click()
    wait_count(4)
    expect(page.get_by_role('button', name='Stop preparing drafts', exact=True)).to_be_visible()
    page.get_by_role('button', name='Stop preparing drafts', exact=True).click()
    for item in list(pending):
        pending.remove(item)
        draft_response(item)
    page.wait_for_timeout(100)
    assert not any('\u0600' <= char <= '\u06ff' for char in page.locator('body').inner_text()), page.locator('body').inner_text()
    assert not errors, errors
    assert not writes, writes
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    browser.close()
server.shutdown()
work.cleanup()
print('PASS read-only bulk drafts: two-clinic/four-GET bound, ordered progress, abort/restart, immediate owner reset, provider-status retry, preserved individual choices, English/mobile, no OAuth or transport writes.')
