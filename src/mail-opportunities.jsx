import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Bell,Check,ChevronDown,ExternalLink,FileText,Mail,RefreshCw,Send} from 'lucide-react';
import {api} from './api';
import {googleAccountLabel} from './google-account-labels.mjs';
import {interfaceLocale,useInterfaceLanguage} from './interface-locale.mjs';
import {MixedText} from './mixed-text';
import {FloatingSendDock} from './send-action-dock';
import './mail-opportunities.css';

const ID=/^mop_[a-f0-9]{32}$/;
const TERMINAL=new Set(['sent','sending','delivery_unknown']);
const rows=value=>Array.isArray(value)?value:Array.isArray(value?.versions)?value.versions:[];
const safeURL=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const unique=values=>[...new Set(values)];

/** The URL carries an opaque item ID and mailbox only, never authentication. */
export function readMailOpportunityDeepLink(href){
 try{
  const url=new URL(href),ids=url.searchParams.getAll('mailOpportunity'),id=ids[0],slots=url.searchParams.getAll('mailbox');
  if(ids.length!==1||!ID.test(id||'')||slots.length>1||slots.length===1&&!['primary','secondary'].includes(slots[0]))return {id:null,mailbox:'primary'};
  return {id,mailbox:slots[0]||'primary'};
 }catch{return {id:null,mailbox:'primary'};}
}

