import React, { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  FileText,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api, apiResponse } from "./api";

export function CVVersions({ person, notify }) {
  const [versions, setVersions] = useState([]),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  async function load() {
    try {
      const data = await api(`cv/versions?profile=${person}`);
      setVersions(Array.isArray(data) ? data : data.versions || []);
      setError("");
    } catch (e) {
      setError(e.message);
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
      setName("");
      await load();
      notify(
        "نسخه از متن ثبت‌شدهٔ رزومه ذخیره شد؛ دستاورد جدیدی اضافه نشده است.",
      );
    } catch (e) {
      notify(e.message);
    }
  }
  async function setDefault(id) {
    try {
      await api(`cv/default?profile=${person}`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await load();
      notify("رزومهٔ پیش‌فرض این پروفایل تعیین شد.");
    } catch (e) {
      notify(e.message);
    }
  }
  async function exportCV(id, format) {
    try {
      const response = await apiResponse(
        `cv/export?profile=${person}&id=${encodeURIComponent(id)}&format=${format}`,
      );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${person}-cv.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify(e.message);
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

export function Presets({ person, subject, body, onChoose, notify }) {
  const [presets, setPresets] = useState([]),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  async function load() {
    try {
      const data = await api(`presets?profile=${person}`);
      setPresets(Array.isArray(data) ? data : data.presets || []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    setPresets([]);
    setName("");
    load();
  }, [person]);
  async function save() {
    if (!name.trim() || !subject.trim() || !body.trim()) {
      notify("نام قالب، موضوع و متن را تکمیل کنید.");
      return;
    }
    try {
      await api(`presets?profile=${person}`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), subject, body }),
      });
      setName("");
      await load();
      notify("قالب مکاتبه ذخیره شد.");
    } catch (e) {
      notify(e.message);
    }
  }
  async function setDefault(id) {
    try {
      await api(`presets/default?profile=${person}`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await load();
      notify("قالب پیش‌فرض ذخیره شد؛ هیچ ایمیلی ارسال نشده است.");
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <section className="preset-tools">
      <h3>قالب‌های شخصی مکاتبه</h3>
      {error ? (
        <p className="notice">{error}</p>
      ) : (
        <>
          <select
            aria-label="قالب‌های ذخیره‌شده"
            defaultValue=""
            onChange={(e) => {
              const selected = presets.find((v) => v.id === e.target.value);
              if (selected) onChoose(selected);
            }}
          >
            <option value="">انتخاب قالب ذخیره‌شده…</option>
            {presets.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · نسخهٔ {v.revision}
                {v.isDefault ? " · پیش‌فرض" : ""}
              </option>
            ))}
          </select>
          <div className="form-actions">
            <input
              aria-label="نام قالب مکاتبه"
              value={name}
              placeholder="نام قالب جدید"
              onChange={(e) => setName(e.target.value)}
            />
            <button className="secondary" onClick={save}>
              <Plus size={15} /> ذخیرهٔ متن بالا
            </button>
          </div>
          {presets.map((v) => (
            <div className="version-row compact" key={v.id}>
              <strong>{v.name}</strong>
              {v.isDefault ? (
                <span className="status">پیش‌فرض</span>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setDefault(v.id)}
                >
                  تعیین پیش‌فرض
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
