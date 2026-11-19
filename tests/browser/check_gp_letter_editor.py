"""Reviewed clinic-specific editing and adaptive styles; all endpoints synthetic."""
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
CV = '11111111-1111-4111-8111-111111111111'
CV2 = '22222222-2222-4222-8222-222222222222'
PRESET = '33333333-3333-4333-8333-333333333333'
QUEUE = '44444444-4444-4444-8444-444444444444'
OPP = 'opp_' + 'a' * 32
EDIT = 'gpedit_' + 'b' * 32
STYLE = 'gpstyle_' + 'c' * 32
CQ = 'Synthetic Clinic provides community general practice and ongoing clinical training.'
VQ = 'Managed acute and chronic conditions in a community general practice.'
P1 = 'I am a general practitioner seeking a long-term supervised GP position in Australia.'
P4 = 'Please let me know a convenient time to discuss how I can support your practice.'
SIGNATURE = 'Kind regards,\nDr Synthetic Arash\nsynthetic@example.invalid\n+61 2 0000 0000'
P2 = 'I am interested in Synthetic Clinic because its ongoing training would support the kind of collaborative general practice I hope to develop.'
P3 = 'My experience managing acute and chronic conditions would help me contribute to careful assessment and continuity of patient care within your team.'


def package(cv=CV, p2=P2, p3=P3, subject='Synthetic Clinic GP application', saved=False):
    body = '\n\n'.join(['Dear Practice Manager,', P1, p2, p3, P4, SIGNATURE])
    result = {'profileId': 'arash', 'opportunityId': OPP, 'cvVersionId': cv,
            'variant': 'B', 'recommendedVariant': 'B', 'templateName': 'GP B — Independent practice enquiry',
            'subjects': [subject, 'Second synthetic subject', 'Third synthetic subject'], 'body': body, 'previewBody': body,
            'paragraphs': {'opening': P1, 'clinicReason': p2, 'candidateValue': p3, 'closing': P4},
            'previewParagraphs': {'opening': P1, 'clinicReason': p2, 'candidateValue': p3, 'closing': P4},
            'suggestedSelection': {'clinicQuote': CQ, 'cvQuote': VQ},
            'clinicEvidenceCandidates': [{'text': CQ}], 'cvEvidenceCandidates': [{'text': VQ, 'cvScope': 'clinical_self_report'}],
            'connectionCandidates': [], 'recipients': ['clinic@example.invalid'],
            'dossier': {'name': {'value': 'Synthetic Clinic'}}, 'missingFields': [], 'writingStatus': {'issues': []},
            'readyForReview': saved,
            **({'editedDraftId': EDIT, 'manualSubjectIndex': 0, 'ownerRevision': 2, 'savedTemplate': {'id': STYLE, 'name': 'My clinical style', 'revision': 2, 'style': {'focus': 'teamwork', 'tone': 'warm_professional'}}} if saved else {})}
    if not saved:
        result['body'] = '\n\n'.join(['Dear Practice Manager,', P1, '{{clinicEvidence}}', '{{cvEvidence}}', P4, SIGNATURE])
        result['paragraphs']['clinicReason'] = '{{clinicEvidence}}'
        result['paragraphs']['candidateValue'] = '{{cvEvidence}}'
    return result


