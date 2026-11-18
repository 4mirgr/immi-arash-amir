"""Private email opportunities, exact deep links and reviewed sending.

All accounts, messages, contacts and transport acknowledgements are synthetic.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import re
import shutil
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
workspace = tempfile.TemporaryDirectory()
root = Path(workspace.name)
first = "mop_" + "a" * 32
second = "mop_" + "b" * 32
foreign = "mop_" + "f" * 32
cv = "11111111-1111-4111-8111-111111111111"

harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {MailOpportunities,readMailOpportunityDeepLink} from 'REPO/src/mail-opportunities.jsx';
import 'REPO/src/workspace-style.css';
function Harness(){const[person,setPerson]=useState('arash'),[owner,setOwner]=useState('ownerA'),[focus,setFocus]=useState(()=>readMailOpportunityDeepLink(location.href));window.__owner=setOwner;window.__person=setPerson;window.__focus=setFocus;
 const primary={state:{connected:true,email:owner+'-primary@example.invalid'}},secondary={state:{connected:true,email:owner+'-secondary@example.invalid'}};
 return <div className={'app '+person+'-workspace'}><main className="main"><MailOpportunities person={person} ownerId={owner} connection={primary} secondaryConnection={secondary} focus={focus} onSettings={()=>{window.__settings=(window.__settings||0)+1;}} onUnreadCount={()=>{}}/></main></div>;
}createRoot(document.getElementById('root')).render(<Harness/>);
""".replace("REPO", repo.as_posix())
config = {"stdin": {"contents": harness, "resolveDir": str(repo), "sourcefile": "mail-opportunities.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(config) + ');'], cwd=repo, check=True)
(root / "index.html").write_text('<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>')
full_config = {"entryPoints": [str(repo / "src/main.jsx")], "outfile": str(root / "main.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(full_config) + ');'], cwd=repo, check=True)
(root / "full.html").write_text('<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="main.css"><div id="root"></div><script type="module" src="main.js"></script></html>')
shutil.copytree(repo / "public/fonts", root / "fonts")
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = "http://127.0.0.1:" + str(server.server_port)

scenario = "normal"
writes, errors, pending = [], [], []
owner = "ownerA"
recipients = ["manager@synthetic-clinic.example.invalid", "recruitment@synthetic-clinic.example.invalid"]


def item(identifier, mailbox="primary"):
    name = owner + " " + mailbox + (" Coastal Practice" if identifier == first else " Rural Practice")
    return {"id": identifier, "title": "General practitioner; supervision needs confirmation", "clinicName": name, "sourceUrl": "https://clinic.example.invalid/careers", "receivedAt": "2026-11-18T02:00:00Z", "mailbox": mailbox, "sourceKind": "linkedin_alert", "status": "suggested", "unread": True, "fit": {"priority": "high", "level1": "unknown", "sponsorship": "unknown", "pesci": "unknown"}, "draft": {"status": "not_prepared"}, "provenance": {"gmailId": "syntheticMessage", "threadId": "syntheticThread"}}


def route(request):
    parsed = urlparse(request.request.url)
    query = parse_qs(parsed.query)
    mailbox = query.get("mailbox", ["primary"])[0]
    path = parsed.path
    method = request.request.method
    if path == "/api/public-config":
        request.fulfill(json={"authRequired": True, "supabaseUrl": "https://auth.example.invalid", "publishableKey": "sb_publishable_synthetic"})
        return
    if path == "/api/me":
        request.fulfill(json={"profileId": "arash", "userId": "22222222-2222-4222-8222-222222222222"})
        return
    if path == "/api/bootstrap":
        request.fulfill(json={"clinics": [], "profiles": [{"id": "arash", "name": "Synthetic Applicant", "cvText": "Synthetic own CV"}], "stations": [], "revision": "synthetic_revision", "settings": {}})
        return
    if path == "/api/google/status":
        request.fulfill(json={"configured": True, "connected": True, "email": owner + "-" + mailbox + "@example.invalid", "capabilities": {"gmailRead": True, "gmailSend": True}})
        return
    if path in ["/api/drafts", "/api/google/mail/queue"]:
        request.fulfill(json=[] if path == "/api/drafts" else {"items": []})
        return
    if path in ["/api/google/clinic-correspondence", "/api/google/mail/messages"]:
        request.fulfill(json={"items": [], "messages": [], "coverage": {}})
        return
    if path == "/api/cv/versions":
        request.fulfill(json=[{"id": cv, "name": "Synthetic own GP CV", "isDefault": True}])
        return
    if method == "GET":
        if scenario == "offline":
            request.fulfill(status=503, json={"error": "mail_opportunities_unavailable"})
        elif path.rsplit("/", 1)[-1] == foreign:
            request.fulfill(status=404, json={"error": "mail_opportunity_unavailable"})
        elif re.match(r"mop_[a-f0-9]{32}$", path.rsplit("/", 1)[-1]):
            request.fulfill(json=item(path.rsplit("/", 1)[-1], mailbox))
        elif scenario == "defer":
            pending.append((request, {"items": [item(first, mailbox)], "unreadCount": 1, "more": False}))
        else:
            offset = int(query.get("offset", ["0"])[0])
            if scenario == "pages":
                request.fulfill(json={"items": [item(first if offset == 0 else second, mailbox)], "unreadCount": 2, "more": offset == 0, "nextOffset": 25 if offset == 0 else None})
            else:
                request.fulfill(json={"items": [item(first, mailbox), item(second, mailbox)], "unreadCount": 2, "more": False})
        return
    body = json.loads(request.request.post_data or "{}")
    writes.append({"path": path, "mailbox": mailbox, "body": body})
    if path.endswith("/read"):
        request.fulfill(json={"read": True})
    elif path.endswith("/prepare"):
        assert body == {"cvVersionId": cv}
        if scenario == "needs_contact":
            request.fulfill(json={"readyForReview": False, "recipients": [], "missing": ["needs_contact"], "cvVersionId": cv})
        else:
            request.fulfill(json={"readyForReview": True, "recipients": recipients, "subject": "Synthetic tailored application", "body": "Synthetic clinic-specific letter.\n\nOwn verified clinical experience.\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nSynthetic Applicant\nEmail: applicant@example.invalid", "cvVersionId": cv})
    elif path.endswith("/preview"):
        assert body["cvVersionId"] == cv and body["recipient"] in recipients
        request.fulfill(json={"readyForReview": True, "sender": owner + "-" + mailbox + "@example.invalid", "recipients": [{"recipient": body["recipient"]}], "cvVersionId": cv, "reviewHash": "synthetic-review-" + body["recipient"], "subject": "Synthetic tailored application", "body": "Synthetic clinic-specific letter.\n\nOwn verified clinical experience.\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nSynthetic Applicant\nEmail: applicant@example.invalid"})
    elif path.endswith("/send"):
        assert body["confirmSend"] is True and body["reviewHash"] == "synthetic-review-" + body["recipient"] and body["cvVersionId"] == cv
        if scenario == "unknown":
            request.fulfill(status=503, json={"error": "delivery_unknown"})
        elif scenario == "sending":
            pending.append((request, {"items": [{"status": "sent", "recipient": body["recipient"]}]}))
        else:
            request.fulfill(json={"items": [{"status": "sent", "recipient": body["recipient"]}], "automaticRetry": False})
    else:
        raise AssertionError("Unexpected mutation: " + path)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 780})
    page.set_default_timeout(8000)
    page.route("**/api/**", route)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base)
    panel = page.locator(".mail-opportunities")
    cards = panel.locator(".mail-opportunity")
    expect(cards).to_have_count(2)
    assert not writes
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_visible()
    expect(cards.first.locator(".mail-opportunity-recipients input:checked")).to_have_count(2)
    assert not [entry for entry in writes if entry["path"].endswith("/send")]
    expect(cards.first.locator(".mail-opportunity-letter")).to_contain_text("Own verified clinical experience")
    single = page.get_by_role("region", name="ارسال همین فرصت ایمیلی", exact=True)
    expect(single.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile opportunity UI overflows"
    scenario = "sending"
    cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True).click()
    expect(cards.first.get_by_role("button", name="در حال ارسال…", exact=True)).to_be_disabled()
    page.wait_for_timeout(150)
    assert len(pending) == 2
    for request, data in pending:
        request.fulfill(json=data)
    pending.clear()
    expect(cards.first.get_by_role("button", name="ارسال شد", exact=True)).to_be_disabled()
    assert len([entry for entry in writes if entry["path"].endswith("/send")]) == 2

    scenario = "normal"
    page.reload()
    expect(cards).to_have_count(2)
    cards.first.locator('header>input[type="checkbox"]').check()
    cards.nth(1).locator('header>input[type="checkbox"]').check()
    dock = page.get_by_role("region", name="ارسال گروهی فرصت‌های ایمیلی", exact=True)
    expect(dock).to_contain_text("۲ آگهی انتخاب شده")
    dock.get_by_role("button", name="آماده‌کردن نامه برای ۲ آگهی", exact=True).click()
    expect(dock.get_by_role("button", name="تأیید و ارسال برای ۲ آگهی", exact=True)).to_be_visible()
    before = len([entry for entry in writes if entry["path"].endswith("/send")])
    page.evaluate("scrollTo(0,document.body.scrollHeight)")
    button = dock.get_by_role("button", name="تأیید و ارسال برای ۲ آگهی", exact=True)
    assert button.bounding_box()["y"] < 780
    button.click()
    expect(dock.get_by_role("button", name="ارسال شد", exact=True)).to_be_disabled()
    assert len([entry for entry in writes if entry["path"].endswith("/send")]) == before + 4

    scenario = "unknown"
    page.reload()
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True).click()
    expect(cards.first.get_by_role("button", name="نتیجه نامشخص؛ دوباره ارسال نکنید", exact=True)).to_be_disabled()
    before = len(writes)
    panel.get_by_role("button", name="تازه‌سازی", exact=True).click()
    expect(cards.first.get_by_role("button", name="نتیجه نامشخص؛ دوباره ارسال نکنید", exact=True)).to_be_disabled()
    assert len(writes) == before

    scenario = "normal"
    page.goto(base + "/?mailOpportunity=" + second + "&mailbox=secondary")
    focused = page.locator("#mail-opportunity-" + second)
    expect(focused).to_have_class(re.compile("mail-opportunity-highlight"))
    expect(focused.locator(".mail-opportunity-detail")).to_be_visible()
    expect(panel.get_by_label("صندوق فرصت‌های ایمیلی", exact=True)).to_have_value("secondary")
    expect(focused.locator(".mail-opportunity-review")).to_contain_text("ownerA-secondary@example.invalid")
    assert not [entry for entry in writes if entry["path"].endswith("/send") and entry["mailbox"] == "secondary"]

    scenario = "pages"
    page.goto(base)
    expect(cards).to_have_count(1)
    panel.get_by_role("button", name="موارد قدیمی‌تر", exact=True).click()
    expect(cards.first).to_contain_text("Rural Practice")
    expect(panel.get_by_label("رزومهٔ فرصت‌های ایمیلی", exact=True)).to_have_value(cv)
    panel.get_by_role("button", name="صفحهٔ قبل", exact=True).click()
    expect(cards.first).to_contain_text("Coastal Practice")
    scenario = "normal"

    page.goto(base + "/?mailOpportunity=" + foreign)
    expect(panel.get_by_role("alert")).to_contain_text("در حساب و صندوق انتخاب‌شده در دسترس نیست")
    expect(page.locator("#mail-opportunity-" + foreign)).to_have_count(0)

    scenario = "defer"
    page.goto(base)
    page.wait_for_timeout(100)
    owner = "ownerB"
    scenario = "normal"
    page.evaluate("window.__owner('ownerB')")
    expect(cards.first).to_contain_text("ownerB primary Coastal Practice")
    for request, data in pending:
        request.fulfill(json=data)
    pending.clear()
    expect(cards.first).not_to_contain_text("ownerA")
    page.evaluate("window.__person('amir')")
    expect(panel).to_have_count(0)
    page.evaluate("window.__person('arash')")
    expect(cards.first).to_contain_text("ownerB")

    page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
    expect(panel.get_by_role("button", name="Refresh", exact=True)).to_be_visible()
    assert not re.search(r"[\u0600-\u06ff]", panel.inner_text()), panel.inner_text()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    assert not errors, errors

    # A Telegram link survives the real login gate. The exact secondary item
    # opens only after /me has verified its application owner.
    owner = "ownerA"
    scenario = "normal"
    gate = browser.new_page(viewport={"width": 390, "height": 780})
    gate.set_default_timeout(8000)
    gate.route("**/api/**", route)
    gate.route("https://auth.example.invalid/**", lambda request: request.fulfill(json={"access_token": "synthetic_access", "refresh_token": "synthetic_refresh", "expires_in": 3600}))
    gate.on("pageerror", lambda error: errors.append(str(error)))
    before = len(writes)
    gate.goto(base + "/full.html?mailOpportunity=" + second + "&mailbox=secondary")
    expect(gate.locator("#login-email")).to_be_visible()
    assert len(writes) == before, "Private opportunity actions occurred before login"
    gate.locator("#login-email").fill("synthetic@example.invalid")
    gate.locator("#login-password").fill("synthetic-password-for-tests")
    gate.get_by_role("button", name="ورود امن", exact=True).click()
    exact = gate.locator("#mail-opportunity-" + second)
    expect(exact.locator(".mail-opportunity-detail")).to_be_visible()
    expect(exact.locator(".mail-opportunity-review")).to_contain_text("ownerA-secondary@example.invalid")
    expect(gate.locator(".mail-opportunities").get_by_label("صندوق فرصت‌های ایمیلی", exact=True)).to_have_value("secondary")
    assert "mailOpportunity=" + second in gate.url
    assert not [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    assert not errors, errors
    browser.close()

server.shutdown()
workspace.cleanup()
print("PASS private mail opportunities: exact mailbox deep links, owner isolation, default-all recipients, frozen review, green single/batch send, pending/sent/unknown outcomes, English and mobile layout; synthetic transport only.")
