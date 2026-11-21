"""Real components preserve reading state and honor server quota deadlines.

All identities, mailbox content, contacts and transport responses are synthetic.
"""
from datetime import datetime, timezone
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
CV = "11111111-1111-4111-8111-111111111111"
OPPORTUNITY = "mop_" + "a" * 32
BASE_TIME = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)
temporary = tempfile.TemporaryDirectory()
root = Path(temporary.name)
harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {ClinicBankPanel} from 'REPO/src/clinic-bank-panel.jsx';
import {MailOpportunities} from 'REPO/src/mail-opportunities.jsx';
import {apiResponse,apiRetryAt,storageDailyReadLimitNotice} from 'REPO/src/api.js';
import 'REPO/src/workspace-style.css';
function Harness(){
 const[owner,setOwner]=useState('ownerA');window.__owner=setOwner;
 window.__language=value=>{document.documentElement.dataset.language=value;document.documentElement.lang=value;window.dispatchEvent(new CustomEvent('masir-language-change',{detail:{language:value}}));};
 window.__probe=async()=>{try{await apiResponse('probe',{method:'POST',body:'{}'});return null;}catch(e){return {status:e.status,code:e.code,retryAt:e.retryAt,retryAfterSeconds:e.retryAfterSeconds,actionNotStarted:e.actionNotStarted,notice:storageDailyReadLimitNotice(e,true),expired:apiRetryAt({...e,retryAt:new Date(Date.now()-1000).toISOString()})};}};
 return <main className="main arash-workspace">{new URL(location.href).searchParams.get('panel')==='bank'?<ClinicBankPanel person="arash" ownerId={owner} onSearch={()=>{}}/>:<MailOpportunities person="arash" ownerId={owner} connection={{state:{connected:true,email:owner+'@example.invalid'}}} secondaryConnection={{state:{connected:false}}} onSettings={()=>{window.__settings=(window.__settings||0)+1;}}/>}</main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
""".replace("REPO", REPO.as_posix())
config = {"stdin": {"contents": harness, "resolveDir": str(REPO), "sourcefile": "quota-harness.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(config) + ');'], cwd=REPO, check=True)
(root / "index.html").write_text('<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>')
shutil.copytree(REPO / "public/fonts", root / "fonts")
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = "http://127.0.0.1:" + str(server.server_port)


def proposal():
    blocks = ["Dear Practice Manager,", "I am a general practitioner seeking a supervised role.",
              "I am drawn to this practice's community care and teaching focus.",
              "My clinical judgment and collaborative care experience would support your team.",
              "Please let me know a convenient time to discuss how I can support your practice.",
              "Synthetic Applicant\nEmail: applicant@example.invalid\nPhone: +61 000 000 000"]
    return {"readyForReview": True, "status": "ready_for_review", "outreachMode": "initial_enquiry", "recipients": ["manager@clinic.example.invalid"], "subject": "GP employment enquiry", "body": "\n\n".join(blocks), "cvVersionId": CV, "evidenceHash": "current-synthetic-source", "missing": []}


class Scenario:
    def __init__(self):
        self.quota = False
        self.retry_at = "2026-11-21T12:03:00Z"
        self.owner = "ownerA"
        self.reads = {"bank": 0, "mail": 0, "probe": 0, "send": 0}
        self.writes = []
        self.send_not_started = True
        self.probe_payload = None
        self.hold_bank = False
        self.held_bank_routes = []

    def limit(self, route, not_started=False):
        payload = {"error": "storage_daily_read_limit", "retryAt": self.retry_at, "retryAfterSeconds": 180}
        if not_started:
            payload["actionNotStarted"] = True
        route.fulfill(status=503, json=payload, headers={"Retry-After": "180"})

    def route(self, route):
        request = route.request
        path = urlparse(request.url).path
        if path == "/api/probe":
            self.reads["probe"] += 1
            if self.probe_payload is None:
                return self.limit(route, True)
            return route.fulfill(status=503, json=self.probe_payload)
        if path.startswith("/api/clinic-bank/"):
            self.reads["bank"] += 1
            if self.hold_bank:
                self.held_bank_routes.append(route)
                return
            if self.quota:
                return self.limit(route)
            if path.endswith("/status"):
                return route.fulfill(json={"enabled": True, "lastRunAt": "2026-11-21T11:00:00Z", "counts": {"total": 5233, "read": 2000, "withContacts": 1900, "pending": 3000}})
            return route.fulfill(json={"items": [{"id": "synthetic-bank", "name": self.owner + " Community Practice", "url": "https://clinic.example.invalid/", "status": "public_contacts_found", "contacts": []}]})
        if path == "/api/cv/versions":
            return route.fulfill(json=[{"id": CV, "name": "Synthetic own CV", "isDefault": True, "userId": self.owner, "profileId": "arash"}])
        if path == "/api/google/mail-opportunities":
            self.reads["mail"] += 1
            if self.quota:
                return self.limit(route)
            return route.fulfill(json={"items": [{"id": OPPORTUNITY, "clinicName": self.owner + " Coastal Practice", "title": "GP enquiry", "receivedAt": "2026-11-21T11:00:00Z", "status": "suggested", "unread": False, "sourceUrl": "https://clinic.example.invalid/", "draft": proposal(), "fit": {"priority": "review"}}], "unreadCount": 0, "more": False})
        self.writes.append(path)
        if path.endswith("/prepare"):
            return route.fulfill(json=proposal())
        if path.endswith("/preview"):
            return route.fulfill(json={**proposal(), "sender": self.owner + "@example.invalid", "reviewHash": "synthetic-review-hash"})
        if path.endswith("/send"):
            self.reads["send"] += 1
            return self.limit(route, self.send_not_started)
        return route.fulfill(status=404, json={"error": "synthetic_not_found"})


def setup(browser, panel):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.clock.install(time=BASE_TIME)
    page.add_init_script("""window.__hidden=false;window.__blurred=false;window.__offline=false;
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});
      document.hasFocus=()=>!window.__blurred;
      Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>!window.__offline});""")
    scenario = Scenario()
    page.route("**/api/**", scenario.route)
    page.goto(base + "/?panel=" + panel)
    return context, page, scenario


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=shutil.which("chromium") or playwright.chromium.executable_path, args=["--no-sandbox"])
    try:
        context, page, scenario = setup(browser, "bank")
        fold = page.locator(".clinic-bank-panel > summary")
        fold.click()
        expect(page.get_by_text("ownerA Community Practice", exact=True)).to_be_visible()
        assert scenario.reads["bank"] == 2
        page.clock.fast_forward(60000)
        assert scenario.reads["bank"] == 2, "Bank must not poll every minute"
        page.evaluate("window.__hidden=true")
        page.clock.fast_forward(600000)
        assert scenario.reads["bank"] == 2, "Hidden bank must not query"
        page.evaluate("window.__hidden=false;window.__blurred=true;document.dispatchEvent(new Event('visibilitychange'))")
        page.clock.fast_forward(300000)
        assert scenario.reads["bank"] == 2, "Unfocused bank must not query"
        page.evaluate("window.__blurred=false;window.__offline=true;window.dispatchEvent(new Event('focus'))")
        assert scenario.reads["bank"] == 2, "Offline bank must not query"
        page.evaluate("window.__offline=false;window.dispatchEvent(new Event('online'))")
        page.wait_for_timeout(60)
        assert scenario.reads["bank"] == 4
        scenario.quota = True
        scenario.retry_at = page.evaluate("new Date(Date.now()+180000).toISOString()")
        page.get_by_role("button", name="تازه‌سازی بانک", exact=True).click()
        expect(page.get_by_text("سهمیهٔ رایگانِ خواندن اطلاعات امروز", exact=False)).to_be_visible()
        expect(page.get_by_text("ownerA Community Practice", exact=True)).to_be_visible()
        expect(page.locator(".clinic-bank-panel .notice")).to_contain_text("به وقت تهران")
        quota_reads = scenario.reads["bank"]
        fold.click(); fold.click()
        page.get_by_role("button", name="تازه‌سازی بانک", exact=True).click()
        page.clock.fast_forward(120000)
        assert scenario.reads["bank"] == quota_reads, "Closing/manual refresh must honor Retry-After"
        page.evaluate("window.__language('en')")
        expect(page.get_by_text("Today's free data-reading allowance", exact=False)).to_be_visible()
        expect(page.get_by_text("Tehran time", exact=False)).to_be_visible()
        page.clock.fast_forward(61000)
        scenario.quota = False
        page.get_by_role("button", name="Refresh clinic bank", exact=True).click()
        page.wait_for_timeout(60)
        assert scenario.reads["bank"] == quota_reads + 2
        scenario.owner = "ownerB"
        page.evaluate("window.__owner('ownerB')")
        expect(page.get_by_text("ownerB Community Practice", exact=True)).to_be_visible()
        expect(page.get_by_text("ownerA Community Practice", exact=True)).to_have_count(0)
        assert not scenario.writes
        context.close()

        context, page, scenario = setup(browser, "mail")
        expect(page.get_by_text("ownerA Coastal Practice", exact=True)).to_be_visible()
        scenario.quota = True
        scenario.retry_at = page.evaluate("new Date(Date.now()+180000).toISOString()")
        page.get_by_role("button", name="تازه‌سازی", exact=True).click()
        expect(page.get_by_text("سهمیهٔ رایگانِ خواندن اطلاعات امروز", exact=False)).to_be_visible()
        expect(page.get_by_text("ownerA Coastal Practice", exact=True)).to_be_visible()
        assert page.get_by_role("button", name="بررسی اتصال همین حساب", exact=True).count() == 0
        quota_reads = scenario.reads["mail"]
        page.clock.fast_forward(120000)
        page.get_by_role("button", name="تازه‌سازی", exact=True).click()
        assert scenario.reads["mail"] == quota_reads
        page.evaluate("window.__language('en')")
        expect(page.get_by_text("Today's free data-reading allowance", exact=False)).to_be_visible()
        expect(page.get_by_text("Tehran time", exact=False)).to_be_visible()
        scenario.quota = False
        page.clock.fast_forward(61000)
        page.get_by_role("button", name="Refresh", exact=True).click()
        page.wait_for_timeout(60)
        assert scenario.reads["mail"] > quota_reads
        page.locator(".mail-opportunity-title").click()
        editor = page.get_by_label("Edit email opportunity paragraph two", exact=True)
        expect(editor).to_be_visible()
        editor.fill("My private working paragraph remains in this editor.")
        reads = scenario.reads["mail"]
        page.clock.fast_forward(120000)
        expect(editor).to_have_value("My private working paragraph remains in this editor.")
        assert scenario.reads["mail"] == reads
        assert not any(path.endswith("/send") for path in scenario.writes)
        context.close()

        for not_started in [True, False]:
            context, page, scenario = setup(browser, "mail")
            scenario.send_not_started = not_started
            expect(page.get_by_text("ownerA Coastal Practice", exact=True)).to_be_visible()
            page.locator(".mail-opportunity-title").click()
            send = page.locator("article .mail-opportunity-send")
            expect(send).to_have_text("تأیید و ارسال ایمیل و رزومه")
            send.click()
            expect(page.get_by_text("سهمیهٔ رایگانِ خواندن اطلاعات امروز", exact=False).first).to_be_visible()
            result = page.locator(".mail-opportunity-result")
            expect(result).to_have_class("mail-opportunity-result result-" + ("blocked" if not_started else "delivery_unknown"))
            page.clock.fast_forward(120000)
            assert scenario.reads["send"] == 1, "A failed/uncertain send must never replay"
            context.close()

        context, page, scenario = setup(browser, "bank")
        scenario.hold_bank = True
        page.locator(".clinic-bank-panel > summary").click()
        expect(page.get_by_role("button", name="تازه‌سازی بانک", exact=True)).to_be_disabled()
        page.clock.fast_forward(20001)
        expect(page.get_by_role("button", name="تازه‌سازی بانک", exact=True)).to_be_enabled()
        expect(page.get_by_text("وضعیت تازهٔ بانک دریافت نشد", exact=False)).to_be_visible()
        for held in scenario.held_bank_routes:
            held.abort("timedout")
        scenario.hold_bank = False
        page.get_by_role("button", name="تازه‌سازی بانک", exact=True).click()
        expect(page.get_by_text("ownerA Community Practice", exact=True)).to_be_visible()
        context.close()

        context, page, scenario = setup(browser, "bank")
        result = page.evaluate("window.__probe()")
        assert result["status"] == 503 and result["code"] == "storage_daily_read_limit"
        assert result["retryAfterSeconds"] == 180 and result["actionNotStarted"] is True
        assert result["expired"] == 0 and "Tehran time" in result["notice"]
        scenario.probe_payload = {"error": "storage_daily_read_limit", "retryAt": "invalid", "retryAfterSeconds": 9999999, "actionNotStarted": "true"}
        result = page.evaluate("window.__probe()")
        assert result.get("retryAt") is None and result.get("retryAfterSeconds") is None and result.get("actionNotStarted") is None
        assert scenario.reads["probe"] == 2
        context.close()
        print("PASS quota UI: bank five-minute foreground/online polling, bounded requests/manual refresh, owner isolation, preserved rows/dirty letter, server retry deadlines, FA/EN Tehran notices, typed bounded API metadata and no send replay.")
    finally:
        browser.close()
        server.shutdown()
        temporary.cleanup()
