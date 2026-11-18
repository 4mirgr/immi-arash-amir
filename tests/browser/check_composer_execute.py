"""Composer execution: private opportunity context, frozen review and no replay.

Every account, message and API response is synthetic; no providers are called.
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
import {GoogleSendPanel} from 'REPO/src/google-send-panel.jsx';
import {LanguageControl} from 'REPO/src/language-control.jsx';
import 'REPO/src/workspace-style.css';
function App(){const[mode,setMode]=useState('ready'),[version,setVersion]=useState(0);window.__mode=setMode;window.__version=setVersion;
 const context={id:'11111111-1111-4111-8111-111111111111'};
 return <div className="app arash-workspace"><main className="main"><LanguageControl personId="arash"/><div style={{height:140}}/><div style={{overflow:'hidden',transform:'translateZ(0)'}}><GoogleSendPanel key={mode+version} person="arash" selected={[]} subject="Synthetic application" body="Synthetic draft for the owned email opportunity." connection={{state:{connected:mode!=='disconnected',email:'arash@example.invalid',capabilities:{gmailSend:mode!=='disconnected'}}}} mailOpportunityContext={context} replyContext={mode==='conflict'?{messageId:'syntheticReply',threadId:'syntheticThread'}:null} onOpenSettings={()=>{window.__settings=(window.__settings||0)+1;}} notify={()=>{}}/></div></main></div>;
}createRoot(document.getElementById('root')).render(<App/>);
""".replace("REPO", repo.as_posix())
build = {"stdin": {"contents": harness, "resolveDir": str(repo), "sourcefile": "composer-execute.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(build) + ');'], cwd=repo, check=True)
(root / "index.html").write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo / "public/fonts", root / "fonts")
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()

cv = "22222222-2222-4222-8222-222222222222"
queue, writes, pending, errors = [], [], [], []
scenario = "new"


def route(request):
    parsed = urlparse(request.request.url)
    payload = json.loads(request.request.post_data or "{}")
    if request.request.method != "GET":
        writes.append((parsed.path, payload))
    if parsed.path.endswith("/cv/versions"):
        data = [{"id": cv, "name": "Synthetic owned CV", "isDefault": True}]
    elif parsed.path.endswith("/queue") and request.request.method == "GET":
        data = {"items": queue, "dailyLimit": 20}
    elif parsed.path.endswith("/preview"):
        assert payload["mailOpportunityContext"] == {"id": "11111111-1111-4111-8111-111111111111"}
        assert not any(key in payload for key in ["clinicIds", "replyContext", "followUpContext"]), payload
        assert payload["cvVersionId"] == cv
        data = {"sender": "arash@example.invalid", "recipients": [{"recipient": "manager@example.invalid", "subject": "Synthetic application", "cvVersionId": cv, "attachmentName": "synthetic.docx"}], "newCount": 1, "reservedToday": 0, "excluded": []}
    elif parsed.path.endswith("/queue"):
        assert payload["mailOpportunityContext"] == {"id": "11111111-1111-4111-8111-111111111111"}
        row = {"id": "syntheticQueue", "recipient": "manager@example.invalid", "sender": "arash@example.invalid", "subject": "Synthetic application", "attachmentName": "synthetic.docx", "status": "queued", "cvVersionId": cv, "reused": scenario == "reuse"}
        queue[:] = [row]
        data = {"items": [row], "excluded": []}
    elif parsed.path.endswith("/dispatch"):
        assert payload == {"ids": ["syntheticQueue"]}
        pending.append(request)
        return
    else:
        data = {}
    request.fulfill(json=data)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 780})
    page.set_default_timeout(6000)
    page.route("**/api/**", route)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:" + str(server.server_port))
    dock = page.locator(".send-action-dock-composer")
    expect(page.locator("#send-cv")).to_have_value(cv)
    expect(dock.locator("button")).to_have_text("ارسال ایمیل و رزومه")
    dock.locator("button").click()
    expect(page.locator(".send-preview")).to_be_visible()
    assert len(writes) == 1 and writes[0][0].endswith("/preview"), writes
    dock.locator("button").click()
    expect(page.locator(".send-queue-row input")).to_be_checked()
    expect(dock.locator("button")).to_have_text("تأیید و ارسال ۱ ایمیل")
    assert not any(path.endswith("/dispatch") for path, _ in writes), writes
    for width in [390, 1440]:
        page.set_viewport_size({"width": width, "height": 780})
        page.evaluate("document.documentElement.style.fontSize='140%';window.scrollTo(0,document.body.scrollHeight)")
        expect(dock).to_be_in_viewport()
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
    dock.locator("button").click()
    expect(dock.locator("button")).to_have_text("در حال ارسال…")
    expect(dock.locator("button")).to_be_disabled()
    assert len(pending) == 1
    queue[0]["status"] = "sent"
    pending.pop().fulfill(json={"items": [{"id": "syntheticQueue", "status": "sent"}]})
    expect(dock.locator("button")).to_have_text("ارسال شد")
    expect(dock.locator("button")).to_be_disabled()
    assert sum(path.endswith("/dispatch") for path, _ in writes) == 1

    # An old queue receipt must never become a freshly selected transport job.
    scenario = "reuse"
    page.evaluate("window.__version(1)")
    expect(page.locator("#send-cv")).to_have_value(cv)
    dock.locator("button").click()
    expect(page.locator(".send-preview")).to_be_visible()
    dock.locator("button").click()
    expect(page.locator(".send-queue-row input")).not_to_be_checked()
    assert sum(path.endswith("/dispatch") for path, _ in writes) == 1

    before = len(writes)
    page.evaluate("window.__mode('conflict')")
    expect(page.locator("#send-cv")).to_have_value(cv)
    dock.locator("button").click()
    expect(page.get_by_role("alert").first).to_contain_text("فقط")
    assert len(writes) == before
    page.evaluate("window.__mode('disconnected')")
    expect(dock.locator("button")).to_be_enabled()
    dock.locator("button").click()
    assert page.evaluate("window.__settings") == 1
    assert len(writes) == before
    assert not errors, errors
    browser.close()
server.shutdown()
print("PASS composer execute: private context without clinic fallback, review/freeze/final-send stages, green viewport control, pending/success, no old-queue replay or conflicting contexts. Synthetic calls only.")
