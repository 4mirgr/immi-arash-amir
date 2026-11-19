"""Real list selection + floating count reflow; all responses are synthetic."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json, shutil, subprocess, tempfile, threading
from playwright.sync_api import sync_playwright

repo = Path(__file__).resolve().parents[2]
work = tempfile.TemporaryDirectory()
root = Path(work.name)
harness = """import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {JobOpportunitiesPanel} from 'REPO/src/job-opportunities-panel.jsx';
import 'REPO/src/workspace-style.css';
function App(){const[person,setPerson]=useState('arash');window.__owner=setPerson;
return <div className={'app '+person+'-workspace'}><main className='main'><div className='page'><JobOpportunitiesPanel key={person} person={person} workspaceOwnerId={person==='arash'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222'} notify={()=>{}}/></div></main></div>}
createRoot(document.getElementById('root')).render(<App/>);""".replace('REPO', repo.as_posix())
script = 'import {build} from "esbuild";await build('+json.dumps({'stdin': {'contents': harness, 'resolveDir': str(repo), 'sourcefile': 'bulk-selection-layout.jsx', 'loader': 'jsx'}, 'outfile': str(root/'app.js'), 'bundle': True, 'format': 'esm', 'external': ['/fonts/*'], 'logLevel': 'silent'})+');'
subprocess.run(['node', '--input-type=module', '-e', script], cwd=repo, check=True)
(root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')
shutil.copytree(repo/'public/fonts', root/'fonts')
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
writes, errors = [], []

def route(request):
    path = urlparse(request.request.url).path
    if request.request.method != 'GET':
        writes.append(path)
    if path == '/api/opportunities':
        data = {'opportunities': [{'id': 'opp_'+format(i, '032x'), 'title': 'General Practitioner — Synthetic Practice '+str(i), 'organization': 'Synthetic Medical Practice '+str(i), 'state': 'ACT', 'country': 'AU', 'status': 'open', 'kind': 'vacancy', 'url': 'https://example.invalid/job/'+str(i), 'gpApplicationPriority': {'tier': 3, 'stars': 3}} for i in range(20)], 'total': 150, 'goalMode': 'employment'}
    elif path == '/api/opportunities/sources':
        data = {'sources': [], 'automation': {'observed': True, 'status': 'completed', 'overdue': False}}
    elif path == '/api/gp-workflow/settings':
        data = {'goalMode': 'employment'}
    else:
        data = {}
    request.fulfill(json=data)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/**', route)
    page.goto('http://127.0.0.1:'+str(server.server_port))
    page.locator('.opportunity-bulk-choice input').first.wait_for()
    count = 0
    for owner in ['arash', 'amir']:
        page.evaluate('(owner)=>window.__owner(owner)', owner)
        page.locator('.opportunity-bulk-choice input').first.wait_for()
        for lang in ['fa', 'en']:
            page.evaluate("lang=>{document.documentElement.dataset.language=lang;document.documentElement.lang=lang;document.documentElement.dir=lang==='en'?'ltr':'rtl';window.dispatchEvent(new Event('masir-language-change'));}", lang)
            for selected in [1, 20]:
                checks = page.locator('.opportunity-bulk-choice input')
                page.locator('.opportunity-bulk-toolbar input').uncheck()
                if selected == 1:
                    checks.first.check()
                else:
                    page.locator('.opportunity-bulk-toolbar input').check()
                for width in [320, 390, 430, 1440]:
                    page.set_viewport_size({'width': width, 'height': 844})
                    for scale in [1, 1.3, 1.5]:
                        page.evaluate("scale=>document.documentElement.style.setProperty('--workspace-text-scale',scale)", scale)
                        page.locator('.opportunity-bulk-toolbar').scroll_into_view_if_needed()
                        page.wait_for_timeout(35)
                        geometry = page.evaluate("""()=>{const toolbar=document.querySelector('.opportunity-bulk-toolbar'),help=toolbar.querySelector('.section-help'),dock=document.querySelector('.opportunity-batch-launcher'),button=dock.querySelector('button'),numeral=button.querySelector('bdi');
                        const box=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
                        const number=box(numeral),painted=document.elementFromPoint(number.x+number.width/2,number.y+number.height/2)?.closest('button')===button;
                        return {toolbar:box(toolbar),help:box(help),dock:box(dock),button:box(button),number,numberPainted:painted,label:button.textContent.replace(/\\s+/g,' ').trim(),pageOverflow:document.documentElement.scrollWidth>innerWidth,childOverflow:[...toolbar.children,...dock.children].some(node=>node.scrollWidth>node.clientWidth+1)}}""")
                        case = f'{owner}/{lang}/{selected}/{width}/{scale}: {geometry}'
                        assert not geometry['pageOverflow'], case
                        assert not geometry['childOverflow'], case
                        if width <= 430:
                            assert geometry['help']['width'] >= geometry['toolbar']['width']*.75, case
                            assert geometry['toolbar']['height'] < 420, case
                        assert geometry['button']['width'] >= 120, case
                        assert geometry['button']['height'] >= 44, case
                        numeral = str(selected) if lang == 'en' else str(selected).translate(str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹'))
                        assert numeral in geometry['label'], case
                        assert geometry['number']['width'] >= 5 and geometry['numberPainted'], case
                        assert geometry['number']['x'] >= geometry['button']['x'] and geometry['number']['right'] <= geometry['button']['right'], case
                        assert geometry['button']['x'] >= 0 and geometry['button']['right'] <= width+1, case
                        count += 1
                        if owner == 'arash' and selected == 1 and width == 390 and scale == 1.3:
                            page.screenshot(path='/tmp/aus-bulk-selection-'+lang+'-390.png')
    assert not writes, writes
    assert not errors, errors
    print(f'PASS {count} selection/dock layouts: both owners, Persian/English, 320/390/430/1440 widths, 100/130/150% text and 1/20 selected ads. No mutations.')
    browser.close()
server.shutdown()
