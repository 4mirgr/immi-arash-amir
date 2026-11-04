import React, { useState } from "react";
import { Check, FileText, Plus, RefreshCw, Save } from "lucide-react";
import { MixedText } from "./mixed-text";
import { useEmailPresets } from "./workspace-tools";

export function EmailTemplateSettings(props) {
  return <OwnedEmailTemplateSettings key={props.person} {...props} />;
}

function OwnedEmailTemplateSettings({ person, notify }) {
  const templates = useEmailPresets(person, notify);
  const [editor, setEditor] = useState({ name: "", subject: "", body: "" });
  const [selectedId, setSelectedId] = useState("");
  const selected = templates.presets.find(item => item.id === selectedId);
  const currentDefault = templates.presets.find(item => item.isDefault || item.is_default);
  const disabled = templates.loading || templates.busy;
  const ownerName = person === "amir" ? "دکتر گرامی" : "دکتر آرش انتظار";
  function choose(id) {
    templates.choose(id, item => {
      setSelectedId(item.id);
      setEditor({ name: item.name || "", subject: item.subject || "", body: item.body || "" });
    });
  }
  function change(field, value) { setEditor(previous => ({ ...previous, [field]: value })); }
  async function save(event) {
    event.preventDefault();
    if (await templates.save(editor) && templates.isCurrent()) setSelectedId("");
  }
  function reset() {
    setSelectedId("");
    setEditor({ name: "", subject: "", body: "" });
  }
  return <section className="panel email-template-settings settings-card-wide" aria-label={`قالب‌های ایمیل ${ownerName}`}>
    <div className="section-head">
      <div><span className="eyebrow">EMAIL TEMPLATE LIBRARY</span><h3>قالب و ایمیل پیش‌فرض {ownerName}</h3></div>
      <button type="button" className="icon" aria-label="تازه‌سازی قالب‌های ایمیل" disabled={disabled} onClick={templates.load}><RefreshCw size={17} /></button>
    </div>
    <p className="muted">قالب‌های این حساب برای مرکز مکاتبات و سیاست ارسال ایمیل استفاده می‌شوند. هر ذخیره با نام قبلی، نسخهٔ جدیدی می‌سازد؛ نسخه‌های قبلی حفظ می‌شوند.</p>
    <div className="email-template-default" role="status">
      <Check size={17} /><span>پیش‌فرض فعلی: <strong><MixedText>{currentDefault?.name || (templates.loading ? "در حال دریافت…" : "هنوز تعیین نشده")}</MixedText></strong>{currentDefault && <> · نسخهٔ {currentDefault.revision}</>}</span>
    </div>
    {templates.error && <p className="notice" role="alert"><MixedText>{templates.error}</MixedText></p>}
    <div className="email-template-layout">
      <form className="email-template-editor" onSubmit={save}>
        <div className="section-head"><h4>{selected ? "ویرایش و ذخیرهٔ نسخهٔ جدید" : "ساخت قالب نام‌گذاری‌شده"}</h4><button type="button" className="text-button" disabled={templates.busy} onClick={reset}><Plus size={15} /> قالب جدید</button></div>
        <label><span>انتخاب قالب برای ویرایش</span><select aria-label="انتخاب قالب ایمیل برای ویرایش" value={selectedId} disabled={disabled} onChange={event => event.target.value ? choose(event.target.value) : reset()}>
          <option value="">قالب جدید…</option>{templates.presets.map(item => <option key={item.id} value={item.id}>{item.name} · نسخهٔ {item.revision}{item.isDefault || item.is_default ? " · پیش‌فرض" : ""}</option>)}
        </select></label>
        <label><span>نام قالب</span><input aria-label="نام قالب ایمیل" dir="auto" required maxLength={120} value={editor.name} disabled={templates.busy} placeholder="مثلاً درخواست موقعیت بالینی" onChange={event => change("name", event.target.value)} /></label>
        <label><span>موضوع ایمیل</span><input aria-label="موضوع قالب ایمیل" dir="auto" required maxLength={500} value={editor.subject} disabled={templates.busy} placeholder="Application for a supervised medical position" onChange={event => change("subject", event.target.value)} /></label>
        <label><span>متن ایمیل</span><textarea aria-label="متن قالب ایمیل" dir="auto" required maxLength={50000} rows={12} value={editor.body} disabled={templates.busy} placeholder="Dear recruitment team,…" onChange={event => change("body", event.target.value)} /></label>
        <p className="muted">برای نگه‌داشتن همین مجموعه، نام را تغییر ندهید. برای قالبی مستقل، نام تازه وارد کنید. پیش‌فرض فقط با دکمهٔ «تعیین پیش‌فرض» عوض می‌شود.</p>
        <div className="form-actions"><button type="submit" className="primary" disabled={disabled}><Save size={16} />{templates.busy ? "در حال ذخیره…" : "ذخیرهٔ نسخهٔ قالب"}</button></div>
      </form>
      <div className="email-template-library">
        <h4>قالب‌های ذخیره‌شدهٔ همین حساب</h4>
        {templates.loading && <p className="muted" role="status">در حال دریافت قالب‌ها…</p>}
        {!templates.loading && !templates.presets.length && !templates.error && <p className="muted">هنوز قالبی ثبت نشده است؛ نام، موضوع و متن را در فرم وارد کنید.</p>}
        <div className="email-template-list">{templates.presets.map(item => <article className={`email-template-row${item.isDefault || item.is_default ? " is-default" : ""}`} key={item.id}>
          <div className="email-template-title"><FileText size={17} /><strong><MixedText>{item.name}</MixedText></strong><small>نسخهٔ {item.revision}</small>{(item.isDefault || item.is_default) && <span className="status">پیش‌فرض</span>}</div>
          <p dir="auto" className="email-template-subject"><MixedText>{item.subject}</MixedText></p>
          <details><summary>نمایش متن این نسخه</summary><p dir="auto" className="email-template-preview" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><MixedText>{item.body}</MixedText></p></details>
          <div className="form-actions"><button type="button" className="secondary" disabled={disabled} onClick={() => choose(item.id)}>ویرایش در فرم</button>{!(item.isDefault || item.is_default) && <button type="button" className="text-button" disabled={disabled} onClick={() => templates.setDefault(item.id)}><Check size={14} /> تعیین پیش‌فرض</button>}</div>
        </article>)}</div>
      </div>
    </div>
  </section>;
}
