import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  FileText,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api, apiResponse } from "./api";
import { downloadCVPDF } from "./cv-pdf.mjs";

export function CVVersions(props) {
  return <OwnedCVVersions key={props.person} {...props} />;
}
function OwnedCVVersions({ person, notify }) {
  const alive=useRef(true),owner=useRef(person);owner.current=person;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [versions, setVersions] = useState([]),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  async function load() {
    try {
      const data = await api(`cv/versions?profile=${person}`);
      if(!alive.current||owner.current!==person)return;
      setVersions(Array.isArray(data) ? data : data.versions || []);
      setError("");
    } catch (e) {
      if(alive.current && owner.current === person) setError(e.message);
    }
  }
  useEffect(() => {
    setVersions([]);
    setName("");
    load();
  }, [person]);
  async function create() {
    if (!name.trim()) {
      notify("برای نسخهٔ رزومه یک نام وارد کنید.");
      return;
    }
    try {
      await api(`cv/versions?profile=${person}`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      if(!alive.current || owner.current !== person) return;
      setName("");
      await load();
      if(!alive.current || owner.current !== person) return;
      notify(
        "نسخه از متن ثبت‌شدهٔ رزومه ذخیره شد؛ دستاورد جدیدی اضافه نشده است.",
      );
    } catch (e) {
      if(alive.current && owner.current === person) notify(e.message);
    }
  }
  async function setDefault(id) {
    try {
      await api(`cv/default?profile=${person}`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      if(!alive.current || owner.current !== person) return;
      await load();
      if(alive.current && owner.current === person) notify("رزومهٔ پیش‌فرض این پروفایل تعیین شد.");
    } catch (e) {
      if(alive.current && owner.current === person) notify(e.message);
    }
  }
  async function exportCV(id, format) {
    try {
      const response = await apiResponse(
        `cv/export?profile=${person}&id=${encodeURIComponent(id)}&format=${format === "pdf" ? "txt" : format}`,
      );
      if(format === "pdf"){
        const text=await response.text();if(!alive.current||owner.current!==person)return;
        const result=downloadCVPDF({name:person === "amir" ? "Amir Houshang Gerami" : "Arash Entezar",cvText:text,versionName:versions.find(v=>v.id===id)?.name,filename:person+"-cv.pdf"});notify(result.requiresPrint?"برای حفظ همهٔ نویسه‌ها، نمای چاپ باز شد؛ Save as PDF را انتخاب کنید.":"فایل PDF همین نسخهٔ رزومه دریافت شد.");return;
      }
      const blob = await response.blob();if(!alive.current||owner.current!==person)return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${person}-cv.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if(alive.current && owner.current === person) notify(e.message);
    }
  }
  return (
    <section className="panel version-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">CV VERSION LIBRARY</span>
          <h3>نسخه‌ها و قالب‌های رزومه</h3>
        </div>
        <button
          className="icon"
          onClick={load}
          aria-label="تازه‌سازی نسخه‌های رزومه"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <p className="muted">
        نسخهٔ جدید، تصویر ثابتی از متن رزومهٔ موجود است. قبل از ارسال، محتوا و
        مدارک آن را بررسی کنید.
      </p>
      {error ? (
        <div className="notice">{error}</div>
      ) : (
        <>
          <div className="form-actions">
            <input
              aria-label="نام نسخهٔ رزومه"
              placeholder="مثلاً GP application — November"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary" onClick={create}>
              <Plus size={16} /> ذخیرهٔ نسخه
            </button>
          </div>
          {versions.length ? (
            versions.map((v) => (
              <div className="version-row" key={v.id}>
                <FileText size={18} />
                <div>
                  <strong>{v.name}</strong>
                  <small>
                    {v.createdAt
                      ? new Date(v.createdAt).toLocaleDateString("fa-IR")
                      : ""}
                  </small>
                </div>
                {v.isDefault || v.is_default ? (
                  <span className="status">پیش‌فرض</span>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => setDefault(v.id)}
                  >
                    <Check size={14} /> تعیین پیش‌فرض
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => exportCV(v.id, "docx")}
                >
                  <ArrowDownToLine size={14} /> DOCX
                </button>
                <button className="text-button" onClick={() => exportCV(v.id, "pdf")}>PDF</button>
                <button
                  className="text-button"
                  onClick={() => exportCV(v.id, "txt")}
                >
                  TXT
                </button>
              </div>
            ))
          ) : (
            <p className="muted">هنوز نسخه‌ای ذخیره نشده است.</p>
          )}
        </>
      )}
    </section>
  );
}

// All responses and mutations are bound to the render identity, including A→B→A switches.
export function useEmailPresets(person, notify) {
  const identity = useRef({ person, epoch: 0 });
  if (identity.current.person !== person) identity.current = { person, epoch: identity.current.epoch + 1 };
  const scope = identity.current;
  const alive = useRef(true), sequence = useRef(0), mutation = useRef(null);
  const [record, setRecord] = useState(null);
  const current = record?.scope === scope ? record : { presets: [], error: "", loading: true, busy: false };
  const valid = () => alive.current && identity.current === scope;
  const update = patch => { if (valid()) setRecord(old => ({ ...(old?.scope === scope ? old : { presets: [], error: "", loading: false, busy: false }), ...patch, scope })); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current += 1; }; }, []);
  async function load() {
    if (!valid()) return;
    const request = ++sequence.current;
    update({ loading: true });
    try {
      const data = await api(`presets?profile=${encodeURIComponent(person)}`);
      if (!valid() || request !== sequence.current) return;
      if (data?.profileId && data.profileId !== person) throw new Error("پاسخ قالب‌ها با پروفایل فعال مطابقت ندارد.");
      const rows = Array.isArray(data) ? data : data.presets || [];
      update({ presets: rows.filter(row => row && typeof row.id === "string" && (!row.profileId || row.profileId === person) && (!row.profile_id || row.profile_id === person)), error: "", loading: false });
    } catch (error) { if (valid() && request === sequence.current) update({ error: error.message, loading: false }); }
  }
  useEffect(() => { load(); }, [person]);
  async function mutate(path, payload, message) {
    if (!valid() || mutation.current === scope) return false;
    mutation.current = scope;
    update({ busy: true, error: "" });
    try {
      await api(`${path}?profile=${encodeURIComponent(person)}`, { method: "POST", body: JSON.stringify(payload) });
      if (!valid()) return false;
      await load();
      if (!valid()) return false;
      notify?.(message);
      return true;
    } catch (error) { if (valid()) { update({ error: error.message }); notify?.(error.message); } return false; }
    finally { if (mutation.current === scope) mutation.current = null; update({ busy: false }); }
  }
  function save(values) {
    if (!valid()) return Promise.resolve(false);
    if (typeof values.name !== "string" || !values.name.trim() || values.name.trim().length > 120 || /[\x00-\x1f\x7f]/.test(values.name) || typeof values.subject !== "string" || !values.subject.trim() || values.subject.trim().length > 500 || /[\r\n]/.test(values.subject) || typeof values.body !== "string" || !values.body.trim() || values.body.trim().length > 50000) {
      notify?.("نام قالب (تا ۱۲۰ نویسه)، موضوع تک‌خطی (تا ۵۰۰ نویسه) و متن (تا ۵۰٬۰۰۰ نویسه) را تکمیل کنید.");
      return Promise.resolve(false);
    }
    return mutate("presets", { name: values.name.trim(), subject: values.subject.trim(), body: values.body.trim() }, "نسخهٔ قالب ذخیره شد؛ هیچ ایمیلی ارسال نشده است.");
  }
  function setDefault(id) {
    if (!valid() || !current.presets.some(row => row.id === id)) return Promise.resolve(false);
    return mutate("presets/default", { id }, "قالب پیش‌فرض همین پروفایل ذخیره شد؛ هیچ ایمیلی ارسال نشده است.");
  }
  function remove(id) {
    if (!valid() || !current.presets.some(row => row.id === id)) return Promise.resolve(false);
    return mutate("presets/delete", { id }, "این نسخهٔ قالب حذف شد؛ قالب دیگری خودکار پیش‌فرض نمی‌شود.");
  }
  function choose(id, callback) {
    if (!valid() || current.loading) return;
    const item = current.presets.find(row => row.id === id);
    if (item) callback(item);
  }
  return { ...current, load, save, setDefault, remove, choose, isCurrent: valid };
}

