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
cv_latest = "22222222-2222-4222-8222-222222222222"
cv_foreign = "33333333-3333-4333-8333-333333333333"

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
research_reason = None
writes, errors, pending = [], [], []
list_reads = []
saved_edits = {}
owner = "ownerA"
recipients = ["manager@synthetic-clinic.example.invalid", "recruitment@synthetic-clinic.example.invalid"]


def recipients_for(identifier):
    if identifier == first:
        return recipients
    rural = ["manager@synthetic-rural.example.invalid", "recruitment@synthetic-rural.example.invalid"]
    return [recipients[0], rural[1]] if scenario == "batch_shared" else rural


def letter_proposal(identifier, cv_id, mailbox="primary"):
    label = "Coastal" if identifier == first else "Rural"
    blocks = ["Dear Practice Manager,", "I am a general practitioner with verified experience and am seeking a supervised GP position.",
              "I am drawn to the " + label + " Practice team and its published community care focus.",
              "My verified clinical experience and collaborative approach would support your team. " + ("Latest CV." if cv_id == cv_latest else "Earlier CV."),
              "Please let me know a convenient time to discuss how I can support your practice.",
              "Synthetic Applicant\nEmail: applicant@example.invalid\nPhone: +61 000 000 000"]
    proposal = {"readyForReview": True, "recipients": recipients_for(identifier), "subject": "Application to " + label + " Practice", "body": "\n\n".join(blocks), "cvVersionId": cv_id, "evidenceHash": "synthetic-current-source-" + identifier, "missing": [], "outreachMode": "initial_enquiry" if identifier == second else "job_application"}
    saved = saved_edits.get((owner, mailbox, identifier, cv_id))
    if saved:
        blocks[2], blocks[3] = saved["clinicParagraph"], saved["valueParagraph"]
        proposal.update(saved, body="\n\n".join(blocks))
    elif scenario == "inline_stale":
        proposal.update(readyForReview=False, ownerEditNeedsReview=True, editStatus="saved_edit_needs_review", missing=["mail_opportunity_saved_edit_requires_review"], savedEdit={"id": "moedit_" + "e" * 32, "revision": 1, "cvVersionId": cv, "subject": proposal["subject"], "clinicParagraph": "Previous owner paragraph requiring current CV review.", "valueParagraph": "Previous owner contribution requiring source review."})
    elif scenario == "inline_incomplete":
        proposal.update(readyForReview=False, missing=["needs_contact"], recipients=[])
    elif scenario == "inline_no_body" or scenario == "inline_order" and identifier == first:
        proposal.update(readyForReview=False, missing=["mail_opportunity_public_evidence_required"], recipients=[], body="")
    return proposal


def item(identifier, mailbox="primary"):
    name = owner + " " + mailbox + (" Coastal Practice" if identifier == first else " Rural Practice")
    researched = identifier == first and research_reason is None
    research = {"status": "read" if researched else "queued", "verified": researched, "reason": None if researched else research_reason or "public_employer_verification_required", "checkedAt": "2026-11-18T02:00:00Z", "officialSourceUrl": "https://clinic.example.invalid/", "searchStatus": "search_not_configured", "sources": [{"url": "https://clinic.example.invalid/about", "kind": "root", "status": "read", "readAt": "2026-11-18T02:00:00Z"}, {"url": "https://www.linkedin.com/company/synthetic-practice", "kind": "public_social", "status": "discovered_not_read", "readAt": None}, {"url": "https://clinic.example.invalid/oauth/callback?code=PRIVATE_SHOULD_NOT_RENDER", "kind": "root", "status": "read", "readAt": "2026-11-18T02:00:00Z"}], "gaps": ["services_not_published", "training_not_published", "crisis_history_not_assessed", "INTERNAL_GAP_MUST_NOT_RENDER"]}
    if scenario == "source_restrictions":
        research["gaps"] = ["source_registration_restricted", "source_australian_residence_required", "source_level1_restricted", "source_sponsorship_restricted", "source_supervision_restricted", "source_img_restricted", "source_applications_closed", "source_deadline_expired"]
    return {"id": identifier, "title": "General practitioner; supervision needs confirmation", "clinicName": name, "sourceUrl": "https://clinic.example.invalid/careers", "receivedAt": "2026-11-18T02:00:00Z", "mailbox": mailbox, "sourceKind": "linkedin_alert", "status": "suggested", "unread": True, "fit": {"priority": "high", "level1": "unknown", "sponsorship": "unknown", "pesci": "unknown"}, "draft": letter_proposal(identifier, cv_latest, mailbox) if scenario in ["inline_cached", "inline_order"] else {"status": "not_prepared"}, "research": research, "outreachMode": "initial_enquiry" if scenario.startswith("inline") and identifier == second else "job_application" if scenario.startswith("inline") else None, "provenance": {"gmailId": "syntheticMessage", "threadId": "syntheticThread"}}


