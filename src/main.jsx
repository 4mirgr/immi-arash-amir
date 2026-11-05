import {googleAccountLabel} from './google-account-labels.mjs';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Linkedin,
  Search,
  Mail,
  FileText,
  GraduationCap,
  Settings,
  ChevronLeft,
  ArrowUpLeft,
  ArrowDownToLine,
  RefreshCw,
  Check,
  Plus,
  ArrowLeft,
  ExternalLink,
  MapPin,
  Clock,
  Activity,
  ShieldCheck,
  SlidersHorizontal,
  Send,
  Calendar,
  Play,
  Pause,
  Volume2,
  BriefcaseBusiness,
  BookOpen,
  CheckCircle2,
  Bell,
  Globe,
  Command,
  Users,
  Copy,
  X,
} from "lucide-react";
import "./style.css";
import { api } from "./api";
import { AccessGate } from "./auth";
import { CVVersions, Presets } from "./workspace-tools";
import { useGoogleConnection, GoogleConnection, GoogleInbox } from "./google-tools";
import { GoogleSendPanel } from "./google-send-panel";
import { CalendarDriveTools } from "./calendar-drive-tools";
import { ProfilePlanning } from "./profile-planning";
import { ThemeControl } from "./theme-control";
import { downloadCVPDF } from "./cv-pdf.mjs";
import { MixedText } from "./mixed-text";
import { TextSizeControl } from "./text-size-control";
import {ArashHome,ArashNavigation,WorkspaceFold,ARASH_TONES} from "./arash-workspace";
import {EmailTemplateSettings} from "./email-template-settings";
import {AmirHome,AmirNavigation,AMIR_TONES} from "./amir-workspace";
import {LanguageControl} from "./language-control";
import {WorkspaceGuidance} from "./workspace-guidance";
import {SourceMonitor} from "./source-monitor";

function deferredPanel(load,name){const Component=React.lazy(()=>load().then(module=>({default:module[name]})));return function DeferredPanel(props){return <React.Suspense fallback={<section className="panel" role="status">در حال آماده‌سازی این بخش…</section>}><Component {...props}/></React.Suspense>;};}
const AutomationHub=deferredPanel(()=>import("./automation-hub"),"AutomationHub");
const LinkedInWorkspace=deferredPanel(()=>import("./linkedin-workspace"),"LinkedInWorkspace");
const PesciPractice=deferredPanel(()=>import("./pesci-practice"),"PesciPractice");
const JobOpportunitiesPanel=deferredPanel(()=>import("./job-opportunities-panel"),"JobOpportunitiesPanel");
const ExtractedEvidence=deferredPanel(()=>import("./extracted-evidence"),"ExtractedEvidence");
const RoadmapPanel=deferredPanel(()=>import("./roadmap-panel"),"RoadmapPanel");
const nav = [
  ["overview", "نمای کلی", LayoutDashboard],
  ["opportunities", "رصد فرصت‌ها", Search],
  ["mail", "مرکز مکاتبات", Mail],
  ["cv", "توسعه رزومه", FileText],
  ["pesci", "آکادمی PESCI", GraduationCap],
  ["linkedin", "لینکدین و شبکه‌سازی", Linkedin],
  ["roadmap", "تحلیل مسیر و برنامه", ShieldCheck],
  ["study", "تحصیل و فاند", GraduationCap],
  ["development", "مهارت‌ها و رویدادها", Calendar],
  ["sources", "منابع و مسیرها", BookOpen],
  ["automation", "اتوماسیون و AI", Command],
  ["settings", "اتصال‌ها و تنظیمات", Settings],
];

