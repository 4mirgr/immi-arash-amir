import React from "react";
import { ClipboardList, GraduationCap, Languages, Clock3 } from "lucide-react";

const text = (value) => (typeof value === "string" ? value : "");
const list = (value) => (Array.isArray(value) ? value : []);
const statusLabels = {
  pending: "در انتظار تعیین تکلیف",
  estimate: "برآورد؛ تأیید نشده",
  scenario: "سناریوی برنامه‌ریزی",
  confirmed: "تأییدشده در پرونده",
  completed: "تکمیل‌شده در پرونده",
};
const statusLabel = (value) => statusLabels[value] || "نیازمند بررسی";

function ScenarioList({ items }) {
  const scenarios = list(items);
  if (!scenarios.length) return <p className="muted">جزئیات هنوز ثبت نشده است.</p>;
  return scenarios.map((item, index) => (
    <div className="step" key={text(item?.id) || index}>
      <span className="step-num">{index + 1}</span>
      <div>
        <strong>{text(item?.label) || "سناریوی نیازمند تکمیل"}</strong>
        <small>{statusLabel(item?.status)}</small>
      </div>
    </div>
  ));
}

export function ProfilePlanning({ profile }) {
  const planning = profile?.planning;
  if (!planning || typeof planning !== "object" || Array.isArray(planning))
    return null;

  const language = planning.language || {};
  const training = planning.training || {};
  const board = planning.board || {};
  const followUps = list(planning.followUps);
  const updatedAt = text(planning.updatedAt);
  const updatedDate = updatedAt ? new Date(updatedAt) : null;
  const hasUpdatedDate = updatedDate && !Number.isNaN(updatedDate.getTime());

  return (
    <section className="panel" aria-label="پروندهٔ برنامه‌ریزی شخصی">
      <div className="section-head">
        <div>
          <span className="eyebrow">PERSONAL PLANNING RECORD</span>
          <h3>پروندهٔ برنامه‌ریزی و موارد باز</h3>
        </div>
        <ClipboardList size={22} aria-hidden="true" />
      </div>
      <div className="notice">
        برآوردها، اطلاعات خوداظهاری و سناریوها برای برنامه‌ریزی نگهداری می‌شوند.
        این موارد به معنی اتمام دوره، دریافت بورد یا احراز شرایط مهاجرت نیستند.
      </div>
      <div className="two-col">
        <section>
          <h3><GraduationCap size={18} aria-hidden="true" /> پایان دورهٔ تخصص</h3>
          <p className="muted">
            {training.completionStatus === "uncertain"
              ? "زمان پایان دوره هنوز قطعی نیست؛ سناریوهای زمانی جداگانه حفظ شده‌اند."
              : "وضعیت پایان دوره باید بر اساس مدارک و آخرین اطلاعات پرونده بررسی شود."}
          </p>
          <ScenarioList items={training.completionScenarios} />
        </section>
        <section>
          <h3>سناریوهای بورد</h3>
          <p className="muted">
            {board.status === "pending"
              ? "نتیجهٔ بورد هنوز مشخص نشده است؛ برنامه‌ریزی هر سناریو جداگانه ادامه دارد."
              : "سناریوهای زیر با آخرین وضعیت پرونده تطبیق داده می‌شوند."}
          </p>
          <ScenarioList items={board.scenarios} />
        </section>
      </div>
      <section>
        <h3><Languages size={18} aria-hidden="true" /> آمادگی زبان</h3>
        <div className="cv-details">
          <span>سطح ثبت‌شده</span>
          <b>{text(language.level) || "هنوز تعیین نشده"}</b>
          <span>پشتوانهٔ سطح</span>
          <b>{language.levelEvidence === "self_reported" ? "خوداظهاری؛ نتیجهٔ آزمون نیست" : "نیازمند بررسی مدارک"}</b>
          <span>آزمون ترجیحی</span>
          <b>{text(language.preferredExam) || "هنوز انتخاب نشده"}</b>
          <span>وضعیت آزمون</span>
          <b>{language.examStatus === "not_taken" ? "هنوز آزمون داده نشده" : "نیازمند به‌روزرسانی پرونده"}</b>
          <span>گواهی زبان</span>
          <b>{language.certificateStatus === "none_reported" ? "گواهی گزارش نشده است" : "نیازمند بررسی مدارک"}</b>
        </div>
      </section>
      <section>
        <h3><Clock3 size={18} aria-hidden="true" /> مواردی که باید بعداً روشن شوند</h3>
        {followUps.length ? followUps.map((item, index) => (
          <div className="step" key={text(item?.id) || index}>
            <span className="step-num">{index + 1}</span>
            <div>
              <strong>{text(item?.label) || "موضوع نیازمند پیگیری"}</strong>
              <small>{statusLabel(item?.status)}</small>
              {text(item?.trigger) && <small>زمان پیگیری: {item.trigger}</small>}
            </div>
          </div>
        )) : <p className="muted">مورد باز دیگری ثبت نشده است.</p>}
      </section>
      {text(planning.academicContact?.email) && <section>
        <h3>راه ارتباطی دانشگاهی گزارش‌شده</h3>
        <p><bdi dir="ltr">{planning.academicContact.email}</bdi></p>
        <p className="muted">به گزارش شما ثبت شده؛ مالکیت و امکان ارسال/دریافت هنوز بررسی نشده است. می‌تواند برای مکاتبات پژوهشی استفاده شود، اما نمایندگی دانشگاه یا دسترسی API را اثبات نمی‌کند.</p>
      </section>}
      <p className="muted">
        این بخش فقط اطلاعات ذخیره‌شدهٔ همین پروفایل را نمایش می‌دهد.
        {hasUpdatedDate && <> آخرین به‌روزرسانی: <time dateTime={updatedAt}>{updatedDate.toLocaleDateString("fa-IR")}</time>.</>}
      </p>
    </section>
  );
}
