import React, { useCallback, useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, ExternalLink, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api";

const text = (value) => typeof value === "string" ? value : "";
const list = (value) => Array.isArray(value) ? value : [];
const link = (value) => { try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; } };
const date = (value) => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "اعلام نشده"; };
const statusLabels = { open: "مهلت درخواست باز", future: "شروع انتشار در آینده", closed: "مهلت پایان یافته", source_removed: "دیگر در منبع دیده نشده" };
const checkLabels = { updated: "منبع بررسی و داده‌ها به‌روز شدند.", not_modified: "منبع تغییری نداشته است.", cooldown: "برای رعایت فاصلهٔ دریافت منبع، فعلاً از دادهٔ ذخیره‌شده استفاده می‌شود.", busy: "بررسی منبع از قبل در حال اجراست.", failed: "دریافت منبع موفق نبود؛ دادهٔ ذخیره‌شده ممکن است قدیمی باشد." };
const reasonLabels = {
  title_matches_interest: "عنوان با کلیدواژه‌های مسیر شما هم‌خوانی دارد",
  registrar_employment_grade_not_training_credit: "عنوان Registrar به‌تنهایی به معنی پذیرش آموزش تخصصی یا احتساب سابقه نیست",
  specialist_qualification_and_registration_require_verification: "مدرک تخصص و شرایط ثبت باید مستقل بررسی شوند",
  register_not_current_specific_vacancy: "این مورد بانک متقاضی است؛ وجود موقعیت مشخص فعلی تأیید نشده",
  registration_supervision_sponsorship_not_assessed: "ثبت پزشکی، supervision و sponsorship هنوز ارزیابی نشده‌اند",
  general_practice: "عنوان یا متن مرتبط با پزشکی عمومی",
  internal_medicine: "عنوان یا متن مرتبط با داخلی",
  medical_registrar: "عنوان یا متن مرتبط با Medical Registrar",
  supervision_mentioned: "اشاره به supervision؛ نیازمند بررسی جزئیات",
  sponsorship_mentioned: "اشاره به sponsorship؛ نیازمند بررسی جزئیات",
  gp_keyword: "وجود واژه‌های مرتبط با پزشکی عمومی",
  physician_keyword: "وجود واژه‌های مرتبط با پزشک داخلی",
  registrar_keyword: "وجود واژهٔ Registrar",
};