const fallbackStation = {
  id: "PESCI-001",
  title: "Chest pain in a rural clinic",
  case: "A 54-year-old man presents to a rural general practice with 40 minutes of central chest pain, sweating and nausea. He has hypertension and smokes. Describe your immediate assessment, management, escalation and transfer plan.",
  prompts: [
    "Initial assessment and red flags",
    "Immediate management and escalation",
    "Communication and safe transfer",
  ],
};
function App({ cloud = false, initialPerson = "arash", onSignOut }) {
  const [tab, setTab] = useState("overview"),
    [person, setPerson] = useState(initialPerson),
    [data, setData] = useState({ clinics: [], profiles: [], stations: [] }),
    [online, setOnline] = useState(false),
    [last, setLast] = useState(null),
    [query, setQuery] = useState(""),
    [state, setState] = useState("all"),
    [selected, setSelected] = useState([]),
    [toast, setToast] = useState(""),
    [subject, setSubject] = useState(
      "Expression of interest — Medical Practitioner",
    ),
    [body, setBody] = useState(""),
    [drafts, setDrafts] = useState([]),
    [seconds, setSeconds] = useState(480),
    [running, setRunning] = useState(false),
    [rate, setRate] = useState("1"),
    [policy, setPolicy] = useState("auto_after_connection"),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState(1);
  const [automationTab,setAutomationTab]=useState("operations");
  const googleConnection = useGoogleConnection(person, cloud);
  const secondaryGoogleConnection = useGoogleConnection(person, cloud && person === "amir", "secondary");
  const [composeMailbox,setComposeMailbox] = useState("primary");
  const mailConnection = composeMailbox === "secondary" ? secondaryGoogleConnection : googleConnection;
  const [replyContext, setReplyContext] = useState(null);
  const notify = (t) => {
    setToast(t);
    setTimeout(() => setToast(""), 4500);
  };
  const currentPerson = useRef({ person, epoch: 0 });
  if (currentPerson.current.person !== person)
    currentPerson.current = { person, epoch: currentPerson.current.epoch + 1 };
  const requestEpoch = currentPerson.current.epoch;
  const alive = useRef(true);
  const revision = useRef({ profile: person, value: null });
  const polling = useRef(false);
  const isCurrent = () =>
    alive.current &&
    currentPerson.current.person === person &&
    currentPerson.current.epoch === requestEpoch;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function refresh() {
    if (!isCurrent()) return;
    setLoading(true);
    try {
      const d = await api("bootstrap?profile=" + person);
      if (!isCurrent()) return;
      revision.current = { profile: person, value: d.revision ?? null };
      setData({ clinics: [], profiles: [], stations: [], ...d });
      setOnline(true);
      setLast(new Date());
      if (d.settings?.emailPolicy) setPolicy(d.settings.emailPolicy);
    } catch {
      if (!isCurrent()) return;
      setOnline(false);
      if (cloud) setData({ clinics: [], profiles: [], stations: [] });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }
  async function heartbeat() {
    if (!cloud) return refresh();
    if (!isCurrent() || polling.current) return;
    polling.current = true;
    try {
      const update = await api("updates?profile=" + person);
      if (!isCurrent()) return;
      if (update.revision == null) throw Error("Missing revision");
      if (
        revision.current.profile !== person ||
        revision.current.value !== update.revision
      )
        await refresh();
      else {
        setOnline(true);
        setLast(new Date());
      }
    } catch {
      if (isCurrent()) setOnline(false);
    } finally {
      polling.current = false;
    }
  }
  useEffect(() => {
    revision.current = { profile: person, value: null };
    setData({ clinics: [], profiles: [], stations: [] });
    refresh();
    setBody("");
    setReplyContext(null);
    setSubject("Expression of interest — Medical Practitioner");
    setDrafts([]);
    let active = true;
    api("drafts?profile=" + person)
      .then((d) => {
        if (active && isCurrent()) setDrafts(Array.isArray(d) ? d : []);
      })
      .catch(() => {});
    const interval = setInterval(heartbeat, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [person, cloud]);
  useEffect(() => {
    setPage(1);
  }, [query, state, person]);
  useEffect(() => {
    if (!running || seconds <= 0) return;
    const i = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(i);
  }, [running, seconds]);
  const arash = person === "arash",
    name = arash ? "دکتر آرش انتظار" : "دکتر امیرهوشنگ گرامی";
  const clinics = Array.isArray(data.clinics) ? data.clinics : [];
  const label = (c) =>
    c.name || c.clinic_name || c.clinic || c.organization || "مرکز بدون نام";
  const filtered = useMemo(
    () =>
      clinics.filter(
        (c) =>
          (state === "all" || c.state === state) &&
          JSON.stringify(c).toLowerCase().includes(query.toLowerCase()),
      ),
    [clinics, state, query],
  );
  const states = [...new Set(clinics.map((c) => c.state).filter(Boolean))];
  const station = data.stations?.[0] || fallbackStation;
  const profile = Array.isArray(data.profiles)
    ? data.profiles.find((p) => p.id === person)
    : data.profiles?.[person];
  function download(format = "txt") {
    if (!profile) {
      notify("اطلاعات رزومه هنوز از سرور دریافت نشده است");
      return;
    }
    if (!profile.cvText) {
      notify("متن رزومهٔ این پروفایل هنوز تکمیل نشده است");
      return;
    }
    const text = profile.cvText;
    if(format === "pdf"){
      try{const result=downloadCVPDF({name:person === "amir" ? "Amir Houshang Gerami" : "Arash Entezar",cvText:text,filename:person+"-profile.pdf"});notify(result.requiresPrint?"برای حفظ متن فارسی، نمای چاپ باز شد؛ مقصد Save as PDF را انتخاب کنید.":"PDF رزومه دریافت شد؛ محتوا را پیش از ارسال بازبینی کنید.");}catch(e){notify(e.message);}return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    a.download = person + "-profile.txt";
    a.click();
    URL.revokeObjectURL(a.href);
    notify(
      "اطلاعات ثبت‌شدهٔ پروفایل دانلود شد؛ خروجی CV نهایی نیازمند بازبینی است",
    );
  }
  async function saveDraft() {
    if (!subject.trim() || !body.trim()) {
      notify("موضوع و متن ایمیل را تکمیل کنید");
      return;
    }
    try {
      const d = await api("drafts", {
        method: "POST",
        body: JSON.stringify({
          profileId: person,
          profile_id: person,
          subject,
          body,
          clinicIds: selected,
          clinic_ids: selected,
          mailbox:composeMailbox,
          ...(replyContext ? {replyContext:{messageId:replyContext.messageId,...(replyContext.threadId?{threadId:replyContext.threadId}:{})}} : {}),
          to: clinics
            .filter((c) => selected.includes(c.id))
            .map((c) => c.email)
            .filter(Boolean),
        }),
      });
      if (!isCurrent()) return;
      setDrafts((x) => [d, ...x]);
      notify("پیش‌نویس ذخیره شد؛ هیچ ایمیلی ارسال نشده است");
    } catch (e) {
      notify(e.message);
    }
  }
  function speak() {
    if (!("speechSynthesis" in window)) {
      notify("مرورگر شما از خواندن متن پشتیبانی نمی‌کند");
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
      station.prompt ||
        station.case ||
        station.scenario ||
        station.description ||
        fallbackStation.case,
    );
    u.lang = "en-AU";
    u.rate = Number(rate);
    speechSynthesis.speak(u);
  }
  function select(id) {
    setSelected((x) =>
      x.includes(id) ? x.filter((v) => v !== id) : [...x, id],
    );
  }
  const sourceLinks = [
    [
      "Medical Board of Australia",
      "مسیرهای رسمی ثبت پزشکی",
      "https://www.medicalboard.gov.au/Registration/International-Medical-Graduates.aspx",
    ],
    [
      "RACGP",
      "آزمون PESCI و ارزیابی بالینی",
      "https://www.racgp.org.au/education/imgs",
    ],
    [
      "RACP",
      "ارزیابی پزشکان متخصص",
      "https://www.racp.edu.au/overseas-trained-physicians/international-medical-graduates/standard-specialist-assessment-pathway",
    ],
    [
      "Department of Health",
      "نیاز مناطق و طبقه‌بندی جغرافیایی",
      "https://www.health.gov.au/topics/rural-health-workforce",
    ],
  ];
  return (
    <div className={"app " + (!arash ? "amir amir-workspace neon-"+AMIR_TONES[tab] : "arash-workspace neon-"+ARASH_TONES[tab])} data-section={tab}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon"><img src="/brand-aa-64.png" alt="AA" width="42" height="42" style={{borderRadius:10}}/></span>
          <div>
            مسیــر<span>MEDICAL CAREER OS</span>
          </div>
        </a>
        <div className="workspace-label">فضای کاری شخصی</div>
        <button
          className="profile"
          onClick={() => {
            if (cloud) return;
            setPerson(arash ? "amir" : "arash");
            setSelected([]);
            setTab("overview");
          }}
        >
          <div className="avatar">{arash ? "AE" : "AG"}</div>
          <div>
            <strong>{name}</strong>
            <small>
              {arash
                ? "پزشک عمومی · مسیر استرالیا"
                : profile?.planning?.training?.currentStatus === "internal_medicine_resident" ? "رزیدنت داخلی · مسیر استرالیا" : "مسیر تخصص داخلی · استرالیا"}
            </small>
          </div>
          {!cloud && <span className="switch">⇄</span>}
        </button>
        <div className="demo-label">
          {cloud
            ? "ورود امن · دسترسی محدود به حساب شما"
            : "تعویض نمای آزمایشی · ورود امن هنوز متصل نیست"}
        </div>
        {arash ? <ArashNavigation items={nav} tab={tab} onNavigate={setTab}/> : <AmirNavigation items={nav} tab={tab} onNavigate={setTab}/>}
        <div className="sidebar-bottom">
          <div className="connection">
            <span className={"dot " + (online ? "green" : "amber")} />
            {online
              ? cloud
                ? "فضای ابری متصل"
                : "سرور محلی متصل"
              : "در انتظار اتصال سرور"}
          </div>
          <small>هر قدم، نزدیک‌تر به استرالیا</small>
          <div className="mini-logo">
            AU <span>→</span> YOUR NEXT CHAPTER
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            فضای کاری <ChevronLeft size={14} />
            <span>{nav.find((n) => n[0] === tab)?.[1]}</span>
          </div>
          <div className="header-actions">
            <LanguageControl personId={person} />
            <TextSizeControl personId={person} />
            <ThemeControl personId={person} />
            {cloud && (
              <button className="secondary" onClick={onSignOut}>
                خروج امن
              </button>
            )}
            <span className="timezone">
              <Globe size={14} /> Australia / Sydney
            </span>
            <button
              className="icon"
              aria-label="اطلاعیه‌ها"
              onClick={() =>
                notify("اعلان جدیدی از سرویس‌های خارجی دریافت نشده است")
              }
            >
              <Bell size={19} />
            </button>
            <div className="small-avatar">{arash ? "AE" : "AG"}</div>
          </div>
        </header>
        <div className="page"><WorkspaceGuidance/>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="dot green" /> مسیر حرفه‌ای شما، یک‌جا
              </div>
              <h1>
                {tab === "overview" ? (
                  <>
                    سلام، دکتر {arash ? "انتظار" : "گرامی"}{" "}
                    <span className="wave">✦</span>
                  </>
                ) : (
                  nav.find((n) => n[0] === tab)?.[1]
                )}
              </h1>
              <p>
                {({overview:"مسیر کاری یا تحصیلی خودتان را انتخاب کنید و قدم بعدی را پیش ببرید.",opportunities:"آگهی‌ها را فیلتر کنید؛ شرایط، اطلاعات تماس و روش درخواست هر مورد را ببینید.",mail:"ایمیل‌های مرتبط را بخوانید و با قالب و رزومهٔ خودتان پاسخ یا درخواست آماده کنید.",cv:"اطلاعات رزومه را مرور کنید، نسخه ذخیره کنید و فایل مناسب درخواست را بگیرید.",roadmap:"شرایط مسیر را با پروندهٔ خودتان مقایسه کنید و کارهای لازم را مشخص کنید.",study:"فرصت‌های تحصیلی و پژوهشی را با شرایط پذیرش، مهلت و کمک‌هزینه بررسی کنید.",development:"دوره‌ها و رویدادهایی را پیدا کنید که به هدف حرفه‌ای شما کمک می‌کنند.",linkedin:"پروفایل، متن پست‌ها و ارتباطات هدف را مدیریت کنید؛ نوع دسترسی هر بخش مشخص است.",pesci:"کیس بالینی انتخاب کنید و ارائهٔ انگلیسی و خودبازبینی را تمرین کنید.",sources:"ببینید آگهی‌ها و راهنمای مسیر از کدام منابع آمده‌اند و آخرین بررسی چه بوده است.",automation:"وضعیت سرویس‌ها، اعلان تلگرام و ابزارهای کمکی همین حساب را مدیریت کنید.",settings:"حساب‌ها را متصل کنید و قالب‌های ایمیل، رزومهٔ پیش‌فرض و برنامه‌هایتان را تنظیم کنید."})[tab]}
              </p>
            </div>
            <button className="secondary" onClick={refresh}>
              <RefreshCw size={16} className={loading ? "spin" : ""} />{" "}
              تازه‌سازی داده‌ها
            </button>
          </div>
          {!online && (
            <div className="notice">
              {cloud
                ? "ارتباط با فضای ابری برقرار نیست؛ برای حفظ حریم خصوصی داده‌ای نمایش داده نمی‌شود."
                : "نسخهٔ پایه · سرور داده در دسترس نیست. برای دریافت اطلاعات واقعی، API را اجرا کنید."}
            </div>
          )}
          {tab === "overview" && arash && <ArashHome onNavigate={setTab} online={online} googleConnected={googleConnection.state.connected} leadCount={clinics.length} draftCount={drafts.length} hasCV={!!profile?.cvText}/>}
          {tab === "overview" && !arash && <AmirHome onNavigate={setTab}/>}
          {tab === "opportunities" && <JobOpportunitiesPanel key={person} person={person} notify={notify} onOpenSettings={()=>setTab("settings")} />}
          {tab === "opportunities" && (
            <WorkspaceFold title="بانک مراکز و انتخاب مخاطب" hint="سرنخ‌های تماس واردشده؛ مستقل از آگهی‌های شغلی" tone="amber"><section className="panel opportunities">
              <div className="section-head">
                <div>
                  <span className="eyebrow">OPPORTUNITY RADAR</span>
                  <h3>
                    {tab === "overview"
                      ? "بانک مراکز؛ نقطهٔ شروع ارتباط"
                      : "رصد فرصت‌ها و بانک مراکز"}{" "}
                    <span className="count">
                      {clinics.length.toLocaleString("fa")}
                    </span>
                  </h3>
                </div>
                <span className="sync">
                  <span className={"dot " + (online ? "green" : "amber")} />
                  {last
                    ? "به‌روزرسانی " + last.toLocaleTimeString("fa-IR")
                    : "منتظر داده"}
                </span>
              </div>
              <div className="filters">
                <div className="search">
                  <Search size={17} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="جست‌وجوی مرکز، شهر، ایمیل یا سوپروایزر…"
                  />
                </div>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  aria-label="ایالت"
                >
                  <option value="all">همهٔ ایالت‌ها</option>
                  {states.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  className="secondary"
                  onClick={() => {
                    setQuery("");
                    setState("all");
                  }}
                >
                  <SlidersHorizontal size={16} /> پاک‌کردن فیلتر
                </button>
              </div>
              <div className="data-note">
                اطلاعات فایل‌های واردشده، سرنخ تماس هستند؛ اسپانسرشیپ، ظرفیت
                استخدام، MMM و پذیرش نیازمند تأیید مستقل است.
              </div>
              {selected.length > 0 && (
                <div className="bulk">
                  <span>
                    {selected.length.toLocaleString("fa")} مورد انتخاب شده
                  </span>
                  <button className="primary" onClick={() => setTab("mail")}>
                    ساخت پیش‌نویس گروهی <Mail size={15} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setSelected([])}
                  >
                    لغو انتخاب
                  </button>
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="انتخاب موارد نمایان"
                          checked={
                            filtered.length > 0 &&
                            filtered
                              .slice(
                                tab === "overview" ? 0 : (page - 1) * 25,
                                tab === "overview" ? 5 : page * 25,
                              )
                              .every((c) => selected.includes(c.id))
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? filtered
                                    .slice(
                                      tab === "overview" ? 0 : (page - 1) * 25,
                                      tab === "overview" ? 5 : page * 25,
                                    )
                                    .map((c) => c.id)
                                : [],
                            )
                          }
                        />
                      </th>
                      <th>مرکز / سازمان</th>
                      <th>موقعیت</th>
                      <th>راه ارتباط</th>
                      <th>وضعیت اعتبارسنجی</th>
                      <th>اقدام</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .slice(
                        tab === "overview" ? 0 : (page - 1) * 25,
                        tab === "overview" ? 5 : page * 25,
                      )
                      .map((c, i) => (
                        <tr key={c.id || i}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={"انتخاب " + label(c)}
                              checked={selected.includes(c.id)}
                              onChange={() => select(c.id)}
                            />
                          </td>
                          <td>
                            <div className="clinic">
                              <span className="clinic-icon">
                                <BriefcaseBusiness size={17} />
                              </span>
                              <div>
                                <strong>{label(c)}</strong>
                                <small>{c.id}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="location">
                              <MapPin size={13} />
                              {[c.city, c.state].filter(Boolean).join("، ") ||
                                "ثبت نشده"}
                            </span>
                          </td>
                          <td dir="ltr" className="email">
                            {c.email || "—"}
                          </td>
                          <td>
                            <span className="status amber">نیازمند بررسی</span>
                          </td>
                          <td>
                            <button
                              className="icon"
                              aria-label="تهیه پیش‌نویس"
                              onClick={() => {
                                setSelected([c.id]);
                                setTab("mail");
                              }}
                            >
                              <ArrowUpLeft size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty">
                    <Search size={29} />
                    <h3>
                      {clinics.length
                        ? "موردی با این فیلتر پیدا نشد"
                        : "بانک مراکز هنوز بارگذاری نشده"}
                    </h3>
                    <p>
                      {clinics.length
                        ? "عبارت جست‌وجو یا فیلتر ایالت را تغییر دهید."
                        : "پس از اجرای API، اطلاعات فایل‌های واردشده در این بخش نمایش داده می‌شود."}
                    </p>
                  </div>
                )}
              </div>
              {tab === "overview" && (
                <button
                  className="view-all"
                  onClick={() => setTab("opportunities")}
                >
                  مشاهدهٔ همهٔ مراکز <ArrowLeft size={16} />
                </button>
              )}
              {filtered.length > 25 && tab !== "overview" && (
                <div className="form-actions">
                  <button
                    className="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    صفحهٔ قبل
                  </button>
                  <span className="muted">
                    صفحهٔ {page.toLocaleString("fa")} از{" "}
                    {Math.ceil(filtered.length / 25).toLocaleString("fa")} ·{" "}
                    {filtered.length.toLocaleString("fa")} نتیجه
                  </span>
                  <button
                    className="secondary"
                    disabled={page >= Math.ceil(filtered.length / 25)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    صفحهٔ بعد
                  </button>
                </div>
              )}
            </section></WorkspaceFold>
          )}
          {tab === "mail" && (
            <div className="two-col compose-grid">
              <section className="panel">
                <div className="section-head">
                  <h3>پیش‌نویس مکاتبه</h3>
                  <span className="tag">{mailConnection.state.connected ? "Gmail همین حساب متصل است" : "Gmail متصل نیست"}</span>
                </div>
                {person === "amir" && <label>صندوق فرستندهٔ همین پیش‌نویس<select value={composeMailbox} onChange={e=>{setComposeMailbox(e.target.value);setReplyContext(null);if(e.target.value==='secondary')secondaryGoogleConnection.refresh();}}><option value="primary">{googleAccountLabel(person,'primary',googleConnection.state.email)}</option><option value="secondary">{googleAccountLabel(person,'secondary',secondaryGoogleConnection.state.email)}</option></select></label>}
                {replyContext && <div className="notice">پاسخ به پیام همین صندوق: <span dir="ltr">{replyContext.to}</span><button className="text-button" onClick={()=>setReplyContext(null)}>حذف زمینهٔ پاسخ</button><small>این مرحله فقط متن پیش‌نویس را آماده می‌کند؛ ارسال هنوز انجام نمی‌شود.</small></div>}
                <label>مخاطبان انتخاب‌شده</label>
                <div className="recipient-list">
                  {selected.length
                    ? clinics
                        .filter((c) => selected.includes(c.id))
                        .map((c) => (
                          <span key={c.id}>
                            {label(c)}{" "}
                            <button
                              onClick={() => select(c.id)}
                              aria-label="حذف مخاطب"
                            >
                              ×
                            </button>
                          </span>
                        ))
                    : "ابتدا از بانک مراکز، مخاطبان را انتخاب کنید."}
                </div>
                <label>قالب آماده</label>
                <select
                  onChange={(e) =>
                    setBody(
                      e.target.value === "intro"
                        ? `Dear Hiring Team,\n\nI am writing to express my interest in suitable medical practitioner opportunities at your practice. Please let me know your current requirements, supervision arrangements and whether sponsorship is available.\n\nKind regards,\n${arash ? "Dr Arash Entezar" : "Dr Amir Houshang Gerami"}`
                        : "",
                    )
                  }
                >
                  <option value="">انتخاب قالب…</option>
                  <option value="intro">معرفی اولیه و استعلام شرایط</option>
                </select>
                <label htmlFor="subject">موضوع</label>
                <input
                  id="subject"
                  dir="ltr"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
                <label htmlFor="body">متن ایمیل</label>
                <textarea
                  id="body"
                  dir="ltr"
                  rows="12"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message…"
                />
                <div className="form-actions">
                  <button className="primary" onClick={saveDraft}>
                    <FileText size={16} /> ذخیرهٔ پیش‌نویس
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      navigator.clipboard?.writeText(body);
                      notify("متن برای کپی آماده شد");
                    }}
                  >
                    <Copy size={16} /> کپی متن
                  </button>
                </div>
                <p className="muted">
                  پیوست و ارسال واقعی، پس از راه‌اندازی OAuth و انتخاب CV
                  تأییدشده فعال می‌شود.
                </p>
                <GoogleSendPanel person={person} selected={selected} subject={subject} body={body} connection={mailConnection} mailbox={composeMailbox} replyContext={replyContext} notify={notify}/>
                <Presets
                  person={person}
                  subject={subject}
                  body={body}
                  onChoose={(v) => {
                    setSubject(v.subject);
                    setBody(v.body);
                  }}
                  notify={notify}
                />
              </section>
              <section className="panel">
                <GoogleInbox person={person} connection={googleConnection} onSettings={()=>setTab("settings")} notify={notify} onReply={message=>{
                  setSelected([]);
                  const mailbox=message.mailbox === "secondary" ? "secondary" : "primary";
                  setComposeMailbox(mailbox);if(mailbox === "secondary")secondaryGoogleConnection.refresh();
                  setReplyContext({messageId:message.id,threadId:message.threadId,to:message.from||"",mailbox});
                  setSubject(/^re:/i.test(message.subject||"")?message.subject:"Re: "+(message.subject||""));
                  setBody("\n\n"+(message.plainBody||message.body||message.snippet||"").split("\n").map(line=>"> "+line).join("\n"));
                }}/>
                <h3>پیش‌نویس‌های این پروفایل</h3>
                {drafts.map((d, i) => (
                  <div className="agent-row" key={i}>
                    <FileText size={16} />
                    <MixedText>{d.subject || subject}</MixedText>
                    <span className="status">ذخیره شد</span>
                  </div>
                ))}
              </section>
            </div>
          )}
          {tab === "cv" && (
            <>
              <ProfilePlanning profile={profile} />
              <section className="upgrade-banner">
                <div>
                  <div className="eyebrow">YOUR NEXT PROFESSIONAL EDGE</div>
                  <h2>یک قدم حرفه‌ای‌تر، هر روز.</h2>
                  <p>
                    پیشنهاد دوره و دستاورد باید با منبع معتبر و پس از تأیید شما
                    وارد رزومه شود.
                  </p>
                </div>
                <GraduationCap size={65} />
              </section>
              <div className="two-col">
                <section className="panel">
                  <div className="section-head">
                    <h3>پروفایل و رزومهٔ حرفه‌ای</h3>
                    <FileText size={21} />
                  </div>
                  <h2>{name}</h2>
                  <p>
                    {arash
                      ? "پزشک عمومی · متقاضی فرصت‌های استرالیا"
                      : profile?.planning?.training?.currentStatus === "internal_medicine_resident" ? "پزشک در حال آموزش تخصصی داخلی · بررسی مسیر استرالیا" : "بررسی مسیر تخصص داخلی در استرالیا"}
                  </p>
                  <div className="cv-details">
                    <span>وضعیت اطلاعات</span>
                    <b>
                      {profile?.cvText
                        ? "واردشده از اسناد اولیه"
                        : "نیازمند تکمیل"}
                    </b>
                    <span>وضعیت خروجی نهایی</span>
                    <b>نیازمند بازبینی انسانی</b>
                    <span>همگام‌سازی خودکار دستاوردها</span>
                    <b>در انتظار اتصال منابع</b>
                  </div>
                  <button className="primary" onClick={()=>download("txt")}>
                    <ArrowDownToLine size={16} /> دریافت TXT پروفایل
                  </button>
                  <button className="secondary" onClick={()=>download("pdf")}><ArrowDownToLine size={16}/> دریافت PDF پروفایل</button>
                  <p className="muted">
                    نسخه‌های نام‌گذاری‌شده و خروجی DOCX از بخش پایین در
                    دسترس‌اند؛ خروجی PDF هنوز فعال نیست.
                  </p>
                </section>
                <section className="panel">
                  <h3>گام‌های ارتقای رزومه</h3>
                  {[
                    "تأیید تاریخ و نتیجهٔ آزمون زبان و AMC",
                    "بررسی اعتبار و تاریخ دوره‌های احیا و مهارت بالینی",
                    "تطبیق سوابق شغلی با الزامات موقعیت هدف",
                  ].map((x, i) => (
                    <div className="step" key={x}>
                      <span className="step-num">{i + 1}</span>
                      <div>
                        <strong>{x}</strong>
                        <small>
                          پیشنهاد اولیه؛ مدرک یا واجدشرایط‌بودن تأیید نشده است
                        </small>
                      </div>
                    </div>
                  ))}
                  <button
                    className="secondary"
                    onClick={() => setTab("sources")}
                  >
                    بررسی منابع رسمی <ExternalLink size={15} />
                  </button>
                </section>
              </div>
              <CVVersions person={person} notify={notify} />
            </>
          )}
          {tab === "pesci" &&
            (arash ? (
              <PesciPractice person={person} notify={notify}/>
            ) : (
              <RoadmapPanel person={person} category="pathways" notify={notify} cloud={cloud}/>
            ))}
          {tab === "linkedin" && <LinkedInWorkspace person={person} notify={notify}/> }
          {tab === "sources" && <><ExtractedEvidence person={person} section="all" country="AU"/>{person==="amir"&&<ExtractedEvidence person={person} section="all" country="IT"/>}</>}
          {tab === "cv" && <ExtractedEvidence person={person} section="development" country="AU"/>}
          {tab === "roadmap" && <><RoadmapPanel key={person+":pathways"} person={person} category="pathways" notify={notify} cloud={cloud} /><ExtractedEvidence person={person} section="pathway" country="AU"/>{person==="amir"&&<ExtractedEvidence person={person} section="pathway" country="IT"/>}</>}
          {tab === "study" && person === "amir" && <><RoadmapPanel key={person+":study"} person={person} category="study" notify={notify} cloud={cloud} /><ExtractedEvidence person={person} section="study" country="IT"/><ExtractedEvidence person={person} section="study" country="AU"/></>}
          {tab === "development" && <><RoadmapPanel key={person+":development"} person={person} category="development" notify={notify} cloud={cloud} /><ExtractedEvidence person={person} section="development" country="AU"/>{person==="amir"&&<ExtractedEvidence person={person} section="development" country="IT"/>}</>}
          {tab === "sources" && (
            <>
              <div className="notice">
                اطلاعات مسیر مهاجرت و ثبت پزشکی باید در زمان اقدام از مرجع رسمی
                بررسی شود. این فهرست نقطهٔ شروع است.
                <button className="text-button" onClick={()=>setTab("roadmap")}>مطالعهٔ تحلیل منابع و برنامهٔ شخصی</button>
              </div>
              <div className="source-grid">
                {sourceLinks.map(([a, b, url]) => (
                  <a
                    className="panel source-card"
                    key={a}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Globe size={27} />
                    <h3 dir="ltr">{a}</h3>
                    <p>{b}</p>
                    <span>
                      مشاهدهٔ مرجع رسمی <ExternalLink size={15} />
                    </span>
                  </a>
                ))}
              </div>
              <SourceMonitor key={person} person={person} onOpportunities={()=>setTab("opportunities")}/>
            </>
          )}
          {tab === "automation" && <AutomationHub key={person+":"+automationTab} person={person} initialTab={automationTab} onNavigate={setTab} notify={notify}/>}
          {tab === "settings" && (
            <div className="settings-workspace">
              <nav className="settings-shortcuts" aria-label="بخش‌های تنظیمات"><a href="#email-templates">قالب‌های ایمیل</a><a href="#cv-defaults">رزومهٔ پیش‌فرض</a><a href="#service-connections">اتصال حساب‌ها</a><a href="#calendar-documents">تقویم و مدارک</a></nav>
              <div id="email-templates"><EmailTemplateSettings key={person} person={person} notify={notify}/></div>
              <div className="settings-secondary-grid"><div id="cv-defaults"><CVVersions key={person} person={person} notify={notify}/></div>
              <section className="panel">
                <h3>سیاست مکاتبات</h3>
                <label className="policy">
                  <input
                    type="radio"
                    name="policy"
                    checked={policy === "approval_required"}
                    onChange={() => setPolicy("approval_required")}
                  />
                  <span>
                    <strong>تأیید پیش از ارسال</strong>
                    <small>فرصت‌ها اعلام شوند؛ تصمیم ارسال با شما باشد.</small>
                  </span>
                </label>
                <label className="policy">
                  <input
                    type="radio"
                    name="policy"
                    checked={policy === "auto_after_connection"}
                    onChange={() => setPolicy("auto_after_connection")}
                  />
                  <span>
                    <strong>ارسال با قالب پیش‌فرض</strong>
                    <small>
                      پس از اتصال Gmail و تعریف محدودیت‌های ارسال قابل فعال‌سازی
                      است.
                    </small>
                  </span>
                </label>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await api("settings?profile=" + person, {
                        method: "PUT",
                        body: JSON.stringify({
                          profileId: person,
                          profile_id: person,
                          emailPolicy: policy,
                          policy,
                          autoSend: false,
                        }),
                      });
                      notify(
                        "ترجیح ذخیره شد؛ ارسال خودکار تا اتصال و پیکربندی فعال نیست",
                      );
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  ذخیرهٔ ترجیح <Check size={17} />
                </button>
                <div className="agent-note">
                  {cloud
                    ? "دسترسی این حساب در سمت سرور و پایگاه داده کنترل می‌شود؛ انتخاب پروفایل دیگر در این نما فعال نیست."
                    : "تعویض پروفایل در نسخهٔ محلی، احراز هویت نیست. پیش از انتشار داده‌های خصوصی، ورود امن و کنترل دسترسی باید فعال شود."}
                </div>
              </section>
              </div>
              <section id="service-connections" className="panel settings-connections">
                <div className="section-head"><div><h3>اتصال حساب‌ها و سرویس‌ها</h3><p className="muted">هر اتصال فقط متعلق به همین کاربر است.</p></div></div>
                <div className="settings-connection-grid">
                  <GoogleConnection person={person} connection={googleConnection} notify={notify}/>
                  {person === "amir" && <GoogleConnection person={person} mailbox="secondary" connection={secondaryGoogleConnection} notify={notify}/>}
                  <div className="settings-system-services">{[
                    ["تلگرام", "فرصت‌های تازه و یادآوری پیگیری‌ها را در تلگرام خودتان دریافت کنید.", "telegram"],
                    ["پایش منابع", "سرور منابع کاری و دانشگاهی را دوره‌ای بررسی و آگهی‌های تازه را ثبت می‌کند. فیلترهای نمایش را در بخش فرصت‌ها انتخاب کنید.", "crawler"],
                    ["هوش مصنوعی", "برای بررسی متن آگهی یا بهترکردن پیش‌نویس، موضوع و متن را خودتان انتخاب کنید. خروجی پیشنهادی است؛ چیزی ارسال نمی‌شود.", "ai"],
                  ].map(([a,b,key])=><div className="integration" key={a}><span className="clinic-icon"><Globe size={20}/></span><div><strong>{a}</strong><small>{b}</small></div><span className={"status "+(data.integrations?.[key]?.connected?"":"amber")}>{data.integrations?.[key]?.connected?(key==="telegram"&&!data.integrations.telegram.enabled?"متصل؛ اعلان خاموش":"آماده"):"نیازمند راه‌اندازی"}</span></div>)}<div className="settings-tool-actions"><button className="secondary" onClick={()=>{setAutomationTab("telegram");setTab("automation");}}>اتصال تلگرام من</button><button className="secondary" onClick={()=>{setAutomationTab("operations");setTab("automation");}}>وضعیت منابع و جست‌وجو</button><button className="secondary" onClick={()=>{setAutomationTab("ai");setTab("automation");}}>کمک برای بررسی و نوشتن</button><button className="text-button" onClick={()=>{setAutomationTab("backup");setTab("automation");}}>پشتیبان اطلاعات من</button></div></div>
                </div>
              </section>
              <div id="calendar-documents" className="settings-calendar-wide"><CalendarDriveTools key={person+":"+Boolean(googleConnection.state.connected)+":"+(googleConnection.state.email||"")} person={person} notify={notify}/></div>
            </div>
          )}
          <footer>
            <span>مسیر · فضای یکپارچهٔ مهاجرت پزشکی</span>
            <span>
              ساخته‌شده برای قدم‌های واقعی <span className="dot green" />
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className={"toast "+(/oauth_|خطا|ناموفق|انجام نشد|متصل نشد|failed|required|unavailable|rejected/i.test(String(toast))?"toast-error":"")} role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button onClick={() => setToast("")} aria-label="بستن">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({ icon: Icon, value, title, sub }) {
  return (
    <section className="stat">
      <div className="stat-top">
        <span>{title}</span>
        <Icon size={20} />
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </section>
  );
}
createRoot(document.getElementById("root")).render(
  <AccessGate>{(props) => <App key={props.initialPerson || "local"} {...props} />}</AccessGate>,
);