const copy={
 needs_contact:['راه تماس مناسب هنوز تأیید نشده است. اصل آگهی را باز کنید؛ ایمیل حدسی ارسال نمی‌شود.','A suitable contact has not been established. Open the source listing; guessed addresses are not used.'],
 needs_evidence:['اطلاعات مرکز برای آماده‌کردن نامهٔ اختصاصی کافی نیست؛ بررسی منبع باید کامل شود.','The clinic information is not sufficient for a tailored letter; the source needs further review.'],
 cv_required:['نسخهٔ رزومه را انتخاب کنید تا نامه و پیوست همان نسخه آماده شود.','Select a CV version to prepare the letter and its attachment.'],
 cv_version_required:['نسخهٔ رزومه را انتخاب کنید تا نامه و پیوست همان نسخه آماده شود.','Select a CV version to prepare the letter and its attachment.'],
 select_recipient:['حداقل یک گیرنده را برای این نامه انتخاب کنید.','Select at least one recipient for this letter.'],
 recipient_selection_changed:['گیرندگان تغییر کرده‌اند؛ پیش‌نویس تازه در حال بررسی است.','The recipients have changed; the updated draft needs review.'],
 ready:['پیش‌نویس آمادهٔ بازبینی است.','The draft is ready for review.'],
 source_removed:['این مورد دیگر برای درخواست تازه در دسترس نیست.','This item is no longer available for a new application.'],
 dismissed:['این مورد از پیگیری کنار گذاشته شده است.','This item has been dismissed.'],
 review_changed:['اطلاعات این درخواست تغییر کرده است؛ پیش‌نویس را دوباره بررسی کنید.','This application has changed; review a fresh draft.'],
 mail_opportunity_review_changed:['اطلاعات این درخواست تغییر کرده است؛ پیش‌نویس را دوباره بررسی کنید.','This application has changed; review a fresh draft.'],
 reconnect_required:['اتصال همین صندوق به تأیید دوبارهٔ Google نیاز دارد.','This mailbox needs renewed Google permission.'],
 not_connected:['برای ارسال از این صندوق، حساب Google خودتان را متصل کنید.','Connect your own Google account to send from this mailbox.'],
 gmail_send_scope_required:['مجوز ارسال Gmail برای همین صندوق لازم است.','This mailbox requires Gmail sending permission.'],
 suppressed:['این مخاطب در فهرست عدم ارسال همین حساب است.','This contact is on this account’s suppression list.'],
 daily_quota_reached:['سقف ارسال امروز تکمیل شده است؛ نتیجه‌های فعلی حفظ شده‌اند.','Today’s sending limit has been reached; existing results are preserved.'],
 owner_writing_profile_required:['قالب و اطلاعات نامهٔ همین حساب باید در تنظیمات تکمیل شود.','Complete this account’s letter profile and template in settings.'],
 signature_name_required:['نام صاحب حساب برای امضای نامه کامل نیست.','The account owner’s name is missing from the letter signature.'],
 signature_email_required:['ایمیل تماس در امضای همین حساب باید تکمیل شود.','Complete this account’s contact email in the letter signature.'],
 signature_phone_required:['شمارهٔ تماس در امضای همین حساب باید تکمیل شود.','Complete this account’s phone number in the letter signature.'],
 clinic_name_required:['نام مرکز هنوز از منبع روشن نشده است؛ نامهٔ اختصاصی به آن نیاز دارد.','The clinic name has not been established from the source; it is needed for a tailored letter.'],
 clinic_evidence_required:['اطلاعات قابل استناد از خدمات و شرایط مرکز هنوز کافی نیست.','There is not enough source evidence about the clinic’s services and requirements.'],
 cv_evidence_required:['برای این نامه، اطلاعات مرتبط از نسخهٔ انتخاب‌شدهٔ رزومه کافی نیست.','The selected CV does not provide enough relevant information for this letter.'],
 clinical_cv_evidence_required:['برای توضیح مزیت بالینی شما، سابقهٔ مرتبط در رزومه باید مشخص باشد.','Relevant experience in your CV is needed to explain your clinical contribution.'],
 specific_service_overlap_required:['هنوز ارتباط مشخصی میان خدمات این مرکز و تجربهٔ ثبت‌شدهٔ شما پیدا نشده است.','A specific link between this clinic’s services and your recorded experience has not been established.'],
 recruitment_contact_required:['راه تماس مناسب برای درخواست کار هنوز روشن نیست؛ تا مشخص‌شدن گیرنده، نامه ارسال نمی‌شود.','A suitable recruitment contact has not been established; the letter cannot be sent until its recipient is known.'],
 source_freshness_or_fit_review_required:['تازگی منبع یا تناسب شرایط این موقعیت هنوز باید بررسی شود.','The source’s freshness or the position’s requirements still need review.'],
 source_unavailable_requires_review:['آخرین بررسی منبع موفق نبود؛ تا بازخوانی موفق آگهی، نامه آمادهٔ ارسال نیست.','The latest source check failed; the listing must be read successfully before the letter is ready to send.'],
 latest_source_reading_required:['آخرین بررسی منبع موفق نبود؛ سامانه دوباره تلاش می‌کند و فعلاً ارسال متوقف است.','The latest source check failed. The system will retry; sending is paused until the source is verified.'],
 mail_opportunity_source_unavailable:['منبع این موقعیت در بررسی تازه قابل تأیید نبود؛ پس از بازخوانی موفق، پیش‌نویس را دوباره بررسی کنید.','The latest check could not verify this opportunity’s source. Review a fresh draft after a successful source reading.'],
 mail_source_incomplete:['متن پیام کامل خوانده نشده است؛ اصل آگهی باید بررسی شود.','The message content was incomplete; review the original advertisement.'],
 mail_opportunity_source_incomplete:['متن پیام کامل خوانده نشده است؛ اصل آگهی باید بررسی شود.','The message content was incomplete; review the original advertisement.'],
 mail_opportunity_closed:['مهلت این موقعیت گذشته است؛ برای درخواست تازه، آگهی معتبر و باز لازم است.','This opportunity’s deadline has passed; a current open listing is required for a new application.'],
 mail_opportunity_public_evidence_required:['این پیام فعلاً یک سرنخ است. اطلاعات مرکز و راه تماس منتشرشده باید از صفحات عمومی آن بررسی شوند تا نامه آمادهٔ اقدام شود.','This message is currently a lead. The clinic information and published contact need to be checked on its public pages before the letter is ready for action.'],
 public_employer_verification_required:['بررسی عمومی مرکز هنوز کامل نشده است؛ متن ایمیل به‌تنهایی شاهد وضعیت واقعی مرکز نیست.','The public employer check is incomplete; the email alone is not evidence of the practice’s current circumstances.'],
 public_employer_identity_required:['نام و نشانی مرکز هنوز با یک منبع عمومی معتبر تطبیق داده نشده‌اند.','The practice name and website have not yet been matched to a reliable public source.'],
 latest_public_employer_read_required:['آخرین خواندن صفحهٔ مرکز تازه و موفق نیست؛ تا بررسی موفق بعدی، اطلاعات قبلی برای اقدام کافی نیست.','The latest practice-page reading is not current and successful. Earlier information is insufficient for action until a fresh check succeeds.'],
 published_employer_name_required:['نام دقیق مرکز باید در صفحهٔ عمومی خوانده‌شده پیدا و تطبیق داده شود.','The exact practice name must be found and matched on a public page that has been read.'],
 published_clinic_context_required:['برای نوشتن نامهٔ اختصاصی، هنوز اطلاعات منتشرشدهٔ کافی دربارهٔ خدمات، تیم یا آموزش مرکز نداریم.','There is not yet enough published information about the practice’s services, team or training to write a tailored letter.'],
 published_recruitment_contact_required:['راه تماس منتشرشدهٔ مرتبط با درخواست کار هنوز پیدا نشده است؛ نشانی فرستندهٔ خبرنامه جایگزین آن نمی‌شود.','A published contact for the application has not been established; the newsletter sender is not a substitute.'],
 published_recipient_required:['گیرندهٔ پیشنهادی باید با اطلاعات تماس منتشرشدهٔ همین مرکز تطبیق داده شود.','The proposed recipient must match this practice’s published contact information.'],
 invalid_evidence_time:['زمان ثبت اطلاعات منبع قابل تأیید نیست؛ بررسی تازه لازم است.','The source information’s timestamp could not be verified; a fresh check is needed.'],
 public_evidence_required:['اطلاعات عمومی مرکز هنوز برای اقدام تأیید نشده است.','The practice’s public information has not yet been established for action.'],
 public_employer_source_required:['وب‌سایت عمومی خود مرکز هنوز مشخص نشده است؛ لینک خبرنامه یا سایت کاریابی به‌تنهایی کافی نیست.','The practice’s own public website has not been established; a newsletter or job-board link alone is insufficient.'],
 clinic_bank_storage_required:['ثبت نتیجه در بانک خصوصی مراکز فعلاً آماده نیست؛ این وضعیت تأیید مرکز محسوب نمی‌شود.','Saving the result to the private practice bank is not currently available; the practice is not treated as verified.'],
 source_changed_or_bank_leased:['اطلاعات مرکز تغییر کرده یا در نوبت بررسی دیگری است؛ نتیجهٔ تازه باید ثبت شود.','The practice information has changed or is being checked in another run; a fresh result is required.'],
 current_source_requires_review:['شرایط فعلی منبع به بررسی نیاز دارد؛ نامه هنوز آمادهٔ ارسال نیست.','The current source conditions need review; the letter is not ready to send.'],
 source_applications_closed:['در منبع، بسته‌شدن درخواست‌ها اعلام شده است؛ این مورد برای اقدام تازه آماده نیست.','The source states that applications are closed; this item is not ready for a new application.'],
 source_deadline_expired:['مهلت اعلام‌شدهٔ منبع گذشته است؛ آگهی جاری و باز لازم است.','The published deadline has passed; a current open listing is required.'],
 source_registration_restricted:['شرط ثبت یا مدرک حرفه‌ایِ منتشرشده باید با مسیر فعلی آرش تطبیق داده شود.','The published registration or qualification requirement must be checked against Arash’s current pathway.'],
 source_australian_residence_required:['در آگهی، حضور فعلی در استرالیا خواسته شده است؛ این شرط باید پیش از اقدام روشن شود.','The advertisement requires current residence in Australia; this condition needs clarification before applying.'],
 source_host_changed:['مقصد صفحه تغییر کرده است و باید دوباره با مرکز تطبیق داده شود.','The page destination has changed and must be matched to the practice again.'],
 search_not_configured:['جست‌وجوی وبِ کمکی هنوز متصل نیست؛ بررسی بانک مراکز و لینک‌های عمومی همچنان مستقل انجام می‌شود.','The supplementary web search is not connected yet; practice-bank and public-link checks run separately.'],
 search_key_invalid:['اتصال جست‌وجوی وبِ کمکی نیاز به اصلاح دارد؛ نتیجهٔ جست‌وجوی تازه دریافت نشده است.','The supplementary web-search connection needs attention; no fresh search result was obtained.'],
 search_provider_unavailable:['سرویس جست‌وجوی وبِ کمکی فعلاً پاسخ نداده است؛ این به معنی نبودن مرکز یا فرصت نیست.','The supplementary search service is temporarily unavailable; this does not mean the practice or opportunity does not exist.'],
 search_provider_rate_limited:['سرویس جست‌وجوی کمکی فعلاً به سقف درخواست رسیده است؛ بررسی تازه به نوبت بعد موکول می‌شود.','The supplementary search service has reached its request limit; a fresh check is deferred to a later run.'],
 search_request_budget_exhausted:['سهم این نوبت جست‌وجو مصرف شده است؛ ادامه در نوبت بعدی انجام می‌شود.','This run’s search allowance has been used; work continues in a later run.'],
 search_daily_limit_or_identity_changed:['سهمیهٔ روزانه یا وضعیت حساب اجازهٔ جست‌وجوی تازه نداده است؛ از این وضعیت نتیجهٔ شغلی نمی‌گیریم.','The daily allowance or account state prevented a new search; no employment conclusion is drawn from this.'],
 search_storage_required:['ذخیرهٔ نتایج جست‌وجوی کمکی هنوز آماده نیست؛ نتیجهٔ تازه‌ای تأیید نشده است.','Supplementary search-result storage is not ready; no fresh result has been established.'],
 search_owner_invalid:['وضعیت حساب برای جست‌وجوی کمکی نیاز به بررسی دارد؛ حساب دیگری جایگزین نمی‌شود.','The account state for supplementary search needs review; another account is never substituted.'],
 free_plan_without_paygo_required:['جست‌وجوی کمکی تا تأیید طرح رایگانِ بدون پرداخت اضافه اجرا نمی‌شود.','Supplementary search stays paused until a free plan without additional usage charges is confirmed.'],
 invalid_search_response:['پاسخ جست‌وجوی کمکی قابل استفاده نبود؛ شاهد تازه‌ای برای مرکز ثبت نشده است.','The supplementary search response was unusable; no fresh practice evidence was recorded.'],
 cached_search_hints:['نشانی‌های ذخیره‌شدهٔ جست‌وجو برای بررسی بعدی استفاده شده‌اند؛ پیدا شدن نشانی به معنی خواندن صفحه نیست.','Saved search hints were used for further checking; finding an address does not mean its page has been read.'],
 searched:['جست‌وجوی کمکی انجام شده است؛ نتیجه‌ها تا خواندن و تطبیق صفحات، فقط سرنخ هستند.','Supplementary search has run; its results remain leads until their pages are read and matched.'],
};
const researchGaps={valid_clinic_source_required:['صفحهٔ عمومی معتبر مرکز هنوز مشخص نشده است.','A suitable public practice page has not been established.'],services_not_published:['جزئیات خدمات مرتبط در صفحات خوانده‌شده پیدا نشده است.','Relevant service details were not found on the pages read.'],team_not_published:['اطلاعات کافی دربارهٔ تیم در صفحات خوانده‌شده پیدا نشده است.','Sufficient team information was not found on the pages read.'],training_not_published:['اطلاعات آموزش یا نظارت در صفحات خوانده‌شده روشن نیست.','Training or supervision information is not established on the pages read.'],recruitment_not_published:['جزئیات جذب نیرو در صفحات خوانده‌شده پیدا نشده است.','Recruitment details were not found on the pages read.'],population_not_published:['دربارهٔ گروه‌های بیماران، شاهد کافی از صفحات خوانده‌شده نداریم.','The pages read do not provide sufficient evidence about patient groups.'],history_not_published:['سوابق مرکز در صفحات خوانده‌شده روشن نیست.','The practice’s history is not established on the pages read.'],crisis_history_not_assessed:['دربارهٔ سابقهٔ بحران‌های مرکز نتیجه‌گیری نشده است.','No conclusion has been made about the practice’s history of crises.'],weaknesses_not_assessed:['دربارهٔ نقاط ضعف مرکز نتیجه‌گیری نشده است.','No conclusion has been made about the practice’s weaknesses.']};
Object.assign(researchGaps,{
 source_registration_restricted:['در آگهی، شرط ثبت حرفه‌ای یا Fellowship ذکر شده است؛ این شرط باید با وضعیت فعلی آرش تطبیق داده شود.','The advertisement states a registration or fellowship requirement; check it against Arash’s current status.'],
 source_australian_residence_required:['این موقعیت، متقاضیِ ساکن استرالیا می‌خواهد؛ این شرط با وضعیت فعلی آرش همخوان نیست.','This position requires applicants already living in Australia; that condition does not match Arash’s current circumstances.'],
 source_level1_restricted:['در متن، محدودیتی برای پذیرش با نظارت Level 1 آمده است؛ این مورد فعلاً با مسیر آرش همخوان نیست.','The source states a restriction on accepting a doctor under Level 1 supervision; this does not currently match Arash’s pathway.'],
 source_sponsorship_restricted:['در متن، محدودیتی دربارهٔ اسپانسرشیپ ویزا توسط کارفرما آمده است؛ پیش از اقدام باید روشن شود.','The source states a restriction on employer visa sponsorship; clarify it before applying.'],
 source_supervision_restricted:['در متن، محدودیتی دربارهٔ فراهم‌کردن نظارت بالینی آمده است؛ ظرفیت لازم برای آرش تأیید نشده است.','The source states a restriction on providing clinical supervision; the capacity Arash needs has not been confirmed.'],
 source_img_restricted:['در متن، محدودیتی برای پذیرش پزشکان بین‌المللی آمده است؛ این شرط باید پیش از اقدام بررسی شود.','The source states a restriction on accepting international medical graduates; check this condition before applying.'],
 source_applications_closed:['درخواست‌های این موقعیت بسته اعلام شده‌اند؛ این به معنی تعطیل‌بودن خود کلینیک نیست.','Applications for this position are stated to be closed; this does not mean the practice itself has closed.'],
 source_deadline_expired:['مهلت درج‌شدهٔ آگهی گذشته است؛ برای اقدام تازه، یک آگهی جاری و باز لازم است.','The advertisement’s published deadline has passed; a current open listing is needed for a new application.'],
});
const researchState={queued:['در صف بررسی','Queued for checking'],pending:['در انتظار بررسی','Awaiting a check'],reading:['در حال خواندن صفحات عمومی','Reading public pages'],read:['صفحات عمومی خوانده شده‌اند','Public pages have been read'],read_partial:['بخشی از محتوا خوانده شده است','Content has been partially read'],needs_employer_source:['وب‌سایت خود مرکز لازم است','The practice’s own website is needed'],blocked:['بررسی منبع کامل نشده است','The source check is incomplete'],failed:['دریافت منبع موفق نبود','The source could not be read'],disabled:['بررسی این منبع فعال نیست','This source check is inactive'],discovered_not_read:['پیوند پیدا شده؛ هنوز خوانده نشده','Link found; not yet read']};
function publicResearchURL(value){const safe=safeURL(value);if(!safe)return null;try{const url=new URL(safe);if(/(?:^|\/)(?:login|signin|auth|oauth|callback|admin|messages?|inbox)(?:\/|$)/i.test(url.pathname)||[...url.searchParams.keys()].some(key=>/^(?:code|token|access_token|refresh_token|secret|api_key|key)$/i.test(key)))return null;return safe;}catch{return null;}}
function MailResearchDetails({research,en,date}){
 const t=(fa,english)=>en?english:fa,r=research&&typeof research==='object'?research:{},verified=r.verified===true;
 const phrase=code=>copy[code]?.[en?1:0]||t('این بخش از بررسی هنوز کامل نشده است.','This part of the check is not complete yet.');
 const state=code=>researchState[code]?.[en?1:0]||t('نتیجهٔ دریافت هنوز روشن نیست','The reading result is not established');
 const official=publicResearchURL(r.officialSourceUrl),sources=(Array.isArray(r.sources)?r.sources:[]).slice(0,8).flatMap(source=>{const url=publicResearchURL(source?.url);return url?[{...source,url}]:[];});
 const gaps=[...new Set((Array.isArray(r.gaps)?r.gaps:[]).map(gap=>typeof gap==='string'?gap:gap?.code).filter(Boolean))].slice(0,8);
 const kind=value=>({public_social:t('صفحهٔ عمومی شبکهٔ اجتماعی','Public social page'),contact:t('صفحهٔ تماس','Contact page'),team:t('صفحهٔ تیم','Team page'),about:t('دربارهٔ مرکز','About the practice'),services:t('صفحهٔ خدمات','Services page'),employer:t('صفحهٔ خود مرکز','Practice page'),root:t('صفحهٔ اصلی منبع','Main source page')}[value]||t('صفحهٔ عمومی','Public page'));
 return <details className="mail-opportunity-research"><summary>{t('بررسی وب‌سایت و منابع عمومی مرکز','Practice website and public-source checks')}</summary><div className="mail-opportunity-research-content">
  <p className="mail-opportunity-research-state">{state(r.status||'queued')}{r.checkedAt&&date(r.checkedAt)&&<> · <bdi>{date(r.checkedAt)}</bdi></>}</p>
  {!verified&&<p>{phrase(r.reason||'public_employer_verification_required')}</p>}
  <p className="section-help">{t('خواندن اطلاعات عمومی، تأیید آگهی باز، ظرفیت نظارت Level 1 یا اسپانسرشیپ نیست. این شرایط جداگانه بررسی می‌شوند.','Reading public information does not confirm an open vacancy, Level 1 supervision capacity or visa sponsorship. These conditions are checked separately.')}</p>
  {official&&<a href={official} target="_blank" rel="noreferrer">{t('وب‌سایت بررسی‌شدهٔ مرکز','Practice website checked')} <ExternalLink size={13}/></a>}
  {r.searchStatus&&r.searchStatus!=='not_needed'&&<p className="mail-opportunity-research-search">{phrase(r.searchStatus)}</p>}
  {sources.length>0&&<ul className="mail-opportunity-research-sources">{sources.map((source,index)=><li key={source.url+':'+index}><a href={source.url} target="_blank" rel="noreferrer"><span>{kind(source.kind)}</span> <bdi>{new URL(source.url).hostname}</bdi><ExternalLink size={12}/></a><span className={source.status==='discovered_not_read'?'research-discovered':'research-reading'}>{state(source.status)}</span>{source.readAt&&date(source.readAt)&&<small><bdi>{date(source.readAt)}</bdi></small>}</li>)}</ul>}
  {sources.some(source=>source.kind==='public_social'||source.status==='discovered_not_read')&&<p className="section-help">{t('پیدا شدن لینک، به معنی خواندن محتوای آن یا دسترسی به ارتباطات خصوصی شبکه‌های اجتماعی نیست.','Finding a link does not mean its content has been read or that private social connections are accessible.')}</p>}
  {gaps.length>0&&<div className="mail-opportunity-research-gaps"><strong>{t('اطلاعاتی که هنوز روشن نیست','Information still missing')}</strong><ul>{gaps.map(code=><li key={code}>{researchGaps[code]?.[en?1:0]||copy[code]?.[en?1:0]||t('برای یکی از اطلاعات مرکز، شاهد عمومی کافی نداریم.','Public evidence for one part of the practice information is still insufficient.')}</li>)}</ul></div>}
  <p className="section-help">{t('بررسی‌های زمان‌بندی‌شده به بازبودن این صفحه وابسته نیستند. منابع محدود، قدیمی یا ناقص تا دریافت شاهد کافی آمادهٔ اقدام نمی‌شوند.','Scheduled checks do not depend on keeping this page open. Restricted, stale or incomplete sources are not ready for action until sufficient evidence is obtained.')}</p>
 </div></details>;
}
const fitReasons={medical_gp_role:['متن پیام به یک موقعیت GP مربوط است.','The message concerns a GP position.'],australian_context:['موقعیت به استرالیا مربوط است.','The position relates to Australia.'],level1_wording:['متن به نظارت Level 1 اشاره دارد؛ ظرفیت واقعی باید تأیید شود.','The wording mentions Level 1 supervision; actual capacity needs confirmation.'],visa_sponsorship_wording:['متن به حمایت ویزا اشاره دارد؛ شرایط کارفرما باید تأیید شود.','The wording mentions visa support; the employer’s conditions need confirmation.']};