with tempfile.TemporaryDirectory(prefix='gp-letter-editor-') as work:
    root = Path(work)
    harness = """
import React,{useState} from 'REPO/node_modules/react/index.js';
import {createRoot} from 'REPO/node_modules/react-dom/client.js';
import {GpApplicationWorkspace} from 'REPO/src/gp-application-workspace.jsx';
import {OpportunityMail} from 'REPO/src/opportunity-mail.jsx';
import 'REPO/src/workspace-style.css';
const opportunity={id:'OPP',title:'Synthetic GP opportunity',organization:'Synthetic Clinic',url:'https://synthetic.example.invalid/job'};
function Harness(){const [version,setVersion]=useState(0),[compact,setCompact]=useState(true),[person,setPerson]=useState('arash'),[mail,setMail]=useState(null),[initial,setInitial]=useState(null);
 window.__reset=(compact,person='arash',savedId=null)=>{setVersion(x=>x+1);setCompact(compact);setPerson(person);setMail(null);setInitial(savedId?{cvVersionId:'CV_RESTORE',variant:'B',subjectIndex:0,editedDraftId:savedId}:null);window.__selection=null;};
 window.__language=value=>{document.documentElement.lang=value;window.dispatchEvent(new Event('masir-language-change'));};
 return <div className="app arash-workspace"><main className="main"><div key={person+compact+version}>
 {mail?<OpportunityMail compact person={person} opportunity={opportunity} gpApplication={mail} onClose={()=>setMail(null)}/>:<GpApplicationWorkspace compact={compact} person={person} opportunity={opportunity} initialSelection={initial} onDraftChange={draft=>{window.__draft=draft;}} notify={()=>{}} onOpenMail={selection=>{window.__selection=selection;setMail(selection);}}/>}
 </div></main></div>;
}createRoot(document.getElementById('root')).render(<Harness/>);
""".replace('REPO', REPO.as_posix()).replace("'OPP'", json.dumps(OPP)).replace('CV_RESTORE', CV)
    build = {'stdin': {'contents': harness, 'resolveDir': str(REPO), 'sourcefile': 'gp-letter-editor.jsx', 'loader': 'jsx'}, 'outfile': str(root/'app.js'), 'bundle': True, 'format': 'esm', 'external': ['/fonts/*'], 'logLevel': 'silent'}
    subprocess.run(['node', '--input-type=module', '-e', 'import {build} from "esbuild";await build('+json.dumps(build)+');'], cwd=REPO, check=True)
    (root/'index.html').write_text('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script>')
    shutil.copytree(REPO/'public/fonts', root/'fonts')
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=work))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    writes, errors, held = [], [], []
    mode, saved = 'success', package(saved=True)

    def route(request):
        global saved
        path, query = urlparse(request.request.url).path, parse_qs(urlparse(request.request.url).query)
        payload = json.loads(request.request.post_data or '{}')
        method = request.request.method
        if method != 'GET':
            writes.append((path, payload))
        if path.endswith('/cv/versions'):
            data = [{'id': CV, 'name': 'Synthetic CV', 'isDefault': True}, {'id': CV2, 'name': 'Second synthetic CV'}]
        elif path.endswith('/presets'):
            data = [{'id': PRESET, 'name': 'GP B — Independent practice enquiry', 'isDefault': True}]
        elif path.endswith('/google/status'):
            data = {'connected': True, 'email': 'synthetic@example.invalid', 'capabilities': {'gmailSend': True}}
        elif path == '/api/gp-workflow/settings':
            data = {'goalMode': 'employment'}
        elif path.startswith('/api/gp-workflow/opportunities/'):
            data = {'opportunityId': OPP, 'stage': 'clinic_identified', 'stages': []}
        elif path.endswith('/package'):
            data = package(payload.get('cvVersionId', query.get('cvVersionId', [CV])[0]))
        elif path == '/api/gp-writing/templates':
            data = {'items': [{'id': STYLE, 'name': 'My clinical style', 'revision': 1, 'style': {'focus': 'teamwork', 'tone': 'warm_professional'}}]}
        elif path.endswith('/manual-edit'):
            assert query == {'profile': ['arash']}
            assert payload['selection']['confirmCvQuote'] is True
            assert payload['saveMode'] in ['replace', 'new_template']
            assert 'body' not in payload
            if mode == 'error':
                request.fulfill(status=409, json={'error': 'gp_letter_edit_context_changed'})
                return
            saved = package(payload['selection']['cvVersionId'], payload['clinicParagraph'], payload['valueParagraph'], payload['subject'], saved=True)
            saved['manualSubjectIndex'] = payload['subjectIndex']
            saved['subjects'][payload['subjectIndex']] = payload['subject']
            saved['restoredSelection'] = payload['selection']
            if mode == 'hold':
                held.append((request, saved))
                return
            data = saved
        elif path.endswith('/restore-edit'):
            assert payload == {'editedDraftId': EDIT}
            data = saved
        elif path.endswith('/apply-template'):
            assert payload['templateId'] == STYLE
            saved = package(payload['selection']['cvVersionId'], P2+' I would welcome the opportunity to learn from your team.', P3, saved=True)
            saved['restoredSelection'] = payload['selection']
            saved['manualSubjectIndex'] = payload.get('subjectIndex', 0)
            data = saved
        elif path.endswith('/mail'):
            data = {'opportunityId': OPP, 'url': 'https://synthetic.example.invalid/job', 'trust': 'official', 'publishedRecipients': ['clinic@example.invalid'], 'scheduling': {'enabled': False, 'approvals': []}}
        elif path.endswith('/mail/preview'):
            assert payload['application']['editedDraftId'] == EDIT
            assert 'body' not in payload and 'subject' not in payload
            data = {'opportunityId': OPP, 'mailbox': 'primary', 'presetId': PRESET, 'cvVersionId': payload['cvVersionId'], 'sender': 'synthetic@example.invalid', 'reviewHash': 'synthetic-hash', 'message': {'subject': saved['subjects'][0], 'body': saved['body']}, 'recipients': [{'recipient': 'clinic@example.invalid', 'subject': saved['subjects'][0], 'cvVersionId': payload['cvVersionId'], 'attachmentName': 'Synthetic CV.docx', 'status': 'preview'}], 'excluded': []}
        elif path.endswith('/mail/queue'):
            assert payload['application']['editedDraftId'] == EDIT and payload['confirmReviewed'] is True
            data = {'opportunityId': OPP, 'mailbox': 'primary', 'items': [{'id': QUEUE, 'status': 'queued', 'reused': False, 'recipient': 'clinic@example.invalid', 'sender': 'synthetic@example.invalid', 'cvVersionId': CV, 'subject': saved['subjects'][0], 'attachmentName': 'Synthetic CV.docx'}], 'excluded': []}
        elif path.endswith('/mail/dispatch'):
            data = {'items': [{'id': QUEUE, 'status': 'sent', 'recipient': 'clinic@example.invalid', 'sender': 'synthetic@example.invalid'}]}
        else:
            raise AssertionError('Unexpected synthetic endpoint '+method+' '+path)
        request.fulfill(json=data)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 390, 'height': 900})
        page.set_default_timeout(5000)
        page.route('**/api/**', route)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:'+str(server.server_port))

        def reset(compact=True, person='arash', saved_id=None):
            page.evaluate('window.__language("fa");window.__reset('+json.dumps(compact)+','+json.dumps(person)+','+json.dumps(saved_id)+')')
            if person == 'arash':
                expect(page.locator('.gp-letter-editor')).to_be_visible()

        def open_editor():
            page.get_by_role('button', name='ویرایش متن نامه', exact=True).click()
            expect(page.get_by_label('ویرایش بند دوم نامه', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='بستن ویرایشگر', exact=True)).to_be_enabled()

        def confirm(compact=True):
            if compact:
                page.get_by_role('checkbox', name='متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.', exact=True).check()
            else:
                page.get_by_role('checkbox', name='این عبارت را در منبع کلینیک بررسی کردم.', exact=True).check()
                page.get_by_role('checkbox', name='این سابقه مربوط به خود من است و می‌توانم آن را مستند کنم.', exact=True).check()

        # A suggested letter is editable before review, but dirty text cannot
        # silently continue or authorize transport using an older letter.
        expect(page.locator('.gp-letter-editor')).to_be_visible()
        assert not [p for p, _ in writes if p.endswith('/manual-edit')]
        open_editor()
        expect(page.get_by_label('ویرایش بند دوم نامه', exact=True)).to_have_value(P2)
        expect(page.get_by_label('ویرایش بند سوم نامه', exact=True)).to_have_value(P3)
        revised = P2+' I would welcome the opportunity to work with your clinical team.'
        page.get_by_label('ویرایش بند دوم نامه', exact=True).fill(revised)
        expect(page.locator('.gp-letter-editor-dirty')).to_be_visible()
        expect(page.locator('.gp-compact-continue > button')).to_be_disabled()
        page.get_by_role('button', name='ذخیره روی نسخهٔ همین نامه', exact=True).click()
        assert not [p for p, _ in writes if p.endswith('/manual-edit')]
        expect(page.get_by_label('ویرایش بند دوم نامه', exact=True)).to_have_value(revised)
        confirm()
        page.get_by_role('button', name='ذخیره روی نسخهٔ همین نامه', exact=True).click()
        expect(page.locator('.gp-compact-letter pre')).to_contain_text(revised)
        expect(page.locator('.gp-letter-editor-saved')).to_be_visible()
        assert P1 in page.locator('.gp-compact-letter pre').inner_text() and P4 in page.locator('.gp-compact-letter pre').inner_text() and SIGNATURE in page.locator('.gp-compact-letter pre').inner_text()
        page.locator('.gp-compact-continue > button').click()
        expect(page.locator('.opportunity-mail')).to_be_visible()
        assert page.evaluate('window.__selection.editedDraftId') == EDIT
        page.locator('.send-action-dock-inline button').click()
        expect(page.locator('.opportunity-mail-body')).to_have_text(saved['body'])
        assert not [p for p, _ in writes if p.endswith('/queue') or p.endswith('/dispatch')]
        page.get_by_role('checkbox', name='گیرندگان، متن و همین رزومه را بررسی کردم.', exact=True).check()
        page.locator('.send-action-dock-inline button').click()
        expect(page.locator('.send-action-dock-inline button')).to_contain_text('ارسال شد')

        # Full view offers a named new adaptive template without saving the
        # entire prior clinic's prose as a reusable factual email body.
        reset(False)
        open_editor()
        confirm(False)
        page.get_by_label('ویرایش بند سوم نامه', exact=True).fill(P3+' I would bring a collaborative approach and seek advice whenever needed.')
        page.locator('.gp-letter-template-tools > summary').click()
        page.get_by_label('نام قالب جدید نامه', exact=True).fill('My clinical style')
        page.get_by_label('تأکید اصلی قالب نامه', exact=True).select_option('teamwork')
        page.get_by_role('button', name='ساخت قالب جدید از این ویرایش', exact=True).click()
        expect(page.locator('.gp-letter-editor-saved')).to_be_visible()
        latest = [v for p, v in writes if p.endswith('/manual-edit')][-1]
        assert latest['saveMode'] == 'new_template' and latest['templateName'] == 'My clinical style' and latest['style']['focus'] == 'teamwork'

        # Durable restoration uses only an opaque checkpoint ID and resets
        # consent. Changing the receipt-bound subject requires a new save.
        reset(saved_id=EDIT)
        expect(page.locator('.gp-letter-editor-saved')).to_be_visible()
        expect(page.get_by_role('checkbox', name='متنِ مربوط به کلینیک و سابقهٔ همین رزومه را بررسی کردم.', exact=True)).not_to_be_checked()
        confirm()
        page.get_by_label('موضوع پیشنهادی نامه', exact=True).select_option('1')
        expect(page.locator('.gp-letter-editor-dirty')).to_be_visible()
        expect(page.locator('.gp-compact-continue > button')).to_be_disabled()
        page.get_by_role('button', name='ذخیره روی نسخهٔ همین نامه', exact=True).click()
        expect(page.locator('.gp-letter-editor-saved')).to_be_visible()
        assert [v for p, v in writes if p.endswith('/manual-edit')][-1]['subjectIndex'] == 1
        assert page.evaluate('window.__draft.editedDraftId') == EDIT

        # Existing templates request fresh clinic/CV reasoning. Failed saves
        # retain typed text, and discard restores the original current letter.
        reset()
        open_editor()
        confirm()
        page.locator('.gp-letter-template-tools > summary').click()
        page.get_by_label('انتخاب قالب شخصی نامه', exact=True).select_option(STYLE)
        page.get_by_role('button', name='نوشتن دوباره برای همین مرکز با این قالب', exact=True).click()
        expect(page.locator('.gp-compact-letter pre')).to_contain_text('learn from your team')
        open_editor()
        page.get_by_label('ویرایش بند دوم نامه', exact=True).fill(revised)
        mode = 'error'
        page.get_by_role('button', name='ذخیره روی نسخهٔ همین نامه', exact=True).click()
        expect(page.locator('.gp-letter-editor [role=alert]')).to_be_visible()
        expect(page.get_by_label('ویرایش بند دوم نامه', exact=True)).to_have_value(revised)
        page.get_by_role('button', name='کنار گذاشتن تغییرات', exact=True).click()
        expect(page.get_by_label('ویرایش بند دوم نامه', exact=True)).to_contain_text('learn from your team')
        mode = 'success'

        # A different owned CV clears local edits and consent. A late response
        # after leaving the owner's workspace never installs its old receipt.
        reset()
        open_editor()
        page.get_by_label('ویرایش بند دوم نامه', exact=True).fill(revised)
        page.get_by_label('نسخهٔ رزومهٔ بستهٔ GP', exact=True).select_option(CV2)
        expect(page.locator('.gp-letter-editor-dirty')).to_have_count(0)
        assert page.evaluate('window.__draft.editedDraftId') is None
        open_editor()
        confirm()
        page.get_by_label('ویرایش بند دوم نامه', exact=True).fill(revised)
        mode = 'hold'
        page.get_by_role('button', name='ذخیره روی نسخهٔ همین نامه', exact=True).click()
        page.wait_for_timeout(50)
        assert len(held) == 1
        reset(person='amir')
        req, old = held.pop()
        req.fulfill(json=old)
        page.wait_for_timeout(80)
        expect(page.locator('.gp-letter-editor')).to_have_count(0)
        assert page.evaluate('window.__selection') is None
        mode = 'success'

        # New controls are fully bilingual and fit narrow/large-font layouts.
        reset()
        open_editor()
        page.locator('.gp-letter-template-tools > summary').click()
        for language in ['fa', 'en']:
            page.evaluate('window.__language('+json.dumps(language)+')')
            expect(page.locator('.gp-letter-editor')).to_contain_text('Make the letter your own' if language == 'en' else 'متن را مطابق نظر خودتان اصلاح کنید')
            if language == 'en':
                assert not page.locator('.gp-letter-editor').evaluate("el=>/[\\u0600-\\u06ff]/.test(el.innerText)")
            for width in [320, 390, 430, 1440]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.evaluate('document.documentElement.style.fontSize="24px"')
                assert not page.locator('.gp-letter-editor').evaluate('el=>el.scrollWidth>el.clientWidth+2')
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+2')
        assert not errors, errors
        browser.close()
    server.shutdown()

print('PASS GP letter editor: in-place P2/P3, explicit replace/new adaptive template, fixed signature, saved artifact review/send, stale-owner/CV guards, error preservation, English and320/390/430/1440 reflow; synthetic transport only.')