export function Presets(props) {
  return <OwnedPresets key={props.person} {...props} />;
}
function OwnedPresets({ person, subject, body, onChoose, notify }) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const { presets, error, loading, busy, save, setDefault, choose, isCurrent } = useEmailPresets(person, notify);
  async function saveCurrent() {
    if (await save({ name, subject, body }) && isCurrent()) setName("");
  }
  return <section className="preset-tools">
    <h3>قالب‌های شخصی مکاتبه</h3>
    {error && <p className="notice" role="alert">{error}</p>}
    <select aria-label="قالب‌های ذخیره‌شده" value={selectedId} disabled={loading || busy} onChange={event => {
      setSelectedId(event.target.value);
      choose(event.target.value, selected => onChoose?.(selected));
    }}>
      <option value="">{loading ? "دریافت قالب‌ها…" : "انتخاب قالب ذخیره‌شده…"}</option>
      {presets.map(value => <option key={value.id} value={value.id}>{value.name} · نسخهٔ {value.revision}{value.isDefault || value.is_default ? " · پیش‌فرض" : ""}</option>)}
    </select>
    <div className="form-actions">
      <input aria-label="نام قالب مکاتبه" maxLength={120} dir="auto" value={name} placeholder="نام قالب جدید" onChange={event => setName(event.target.value)} />
      <button type="button" className="secondary" disabled={busy || loading} onClick={saveCurrent}><Plus size={15} /> ذخیرهٔ متن بالا</button>
    </div>
    {presets.map(value => <div className="version-row compact" key={value.id}>
      <strong dir="auto">{value.name}</strong>
      {value.isDefault || value.is_default ? <span className="status">پیش‌فرض</span> : <button type="button" className="text-button" disabled={busy || loading} onClick={() => setDefault(value.id)}>تعیین پیش‌فرض</button>}
    </div>)}
  </section>;
}
