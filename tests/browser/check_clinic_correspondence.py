"""Real clinic-conversation UI: private scopes, safe draft handoff and recovery.

All messages, contacts and identities in this test are synthetic.
Run: python tests/browser/check_clinic_correspondence.py
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import copy
import re
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
import {ClinicCorrespondence} from 'REPO/src/clinic-correspondence.jsx';
import 'REPO/src/workspace-style.css';
window.__cacheReads=0;const originalFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('clinic-correspondence?'))window.__cacheReads++;return originalFetch(...args);};
function Harness(){const[person,setPerson]=useState('arash'),[draft,setDraft]=useState(null),[reply,setReply]=useState(null),[connectionState,setConnectionState]=useState({connected:true});window.__owner=setPerson;window.__connection=setConnectionState;
 const connection={state:{...connectionState,email:person+'@example.invalid'}},secondaryConnection={state:{connected:true,email:person+'2@example.invalid'}};
 return <div className={'app '+person+'-workspace'}><main className="main"><ClinicCorrespondence person={person} ownerId={person+'-synthetic-owner'} connection={connection} secondaryConnection={secondaryConnection} onSettings={()=>{window.__settings=(window.__settings||0)+1;}} onReply={setReply} onPrepare={setDraft} notify={()=>{}}/><output data-draft>{draft?JSON.stringify(draft):''}</output><output data-reply>{reply?JSON.stringify(reply):''}</output></main></div>;
}createRoot(document.getElementById('root')).render(<Harness/>);
""".replace("REPO", repo.as_posix())
build = {"stdin": {"contents": harness, "resolveDir": str(repo), "sourcefile": "clinic-correspondence.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(build) + ');'], cwd=repo, check=True)
(root / "index.html").write_text('<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}</style><div id="root"></div><script type="module" src="app.js"></script></html>')
shutil.copytree(repo / "public/fonts", root / "fonts")
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()

errors, writes, reads, deferred = [], [], [], []
scenario = "normal"


def response(person, mailbox, suffix=""):
    recipient = person + "-clinic@example.invalid"
    name = person + " " + mailbox + " clinic" + suffix
    item = {"id": "threadWaiting", "threadId": "threadWaiting", "clinicLabel": name, "recipient": recipient, "subject": "Synthetic GP application", "status": "waiting", "lastSentAt": "2026-11-01T10:00:00Z", "lastReceivedAt": None, "signals": {"level1": {"status": "unknown"}, "sponsorship": {"status": "unknown"}, "pesci": {"status": "unknown"}}, "timeline": [{"id": "messageSent", "direction": "sent", "date": "2026-11-01T10:00:00Z", "from": person + "@example.invalid", "to": recipient, "excerpt": "Synthetic clinical application text."}], "followUp": {"eligible": True, "dueAt": "2026-11-08T10:00:00Z", "reason": "follow_up_due"}}
    replied = {**item, "id": "threadReplied", "threadId": "threadReplied", "clinicLabel": name + " replied", "status": "documents_requested", "lastReceivedAt": "2026-11-05T10:00:00Z", "signals": {"level1": {"status": "positive", "excerpt": "Synthetic Level 1 response."}, "sponsorship": {"status": "unknown"}, "pesci": {"status": "unknown"}}, "replyMessage": {"id": "messageReceived", "threadId": "threadReplied", "from": recipient, "subject": "Synthetic GP application", "plainBody": "Please send the requested documents."}, "timeline": item["timeline"] + [{"id": "messageReceived", "direction": "received", "date": "2026-11-05T10:00:00Z", "from": recipient, "to": person + "@example.invalid", "excerpt": "Please send the requested documents."}], "followUp": {"eligible": False, "dueAt": None, "reason": "reply_received_stop_follow_up"}}
    return {"items": [item, replied], "coverage": {"cachedMessages": 3, "windowLimit": 2000, "limited": False, "reader": {"scannedSentCount": 18, "matchedSentCount": 2, "backfillComplete": False, "pendingThreadMessageCount": 4}}, "automaticSending": False}


def route(request):
    parsed = urlparse(request.request.url)
    query = parse_qs(parsed.query)
    person, mailbox = query.get("profile", ["arash"])[0], query.get("mailbox", ["primary"])[0]
    if request.request.method == "GET":
        offset = int(query.get("offset", ["0"])[0])
        reads.append((person, mailbox, offset))
        if scenario == "defer" and person == "arash":
            deferred.append((request, response(person, mailbox, " OLD RESPONSE")))
            return
        data = response(person, mailbox)
        if scenario == "background_permission":
            data["coverage"]["reader"]["lastError"] = "gmail_read_scope_required"
        if scenario == "background_transient":
            data["coverage"]["activity"] = {"status": "blocked", "code": "gmail_unavailable"}
        if scenario == "pages":
            if offset == 0:
                data["items"] = [{**copy.deepcopy(data["items"][0]), "id": "pageThread" + str(index), "threadId": "pageThread" + str(index), "clinicLabel": "Synthetic page clinic " + str(index)} for index in range(50)]
                data.update({"hasMore": True, "nextOffset": 50})
            else:
                data["items"] = [{**data["items"][0], "id": "olderThread", "threadId": "olderThread", "clinicLabel": "Synthetic older clinic"}]
                data.update({"hasMore": False, "nextOffset": None})
        request.fulfill(json=data)
        return
    writes.append((parsed.path, person, mailbox, request.request.post_data))
    if parsed.path.endswith("/sync"):
        assert request.request.post_data == "{}"
        if scenario == "failure":
            request.fulfill(status=503, json={"error": "gmail_unavailable"})
            return
        request.fulfill(json={"synced": 2, "providerReads": 5, "moreSent": True})
    elif parsed.path.endswith("/draft"):
        assert json.loads(request.request.post_data) == {"threadId": "threadWaiting"}
        request.fulfill(json={"kind": "follow_up", "subject": "Re: Synthetic GP application", "body": "Synthetic follow-up for review only.", "recipient": person + "-clinic@example.invalid", "threadId": "threadWaiting", "followUpContext": {"messageId": "messageSent", "threadId": "threadWaiting", "to": person + "-clinic@example.invalid"}, "replyContext": None, "reviewRequired": True})
    else:
        raise AssertionError("Unexpected mutation: " + parsed.path)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 780})
    page.set_default_timeout(6000)
    page.route("**/api/**", route)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.clock.install()
    page.goto("http://127.0.0.1:" + str(server.server_port))
    panel = page.locator(".clinic-correspondence")
    cards = panel.locator(".clinic-conversation")
    expect(cards).to_have_count(2)
    assert not writes, writes
    cards.first.locator("summary").click()
    expect(cards.first.get_by_role("button", name="آماده‌کردن پیگیری برای بازبینی", exact=True)).to_be_visible()
    expect(cards.first.get_by_text("اسپانسرشیپ ویزای کار", exact=True)).to_be_visible()
    cards.first.get_by_role("button", name="آماده‌کردن پیگیری برای بازبینی", exact=True).click()
    expect(page.locator("[data-draft]")).to_contain_text('"kind":"follow_up"')
    draft = json.loads(page.locator("[data-draft]").inner_text())
    assert draft["mailbox"] == "primary" and draft["reviewRequired"] is True
    assert draft["followUpContext"]["messageId"] == "messageSent"
    assert len(writes) == 1 and writes[0][0].endswith("/draft"), writes
    cards.nth(1).locator("summary").click()
    expect(cards.nth(1).get_by_role("button", name="آماده‌کردن پیگیری برای بازبینی", exact=True)).to_have_count(0)
    cards.nth(1).get_by_role("button", name="نوشتن پاسخ در همین رشته", exact=True).click()
    expect(page.locator("[data-reply]")).to_contain_text('"id":"messageReceived"')

    scenario = "failure"
    panel.get_by_role("button", name="خواندن و ادامهٔ بررسی Gmail", exact=True).click()
    expect(panel.get_by_role("alert")).to_contain_text("gmail_unavailable")
    expect(cards).to_have_count(2)
    assert cards.first.get_attribute("open") is not None, "Polling discarded the open conversation"
    scenario = "normal"
    page.evaluate("window.__connection({connected:true,stale:true})")
    expect(cards).to_have_count(2)

    scenario = "background_permission"
    panel.get_by_role("button", name="خواندن و ادامهٔ بررسی Gmail", exact=True).click()
    warning = panel.locator("[data-background-review-error]")
    expect(warning).to_contain_text("gmail_read_scope_required")
    expect(cards).to_have_count(2)
    warning.get_by_role("button", name="بررسی اتصال همین حساب", exact=True).click()
    assert page.evaluate("window.__settings") == 1
    scenario = "background_transient"
    panel.get_by_role("button", name="خواندن و ادامهٔ بررسی Gmail", exact=True).click()
    expect(warning).to_contain_text("gmail_unavailable")
    expect(warning.get_by_role("button")).to_have_count(0)
    expect(cards).to_have_count(2)
    scenario = "normal"

    panel.get_by_role("combobox", name="صندوق مکاتبات کلینیک‌ها", exact=True).select_option("secondary")
    expect(cards.first.locator("summary strong")).to_have_text("arash secondary clinic")
    cards.first.locator("summary").click()
    cards.first.get_by_role("button", name="آماده‌کردن پیگیری برای بازبینی", exact=True).click()
    expect(page.locator("[data-draft]")).to_contain_text('"mailbox":"secondary"')
    assert writes[-1][2] == "secondary"

    # A delayed response cannot repopulate another owner's workspace or a later
    # visit to the original owner with the same scope values.
    scenario = "defer"
    panel.get_by_role("button", name="خواندن و ادامهٔ بررسی Gmail", exact=True).click()
    page.wait_for_function("document.querySelector('.clinic-correspondence-heading button').disabled")
    page.evaluate("window.__owner('amir')")
    expect(cards.first.locator("summary strong")).to_have_text("amir primary clinic")
    scenario = "normal"
    page.evaluate("window.__owner('arash')")
    expect(cards.first.locator("summary strong")).to_have_text("arash secondary clinic")
    for request, data in deferred:
        request.fulfill(json=data)
    expect(panel.get_by_text("OLD RESPONSE", exact=False)).to_have_count(0)

    # Fifty-result requests and explicit older-page loading support display
    # pagination. A cache refresh retains the loaded page rather than reverting
    # to page one while a user is reading an older conversation.
    scenario = "pages"
    panel.get_by_role("button", name="خواندن و ادامهٔ بررسی Gmail", exact=True).click()
    panel.get_by_label("تعداد نمایش", exact=True).select_option("50")
    expect(cards).to_have_count(50)
    panel.get_by_role("button", name="دریافت ۵۰ رشتهٔ قدیمی‌تر از حافظه", exact=True).click()
    panel.get_by_role("button", name="صفحهٔ بعد", exact=True).click()
    expect(cards).to_have_count(1)
    expect(cards.first.locator("summary strong")).to_have_text("Synthetic older clinic")
    before = len(reads)
    page.clock.run_for(61000)
    page.wait_for_function("window.__cacheReads >= " + str(before + 2))
    page.wait_for_function("!document.querySelector('.clinic-correspondence-heading button').disabled")
    expect(cards.first.locator("summary strong")).to_have_text("Synthetic older clinic")
    assert len(reads) >= before + 2 and reads[-1][2] == 50, reads[before:]
    scenario = "background_permission"
    panel.get_by_role("button", name="خواندن و ادامهٔ بررسی Gmail", exact=True).click()
    expect(cards).to_have_count(2)

    page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';dispatchEvent(new Event('masir-language-change'))")
    expect(panel.get_by_role("heading", name="Clinic conversations, from application to reply", exact=True)).to_be_visible()
    panel.locator(".clinic-correspondence-coverage summary").click()
    cards.first.locator("summary").click()
    cards.nth(1).locator("summary").click()
    assert not re.search(r'[\u0600-\u06ff]', panel.inner_text()), panel.inner_text()
    for node in panel.locator("[aria-label],input[placeholder]").all():
        assert not re.search(r'[\u0600-\u06ff]', (node.get_attribute("aria-label") or "") + (node.get_attribute("placeholder") or ""))
    assert not page.evaluate("document.documentElement.scrollWidth>innerWidth"), "Mobile overflow"
    assert all(path.endswith("/sync") or path.endswith("/draft") for path, _, _, _ in writes), writes
    assert not errors, errors
    browser.close()
server.shutdown()
print("PASS clinic correspondence: mailbox/owner isolation, late-response rejection, private draft handoff, reply-aware actions, transient continuity, English and mobile layout; no sends.")
