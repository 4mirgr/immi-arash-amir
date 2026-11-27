"""GP discovery links and offshore questions; synthetic UI only, no providers.

Run: python tests/browser/check_gp_discovery_linkedin.py
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import shutil
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

REPO = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='gp-discovery-linkedin-') as work:
    root = Path(work)
    harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {GPDiscovery} from 'REPO/src/gp-discovery.jsx';
import {LanguageControl} from 'REPO/src/language-control.jsx';
import 'REPO/src/workspace-style.css';
const sources=[{id:'synthetic-qld',name:'Synthetic Queensland discovery source',state:'QLD',channel:'workforce',trust:'official',url:'https://synthetic.example.invalid/qld'},{id:'synthetic-au',name:'Synthetic national discovery source',state:'AU',channel:'clinic',trust:'unofficial',url:'https://synthetic.example.invalid/au'}];
function Harness(){const [notice,setNotice]=useState('');return <div className="app arash-workspace" style={{display:'block'}}><div className="page" style={{maxWidth:1100,margin:'auto',padding:16}}><LanguageControl personId="arash"/><GPDiscovery sources={sources} notify={setNotice}/><p role="status">{notice}</p></div></div>};
createRoot(document.getElementById('root')).render(<Harness/>);
""".replace('REPO', REPO.as_posix())
    build = {'stdin': {'contents': harness, 'resolveDir': str(REPO), 'sourcefile': 'gp-discovery-linkedin.jsx', 'loader': 'jsx'}, 'outfile': str(root/'app.js'), 'bundle': True, 'format': 'esm', 'external': ['/fonts/*'], 'logLevel': 'silent'}
    subprocess.run(['node', '--input-type=module', '-e', 'import {build} from "esbuild";await build('+json.dumps(build)+');'], cwd=REPO, check=True)
    (root/'index.html').write_text('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>')
    shutil.copytree(REPO/'public/fonts', root/'fonts')
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=work))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1440,'height':1000})
        errors, external = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("Object.defineProperty(navigator,'clipboard',{value:{async writeText(value){window.__copied=value;}}});")
        def route(r):
            if urlparse(r.request.url).hostname != '127.0.0.1':
                external.append(r.request.url)
                r.abort()
            else:
                r.continue_()
        page.route('**/*', route)
        page.goto('http://127.0.0.1:'+str(server.server_port))
        target = page.get_by_label('محل کاوش GP', exact=True)
        expect(target.locator('option[value=linkedin_jobs]')).to_have_text('فرصت‌های کاری LinkedIn')
        expect(target.locator('option[value=linkedin]')).to_have_text('پست‌های عمومی LinkedIn')
        target.select_option('linkedin_jobs')
        broad = page.get_by_role('link', name='جست‌وجوی گسترده در LinkedIn Jobs', exact=True)
        broad_url = urlparse(broad.get_attribute('href'))
        assert broad_url.hostname == 'www.linkedin.com' and broad_url.path == '/jobs/search/'
        assert parse_qs(broad_url.query) == {'keywords':['General Practitioner'],'location':['Australia'],'sortBy':['DD']}
        page.get_by_label('ایالت کاوش GP', exact=True).select_option('QLD')
        page.get_by_label('شهر یا مرکز برای کاوش GP', exact=True).fill('Townsville')
        broad_href = broad.get_attribute('href')
        assert parse_qs(urlparse(broad_href).query)['location'] == ['Townsville, Queensland, Australia']
        page.get_by_role('checkbox', name='عبارت Level 1', exact=True).check()
        page.get_by_role('checkbox', name='عبارت visa sponsorship', exact=True).check()
        assert broad.get_attribute('href') == broad_href, 'Optional precision terms must not narrow the broad search'
        focused = page.get_by_role('link', name='LinkedIn Jobs با واژه‌های انتخابی', exact=True)
        focused_terms = parse_qs(urlparse(focused.get_attribute('href')).query)['keywords'][0]
        assert '"level 1"' in focused_terms and '"visa sponsorship"' in focused_terms and 'IMG' in focused_terms
        assert '\\' not in focused_terms
        indexed = page.get_by_role('link', name='جست‌وجوی آگهی‌های عمومی LinkedIn در وب', exact=True)
        q = parse_qs(urlparse(indexed.get_attribute('href')).query)['q'][0]
        assert 'site:linkedin.com/jobs/view' in q and 'level 1' in q and 'visa sponsorship' in q and '\\' not in q
        # Search-only wording controls must not filter the registered discovery source list.
        expect(page.get_by_text('Synthetic Queensland discovery source', exact=True)).to_have_count(1)
        expect(page.get_by_text('Synthetic national discovery source', exact=True)).to_have_count(1)
        page.get_by_role('button', name='کپی پرسش‌های بررسی مرکز', exact=True).click()
        questions = page.evaluate('window.__copied')
        assert 'currently offshore' in questions and 'not yet completed PESCI' in questions
        assert 'conditional offer' in questions and 'Level 1 supervision' in questions
        assert 'willing and currently able to sponsor' in questions and 'before travel' in questions
        assert '\n\n' in questions
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
        # Switch languages without resetting selected target, geography or keyword controls.
        page.get_by_role('button', name='تغییر زبان رابط به انگلیسی', exact=True).click()
        en_target = page.get_by_label('GP discovery location', exact=True)
        expect(en_target).to_have_value('linkedin_jobs')
        expect(en_target.locator('option[value=linkedin_jobs]')).to_have_text('LinkedIn job opportunities')
        expect(page.get_by_role('link', name='Broad search on LinkedIn Jobs', exact=True)).to_be_visible()
        expect(page.get_by_role('checkbox', name='Level 1 wording', exact=True)).to_be_checked()
        page.locator('details').evaluate_all('(nodes)=>nodes.forEach(n=>n.open=true)')
        remaining = page.evaluate("""() => {const out=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(/[\\u0600-\\u06ff]/.test(n.nodeValue)&&n.parentElement?.getClientRects().length)out.push(n.nodeValue.trim());}return out;}""")
        assert not remaining, remaining
        en_target.select_option('linkedin')
        expect(page.get_by_role('link', name='Broad search on LinkedIn Jobs', exact=True)).to_have_count(0)
        posts = page.get_by_role('link', name='Search public LinkedIn posts on the web', exact=True)
        assert 'site:linkedin.com/posts' in parse_qs(urlparse(posts.get_attribute('href')).query)['q'][0]
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
        assert not errors, errors
        assert not external, external
        browser.close()
    server.shutdown()
print('PASS GP LinkedIn discovery: native jobs geography, broad/precision separation, public posts/index, offshore questions, Persian/English desktop/mobile; no provider requests.')
