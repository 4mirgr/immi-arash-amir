"""Actual app badges, toast and source-error notices; synthetic accounts only."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json, shutil, subprocess, tempfile, threading
from playwright.sync_api import expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
work = tempfile.TemporaryDirectory()
root = Path(work.name)
source = (repo/'src/main.jsx').read_text()
assert 'neon-notifications.css' in source, 'The shared notification style must be imported by the actual app.'
source = source[:source.rfind('createRoot(document.getElementById("root"))')]
source = source.replace('const [automationTab,setAutomationTab]=useState("operations");', 'const [automationTab,setAutomationTab]=useState("operations");window.__tab=setTab;window.__toast=setToast;')
# Keep the real app/components and actual current CSS. This is a display-only
# harness in place of the login gate, not a production authentication bypass.
source += """
function Harness(){const[owner,setOwner]=useState('arash');window.__owner=setOwner;return <App key={owner} cloud initialPerson={owner} workspaceOwnerId={owner==='arash'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222'} onSignOut={()=>{}}/>}
createRoot(document.getElementById('root')).render(<Harness/>);
"""
subprocess.run(['node', '--input-type=module', '-e', 'import {build} from "esbuild";await build('+json.dumps({'stdin': {'contents': source, 'resolveDir': str(repo/'src'), 'sourcefile': 'notification-audit.jsx', 'loader': 'jsx'}, 'outfile': str(root/'app.js'), 'bundle': True, 'format': 'esm', 'external': ['/fonts/*'], 'logLevel': 'silent'})+');'], cwd=repo, check=True)
(root/'index.html').write_text('<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>')
shutil.copytree(repo/'public/fonts', root/'fonts')
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
owner, scenario = 'arash', 'normal'
writes, errors = [], []

def route(request):
    path = urlparse(request.request.url).path
    query = parse_qs(urlparse(request.request.url).query)
    who = query.get('profile', [owner])[0]
    if request.request.method != 'GET':
        writes.append(path)
    if path == '/api/bootstrap':
        data = {'profiles': [{'id': who, 'name': 'Synthetic Applicant', 'cvText': 'Synthetic own CV'}], 'clinics': [], 'stations': [], 'revision': 'synthetic', 'settings': {}}
    elif path == '/api/updates':
        data = {'revision': 'synthetic'}
    elif path == '/api/google/status':
        secondary = query.get('mailbox') == ['secondary']
        data = {'configured': True, 'connected': not secondary, 'email': who+'@example.invalid' if not secondary else None, 'capabilities': {'gmailRead': True, 'gmailSend': True}}
    elif path == '/api/google/mail-opportunities' and scenario != 'mail_error':
        data = {'items': [{'id': 'mop_'+'a'*32, 'title': 'Synthetic GP role', 'clinicName': 'Synthetic Practice', 'status': 'suggested', 'unread': True, 'receivedAt': '2026-11-19T01:00:00Z', 'fit': {}, 'draft': {}}], 'unreadCount': 27, 'more': False}
    elif path == '/api/opportunities' and scenario != 'opportunity_error':
        data = {'opportunities': [], 'total': 0}
    elif path == '/api/opportunities/sources':
        data = {'sources': [], 'automation': {'observed': True, 'status': 'completed', 'overdue': False}}
    elif path == '/api/gp-workflow/settings':
        data = {'goalMode': 'employment'}
    elif path in ['/api/drafts', '/api/presets', '/api/cv/versions']:
        data = []
    elif path in ['/api/google/mail/messages', '/api/google/clinic-correspondence']:
        data = {'items': [], 'messages': [], 'coverage': {}}
    else:
        request.fulfill(status=503, json={'error': 'Synthetic service unavailable'})
        return
    request.fulfill(json=data)

def rgb(value):
    return [float(part) for part in value[value.index('(')+1:value.index(')')].replace(',', ' ').split()[:3]]

def contrast(a, b):
    def lum(colour):
        channels = [channel/255 for channel in rgb(colour)]
        channels = [channel/12.92 if channel <= .04045 else ((channel+.055)/1.055)**2.4 for channel in channels]
        return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]
    first, second = sorted([lum(a), lum(b)])
    return (second+.05)/(first+.05)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 900})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/**', route)
    page.goto('http://127.0.0.1:'+str(server.server_port))
    expect(page.locator('.mail-opportunity-toolbar-badge')).to_have_text('۲۷')
    for current in ['arash', 'amir']:
        owner = current
        scenario = 'normal' if owner == 'arash' else 'opportunity_error'
        page.evaluate('(owner)=>window.__owner(owner)', owner)
        page.wait_for_function('typeof window.__toast==="function"')
        if owner == 'arash':
            expect(page.locator('.mail-opportunity-toolbar-badge')).to_have_text('۲۷')
            page.locator('.mail-opportunity-toolbar-badge').click()
            expect(page.locator('.mail-opportunity-count')).to_have_text('۲۷')
            scenario = 'mail_error'
            page.locator('.mail-opportunities-heading button').click()
            expect(page.locator('.mail-opportunities [role=alert]')).to_be_visible()
        else:
            page.evaluate("window.__tab('opportunities')")
            expect(page.locator('.opportunity-workspace [role=alert]')).to_be_visible()
            expect(page.locator('.mail-opportunity-toolbar-badge')).to_have_count(0)
        for language in ['fa', 'en']:
            page.evaluate("lang=>{document.documentElement.dataset.language=lang;document.documentElement.lang=lang;document.documentElement.dir=lang==='en'?'ltr':'rtl';window.dispatchEvent(new Event('masir-language-change'));}", language)
            for theme in ['dark', 'light']:
                page.evaluate('(theme)=>document.documentElement.dataset.theme=theme', theme)
                for width in [320, 390, 1440]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    for scale in [1, 1.5]:
                        page.evaluate("scale=>document.documentElement.style.setProperty('--workspace-text-scale',scale)", scale)
                        page.evaluate("window.__toast('Synthetic notification: review the new opportunity.')")
                        expect(page.locator('.toast')).to_be_visible()
                        snapshot = page.evaluate("""()=>{const style=node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return {colour:s.color,background:s.backgroundColor,border:s.borderColor,shadow:s.boxShadow,animation:s.animationName,duration:s.animationDuration,x:r.x,right:r.right,width:r.width,height:r.height}};return {badges:[...document.querySelectorAll('.mail-opportunity-toolbar-badge,.mail-opportunity-count')].map(style),toast:style(document.querySelector('.toast')),alerts:[...document.querySelectorAll('[role=alert]')].map(style),plain:[...document.querySelectorAll('.notice:not([role=alert])')].map(style),overflow:document.documentElement.scrollWidth>innerWidth}}""")
                        case = f'{owner}/{language}/{theme}/{width}/{scale}: {snapshot}'
                        assert not snapshot['overflow'], case
                        assert contrast(snapshot['toast']['colour'], snapshot['toast']['background']) >= 4.5, case
                        assert snapshot['toast']['animation'] == 'none', case
                        assert all(item['animation'] == 'none' for item in snapshot['alerts']+snapshot['plain']), case
                        for badge in snapshot['badges']:
                            assert contrast(badge['colour'], badge['background']) >= 4.5, case
                            assert badge['background'] == 'rgb(245, 255, 59)', case
                            assert badge['animation'] == 'notification-neon-breathe' and badge['duration'] == '2.8s', case
                            assert badge['shadow'] != 'none' and badge['width'] >= 15 and badge['height'] >= 15, case
                        assert snapshot['toast']['x'] >= 0 and snapshot['toast']['right'] <= width+1, case
                        if owner == 'arash' and width == 390 and scale == 1.5:
                            page.screenshot(path=f'/tmp/aus-neon-notifications-{language}-{theme}-390.png')
                if owner == 'arash':
                    # The halo varies smoothly without hiding text or moving badges.
                    pulse = page.locator('.mail-opportunity-toolbar-badge').evaluate("""node=>{const a=node.getAnimations()[0];a.pause();a.currentTime=0;const first=getComputedStyle(node).boxShadow,r=node.getBoundingClientRect();a.currentTime=1400;const second=getComputedStyle(node).boxShadow,n=node.getBoundingClientRect();return {first,second,same:r.width===n.width&&r.height===n.height,opacity:getComputedStyle(node).opacity}}""")
                    assert pulse['first'] != pulse['second'] and pulse['same'] and pulse['opacity'] == '1', pulse
                    page.emulate_media(reduced_motion='reduce')
                    reduced = page.locator('.mail-opportunity-toolbar-badge').evaluate("node=>({animation:getComputedStyle(node).animationName,shadow:getComputedStyle(node).boxShadow})")
                    assert reduced['animation'] == 'none' and reduced['shadow'] != 'none', reduced
                    page.emulate_media(reduced_motion='no-preference')
        page.evaluate("window.__toast('Synthetic request failed. Please try again.')")
        expect(page.locator('.toast.toast-error')).to_be_visible()
        expect(page.locator('.toast.toast-error .lucide-triangle-alert')).to_have_count(1)
        error_style = page.locator('.toast.toast-error').evaluate("node=>({text:getComputedStyle(node).color,bg:getComputedStyle(node).backgroundColor,icon:getComputedStyle(node.querySelector('svg')).color,animation:getComputedStyle(node).animationName})")
        assert contrast(error_style['text'], error_style['bg']) >= 4.5 and error_style['animation'] == 'none', error_style
        assert error_style['icon'] != error_style['text'], error_style
    assert not writes, writes
    assert not errors, errors
    print('PASS actual app unread counts, source errors and toasts: both owners, light/dark, Persian/English, 320/390/1440, 100/150% text, contrast, gentle halo, reduced-motion and no provider writes.')
    browser.close()
server.shutdown()
