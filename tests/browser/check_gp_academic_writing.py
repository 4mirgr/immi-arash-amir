"""Academic GP letter UI with synthetic endpoints only; no inference or sends.

Exercises both compact and full GP editors, evidence consent, error recovery,
server-artifact forwarding, invalidation, and a late response after a CV change.
Run: python tests/browser/check_gp_academic_writing.py
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
CV = "11111111-1111-4111-8111-111111111111"
CV2 = "22222222-2222-4222-8222-222222222222"
PRESET = "33333333-3333-4333-8333-333333333333"
OPPORTUNITY = "opp_" + "a" * 32
REFINEMENT = "academic_" + "b" * 32
CLINIC_QUOTE = "Synthetic clinic provides continuity of care and supervised learning."
CLINIC_QUOTE2 = "Synthetic clinic supports community chronic disease reviews."
CV_QUOTE = "Synthetic own CV: general practice and continuity of care."
CV_QUOTE2 = "Synthetic alternate own CV: chronic disease management."
P1 = "I am a general practitioner with more than five years of clinical experience, including 12 months as Medical Director of a busy 24-hour clinic. I have passed the AMC MCQ and PTE and am PESCI-ready. I am now looking for a long-term GP position in Australia where appropriate RACGP/ACRRM Level 1 supervision may be available."
P4 = "Please let me know a convenient time to discuss how I can support your practice."
SIGNATURE = "Kind regards,\nDr Synthetic Arash\narash@example.invalid\n+61 2 0000 0000"
POLISHED_P2 = "Synthetic Clinic's documented continuity of care and supervised learning would provide a considered setting for my next stage of general practice."
POLISHED_P3 = "My documented experience in general practice and continuity of care would allow me to contribute to the clinic's day-to-day clinical work."


CV_SCOPE = "clinical_self_report"


def package(cv_id=CV, clinic_quote=CLINIC_QUOTE, cv_quote=None, polished=False, reviewed=False):
    cv_quote = cv_quote or (CV_QUOTE2 if cv_id == CV2 else CV_QUOTE)
    p2 = POLISHED_P2 if polished else "Synthetic baseline clinic paragraph: " + clinic_quote
    p3 = POLISHED_P3 if polished else "Synthetic baseline candidate paragraph: " + cv_quote
    body = "\n\n".join(["Dear Practice Manager,", P1, p2, p3, P4, SIGNATURE])
    return {
        "profileId": "arash", "opportunityId": OPPORTUNITY, "cvVersionId": cv_id,
        "variant": "B", "recommendedVariant": "B", "templateName": "GP B — Independent practice enquiry",
        "subjects": ["Synthetic Clinic — GP application"], "body": body, "previewBody": body,
        "paragraphs": {"opening": P1, "clinicReason": p2, "candidateValue": p3, "closing": P4},
        "suggestedSelection": {"clinicQuote": clinic_quote, "cvQuote": cv_quote},
        "clinicEvidenceCandidates": [{"text": CLINIC_QUOTE}, {"text": CLINIC_QUOTE2}],
        "cvEvidenceCandidates": [{"text": CV_QUOTE2 if cv_id == CV2 else CV_QUOTE, "cvScope": CV_SCOPE}],
        "connectionCandidates": [{"id": "connection_synthetic", "name": "Synthetic Colleague", "organization": "Synthetic Clinic"}],
        "recipients": ["clinic@example.invalid"], "writingStatus": {"issues": []},
        "missingFields": [], "dossier": {"name": {"value": "Synthetic Clinic"}},
        "readyForReview": reviewed or polished, "evidenceMatch": {"cvScope": CV_SCOPE},
        **({"refinementId": REFINEMENT} if polished else {}),
    }


with tempfile.TemporaryDirectory() as work:
    root = Path(work)
    harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {GpApplicationWorkspace} from 'REPO/src/gp-application-workspace.jsx';
import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';
import 'REPO/src/workspace-style.css';
const opportunity={id:'OPPORTUNITY',title:'Synthetic GP vacancy',organization:'Synthetic Clinic',url:'https://example.invalid/job'};
function Harness(){
 const [compact,setCompact]=useState(false),[epoch,setEpoch]=useState(0),[mail,setMail]=useState(null);
 window.__reset=compact=>{setCompact(compact);setEpoch(x=>x+1);setMail(null);window.__lastSelection=null;};
 return <div className="app arash-workspace"><main className="main"><div key={String(compact)+epoch}>
 {mail?<OpportunityMail compact person="arash" opportunity={opportunity} gpApplication={mail} onClose={()=>setMail(null)}/>:<GpApplicationWorkspace compact={compact} person="arash" opportunity={opportunity} notify={()=>{}} onOpenMail={selection=>{window.__lastSelection=selection;setMail(selection);}}/>}
 </div></main></div>;
}createRoot(document.getElementById('root')).render(<Harness/>);
""".replace("REPO", REPO.as_posix()).replace("OPPORTUNITY", OPPORTUNITY)
    build = {"stdin": {"contents": harness, "resolveDir": str(REPO), "sourcefile": "academic-letter.jsx", "loader": "jsx"}, "outfile": str(root / "app.js"), "bundle": True, "format": "esm", "external": ["/fonts/*"], "logLevel": "silent"}
    subprocess.run(["node", "--input-type=module", "-e", 'import {build} from "esbuild";await build(' + json.dumps(build) + ');'], cwd=REPO, check=True)
    shutil.copytree(REPO / "public/fonts", root / "fonts")
    (root / "index.html").write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=work))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    writes, errors, pending = [], [], []
    refine_mode = "success"

    def route(request):
        url = urlparse(request.request.url)
        path, query = url.path, parse_qs(url.query)
        method = request.request.method
        payload = json.loads(request.request.post_data or "{}")
        if method != "GET":
            writes.append((path, payload))
        if path.endswith("/cv/versions"):
            data = [{"id": CV, "name": "Synthetic current CV", "isDefault": True}, {"id": CV2, "name": "Synthetic alternate CV"}]
        elif path.endswith("/presets"):
            data = [{"id": PRESET, "name": "GP B — Independent practice enquiry", "isDefault": True}]
        elif path.endswith("/google/status"):
            data = {"connected": True, "email": "arash@example.invalid", "capabilities": {"gmailSend": True}}
        elif path == "/api/gp-workflow/settings":
            data = {"goalMode": "employment"}
        elif path.startswith("/api/gp-workflow/opportunities/"):
            data = {"opportunityId": OPPORTUNITY, "stage": "clinic_identified", "stages": []}
        elif path.endswith("/package"):
            data = package(payload.get("cvVersionId", query.get("cvVersionId", [CV])[0]), payload.get("clinicQuote", CLINIC_QUOTE), payload.get("cvQuote"), reviewed=method == "POST")
        elif path == "/api/gp-writing/" + OPPORTUNITY + "/refine":
            assert method == "POST" and query == {"profile": ["arash"]}
            if refine_mode == "error":
                request.fulfill(status=503, json={"error": "academic_ai_unavailable"})
                return
            data = package(payload["cvVersionId"], payload["clinicQuote"], payload["cvQuote"], polished=True)
            if refine_mode == "hold":
                pending.append((request, data))
                return
        elif path.endswith("/mail"):
            data = {"opportunityId": OPPORTUNITY, "url": "https://example.invalid/job", "trust": "official", "publishedRecipients": ["clinic@example.invalid"], "scheduling": {"enabled": False, "approvals": []}}
        elif path.endswith("/mail/preview"):
            assert payload["application"]["refinementId"] == REFINEMENT
            assert "body" not in payload and "body" not in payload["application"]
            data = {"opportunityId": OPPORTUNITY, "mailbox": "primary", "presetId": PRESET, "cvVersionId": payload["cvVersionId"], "sender": "arash@example.invalid", "reviewHash": "synthetic-review-hash", "message": {"subject": "Synthetic Clinic — GP application", "body": package(polished=True)["body"]}, "recipients": [{"recipient": "clinic@example.invalid", "cvVersionId": payload["cvVersionId"], "subject": "Synthetic Clinic — GP application", "attachmentName": "Synthetic CV.pdf", "status": "preview"}], "excluded": []}
        else:
            raise AssertionError("Unexpected endpoint: " + method + " " + path)
        request.fulfill(json=data)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 390, "height": 900})
        page.set_default_timeout(5000)
        page.route("**/api/**", route)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:" + str(server.server_port))

        def editor(compact=False):
            return page.locator(".gp-compact-letter pre" if compact else "textarea.gp-letter-preview")

        def text(compact=False):
            return editor(compact).inner_text() if compact else editor().input_value()

        def reset(compact=False):
            page.evaluate("window.__reset(" + json.dumps(compact) + ")")
            expect(editor(compact)).to_be_visible()
            page.locator(".gp-academic-tools > summary").click()

        def confirm(compact=False):
            if compact:
                page.get_by_role("checkbox", name="متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.", exact=True).check()
            else:
                page.get_by_role("checkbox", name="این عبارت را در منبع کلینیک بررسی کردم.", exact=True).check()
                page.get_by_role("checkbox", name="این سابقه مربوط به خود من است و می‌توانم آن را مستند کنم.", exact=True).check()

        def continue_button(compact=False):
            return page.locator(".gp-compact-continue > button") if compact else page.get_by_role("button", name="ادامه به بازبینی ایمیل و رزومه", exact=True)

        def no_sends():
            assert not any("/queue" in path or "/dispatch" in path or "/schedule" in path for path, _ in writes), writes

        # Full editor: explicit evidence consent, graceful AI failure, then success.
        expect(editor()).to_be_visible()
        page.locator(".gp-academic-tools > summary").click()
        polish = page.locator(".gp-academic-tools button")
        expect(polish).to_be_disabled()
        baseline = text()
        confirm()
        expect(polish).to_be_enabled()
        refine_mode = "error"
        polish.click()
        expect(page.locator(".gp-academic-tools [role=alert]")).to_contain_text("متن قبلی حفظ شد")
        assert text() == baseline
        refine_mode = "success"
        polish.click()
        expect(editor()).to_have_value(package(polished=True)["body"])
        request_payload = [payload for path, payload in writes if path.endswith("/refine")][-1]
        assert request_payload == {"variant": "B", "cvVersionId": CV, "clinicQuote": CLINIC_QUOTE, "cvQuote": CV_QUOTE, "confirmCvQuote": True, "contextConsent": True}
        assert P1 in text() and P4 in text() and SIGNATURE in text()
        continue_button().click()
        expect(page.locator(".opportunity-mail")).to_be_visible()
        selection = page.evaluate("window.__lastSelection")
        assert selection["refinementId"] == REFINEMENT and "body" not in selection
        assert not any(path.endswith("/package") for path, _ in writes), "Continuing an approved polish regenerated the canonical body"
        page.locator(".send-action-dock-inline button").click()
        expect(page.locator(".opportunity-mail-body")).to_have_text(package(polished=True)["body"])
        no_sends()

        # Compact editor: changing selected evidence invalidates its artifact.
        reset(True)
        confirm(True)
        polish.click()
        expect(editor(True)).to_have_text(package(polished=True)["body"])
        page.locator(".gp-compact-evidence > summary").click()
        page.get_by_label("جملهٔ مستند کلینیک", exact=True).select_option(CLINIC_QUOTE2)
        expect(continue_button(True)).to_be_disabled()
        expect(page.locator(".gp-compact-letter pre")).to_have_count(0)
        page.get_by_role("checkbox", name="متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.", exact=True).check()
        page.get_by_role("button", name="به‌روزرسانی متن و انتخاب فرستنده", exact=True).click()
        expect(page.locator(".opportunity-mail")).to_be_visible()
        selection = page.evaluate("window.__lastSelection")
        assert selection["clinicQuote"] == CLINIC_QUOTE2 and "refinementId" not in selection and "body" not in selection

        # A changed CV must re-load its own evidence and never carry the old ID.
        reset(True)
        confirm(True)
        polish.click()
        expect(editor(True)).to_have_text(package(polished=True)["body"])
        page.get_by_label("نسخهٔ رزومهٔ بستهٔ GP", exact=True).select_option(CV2)
        expect(editor(True)).to_have_text(package(CV2)["body"])
        expect(polish).to_be_disabled()
        confirm(True)
        continue_button(True).click()
        expect(page.locator(".opportunity-mail")).to_be_visible()
        selection = page.evaluate("window.__lastSelection")
        assert selection["cvVersionId"] == CV2 and selection["cvQuote"] == CV_QUOTE2 and "refinementId" not in selection

        # A late AI response cannot replace the new CV's letter or restore consent.
        reset(True)
        confirm(True)
        refine_mode = "hold"
        polish.click()
        page.wait_for_function("document.querySelector('.gp-academic-tools button').disabled")
        assert len(pending) == 1
        page.get_by_label("نسخهٔ رزومهٔ بستهٔ GP", exact=True).select_option(CV2)
        expect(editor(True)).to_have_text(package(CV2)["body"])
        old_request, old_result = pending.pop()
        old_request.fulfill(json=old_result)
        page.wait_for_timeout(100)
        expect(editor(True)).to_have_text(package(CV2)["body"])
        expect(polish).to_be_disabled()
        expect(page.get_by_role("checkbox", name="متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.", exact=True)).not_to_be_checked()
        refine_mode = "success"

        # An explicitly confirmed shared contact preserves the existing letter;
        # AI must remain disabled in both integration locations.
        for compact in [False, True]:
            reset(compact)
            confirm(compact)
            expect(polish).to_be_enabled()
            if compact:
                page.locator(".gp-compact-evidence > summary").click()
            page.get_by_label("آشنایی مرتبط با این مرکز", exact=True).select_option("connection_synthetic")
            page.get_by_role("checkbox", name="ارتباط و محل کار این فرد را بررسی کردم و اجازهٔ اشاره در نامه را دارم.", exact=True).check()
            page.locator(".gp-academic-tools > summary").click()
            expect(polish).to_be_disabled()
            expect(page.locator(".gp-academic-tools")).to_contain_text("برای حفظ متنِ آشناییِ تأییدشده")
        # Training/research/limitations remain visible as source-bound drafts,
        # but must never be sent to the clinical-experience AI editor.
        for CV_SCOPE in ["training", "research", "limitation"]:
            for compact in [False, True]:
                reset(compact)
                confirm(compact)
                expect(polish).to_be_disabled()
                expect(page.locator(".gp-academic-tools")).to_contain_text("این عبارتِ رزومه سابقهٔ بالینی قابل استفاده")
                assert text(compact), "The ordinary evidence-based draft was hidden"
        CV_SCOPE = "clinical_self_report"
        no_sends()
        assert not errors, errors
        assert not page.evaluate("document.documentElement.scrollWidth>innerWidth")
        browser.close()
    server.shutdown()
print("PASS academic GP polish: evidence consent, fixed introduction/closing/signature, error preservation, artifact-only mail preview, evidence/CV/late-response invalidation, confirmed-contact and nonclinical-evidence exclusion; synthetic requests only.")