def route(request):
    parsed = urlparse(request.request.url)
    query = parse_qs(parsed.query)
    mailbox = query.get("mailbox", ["primary"])[0]
    path = parsed.path
    method = request.request.method
    if method == "GET" and path == "/api/google/mail-opportunities":
        list_reads.append({"sort": query.get("sort", [None])[0], "offset": query.get("offset", ["0"])[0], "mailbox": mailbox})
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
        request.fulfill(json=[{"id": cv, "name": "Synthetic own GP CV", "version": 1, "profileId": "arash", "userId": owner, "isDefault": scenario == "inline_default"}, {"id": cv_latest, "name": "Synthetic latest GP CV", "version": 2, "profileId": "arash", "userId": owner}, {"id": cv_foreign, "name": "Foreign CV must never appear", "version": 9, "profileId": "amir", "userId": "another-owner"}] if scenario.startswith("inline") else [{"id": cv, "name": "Synthetic own GP CV", "isDefault": True}])
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
            elif scenario == "inline_order":
                identifiers = [second, first] if query.get("sort", ["ready"])[0] == "ready" else [first]
                request.fulfill(json={"items": [item(identifier, mailbox) for identifier in identifiers], "unreadCount": 2, "more": len(identifiers) == 1, "nextOffset": 25 if len(identifiers) == 1 else None})
            else:
                request.fulfill(json={"items": [item(first, mailbox), item(second, mailbox)], "unreadCount": 2, "more": False})
        return
    identifier = path.split("/")[-2]
    body = json.loads(request.request.post_data or "{}")
    writes.append({"path": path, "mailbox": mailbox, "body": body})
    if path.endswith("/read"):
        request.fulfill(json={"read": True})
    elif path.endswith("/edit"):
        assert scenario.startswith("inline")
        assert body["cvVersionId"] in [cv, cv_latest]
        assert body["clinicParagraph"] and body["valueParagraph"]
        assert "subject" not in body, "The private letter subject must remain stable"
        if scenario == "inline_save_failure":
            request.fulfill(status=409, json={"error": "mail_opportunity_edit_context_changed"})
            return
        identifier = path.split("/")[-2]
        receipt = "moedit_" + format(len(writes), "032x")
        saved_edits[(owner, mailbox, identifier, body["cvVersionId"])] = {"clinicParagraph": body["clinicParagraph"], "valueParagraph": body["valueParagraph"], "editedDraftId": receipt, "editRevision": len(writes), "editStatus": "owner_edited"}
        request.fulfill(json=letter_proposal(identifier, body["cvVersionId"], mailbox))
    elif path.endswith("/prepare"):
        if scenario.startswith("inline"):
            assert body["cvVersionId"] in [cv, cv_latest]
            data = letter_proposal(path.split("/")[-2], body["cvVersionId"], mailbox)
            if scenario == "inline_cached":
                pending.append((request, data))
            else:
                request.fulfill(json=data)
            return
        assert body == {"cvVersionId": cv}
        if scenario == "research_blocked":
            request.fulfill(json={"readyForReview": False, "recipients": [], "missing": ["mail_opportunity_public_evidence_required"], "cvVersionId": cv})
        elif scenario == "needs_contact" or scenario == "batch_mixed" and identifier == second:
            request.fulfill(json={"readyForReview": False, "recipients": [], "missing": ["needs_contact"], "cvVersionId": cv})
        else:
            request.fulfill(json={"readyForReview": True, "recipients": recipients_for(identifier), "subject": "Synthetic tailored application", "body": "Synthetic clinic-specific letter.\n\nOwn verified clinical experience.\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nSynthetic Applicant\nEmail: applicant@example.invalid", "cvVersionId": cv})
    elif path.endswith("/preview"):
        if scenario.startswith("inline"):
            assert body["cvVersionId"] in [cv, cv_latest] and body["recipient"] in recipients_for(identifier)
            data = letter_proposal(path.split("/")[-2], body["cvVersionId"], mailbox)
            assert body.get("editedDraftId") == data.get("editedDraftId"), "Fresh review must use the saved edit receipt"
            request.fulfill(json={**data, "sender": owner + "-" + mailbox + "@example.invalid", "reviewHash": "synthetic-review-" + body["recipient"] + ":" + body.get("editedDraftId", "canonical")})
            return
        assert body["cvVersionId"] == cv and body["recipient"] in recipients_for(identifier)
        request.fulfill(json={"readyForReview": True, "sender": owner + "-" + mailbox + "@example.invalid", "recipients": [{"recipient": body["recipient"]}], "cvVersionId": cv, "reviewHash": "synthetic-review-" + body["recipient"], "subject": "Synthetic tailored application", "body": "Synthetic clinic-specific letter.\n\nOwn verified clinical experience.\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nSynthetic Applicant\nEmail: applicant@example.invalid"})
    elif path.endswith("/send"):
        if scenario.startswith("inline"):
            data = letter_proposal(path.split("/")[-2], body["cvVersionId"], mailbox)
            assert body["cvVersionId"] in [cv, cv_latest] and body["confirmSend"] is True
            assert body.get("editedDraftId") == data.get("editedDraftId")
            assert body["reviewHash"] == "synthetic-review-" + body["recipient"] + ":" + body.get("editedDraftId", "canonical")
            request.fulfill(json={"items": [{"status": "sent", "recipient": body["recipient"]}], "automaticRetry": False})
            return
        assert body["confirmSend"] is True and body["reviewHash"] == "synthetic-review-" + body["recipient"] and body["cvVersionId"] == cv
        if scenario == "batch_partial" and body["recipient"] == recipients[1]:
            request.fulfill(status=409, json={"error": "mail_opportunity_review_changed"})
        elif scenario == "unknown":
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
    expect(cards.first.locator('.mail-opportunity-research-badge')).to_have_text('اطلاعات عمومی مرکز بررسی شده')
    expect(cards.nth(1).locator('.mail-opportunity-research-badge')).to_have_text('سرنخ ایمیلی؛ بررسی مرکز ادامه دارد')
    expect(panel.locator('.mail-opportunity-research')).to_have_count(0)
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_visible()
    expect(cards.first.locator(".mail-opportunity-recipients input:checked")).to_have_count(2)
    research = cards.first.locator('.mail-opportunity-research')
    expect(research).not_to_have_attribute('open', '')
    research.locator('summary').click()
    expect(research).to_contain_text('پیوند پیدا شده؛ هنوز خوانده نشده')
    expect(research).to_contain_text('جست‌وجوی وبِ کمکی هنوز متصل نیست')
    assert not any(code in research.inner_text() for code in ['search_not_configured', 'discovered_not_read', 'INTERNAL_GAP_MUST_NOT_RENDER'])
    assert not research.locator('a[href*="PRIVATE_SHOULD_NOT_RENDER"]').count()
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
    before = len([entry for entry in writes if entry["path"].endswith("/send")])
    page.evaluate("scrollTo(0,document.body.scrollHeight)")
    button = dock.get_by_role("button", name="بازبینی و ارسال برای ۲ آگهی", exact=True)
    assert button.bounding_box()["y"] < 780
    button.click()
    summary = page.get_by_role("dialog", name="بازبینی نهایی آگهی‌های انتخاب‌شده", exact=True)
    expect(summary).to_be_visible()
    assert len([entry for entry in writes if entry["path"].endswith("/send")]) == before
    summary.get_by_role("button", name="تأیید و ارسال برای ۲ آگهی", exact=True).click()
    expect(dock.get_by_role("button", name="ارسال شد", exact=True)).to_be_disabled()
    assert len([entry for entry in writes if entry["path"].endswith("/send")]) == before + 4

    # A missing clinic contact must not trap a prepared peer on the
    # preparation button. The compact mobile review keeps confirm reachable.
    scenario = "batch_mixed"
    page.reload()
    cards.first.locator('header>input[type="checkbox"]').check()
    cards.nth(1).locator('header>input[type="checkbox"]').check()
    before = len(writes)
    dock.get_by_role("button", name="آماده‌کردن نامه برای ۲ آگهی", exact=True).click()
    review_one = dock.get_by_role("button", name="بازبینی و ارسال برای ۱ آگهی", exact=True)
    review_one.click()
    expect(summary.locator("li").nth(0)).to_contain_text(recipients[0])
    expect(summary.locator("li").nth(0)).to_contain_text("ownerA-primary@example.invalid")
    expect(summary.locator("li").nth(1)).to_contain_text("راه تماس مناسب هنوز تأیید نشده")
    summary.locator("details").first.locator("summary").click()
    expect(summary.locator(".mail-opportunity-letter").first).to_be_visible()
    confirm_one = summary.get_by_role("button", name="تأیید و ارسال برای ۱ آگهی", exact=True)
    box = confirm_one.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 390 and box["y"] + box["height"] <= 780
    page.keyboard.press("Escape")
    expect(summary).to_have_count(0)
    assert not [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    review_one.click()
    confirm_one.click()
    expect(dock).to_contain_text("۱ ارسال شد")
    expect(dock).to_contain_text("۱ نیازمند بررسی")
    dock.get_by_role("button", name="بررسی دوبارهٔ ۱ آگهی", exact=True).click()
    expect(dock.get_by_role("button", name="بررسی دوبارهٔ ۱ آگهی", exact=True)).to_be_enabled()
    sent = [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    assert len(sent) == 2 and all(first in entry["path"] for entry in sent)
    assert len([entry for entry in writes[before:] if first in entry["path"] and entry["path"].endswith("/prepare")]) == 1

    # A shared mailbox appears once in the plan and is sent once even
    # when different ads have a different application key on the server.
    scenario = "batch_shared"
    page.reload()
    cards.first.locator('header>input[type="checkbox"]').check()
    cards.nth(1).locator('header>input[type="checkbox"]').check()
    dock.get_by_role("button", name="آماده‌کردن نامه برای ۲ آگهی", exact=True).click()
    dock.get_by_role("button", name="بازبینی و ارسال برای ۲ آگهی", exact=True).click()
    expect(summary.locator("li").nth(1)).to_contain_text("گیرندهٔ مشترک گروه")
    before = len(writes)
    summary.get_by_role("button", name="تأیید و ارسال برای ۲ آگهی", exact=True).click()
    expect(dock.get_by_role("button", name="ارسال شد", exact=True)).to_be_disabled()
    sent = [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    assert len(sent) == 3 and len({entry["body"]["recipient"] for entry in sent}) == 3

    # A successful recipient remains excluded when a rejected peer is
    # prepared again; the result acknowledges the partial delivery.
    scenario = "batch_partial"
    page.reload()
    cards.first.locator('header>input[type="checkbox"]').check()
    dock.get_by_role("button", name="آماده‌کردن نامه برای ۱ آگهی", exact=True).click()
    review_one.click()
    confirm_one.click()
    again = dock.get_by_role("button", name="بررسی دوبارهٔ ۱ آگهی", exact=True)
    expect(again).to_be_enabled()
    dock.get_by_role("button", name="وضعیت آگهی‌ها", exact=True).click()
    expect(summary).to_contain_text("فقط به بعضی گیرندگان ارسال شد")
    summary.get_by_role("button", name="بازگشت", exact=True).click()
    again.click()
    review_one.click()
    assert summary.locator(".mail-opportunity-batch-delivery").count() == 1
    expect(summary.locator(".mail-opportunity-batch-delivery")).to_contain_text(recipients[1])
    page.keyboard.press("Escape")

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

    # Every evidence gate is translated rather than exposing implementation
    # codes; finding a social link is not presented as a completed reading.
    explanations = [
        ('public_employer_verification_required', 'public employer check is incomplete'),
        ('public_employer_identity_required', 'practice name and website'),
        ('latest_public_employer_read_required', 'latest practice-page reading'),
        ('published_employer_name_required', 'exact practice name'),
        ('published_clinic_context_required', 'published information about the practice'),
        ('published_recruitment_contact_required', 'published contact for the application'),
        ('published_recipient_required', 'proposed recipient must match'),
        ('invalid_evidence_time', 'timestamp could not be verified'),
    ]
    for research_reason, message in explanations:
        page.reload()
        cards.first.get_by_role('button', name='بررسی و ارسال ایمیل', exact=True).click()
        page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
        research = cards.first.locator('.mail-opportunity-research')
        research.locator('summary').click()
        expect(research).to_contain_text(message)
        expect(research).to_contain_text('Link found; not yet read')
        assert not re.search(r'[\u0600-\u06ff]', research.inner_text())
        assert research_reason not in research.inner_text()
        assert 'PRIVATE_SHOULD_NOT_RENDER' not in research.inner_html()
        assert 'INTERNAL_GAP_MUST_NOT_RENDER' not in research.inner_text()
    research_reason = None
    scenario = 'source_restrictions'
    page.reload()
    cards.first.get_by_role('button', name='بررسی و ارسال ایمیل', exact=True).click()
    research = cards.first.locator('.mail-opportunity-research')
    research.locator('summary').click()
    expect(research).to_contain_text('متقاضیِ ساکن استرالیا')
    expect(research).to_contain_text('پذیرش با نظارت Level 1')
    page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
    for phrase in ['registration or fellowship requirement', 'applicants already living in Australia', 'under Level 1 supervision', 'employer visa sponsorship', 'providing clinical supervision', 'international medical graduates', 'Applications for this position are stated to be closed', 'published deadline has passed']:
        expect(research).to_contain_text(phrase)
    assert not re.search(r'[\u0600-\u06ff]', research.inner_text())
    assert 'source_registration_restricted' not in research.inner_text()
    assert 'source_australian_residence_required' not in research.inner_text()
    scenario = 'research_blocked'
    page.reload()
    cards.first.get_by_role('button', name='بررسی و ارسال ایمیل', exact=True).click()
    expect(cards.first).to_contain_text('این پیام فعلاً یک سرنخ است')
    assert 'mail_opportunity_public_evidence_required' not in cards.first.inner_text()
    page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
    expect(cards.first).to_contain_text('This message is currently a lead')
    assert not re.search(r'[\u0600-\u06ff]', panel.inner_text())
    assert not errors, errors
    scenario = 'normal'

    # No saved CV default exists in the reported case. The latest OWN version
    # is selected locally, and the expanded card prepares a visible letter
    # without another click. Neither choosing a CV nor typing sends mail.
    scenario = "inline"
    owner = "ownerA"
    saved_edits.clear()
    page.goto(base)
    expect(panel.get_by_label("رزومهٔ فرصت‌های ایمیلی", exact=True)).to_have_value(cv_latest)
    expect(panel.locator(".mail-opportunity-cv-fallback")).to_contain_text("جدیدترین نسخهٔ همین حساب")
    assert not panel.get_by_text("Foreign CV must never appear", exact=False).count()
    before = len(writes)
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    letter = cards.first.locator(".mail-opportunity-letter-workspace")
    p2 = letter.get_by_label("ویرایش بند دوم فرصت ایمیلی", exact=True)
    p3 = letter.get_by_label("ویرایش بند سوم فرصت ایمیلی", exact=True)
    expect(p2).to_have_value(re.compile("Coastal Practice team"))
    expect(p3).to_have_value(re.compile("Latest CV"))
    expect(cards.first.get_by_label("رزومهٔ همین آگهی", exact=True)).to_have_value(cv_latest)
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    assert cards.first.evaluate("node=>Boolean(node.querySelector('.mail-opportunity-letter-workspace').compareDocumentPosition(node.querySelector('.mail-opportunity-research')) & Node.DOCUMENT_POSITION_FOLLOWING)")
    assert not [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    original_subject = letter.locator(".mail-opportunity-subject").inner_text()
    p2.fill("I would welcome the opportunity to join your community-focused clinical team.")
    p3.fill("I would bring careful clinical prioritisation, reliable follow-up and constructive teamwork.")
    expect(cards.first.get_by_role("button", name="ابتدا ویرایش نامه را ذخیره کنید", exact=True)).to_be_disabled()
    expect(panel.get_by_label("صندوق فرصت‌های ایمیلی", exact=True)).to_be_disabled()
    expect(cards.first.get_by_label("رزومهٔ همین آگهی", exact=True)).to_be_disabled()
    cards.nth(1).get_by_role("button", name="بازکردن جزئیات آگهی", exact=True).click()
    expect(cards.first.locator(".mail-opportunity-detail")).to_be_visible()
    expect(cards.nth(1).locator(".mail-opportunity-detail")).to_have_count(0)
    expect(p2).to_have_value("I would welcome the opportunity to join your community-focused clinical team.")
    cards.first.locator('header>input[type="checkbox"]').check()
    dock = page.get_by_role("region", name="ارسال گروهی فرصت‌های ایمیلی", exact=True)
    expect(dock.get_by_role("button", name="ابتدا ویرایش نامه‌ها را ذخیره کنید", exact=True)).to_be_disabled()
    assert not [entry for entry in writes[before:] if entry["path"].endswith(("/send", "/edit"))]
    letter.get_by_role("button", name="ذخیرهٔ ویرایش و بازبینی نامه", exact=True).click()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    expect(p2).to_have_value("I would welcome the opportunity to join your community-focused clinical team.")
    expect(letter.locator(".mail-opportunity-subject")).to_have_text(original_subject)
    saved = saved_edits[(owner, "primary", first, cv_latest)]
    edited_previews = [entry for entry in writes[before:] if entry["path"].endswith("/preview") and entry["body"].get("editedDraftId")]
    assert len(edited_previews) == 2 and all(entry["body"]["editedDraftId"] == saved["editedDraftId"] for entry in edited_previews)
    cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True).click()
    expect(cards.first.get_by_role("button", name="ارسال شد", exact=True)).to_be_disabled()
    assert all(entry["body"].get("editedDraftId") == saved["editedDraftId"] for entry in writes[before:] if entry["path"].endswith("/send"))

    # A persisted default wins over a newer version; an override belongs only
    # to its card, including a batch with two different owned CV attachments.
    scenario = "inline_default"
    page.reload()
    expect(panel.get_by_label("رزومهٔ فرصت‌های ایمیلی", exact=True)).to_have_value(cv)
    expect(panel.locator(".mail-opportunity-cv-fallback")).to_have_count(0)
    scenario = "inline"
    page.reload()
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    cards.first.get_by_label("رزومهٔ همین آگهی", exact=True).select_option(cv)
    expect(cards.first.get_by_label("ویرایش بند سوم فرصت ایمیلی", exact=True)).to_have_value(re.compile("Earlier CV"))
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    cards.first.locator('header>input[type="checkbox"]').check()
    cards.nth(1).locator('header>input[type="checkbox"]').check()
    dock.get_by_role("button", name="آماده‌کردن نامه برای ۱ آگهی", exact=True).click()
    dock.get_by_role("button", name="بازبینی و ارسال برای ۲ آگهی", exact=True).click()
    expect(summary.locator("li").nth(0)).to_contain_text("Synthetic own GP CV")
    expect(summary.locator("li").nth(1)).to_contain_text("Synthetic latest GP CV")
    before = len(writes)
    summary.get_by_role("button", name="تأیید و ارسال برای ۲ آگهی", exact=True).click()
    expect(dock.get_by_role("button", name="ارسال شد", exact=True)).to_be_disabled()
    delivered = [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    assert len(delivered) == 4
    assert all(entry["body"]["cvVersionId"] == (cv if first in entry["path"] else cv_latest) for entry in delivered)

    # An incomplete existing letter stays readable/editable. Missing facts do
    # not become invented prose, and cached text is visible during preparation.
    saved_edits.clear()
    scenario = "inline_incomplete"
    page.reload()
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(cards.first.get_by_label("ویرایش بند دوم فرصت ایمیلی", exact=True)).to_be_visible()
    expect(cards.first.locator(".letter-preview-incomplete")).to_be_visible()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_have_count(0)
    scenario = "inline_no_body"
    page.reload()
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(cards.first.locator(".mail-opportunity-letter-workspace")).to_contain_text("متن حدسی جایگزین نمی‌شود")
    expect(cards.first.locator("textarea")).to_have_count(0)
    scenario = "inline_cached"
    page.reload()
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(cards.first.get_by_label("ویرایش بند دوم فرصت ایمیلی", exact=True)).to_have_value(re.compile("Coastal Practice team"))
    expect(cards.first.get_by_label("ویرایش بند دوم فرصت ایمیلی", exact=True)).to_be_disabled()
    assert len(pending) == 1
    for request, data in pending:
        request.fulfill(json=data)
    pending.clear()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()

    # Stale edits are reviewed explicitly against the newly selected CV. A
    # failed save retains typed prose, invalidates old approval, and never sends.
    scenario = "inline_stale"
    page.reload()
    cards.first.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    p2 = cards.first.get_by_label("ویرایش بند دوم فرصت ایمیلی", exact=True)
    expect(p2).to_have_value("Previous owner paragraph requiring current CV review.")
    cards.first.get_by_role("button", name="جایگزینی این دو بند با پیشنهاد تازه", exact=True).click()
    expect(p2).to_have_value(re.compile("Coastal Practice team"))
    save_button = cards.first.get_by_role("button", name="ذخیرهٔ ویرایش و بازبینی نامه", exact=True)
    expect(save_button).to_be_enabled()
    before = len(writes)
    save_button.click()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    rebase = next(entry for entry in writes[before:] if entry["path"].endswith("/edit"))
    assert rebase["body"]["cvVersionId"] == cv_latest and "editedDraftId" not in rebase["body"]
    scenario = "inline_save_failure"
    p2.fill("My unsaved source-sensitive revision must remain visible after failure.")
    cards.first.get_by_role("button", name="ذخیرهٔ ویرایش و بازبینی نامه", exact=True).click()
    expect(cards.first.locator(".mail-opportunity-letter-workspace").get_by_role("alert")).to_contain_text("متن شما در همین صفحه حفظ شده")
    expect(p2).to_have_value("My unsaved source-sensitive revision must remain visible after failure.")
    expect(cards.first.get_by_role("button", name="ابتدا ویرایش نامه را ذخیره کنید", exact=True)).to_be_disabled()
    assert not [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    scenario = "inline"
    cards.first.get_by_role("button", name="ذخیرهٔ ویرایش و بازبینی نامه", exact=True).click()
    expect(cards.first.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()

    # Labels and edited content fit small phones at a large user-selected font;
    # changing interface language does not replace the owner's draft text.
    page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
    expect(cards.first.get_by_label("Edit email opportunity paragraph two", exact=True)).to_have_value("My unsaved source-sensitive revision must remain visible after failure.")
    assert not re.search(r"[\u0600-\u06ff]", panel.inner_text()), panel.inner_text()
    for width in [320, 390, 430, 1440]:
        page.set_viewport_size({"width": width, "height": 900})
        page.evaluate("document.documentElement.style.fontSize='150%'")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Inline mail editor overflows at " + str(width)
    assert not errors, errors

    # Readiness ordering is requested BEFORE server pagination, rather than
    # sorting only the current 25 results. Changing order keeps the open letter,
    # selected CV and existing review; unsaved text cannot be hidden by sorting.
    scenario = "inline_order"
    saved_edits.clear()
    page.goto(base)
    order = panel.get_by_label("ترتیب فرصت‌های ایمیلی", exact=True)
    expect(order).to_have_value("ready")
    expect(cards.first).to_have_attribute("id", "mail-opportunity-" + second)
    assert list_reads[-1]["sort"] == "ready"
    initial = page.locator("#mail-opportunity-" + second)
    initial.get_by_role("button", name="بررسی و ارسال ایمیل", exact=True).click()
    expect(initial.locator(".mail-opportunity-mode")).to_have_text("استعلام اولیهٔ همکاری")
    expect(initial.locator(".mail-opportunity-enquiry-help")).to_contain_text("وجود آگهی باز یا ظرفیت سوپروایزر هنوز تأیید نشده")
    expect(initial.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    before = len(writes)
    initial.get_by_label("ویرایش بند دوم فرصت ایمیلی", exact=True).fill("Keep my enquiry visible while I review the selected practice.")
    expect(order).to_be_disabled()
    initial.get_by_role("button", name="کنار گذاشتن تغییرات", exact=True).click()
    expect(order).to_be_enabled()
    order.select_option("newest")
    expect(cards.first).to_have_attribute("id", "mail-opportunity-" + first)
    expect(initial.locator(".mail-opportunity-detail")).to_be_visible()
    expect(initial.get_by_label("رزومهٔ همین آگهی", exact=True)).to_have_value(cv_latest)
    expect(initial.get_by_role("button", name="تأیید و ارسال ایمیل و رزومه", exact=True)).to_be_enabled()
    assert list_reads[-1]["sort"] == "newest" and list_reads[-1]["offset"] == "0"
    assert not [entry for entry in writes[before:] if entry["path"].endswith(("/prepare", "/preview", "/send", "/edit"))], "Sorting recreated or sent a prepared letter"
    order.select_option("ready")
    expect(cards.first).to_have_attribute("id", "mail-opportunity-" + second)
    expect(initial.locator(".mail-opportunity-detail")).to_be_visible()
    page.evaluate("document.documentElement.lang='en';document.documentElement.dataset.language='en';document.documentElement.dir='ltr';window.dispatchEvent(new Event('masir-language-change'))")
    expect(panel.get_by_label("Email opportunity order", exact=True)).to_have_value("ready")
    expect(initial.locator(".mail-opportunity-mode")).to_have_text("Initial employment enquiry")
    expect(initial.locator(".mail-opportunity-enquiry-help")).to_contain_text("has not been confirmed")
    expect(page.locator("#mail-opportunity-" + first).locator(".mail-opportunity-mode")).to_have_text("Job application")
    assert not re.search(r"[\u0600-\u06ff]", panel.inner_text()), panel.inner_text()
    for width in [320, 390, 1440]:
        page.set_viewport_size({"width": width, "height": 900})
        page.evaluate("document.documentElement.style.fontSize='150%'")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Sorted mail opportunities overflow at " + str(width)
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
    # A fresh sign-in starts with correspondence even if the tab was previously
    # left on public opportunities. The toolbar and per-card action start visible.
    gate.goto(base + "/full.html")
    gate.evaluate("""() => {
        const owner = '22222222-2222-4222-8222-222222222222';
        sessionStorage.setItem('masir-ui:v1:' + owner + ':arash:navigation',
            JSON.stringify({version: 1, owner, profile: 'arash',
                            savedAt: Date.now(), value: {tab: 'opportunities'}}));
    }""")
    gate.locator("#login-email").fill("synthetic@example.invalid")
    gate.locator("#login-password").fill("synthetic-password-for-tests")
    gate.get_by_role("button", name="ورود امن", exact=True).click()
    expect(gate.locator("#mail-opportunities")).to_be_visible()
    expect(gate.locator(".mail-opportunity-toolbar-badge")).to_have_text("۲")
    first_action = gate.locator("#mail-opportunity-" + first + " .mail-opportunity-send")
    expect(first_action).to_be_visible()
    expect(first_action).to_be_enabled()
    first_action.click()
    expect(gate.locator("#mail-opportunity-" + first + " .mail-opportunity-detail")).to_be_visible()
    assert not [entry for entry in writes[before:] if entry["path"].endswith("/send")]
    assert not errors, errors
    browser.close()

server.shutdown()
workspace.cleanup()
print("PASS private mail opportunities: owner/mailbox isolation, own default/latest CV and per-card mixed-CV batches, mixed readiness, shared-recipient deduplication, acknowledged partial delivery, visible editable letters, source-bound saved receipts, stale-edit rebase, failed-save retention, ready/newest server ordering without losing open letters, initial enquiry labels, green sends, English/mobile; synthetic transport only.")
