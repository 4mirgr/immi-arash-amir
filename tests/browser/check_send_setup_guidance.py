"""Real send controls: setup guidance stays actionable, without provider writes.

Run: python tests/browser/check_send_setup_guidance.py
All clinic, CV, account and transport data are synthetic.
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

repo = Path(__file__).resolve().parents[2]
work = tempfile.TemporaryDirectory()
root = Path(work.name)
harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';
import {OpportunityBulkMail} from 'REPO/src/opportunity-bulk-mail.jsx';
import {JobOpportunitiesPanel} from 'REPO/src/job-opportunities-panel.jsx';
import {LanguageControl} from 'REPO/src/language-control.jsx';
import 'REPO/src/workspace-style.css';
const opportunities=['a','b'].map(x=>({id:'opp_'+x.repeat(32),title:'Synthetic GP vacancy '+x,organization:'Synthetic clinic '+x,country:'AU',state:'NSW',status:'open',url:'https://example.invalid/job/'+x}));
function Harness(){
 const [view,setView]=useState('mail'),[scenario,setScenario]=useState('ready'),[owner,setOwner]=useState('arash'),[settings,setSettings]=useState(0);
 window.__view=setView;window.__scenario=setScenario;window.__owner=setOwner;
 const props={person:owner,onOpenSettings:()=>setSettings(x=>x+1),notify:()=>{}};
 return <div className={'app '+owner+'-workspace'}><main className="main"><LanguageControl personId={owner}/><output data-settings>{settings}</output><div key={view+scenario+owner}>
 {view==='jobs'?<JobOpportunitiesPanel {...props}/>:view==='bulk'?<OpportunityBulkMail {...props} opportunities={opportunities} onClose={()=>{}}/>:<OpportunityMail {...props} compact opportunity={opportunities[0]}/>}
 </div></main></div>;
}createRoot(document.getElementById('root')).render(<Harness/>);
""".replace("REPO", repo.as_posix())
build = {"stdin": {"contents": harness, "resolveDir": str(repo), "sourcefile": "send-setup.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(build) + ');'], cwd=repo, check=True)
(root / "index.html").write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo / "public/fonts", root / "fonts")
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()

cv = "11111111-1111-4111-8111-111111111111"
preset = "22222222-2222-4222-8222-222222222222"
scenario = "ready"
writes, errors = [], []

def route(request):
    url = urlparse(request.request.url)
    path, query = url.path, parse_qs(url.query)
    who = query.get("profile", ["arash"])[0]
    mailbox = query.get("mailbox", ["primary"])[0]
    oid = next((part for part in path.split("/") if part.startswith("opp_")), "opp_" + "a" * 32)
    if request.request.method != "GET":
        writes.append(path)
    if path.endswith("/cv/versions"):
        data = [{"id": cv, "name": "Synthetic CV", "isDefault": scenario != "select-cv"}]
    elif path.endswith("/presets"):
        data = [{"id": preset, "name": "GP B — Independent practice enquiry", "isDefault": True}]
    elif path.endswith("/google/status"):
        connected = scenario != "disconnected" and (scenario != "secondary-only" or mailbox == "secondary")
        data = {"connected": connected, "email": who + ("2" if mailbox == "secondary" else "") + "@example.invalid", "capabilities": {"gmailSend": connected}}
    elif path.endswith("/mail"):
        data = {"opportunityId": oid, "url": "https://example.invalid/job/a", "trust": "official", "publishedRecipients": [] if scenario == "no-email" else ["clinic@example.invalid"], "scheduling": {"enabled": False, "approvals": []}}
    elif path == "/api/opportunities":
        data = {"opportunities": [{"id": "opp_" + x * 32, "title": "Synthetic GP vacancy " + x, "organization": "Synthetic clinic " + x, "country": "AU", "state": "NSW", "status": "open", "url": "https://example.invalid/job/" + x} for x in ["a", "b"]], "total": 2}
    elif path.endswith("/sources"):
        data = {"sources": [], "automation": {"observed": True, "status": "completed"}}
    elif path.endswith("/package"):
        data = {"profileId": who, "opportunityId": oid, "cvVersionId": cv, "variant": "B", "recommendedVariant": "B", "templateName": "GP B — Independent practice enquiry", "subjects": ["Synthetic enquiry"], "previewBody": "Synthetic evidence-based letter", "suggestedSelection": {"clinicQuote": "Synthetic clinic fact.", "cvQuote": "Synthetic owned CV fact."}, "clinicEvidenceCandidates": [{"text": "Synthetic clinic fact."}], "cvEvidenceCandidates": [{"text": "Synthetic owned CV fact."}], "dossier": {}, "recipients": ["clinic@example.invalid"], "writingStatus": {"issues": []}, "missingFields": []}
    else:
        data = {}
    request.fulfill(json=data)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 780})
    page.set_default_timeout(5000)
    page.route("**/api/**", route)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:" + str(server.server_port))
    dock = page.locator(".send-action-dock-inline")
    expect(dock.locator("button")).to_be_enabled()

    for mode in ["disconnected", "secondary-only", "select-cv", "no-email"]:
        scenario = mode
        page.evaluate("window.__scenario(" + json.dumps(mode) + ")")
        expect(dock.locator("button")).to_be_enabled()
        before = int(page.locator("[data-settings]").inner_text())
        dock.locator("button").click()
        if mode == "disconnected":
            expect(page.locator("[data-settings]")).to_have_text(str(before + 1))
            expect(page.get_by_role("button", name="اتصال Gmail برای ارسال", exact=True)).to_be_visible()
        elif mode == "secondary-only":
            expect(page.locator("select[data-mail-sender]")).to_be_focused()
            expect(page.locator("select[data-mail-sender]")).to_have_value("primary")
        elif mode == "select-cv":
            expect(page.locator("select[data-mail-cv]")).to_be_focused()
        else:
            expect(page.locator(".opportunity-mail-missing-recipient")).to_be_focused()
            expect(page.get_by_role("link", name="بازکردن درخواست رسمی مرکز", exact=True)).to_be_visible()
        assert not writes, writes
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")

    scenario = "disconnected"
    page.evaluate("window.__scenario('disconnected');window.__view('bulk')")
    bulk = page.locator(".send-action-dock-floating")
    expect(bulk.locator("button")).to_be_enabled()
    before = int(page.locator("[data-settings]").inner_text())
    bulk.locator("button").click()
    expect(page.locator("[data-settings]")).to_have_text(str(before + 1))
    assert not writes, writes

    scenario = "ready"
    page.evaluate("window.__scenario('ready');window.__view('jobs')")
    expect(page.locator(".arash-row-quick-actions > button")).to_have_count(2)
    page.get_by_role("checkbox", name="انتخاب این آگهی برای ارسال دسته‌ای", exact=True).first.check()
    page.locator(".arash-row-quick-actions > button").first.click()
    expect(page.locator(".gp-application-compact")).to_be_visible()
    expect(page.locator(".opportunity-mail")).to_have_count(0)
    expect(page.locator(".opportunity-batch-launcher")).to_be_in_viewport()
    page.evaluate("window.scrollTo(0,document.body.scrollHeight)")
    expect(page.locator(".opportunity-batch-launcher")).to_be_in_viewport()
    assert not writes, writes

    # An owner change removes the other owner's selected adverts and open letter.
    page.evaluate("window.__owner('amir')")
    expect(page.locator(".opportunity-result-card")).to_have_count(2)
    expect(page.locator(".gp-application-compact")).to_have_count(0)
    expect(page.locator(".opportunity-batch-launcher")).to_have_count(0)
    assert not writes, writes

    # Setup blockers and their actions also remain understandable in English.
    scenario = "disconnected"
    page.evaluate("window.__owner('arash');window.__view('mail');window.__scenario('disconnected')")
    expect(dock.locator("button")).to_be_enabled()
    page.locator(".language-control").click()
    expect(page.locator("html")).to_have_attribute("lang", "en")
    expect(dock).to_contain_text("Connect Gmail for this account or select an already connected sender.")
    expect(page.get_by_role("button", name="Connect Gmail to send", exact=True)).to_be_visible()
    for width in [390, 1440]:
        page.set_viewport_size({"width": width, "height": 780})
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
    assert not errors, errors
    browser.close()
server.shutdown()
print("PASS missing Gmail/CV/recipients guide to setup; every ad has Send; batch action persists while reading; owner state stays isolated; no provider writes.")
