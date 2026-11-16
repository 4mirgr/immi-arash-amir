"""Owner/mailbox-scoped real-component connection checks; all providers mocked.

Run: python tests/browser/check_connection_health.py
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
work = tempfile.TemporaryDirectory()
root = Path(work.name)
harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {GoogleConnection,useGoogleConnection} from 'REPO/src/google-tools.jsx';
import {TelegramSettings} from 'REPO/src/telegram-settings.jsx';
import {LanguageControl} from 'REPO/src/language-control.jsx';
import 'REPO/src/workspace-style.css';
function Harness(){const[person,setPerson]=useState('arash');window.__owner=setPerson;
 const primary=useGoogleConnection(person,true),secondary=useGoogleConnection(person,true,'secondary');window.__refresh=primary.refresh;
 return <div className="app arash-workspace"><main className="main"><LanguageControl personId={person}/><div data-primary><GoogleConnection person={person} connection={primary} notify={()=>{}}/></div><div data-secondary><GoogleConnection person={person} connection={secondary} notify={()=>{}}/></div><div data-telegram><TelegramSettings person={person}/></div></main></div>;
}createRoot(document.getElementById('root')).render(<Harness/>);
""".replace("REPO", repo.as_posix())
build = {"stdin": {"contents": harness, "resolveDir": str(repo), "sourcefile": "health.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(build) + ');'], cwd=repo, check=True)
(root / "index.html").write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
shutil.copytree(repo / "public/fonts", root / "fonts")
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()

posts, errors, deferred = [], [], []
scenario = "normal"


def google(person, mailbox):
    return {"configured": True, "connected": True, "status": "connected", "email": person + ("2" if mailbox == "secondary" else "") + "@example.invalid", "capabilities": {"gmailRead": True, "gmailSend": True, "calendar": True}, "verification": {"state": "not_checked", "recoveryAction": "verify_connection"}}


def telegram(person):
    return {"profileId": person, "configured": True, "connected": True, "enabled": False, "botUsername": "SyntheticBot", "webhookRegistered": True, "canSetupWebhook": person == "amir", "quietStart": 22, "quietEnd": 8, "dailyLimit": 10, "perRunLimit": 2, "verification": {"state": "not_checked", "recoveryAction": "enable_notifications"}}


def route(request):
    url = urlparse(request.request.url)
    path, query = url.path, parse_qs(url.query)
    person = query.get("profile", ["arash"])[0]
    mailbox = query.get("mailbox", ["primary"])[0]
    if request.request.method == "POST":
        posts.append((path, person, mailbox))
        assert request.request.post_data == "{}"
    if path.endswith('/google/start'):
        callback = 'https://callback.example.invalid/api/google/callback'
        request.fulfill(json={"authorizationUrl": 'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=' + callback, "launchUrl": 'https://callback.example.invalid/api/google/launch', "launchTicket": 'a' * 43 + '.' + 'b' * 43, "callbackNonce": 'n' * 43})
        return
    data = google(person, mailbox) if "/google/" in path else telegram(person)
    if path.endswith("/verify"):
        if scenario == "defer" and person == "arash":
            deferred.append((request, data))
            return
        if scenario == "network" and "/google/" in path:
            request.fulfill(status=503, json={"error": "synthetic_temporarily_unavailable"})
            return
        data["verification"] = {"state": "verified" if "/google/" in path else "partial", "checkedAt": "2026-11-16T09:00:00Z", "recoveryAction": "none" if "/google/" in path else "enable_notifications"}
        if "/google/" in path:
            data["serviceChecks"] = {"gmailRead": {"state": "available"}, "gmailSend": {"state": "scope_recorded"}, "calendar": {"state": "available"}}
            if scenario == "partial_permission":
                data["capabilities"]["calendar"] = False
                data["verification"].update({"state": "partial", "recoveryAction": "approve_service_permission"})
                data["serviceChecks"]["calendar"] = {"state": "permission_required"}
            if mailbox == "secondary":
                data.update({"connected": False, "status": "reconnect_required", "capabilities": {}})
                data["verification"].update({"state": "reconnect_required", "recoveryAction": "reconnect_google"})
    request.fulfill(json=data)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 780})
    page.set_default_timeout(6000)
    page.route("**/api/**", route)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:" + str(server.server_port))
    primary, secondary, tg = page.locator("[data-primary]"), page.locator("[data-secondary]"), page.locator("[data-telegram]")
    expect(primary.get_by_text("مجوز ذخیره شده؛ هنوز بررسی نشده", exact=True).first).to_be_visible()
    expect(tg.get_by_text("چت ثبت شده؛ هنوز بررسی نشده", exact=True)).to_be_visible()
    assert not posts, posts

    primary.get_by_role("button", name="بررسی واقعی اتصال", exact=True).click()
    expect(primary.get_by_text("اتصال بررسی شد", exact=True).first).to_be_visible()
    primary.locator(".connection-health summary").click()
    expect(primary.get_by_text("مجوز ارسال ثبت شده؛ ایمیل آزمایشی ارسال نشده", exact=False)).to_be_visible()
    expect(primary.get_by_text("arash@example.invalid", exact=True)).to_be_visible()

    secondary.get_by_role("button", name="بررسی واقعی اتصال", exact=True).click()
    expect(secondary.get_by_role("button", name="اتصال Google همین کاربر", exact=True)).to_be_visible()
    expect(primary.get_by_text("arash@example.invalid", exact=True)).to_be_visible()

    page.evaluate("window.__refresh()")
    expect(primary.get_by_text("اتصال بررسی شد", exact=True).first).to_be_visible()

    scenario = "network"
    primary.get_by_role("button", name="بررسی واقعی اتصال", exact=True).click()
    expect(primary.get_by_text("بررسی Google موقتاً انجام نشد؛ اتصال و اطلاعات قبلی حفظ شده‌اند. کمی بعد دوباره بررسی کنید.", exact=True)).to_be_visible()
    expect(primary.get_by_text("arash@example.invalid", exact=True)).to_be_visible()
    expect(primary.get_by_role("button", name="قطع اتصال همین حساب", exact=False)).to_be_visible()

    scenario = "normal"
    tg.get_by_role("button", name="بررسی واقعی تلگرام", exact=True).click()
    expect(tg.get_by_text("اتصال تلگرام نیاز به رسیدگی دارد", exact=True)).to_be_visible()
    expect(tg.get_by_text("چت ثبت شده، اما اعلان‌ها خاموش‌اند. برای دریافت پیام، گزینهٔ دریافت اعلان را فعال و ذخیره کنید.", exact=True)).to_be_visible()
    expect(tg.get_by_role("button", name="ارسال یک پیام آزمایشی به چت خودم", exact=False)).to_be_disabled()

    # A stored connected grant is not evidence that NEW re-consent has completed.
    scenario = "partial_permission"
    primary.get_by_role("button", name="بررسی واقعی اتصال", exact=True).click()
    page.clock.install()
    page.evaluate("const originalOpen=window.open;window.open=function(...args){return window.__oauthPopup=originalOpen.apply(window,args)};HTMLFormElement.prototype.submit=function(){}")
    with page.expect_popup() as opened:
        primary.get_by_role("button", name="تأیید دوبارهٔ مجوزهای Google", exact=True).click()
    consent_popup = opened.value
    expect(primary.get_by_role("button", name="تأیید دوبارهٔ مجوزهای Google", exact=True)).to_be_disabled()
    page.clock.run_for(3000)
    assert not consent_popup.is_closed(), "Old saved permission prematurely closed the fresh consent popup"
    page.evaluate("dispatchEvent(new MessageEvent('message',{origin:'https://callback.example.invalid',source:window.__oauthPopup,data:{type:'immi-google-oauth',nonce:'n'.repeat(43),ok:true}}))")
    page.wait_for_function("window.__oauthPopup.closed")

    # Delayed provider checks from Arash must not populate Amir's new workspace.
    scenario = "defer"
    primary.get_by_role("button", name="بررسی واقعی اتصال", exact=True).click()
    tg.get_by_role("button", name="بررسی واقعی تلگرام", exact=True).click()
    page.wait_for_function("document.querySelector('[data-primary] .connection-health button').disabled")
    page.evaluate("window.__owner('amir')")
    expect(primary.get_by_text("amir@example.invalid", exact=True)).to_be_visible()
    expect(secondary.get_by_text("amir2@example.invalid", exact=True)).to_be_visible()
    for request, data in deferred:
        request.fulfill(json=data)
    expect(primary.get_by_text("amir@example.invalid", exact=True)).to_be_visible()
    expect(page.get_by_text("arash@example.invalid", exact=True)).to_have_count(0)
    scenario = "normal"
    page.get_by_role("button", name="تغییر زبان رابط به انگلیسی", exact=True).click()
    primary.get_by_role("button", name="Check the connection now", exact=True).click()
    expect(primary.get_by_text("Connection checked", exact=True).first).to_be_visible()
    primary.locator('.connection-health summary').click()
    tg.get_by_role("button", name="Check Telegram now", exact=True).click()
    expect(tg.get_by_text("Telegram connection needs attention", exact=True)).to_be_visible()
    assert not re.search(r'[\u0600-\u06ff]', primary.inner_text()), primary.inner_text()
    assert not re.search(r'[\u0600-\u06ff]', tg.inner_text()), tg.inner_text()
    assert not errors, errors
    assert all(path.endswith("/verify") or path.endswith('/google/start') for path, _, _ in posts), posts
    assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
    browser.close()
server.shutdown()
print("PASS connection health: explicit provider checks only, stored/live distinction, transient continuity, reconnect guidance and owner/mailbox isolation.")