export function JobOpportunitiesPanel({ person, notify }) {
  const [items, setItems] = useState([]), [sources, setSources] = useState([]);
  const [query, setQuery] = useState(""), [submittedQuery, setSubmittedQuery] = useState("");
  const [kind, setKind] = useState("all"), [state, setState] = useState("all"), [includeClosed, setIncludeClosed] = useState(false);
  const [page, setPage] = useState(0), [total, setTotal] = useState(0), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [error, setError] = useState(""), [checkNote, setCheckNote] = useState(""), [expanded, setExpanded] = useState(null);
  const generation = useRef(0), owner = useRef(person); owner.current = person;
  const limit = 25;

  const load = useCallback(async () => {
    const epoch = ++generation.current, requestedOwner = person;
    setBusy(true); setError("");
    const params = new URLSearchParams({ profile: person, q: submittedQuery, state, kind, includeClosed: String(includeClosed), limit: String(limit), offset: String(page * limit) });
    const results = await Promise.allSettled([api("opportunities?" + params), api("opportunities/sources?profile=" + encodeURIComponent(person))]);
    if (epoch !== generation.current || owner.current !== requestedOwner) return;
    if (results[0].status === "fulfilled") {
      const data = results[0].value;
      setItems(list(data?.opportunities || (Array.isArray(data) ? data : [])));
      setTotal(Number.isFinite(data?.total) ? data.total : list(data?.opportunities || data).length);
    } else { setItems([]); setTotal(0); setError(results[0].reason?.message || "دریافت فهرست فرصت‌ها انجام نشد."); }
    if (results[1].status === "fulfilled") setSources(list(results[1].value?.sources));
    else { setSources([]); if (results[0].status === "fulfilled") setError("وضعیت بررسی منبع در دسترس نیست؛ تازگی داده را نمی‌توان تأیید کرد."); }
    setBusy(false);
  }, [person, submittedQuery, state, kind, includeClosed, page]);

  const loadCurrent = useRef(load); loadCurrent.current = load;

  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { setItems([]); setSources([]); setQuery(""); setSubmittedQuery(""); setPage(0); setExpanded(null); setCheckNote(""); setChecking(false); }, [person]);

  async function refreshSource() {
    const requestedOwner = person;
    setChecking(true); setCheckNote("");
    try {
      const result = await api("opportunities/refresh?profile=" + encodeURIComponent(person), { method: "POST", body: "{}" });
      if (owner.current !== requestedOwner) return;
      const message = checkLabels[result.status] || "وضعیت دریافت منبع به‌روز شد.";
      setCheckNote(message); notify?.(message); await loadCurrent.current();
    } catch (e) { if (owner.current === requestedOwner) setCheckNote(e.message || "بررسی منبع انجام نشد."); }
    finally { if (owner.current === requestedOwner) setChecking(false); }
  }

  return <section className="panel" aria-label="فرصت‌های منتشرشده در منابع رسمی">
    <div className="section-head" style={{ flexWrap: "wrap", gap: 12 }}>
      <div><span className="eyebrow">OFFICIAL SOURCE • TASMANIA PILOT</span><h3><BriefcaseBusiness size={19} aria-hidden="true" /> فرصت‌های منتشرشده در منبع رسمی</h3></div>
      <button className="secondary" disabled={checking || busy} onClick={refreshSource}><RefreshCw size={15} className={checking ? "spin" : ""} /> {checking ? "در حال بررسی منبع…" : "بررسی تازهٔ منبع"}</button>
    </div>
    <div className="notice">پوشش فعلی این بخش فقط پایلوت تاسمانی است؛ پوشش سراسر استرالیا هنوز کامل نیست. این موارد از منبع استخدامی آمده‌اند؛ پیشنهاد کار قطعی، تأیید اسپانسر یا احراز شرایط ثبت پزشکی محسوب نمی‌شوند.</div>
    {sources.map(source => <div className="agent-row" key={text(source.id)} style={{ flexWrap: "wrap", gap: 8, alignItems: "start" }}>
      <div style={{ flex: 1, minWidth: 180 }}><strong>{text(source.name) || "منبع استخدامی"}</strong><small style={{ display: "block", marginTop: 7 }}>آخرین بررسی: {date(source.lastCheckAt)} · آخرین دریافت موفق: {date(source.lastSuccessAt)}</small></div>
      <span className="status amber">TAS · پایلوت</span>
      {link(source.portalUrl) && <a className="text-button" href={link(source.portalUrl)} target="_blank" rel="noreferrer">مرجع رسمی <ExternalLink size={13} /></a>}
      {(source.lastErrorCode || source.status === "failed") && <span className="notice" role="status">آخرین دریافت موفق نبوده؛ تازگی اطلاعات نیازمند بررسی است.</span>}
    </div>)}
    {checkNote && <div className="notice" role="status">{checkNote}</div>}
    {error && <div className="notice" role="alert">{error} <button className="text-button" onClick={load} disabled={busy}>دریافت دوباره</button></div>}
    <form className="inbox-filters" onSubmit={event => { event.preventDefault(); setPage(0); setSubmittedQuery(query.trim()); }} style={{ marginTop: 20 }}>
      <label className="inbox-search"><Search size={17} /><input aria-label="جست‌وجو در آگهی‌های منبع رسمی" value={query} onChange={e => setQuery(e.target.value)} placeholder="عنوان یا متن فرصت…" maxLength={200} /></label>
      <select aria-label="ایالت فرصت" value={state} onChange={e => { setPage(0); setState(e.target.value); }}><option value="all">ایالت‌های تحت پوشش</option><option value="TAS">تاسمانی · TAS</option></select>
      <select aria-label="نوع فرصت" value={kind} onChange={e => { setPage(0); setKind(e.target.value); }}><option value="all">همهٔ انواع</option><option value="vacancy">آگهی موقعیت</option><option value="employment_register">ثبت علاقه‌مندی / بانک متقاضی</option></select>
      <button type="submit" className="secondary" disabled={busy}>جست‌وجو</button>
    </form>
    <label className="checkline" style={{ marginTop: 12 }}><input type="checkbox" checked={includeClosed} onChange={e => { setPage(0); setIncludeClosed(e.target.checked); }} /> نمایش موارد بسته‌شده نیز</label>
    <p className="muted">{busy ? "در حال دریافت دادهٔ ذخیره‌شده…" : `${total.toLocaleString("fa-IR")} نتیجه با فیلتر فعلی`} · رتبه‌بندی، نشانه‌های موجود در متن را مقایسه می‌کند و احتمال پذیرش نیست.</p>
    {!busy && !items.length && !error && <div className="empty"><BriefcaseBusiness size={28} /><h3>فعلاً موردی با این فیلتر ثبت نشده است</h3><p>ممکن است دریافت اولیه هنوز انجام نشده باشد یا منبع مورد مناسبی نداشته باشد. بانک تماس‌های پایین صفحه مستقل از این فهرست است.</p></div>}
    {items.map(item => <article className="inbox-message" key={text(item.id)}>
      <div className="section-head" style={{ gap: 10, flexWrap: "wrap", alignItems: "start" }}><div style={{ minWidth: 0, flex: 1 }}><h4 dir="auto" style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>{text(item.title) || "عنوان اعلام نشده"}</h4><small>{text(item.organization) || "نام سازمان نیازمند بررسی"} · {text(item.state) || "ایالت نامعلوم"}</small></div><span className="status amber">{item.kind === "employment_register" ? "بانک متقاضی؛ آگهی قطعی نیست" : "آگهی موقعیت"}</span><span className="status">{statusLabels[item.status] || "وضعیت نیازمند بررسی"}</span></div>
      <p className="muted">مهلت اعلام‌شده: {date(item.closingAt)} · مشاهدهٔ اخیر در منبع: {date(item.lastSeenAt)}</p>
      <p className="message-snippet" dir="auto">{text(item.summary)}</p>
      <p className="muted">اسپانسرشیپ: {item.sponsorship === true ? "ذکرشده در متن؛ نیازمند تأیید" : "تأیید نشده"} · supervision: {item.supervision === true ? "ذکرشده در متن؛ نیازمند تأیید" : "تأیید نشده"} · شرایط ثبت و MMM/DPA: نیازمند بررسی مستقل</p>
      <div className="form-actions" style={{ flexWrap: "wrap" }}>
        {link(item.url) && <a className="secondary link" href={link(item.url)} target="_blank" rel="noreferrer">اصل آگهی <ExternalLink size={14} /></a>}
        <button className="text-button" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? "بستن جزئیات منبع" : "جزئیات و مبنای تطابق"}</button>
      </div>
      {expanded === item.id && <div className="message-details"><div className="cv-details"><span>شناسهٔ منبع</span><b>{text(item.sourceId) || "نامعلوم"}</b><span>انتشار اعلام‌شده</span><b>{date(item.publishedAt)}</b><span>نخستین مشاهده</span><b>{date(item.firstSeenAt)}</b><span>شاخص تطابق واژه‌ها</span><b>{Number.isFinite(item.match?.score) ? item.match.score.toLocaleString("fa-IR") : "ارزیابی نشده"} — احتمال پذیرش نیست</b></div>
        <ul>{list(item.match?.reasons).map((reason, index) => <li key={index}>{reasonLabels[reason] || "نشانهٔ متنی برای بررسی تناسب؛ شرایط نهایی باید از اصل آگهی تأیید شود."}</li>)}</ul>
        {link(item.sourceUrl) && <a className="text-button" href={link(item.sourceUrl)} target="_blank" rel="noreferrer">دادهٔ منبع ناشر <ExternalLink size={13} /></a>}
      </div>}
    </article>)}
    {total > limit && <div className="form-actions" style={{ marginTop: 18 }}><button className="secondary" disabled={busy || page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronRight size={15} /> قبلی</button><span className="muted">صفحهٔ {(page + 1).toLocaleString("fa-IR")} از {Math.ceil(total / limit).toLocaleString("fa-IR")}</span><button className="secondary" disabled={busy || (page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>بعدی <ChevronLeft size={15} /></button></div>}
  </section>;
}