/** Email-derived opportunities stay private. Drafting and preview never send. */
export function MailOpportunities({person,ownerId,connection,secondaryConnection,focus={id:null,mailbox:'primary'},onSettings,onUnreadCount,notify,cloud=true}){
 const language=useInterfaceLanguage(),en=language==='en',t=(fa,english)=>en?english:fa;
 const ownerKey=JSON.stringify([ownerId||'',person]);
 const [selection,setSelection]=useState({owner:ownerKey,mailbox:focus.mailbox==='secondary'?'secondary':'primary'});
 const mailbox=selection.owner===ownerKey?selection.mailbox:'primary',setMailbox=value=>setSelection({owner:ownerKey,mailbox:value});
 const google=(mailbox==='secondary'?secondaryConnection:connection)?.state||{};
 const accountKey=JSON.stringify([ownerId||'',person,mailbox,google.email||'']);
 const epoch=useRef({key:accountKey,value:0});if(epoch.current.key!==accountKey)epoch.current={key:accountKey,value:epoch.current.value+1};
 const scope=JSON.stringify([accountKey,epoch.current.value]),currentScope=useRef(scope);currentScope.current=scope;
 const mounted=useRef(true),readFlight=useRef(null),actionLock=useRef(null),lastFocus=useRef(''),previewRef=useRef({});
 const [snapshot,setSnapshot]=useState(null),[versions,setVersions]=useState({scope:null,items:[]}),[cvChoice,setCvChoice]=useState({scope:null,id:''});
 const [open,setOpen]=useState(null),[selected,setSelected]=useState({scope:null,ids:[]}),[previews,setPreviews]=useState({scope:null,items:{}}),[results,setResults]=useState({scope:null,items:{}}),[recipientChoices,setRecipientChoices]=useState({scope:null,items:{}});
 const [busy,setBusy]=useState(null),[error,setError]=useState(null),[focusError,setFocusError]=useState(null),[filter,setFilter]=useState('all'),[pageState,setPageState]=useState({scope:null,offset:0});
 const recipientRef=useRef({});recipientRef.current=recipientChoices.scope===scope?recipientChoices.items:{};
 const ownVersions=versions.scope===scope?versions.items:[],cvId=cvChoice.scope===scope?cvChoice.id:'',selectionIds=selected.scope===scope?selected.ids:[];
 const cache=snapshot?.scope===scope?snapshot:null,items=cache?.items||[],visiblePreviews=previews.scope===scope?previews.items:{},visibleResults=results.scope===scope?results.items:{};
 previewRef.current=visiblePreviews;
 const busyHere=busy?.scope===scope?busy:null,errorHere=error?.scope===scope?error:null;
 const offset=pageState.scope===scope?pageState.offset:0;
 const endpoint=`google/mail-opportunities?profile=${encodeURIComponent(person)}&mailbox=${mailbox}&limit=25&offset=${offset}`,endpointRef=useRef(endpoint);endpointRef.current=endpoint;
 const path=id=>`google/mail-opportunities/${encodeURIComponent(id)}?profile=${encodeURIComponent(person)}&mailbox=${mailbox}`;
 const actionPath=(id,action)=>`google/mail-opportunities/${encodeURIComponent(id)}/${action}?profile=${encodeURIComponent(person)}&mailbox=${mailbox}`;
 const alive=requested=>mounted.current&&currentScope.current===requested;
 const codeText=code=>copy[code]?.[en?1:0]||t('این مورد به بررسی بیشتری نیاز دارد؛ علت را در نتیجهٔ زیر ببینید.','This item needs further review; see the result below.');
 const date=value=>{const stamp=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(stamp)&&stamp>0?new Date(stamp).toLocaleDateString(interfaceLocale('fa-IR'),{timeZone:'Asia/Tehran',dateStyle:'medium'}):'';};
 const updatePreview=(requested,id,value)=>{if(!alive(requested))return;setPreviews(previous=>({scope:requested,items:{...(previous.scope===requested?previous.items:{}),[id]:value}}));};
 const updateResult=(requested,id,value)=>{if(!alive(requested))return;setResults(previous=>({scope:requested,items:{...(previous.scope===requested?previous.items:{}),[id]:value}}));};
 const load=useCallback(async()=>{
  if(!cloud||person!=='arash'||readFlight.current?.scope===scope&&readFlight.current.endpoint===endpoint)return;
  const operation={scope,endpoint};readFlight.current=operation;
  try{
   const value=await api(endpoint);if(!alive(scope)||endpointRef.current!==endpoint)return;
   setSnapshot(previous=>({scope,offset,items:(value.items||[]).filter(item=>ID.test(item?.id||'')),more:Boolean(value.more),nextOffset:value.nextOffset,unreadCount:Number(value.unreadCount)||0,focusedItem:previous?.scope===scope?previous.focusedItem:null}));
   onUnreadCount?.(Number(value.unreadCount)||0,mailbox);
   setError(previous=>previous?.scope===scope&&previous.kind==='load'?null:previous);
  }catch(e){if(alive(scope)&&endpointRef.current===endpoint)setError({scope,kind:'load',code:e.message||'mail_opportunities_unavailable'});}
  finally{if(readFlight.current===operation)readFlight.current=null;}
 },[cloud,person,scope,endpoint,mailbox,offset]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  actionLock.current=null;setOpen(null);setFilter('all');setFocusError(null);setBusy(null);setError(null);
  if(!cloud||person!=='arash')return;
  const requested=scope;
  api(`cv/versions?profile=${encodeURIComponent(person)}`).then(value=>{if(!alive(requested))return;const found=rows(value);setVersions({scope:requested,items:found});setCvChoice({scope:requested,id:found.find(item=>item.isDefault||item.is_default)?.id||''});}).catch(e=>{if(alive(requested))setError({scope:requested,kind:'cv',code:e.message||'cv_required'});});
 },[scope,cloud,person]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{if(!cloud||person!=='arash')return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false&&!actionLock.current)load();},60000);return()=>clearInterval(timer);},[cloud,person,load]);
 useEffect(()=>{
  const requested=focus?.id;if(person!=='arash'||!ID.test(requested||''))return;
  if(focus.mailbox!==mailbox){setMailbox(focus.mailbox==='secondary'?'secondary':'primary');return;}
  const key=scope+':'+requested;if(lastFocus.current===key)return;lastFocus.current=key;
  api(path(requested)).then(async value=>{
   if(!alive(scope))return;if(value.id!==requested)throw Error('mail_opportunity_unavailable');
   setSnapshot(previous=>({...(previous?.scope===scope?previous:{scope,items:[]}),focusedItem:value}));setOpen({scope,id:requested});setFocusError(null);
   setTimeout(()=>{if(alive(scope))document.getElementById('mail-opportunity-'+requested)?.scrollIntoView({behavior:'smooth',block:'center'});},100);
   await markRead(value);
  }).catch(()=>{if(alive(scope))setFocusError({scope,id:requested});});
 },[focus?.id,focus?.mailbox,scope,mailbox]);

 async function previewOne(id,requested=scope,overrideRecipients){
  if(!cvId){if(alive(requested))setError({scope:requested,kind:'preview',code:'cv_required'});return null;}
  try{
   const proposal=await api(actionPath(id,'prepare'),{method:'POST',body:JSON.stringify({cvVersionId:cvId})});if(!alive(requested))return null;
   const available=unique((proposal.recipients||[proposal.recipient]).map(row=>typeof row==='string'?row:row?.recipient||row?.email||row?.value).filter(value=>typeof value==='string'&&value));
   const chosen=overrideRecipients||recipientRef.current[id]||available;
   const completed=new Set((visibleResults[id]?.items||[]).filter(row=>TERMINAL.has(row.status)).map(row=>row.recipient));
   const addresses=chosen.filter(recipient=>available.includes(recipient)&&!completed.has(recipient));
   if(!proposal.readyForReview||!addresses.length){const blocked={...proposal,availableRecipients:available,selectedRecipients:addresses,readyForReview:false,missing:!available.length?(proposal.missing?.length?proposal.missing:['needs_contact']):!addresses.length?['select_recipient']:proposal.missing,cvVersionId:cvId};updatePreview(requested,id,blocked);return blocked;}
   const reviews=[];let failure=null;
   // One preview request belongs to one exact selected recipient. The server
   // validates each address against the owned canonical source.
   for(const recipient of addresses){
    if(!alive(requested))return null;
    try{const value=await api(actionPath(id,'preview'),{method:'POST',body:JSON.stringify({cvVersionId:cvId,recipient})});reviews.push({...value,recipient,subject:value.subject||value.message?.subject||'',body:value.body||value.message?.body||'',cvVersionId:value.cvVersionId||cvId});}
    catch(e){failure=e.message||'needs_evidence';}
   }
   if(!alive(requested))return null;
   const checked={...proposal,...reviews[0],availableRecipients:available,selectedRecipients:addresses,reviews,readyForReview:!failure&&reviews.length===addresses.length&&reviews.every(review=>review.readyForReview&&review.reviewHash),missing:failure?[failure]:[],cvVersionId:cvId};
   updatePreview(requested,id,checked);return checked;
  }catch(e){updatePreview(requested,id,{readyForReview:false,missing:[e.message||'needs_evidence'],cvVersionId:cvId});return null;}
 }
 async function prepare(ids,overrides={}){
  if(actionLock.current)return;const requested=scope,operation={scope:requested,kind:'prepare'};actionLock.current=operation;setBusy({...operation,ids});setError(null);
  try{const pending=[...ids];await Promise.allSettled([0,1].map(async()=>{while(pending.length&&alive(requested)){const id=pending.shift();if(TERMINAL.has(visibleResults[id]?.status))continue;await previewOne(id,requested,overrides[id]);}}));}
  finally{if(actionLock.current===operation)actionLock.current=null;if(alive(requested))setBusy(null);}
 }
 async function openItem(item){
  if(open?.scope===scope&&open.id===item.id){setOpen(null);return;}
  setOpen({scope,id:item.id});setError(null);
  await markRead(item);
  if(cvId&&!previewRef.current[item.id]&&!TERMINAL.has(visibleResults[item.id]?.status))await prepare([item.id]);
 }
 async function markRead(item){
  if(item.unread){
   try{await api(actionPath(item.id,'read'),{method:'POST',body:'{}'});if(alive(scope)){setSnapshot(previous=>previous?.scope===scope?{...previous,unreadCount:Math.max(0,(previous.unreadCount||0)-1),items:previous.items.map(row=>row.id===item.id?{...row,unread:false}:row),focusedItem:previous.focusedItem?.id===item.id?{...previous.focusedItem,unread:false}:previous.focusedItem}:previous);onUnreadCount?.(Math.max(0,(cache?.unreadCount||0)-1),mailbox);}}
   catch(e){if(alive(scope))setError({scope,kind:'read',code:e.message||'read_not_recorded'});}
  }
 }
 async function send(ids){
  if(actionLock.current||!ids.length)return;
  const requested=scope,frozen=ids.map(id=>({id,review:previewRef.current[id]}));
  if(frozen.some(item=>!item.review?.readyForReview||!item.review.reviews?.length||item.review.cvVersionId!==cvId||TERMINAL.has(visibleResults[item.id]?.status)))return;
  const operation={scope:requested,kind:'send'};actionLock.current=operation;setBusy({...operation,ids});setError(null);
  try{
   const accumulated=new Map(frozen.map(item=>[item.id,[]]));
   const pending=frozen.flatMap(item=>item.review.reviews.map(review=>({id:item.id,review})));for(const item of frozen)updateResult(requested,item.id,{status:'sending'});
   const summarize=(id,outcome)=>{const values=accumulated.get(id);values.push(outcome);const expected=frozen.find(item=>item.id===id).review.reviews.length;const prior=visibleResults[id]?.items||[];const merged=[...prior.filter(row=>!values.some(value=>value.recipient===row.recipient)),...values];const status=values.length<expected?'sending':merged.every(row=>row.status==='sent')?'sent':merged.some(row=>['delivery_unknown','sending'].includes(row.status))?'delivery_unknown':'blocked';updateResult(requested,id,{status,items:merged});};
   await Promise.allSettled([0,1].map(async()=>{while(pending.length&&alive(requested)){
    const item=pending.shift();
    try{
     const value=await api(actionPath(item.id,'send'),{method:'POST',body:JSON.stringify({cvVersionId:item.review.cvVersionId,recipient:item.review.recipient,reviewHash:item.review.reviewHash,confirmSend:true})});
     const outcomes=Array.isArray(value.items)?value.items:[];
     const status=outcomes.length&&outcomes.every(row=>row.status==='sent')?'sent':outcomes.some(row=>['delivery_unknown','sending'].includes(row.status))?'delivery_unknown':value.status==='sent'?'sent':value.status==='delivery_unknown'?'delivery_unknown':'blocked';
     summarize(item.id,{recipient:item.review.recipient,status,code:value.reason||value.error||null});
    }catch(e){summarize(item.id,{recipient:item.review.recipient,status:!Number.isInteger(e.status)||e.status>=500?'delivery_unknown':'blocked',code:e.message||'send_result_unknown'});}
   }}));
  }finally{if(actionLock.current===operation)actionLock.current=null;if(alive(requested)){setBusy(null);await load();}}
 }
 function choose(id){setSelected(previous=>{const ids=previous.scope===scope?previous.ids:[];return {scope,ids:ids.includes(id)?ids.filter(value=>value!==id):ids.length<5?[...ids,id]:ids};});}
 function changeCV(id){setCvChoice({scope,id});setPreviews({scope,items:{}});setError(null);}
 function chooseRecipient(id,recipient){const group=previewRef.current[id],selected=recipientRef.current[id]||group?.availableRecipients||[],next=selected.includes(recipient)?selected.filter(value=>value!==recipient):[...selected,recipient];setRecipientChoices(previous=>({scope,items:{...(previous.scope===scope?previous.items:{}),[id]:next}}));updatePreview(scope,id,{...group,selectedRecipients:next,readyForReview:false,reviews:[],missing:['recipient_selection_changed']});prepare([id],{[id]:next});}
 useEffect(()=>{if(open?.scope===scope&&cvId&&!previewRef.current[open.id]&&!actionLock.current&&!TERMINAL.has(visibleResults[open.id]?.status))prepare([open.id]);},[scope,open?.id,cvId]);
 const allItems=unique([...items.map(item=>item.id),...(cache?.focusedItem?[cache.focusedItem.id]:[])]).map(id=>cache?.focusedItem?.id===id?cache.focusedItem:items.find(item=>item.id===id)).filter(Boolean);
 const shown=allItems.filter(item=>filter==='new'?item.unread:filter==='high'?item.fit?.priority==='high':true);
 const selectedReviews=selectionIds.map(id=>visiblePreviews[id]),batchReady=selectionIds.length>0&&selectedReviews.every(review=>review?.readyForReview&&review.reviews?.length&&review.cvVersionId===cvId)&&selectionIds.every(id=>!TERMINAL.has(visibleResults[id]?.status));
 const batchSent=selectionIds.length>0&&selectionIds.every(id=>visibleResults[id]?.status==='sent');
 const activeOpen=open?.scope===scope?allItems.find(item=>item.id===open.id):null,activeReview=activeOpen?visiblePreviews[activeOpen.id]:null,activeResult=activeOpen?visibleResults[activeOpen.id]:null;
 const activeReady=activeReview?.readyForReview&&activeReview.reviews?.length&&activeReview.cvVersionId===cvId;
 const labelResult=status=>status==='sent'?t('ارسال شد','Sent'):status==='sending'?t('در حال ارسال…','Sending…'):status==='delivery_unknown'?t('نتیجه نامشخص؛ دوباره ارسال نکنید','Unconfirmed; do not send again'):t('ارسال انجام نشد؛ نتیجه را بررسی کنید','Not sent; review the result');
 const missingText=value=>{const codes=Array.isArray(value)?value:[];return codes.length?codes.map(code=>codeText(code)).join(' '):codeText('needs_evidence');};
 if(person!=='arash')return null;
 if(!cloud)return <section className="panel mail-opportunities" aria-label={t('فرصت‌های پیدا شده در ایمیل','Opportunities found in email')}><h3>{t('فرصت‌های پیدا شده در ایمیل','Opportunities found in email')}</h3><p className="section-help">{t('این بخش پس از ورود امن به حساب ابری، فرصت‌های خصوصی پیدا شده در Gmail خودتان را نشان می‌دهد.','After secure cloud sign-in, this section shows private opportunities found in your own Gmail.')}</p></section>;
 return <section className="panel mail-opportunities" id="mail-opportunities" aria-label={t('فرصت‌های پیدا شده در ایمیل','Opportunities found in email')}>
  <div className="mail-opportunities-heading"><div><h3><Bell size={20}/>{t('فرصت‌هایی که در ایمیل شما پیدا شده','Opportunities found in your email')}{cache?.unreadCount>0&&<span className="mail-opportunity-count">{cache.unreadCount.toLocaleString(interfaceLocale('fa-IR'))}</span>}</h3><p className="section-help">{t('پیام‌های کاری و اعلان‌های LinkedIn همین حساب اینجا به یک اقدام مشخص تبدیل می‌شوند: بررسی آگهی، بازبینی نامه و ارسال رزومه.','Job messages and LinkedIn alerts from this account become a clear next step: review the opportunity, check the letter and send your CV.')}</p></div><button type="button" className="secondary" disabled={Boolean(busyHere)} onClick={load}><RefreshCw size={15}/>{t('تازه‌سازی','Refresh')}</button></div>
  <div className="mail-opportunities-controls"><label>{t('صندوق منبع و فرستنده','Source and sender mailbox')}<select aria-label={t('صندوق فرصت‌های ایمیلی','Email opportunity mailbox')} value={mailbox} disabled={Boolean(busyHere)} onChange={event=>setMailbox(event.target.value)}><option value="primary">{googleAccountLabel(person,'primary',connection?.state.email)}</option><option value="secondary">{googleAccountLabel(person,'secondary',secondaryConnection?.state.email)}</option></select></label><label>{t('رزومهٔ پیوست','CV attachment')}<select aria-label={t('رزومهٔ فرصت‌های ایمیلی','Email opportunity CV')} value={cvId} disabled={Boolean(busyHere)} onChange={event=>changeCV(event.target.value)}><option value="">{t('رزومه را انتخاب کنید','Select a CV')}</option>{ownVersions.map(version=><option key={version.id} value={version.id}>{version.name||'CV'}{(version.isDefault||version.is_default)?t(' · پیش‌فرض',' · Default'):''}</option>)}</select></label><label>{t('نمایش','Show')}<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">{t('همهٔ موارد','All items')}</option><option value="new">{t('تازه و خوانده‌نشده','New and unread')}</option><option value="high">{t('اولویت بررسی بیشتر','Higher review priority')}</option></select></label></div>
  {focusError?.scope===scope&&<div className="notice" role="alert">{t('این فرصت در حساب و صندوق انتخاب‌شده در دسترس نیست. وارد حساب مالک لینک شوید؛ حساب دیگر جایگزین آن نمی‌شود.','This opportunity is unavailable in the selected account and mailbox. Sign in to the account that owns this link; another account is never used as a substitute.')}</div>}
  {errorHere&&<div className="notice" role="alert"><p>{copy[errorHere.code]?codeText(errorHere.code):t('اطلاعات تازه دریافت نشد؛ موارد خوانده‌شدهٔ همین حساب حفظ شده‌اند.','The latest information could not be loaded; this account’s previous items are preserved.')}</p>{!copy[errorHere.code]&&<small>{t('کد قابل گزارش: ','Report code: ')}<bdi>{/^[a-z0-9_/-]{1,100}$/i.test(errorHere.code)?errorHere.code:'request_not_completed'}</bdi></small>}{/reconnect|not_connected|scope/.test(errorHere.code)&&<button type="button" className="secondary" onClick={onSettings}>{t('بررسی اتصال همین حساب','Check this account’s connection')}</button>}</div>}
  {!google.connected&&<p className="section-help">{t('برای ارسال، اتصال و مجوز Gmail همین صندوق باید برقرار باشد.','Sending requires this mailbox’s Gmail connection and permission.')} <button type="button" className="text-button" onClick={onSettings}>{t('اتصال‌ها و تنظیمات','Connections and settings')}</button></p>}
  <div className="mail-opportunities-selection"><label><input type="checkbox" checked={selectionIds.length>0&&selectionIds.length===Math.min(5,shown.filter(item=>!TERMINAL.has(visibleResults[item.id]?.status)).length)} disabled={!shown.length||Boolean(busyHere)} onChange={()=>setSelected({scope,ids:selectionIds.length?[]:shown.filter(item=>!TERMINAL.has(visibleResults[item.id]?.status)).slice(0,5).map(item=>item.id)})}/>{t('انتخاب تا ۵ مورد این صفحه','Select up to 5 items on this page')}</label><span>{selectionIds.length.toLocaleString(interfaceLocale('fa-IR'))}{t(' آگهی انتخاب شده',' opportunities selected')}</span></div>
  {!cache&&!errorHere&&<p role="status">{t('در حال دریافت فرصت‌های همین حساب…','Loading this account’s opportunities…')}</p>}
  {cache&&!shown.length&&<p className="section-help">{t('هنوز موردی با این فیلتر در پیام‌های بررسی‌شده پیدا نشده است. بررسی سابقه و پیام‌های تازه روی سرور ادامه دارد.','No matching item has been found in the reviewed messages yet. History and new messages continue to be checked on the server.')}</p>}
  <div className="mail-opportunities-list">{shown.map(item=>{
   const review=visiblePreviews[item.id],result=visibleResults[item.id],opened=open?.scope===scope&&open.id===item.id,preparing=busyHere?.kind==='prepare'&&busyHere.ids.includes(item.id),terminal=TERMINAL.has(result?.status),ready=review?.readyForReview&&review.reviews?.length&&review.cvVersionId===cvId;
   const recipients=review?.selectedRecipients||[],source=safeURL(item.sourceUrl),mailId=item.provenance?.gmailId;
   const gmailLink=/^[a-zA-Z0-9_-]{1,200}$/.test(mailId||'')&&google.email?'https://mail.google.com/mail/?authuser='+encodeURIComponent(google.email)+'#all/'+encodeURIComponent(mailId):null;
   return <article className={'mail-opportunity'+(focus?.id===item.id?' mail-opportunity-highlight':'')} id={'mail-opportunity-'+item.id} key={scope+':'+item.id}>
    <header><input type="checkbox" aria-label={t('انتخاب آگهی ','Select opportunity ')+(item.clinicName||item.title)} checked={selectionIds.includes(item.id)} disabled={Boolean(busyHere)||terminal||(!selectionIds.includes(item.id)&&selectionIds.length>=5)} onChange={()=>choose(item.id)}/><button type="button" className="mail-opportunity-title" aria-expanded={opened} onClick={()=>openItem(item)}><strong data-no-translate><MixedText>{item.clinicName||item.title}</MixedText></strong><small data-no-translate><MixedText>{item.title}</MixedText></small></button>{item.unread&&<span className="mail-opportunity-new">{t('تازه','New')}</span>}<button type="button" className="mail-opportunity-send" disabled={Boolean(busyHere)||terminal||['dismissed','source_removed'].includes(item.status)} onClick={()=>{if(ready)send([item.id]);else if(opened)prepare([item.id]);else openItem(item);}}>{terminal?<>{result.status==='sent'?<Check size={17}/>:<RefreshCw size={17} className={result.status==='sending'?'spin':''}/>} {labelResult(result.status)}</>:preparing?<><RefreshCw size={17} className="spin"/>{t('در حال آماده‌سازی…','Preparing…')}</>:<><Send size={17}/>{ready?t('تأیید و ارسال ایمیل و رزومه','Confirm and send email and CV'):t('بررسی و ارسال ایمیل','Review and send email')}</>}</button><button type="button" className="mail-opportunity-toggle" aria-label={opened?t('بستن جزئیات آگهی','Close opportunity details'):t('بازکردن جزئیات آگهی','Open opportunity details')} onClick={()=>openItem(item)}><ChevronDown size={18}/></button></header>
    <div className="mail-opportunity-meta"><span>{item.sourceKind==='linkedin_alert'?t('اعلان LinkedIn','LinkedIn alert'):t('پیام کاری در Gmail','Job message in Gmail')}</span><span>{date(item.receivedAt)}</span><span className={"mail-opportunity-research-badge "+(item.research?.verified===true?"research-checked":"research-lead")}>{item.research?.verified===true?t('اطلاعات عمومی مرکز بررسی شده','Practice public information checked'):t('سرنخ ایمیلی؛ بررسی مرکز ادامه دارد','Email lead; practice check pending')}</span><span>{item.fit?.priority==='high'?t('ارزش بررسی بیشتری دارد','Higher review priority'):t('نیازمند بررسی شرایط','Requirements need review')}</span>{item.overlap?.status==='verified_own_bank_match'&&<span>{t('با بانک خصوصی مراکز شما همپوشانی دارد','Matches your private clinic bank')}</span>}{['dismissed','source_removed'].includes(item.status)&&<span>{codeText(item.status)}</span>}</div>
    {opened&&<div className="mail-opportunity-detail"><MailResearchDetails research={item.research} en={en} date={date}/><div className="mail-opportunity-signals">{[['level1',t('نظارت Level 1','Level 1 supervision')],['sponsorship',t('اسپانسرشیپ کارفرما','Employer visa sponsorship')],['pesci',t('مدارک و سمت PESCI','PESCI position and documents')]].map(([key,title])=><div key={key}><strong>{title}</strong><span>{item.fit?.[key]==='supported'?t('در متن آمده؛ نیازمند تأیید','Mentioned; confirmation required'):item.fit?.[key]==='restricted'?t('محدودیت در متن آمده','Restriction stated'):t('هنوز روشن نیست','Not established')}</span></div>)}</div>{item.fit?.why?.some(code=>fitReasons[code])&&<details className="mail-opportunity-fit"><summary>{t('چرا این مورد ارزش بررسی دارد؟','Why is this item worth reviewing?')}</summary><ul>{item.fit.why.filter(code=>fitReasons[code]).map(code=><li key={code}>{fitReasons[code][en?1:0]}</li>)}</ul></details>}<p className="section-help">{t('این ارزیابی از متن پیام و منبع آن است؛ تأیید جاب‌آفر، سوپروایزر یا ویزا نیست.','This assessment uses the message and its source; it does not confirm an offer, supervisor or visa.')}</p><div className="mail-opportunity-source-actions">{source&&<a className="secondary" href={source} target="_blank" rel="noreferrer">{t('بازکردن منبع آگهی','Open opportunity source')}<ExternalLink size={14}/></a>}{gmailLink&&<a className="text-button" href={gmailLink} target="_blank" rel="noreferrer">{t('بازکردن ایمیل منبع در همین حساب','Open the source email in this account')}<Mail size={14}/></a>}</div>
     {review?.availableRecipients?.length>0&&<fieldset className="mail-opportunity-recipients"><legend>{t('گیرندگان این آگهی','Recipients for this opportunity')}</legend>{review.availableRecipients.map(recipient=><label key={recipient}><input type="checkbox" checked={(recipientRef.current[item.id]||review.selectedRecipients||review.availableRecipients).includes(recipient)} disabled={Boolean(busyHere)||terminal||Boolean(result?.items?.some(row=>row.recipient===recipient&&TERMINAL.has(row.status)))} onChange={()=>chooseRecipient(item.id,recipient)}/><bdi>{recipient}</bdi></label>)}</fieldset>}
     {review&&ready&&<section className="mail-opportunity-review"><h4><FileText size={17}/>{t('نامه و رزومهٔ آمادهٔ ارسال','Email and CV ready to send')}</h4><dl><div><dt>{t('فرستنده','Sender')}</dt><dd><bdi>{review.sender}</bdi></dd></div><div><dt>{t('گیرندگان','Recipients')}</dt><dd>{recipients.map(recipient=><bdi key={recipient}>{recipient}</bdi>)}</dd></div><div><dt>{t('رزومه','CV')}</dt><dd data-no-translate>{ownVersions.find(version=>version.id===review.cvVersionId)?.name||'CV'}</dd></div></dl><strong className="mail-opportunity-subject" dir="ltr" data-no-translate>{review.subject}</strong><div className="mail-opportunity-letter" dir="ltr" data-no-translate>{review.body}</div><p className="section-help">{t('با دکمهٔ سبز، همین متن و رزومه برای گیرندگان نمایش‌داده‌شده از Gmail انتخاب‌شده ارسال می‌شود.','The green button sends this exact letter and CV to the displayed recipients from the selected Gmail account.')}</p></section>}
     {review&&!ready&&<div className="notice" role="status"><p>{missingText(review.missing)}</p><button type="button" className="secondary" disabled={Boolean(busyHere)||!cvId} onClick={()=>prepare([item.id])}>{t('بررسی دوبارهٔ آمادگی نامه','Check letter readiness again')}</button></div>}
     {!review&&!cvId&&<p className="notice">{codeText('cv_required')}</p>}
     {result&&<div className={'mail-opportunity-result result-'+result.status} role="status"><strong>{labelResult(result.status)}</strong>{result.code&&<p>{codeText(result.code)}</p>}{result.items?.map((row,index)=><p key={row.id||index}><bdi>{row.recipient}</bdi> · {labelResult(row.status)}</p>)}{result.status==='delivery_unknown'&&<p>{t('ممکن است Gmail نامه را پذیرفته باشد. ابتدا پوشهٔ ارسال‌شده‌ها و نتیجهٔ صف را بررسی کنید.','Gmail may have accepted the message. Check Sent and the queue result before taking another action.')}</p>}</div>}
    </div>}
   </article>;
  })}</div>
  {(offset>0||cache?.more)&&<nav className="mail-opportunity-pages" aria-label={t('صفحه‌های فرصت‌های ایمیلی','Email opportunity pages')}><button type="button" className="secondary" disabled={Boolean(busyHere)||offset===0} onClick={()=>{setPageState({scope,offset:Math.max(0,offset-25)});setOpen(null);}}>{t('صفحهٔ قبل','Previous page')}</button><span>{t('صفحهٔ ','Page ')}{(Math.floor(offset/25)+1).toLocaleString(interfaceLocale('fa-IR'))}</span><button type="button" className="secondary" disabled={Boolean(busyHere)||!cache?.more||!Number.isInteger(cache?.nextOffset)} onClick={()=>{setPageState({scope,offset:cache.nextOffset});setOpen(null);}}>{t('موارد قدیمی‌تر','Older items')}</button></nav>}
  {batchReady&&selectionIds.length>1&&<section className="mail-opportunity-batch-review" aria-label={t('بازبینی نهایی آگهی‌های انتخاب‌شده','Final review of selected opportunities')}><h4>{t('پیش از ارسال گروهی، این موارد را مرور کنید','Review these items before sending the batch')}</h4><ol>{selectionIds.map(id=>{const review=visiblePreviews[id],item=allItems.find(value=>value.id===id);return <li key={id}><strong data-no-translate><MixedText>{item?.clinicName||item?.title||review.subject}</MixedText></strong><p><span>{t('فرستنده: ','Sender: ')}</span><bdi>{review.sender}</bdi></p><p><span>{t('گیرندگان: ','Recipients: ')}</span>{review.selectedRecipients.map(recipient=><bdi key={recipient}>{recipient} </bdi>)}</p><p>{t('رزومه: ','CV: ')}<span data-no-translate>{ownVersions.find(version=>version.id===review.cvVersionId)?.name||'CV'}</span></p><details><summary>{t('متن نامهٔ آمادهٔ ارسال','Prepared letter')}</summary><strong dir="ltr" data-no-translate>{review.subject}</strong><div className="mail-opportunity-letter" dir="ltr" data-no-translate>{review.body}</div></details></li>;})}</ol></section>}
  {!selectionIds.length&&activeOpen&&(activeReady||TERMINAL.has(activeResult?.status))&&<FloatingSendDock><div className="mail-opportunity-batch" role="region" aria-label={t('ارسال همین فرصت ایمیلی','Send this email opportunity')}><div><strong data-no-translate><MixedText>{activeOpen.clinicName||activeOpen.title}</MixedText></strong><small>{t('رزومه: ','CV: ')}<span data-no-translate>{ownVersions.find(version=>version.id===activeReview?.cvVersionId)?.name||'CV'}</span>{t('؛ گیرندگان: ','; recipients: ')}{Number(activeReview?.selectedRecipients?.length||0).toLocaleString(interfaceLocale('fa-IR'))}</small></div><button type="button" className="mail-opportunity-send" disabled={Boolean(busyHere)||TERMINAL.has(activeResult?.status)} onClick={()=>send([activeOpen.id])}>{TERMINAL.has(activeResult?.status)?<>{activeResult.status==='sent'?<Check size={18}/>:<RefreshCw size={18} className={activeResult.status==='sending'?'spin':''}/>} {labelResult(activeResult.status)}</>:<><Send size={18}/>{t('تأیید و ارسال ایمیل و رزومه','Confirm and send email and CV')}</>}</button></div></FloatingSendDock>}
  {selectionIds.length>0&&<FloatingSendDock><div className="mail-opportunity-batch" role="region" aria-label={t('ارسال گروهی فرصت‌های ایمیلی','Email opportunity batch sending')}><div><strong>{selectionIds.length.toLocaleString(interfaceLocale('fa-IR'))}{t(' آگهی انتخاب شده',' opportunities selected')}</strong><small>{batchReady?t('نامه‌ها، گیرندگان و رزومه را در کارت‌های انتخاب‌شده مرور کنید.','Review the letters, recipients and CV in the selected cards.'):t('ابتدا نامهٔ اختصاصی و رزومهٔ هر مورد آماده می‌شود.','Each item’s tailored letter and CV are prepared first.')}</small></div><button type="button" className="mail-opportunity-send" disabled={Boolean(busyHere)||!cvId||selectionIds.some(id=>TERMINAL.has(visibleResults[id]?.status))} onClick={()=>batchReady?send(selectionIds):prepare(selectionIds)}>{batchSent?<><Check size={18}/>{t('ارسال شد','Sent')}</>:busyHere?.kind==='send'?<><RefreshCw size={18} className="spin"/>{t('در حال ارسال…','Sending…')}</>:busyHere?.kind==='prepare'?<><RefreshCw size={18} className="spin"/>{t('در حال آماده‌سازی…','Preparing…')}</>:<><Send size={18}/>{batchReady?t('تأیید و ارسال برای ','Confirm and send for '):t('آماده‌کردن نامه برای ','Prepare letters for ')}{selectionIds.length.toLocaleString(interfaceLocale('fa-IR'))}{t(' آگهی',' opportunities')}</>}</button><button type="button" className="text-button" disabled={Boolean(busyHere)} onClick={()=>setSelected({scope,ids:[]})}>{t('لغو انتخاب','Clear selection')}</button></div></FloatingSendDock>}
 </section>;
}
