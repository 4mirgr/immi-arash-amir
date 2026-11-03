import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
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
import sourceRegistry from "../library/sources.json";
const nav = [
  ["overview", "نمای کلی", LayoutDashboard],
  ["opportunities", "رصد فرصت‌ها", Search],
  ["mail", "مرکز مکاتبات", Mail],
  ["cv", "توسعه رزومه", FileText],
  ["pesci", "آکادمی PESCI", GraduationCap],
  ["sources", "منابع و مسیرها", BookOpen],
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
  function download() {
    if (!profile) {
      notify("اطلاعات رزومه هنوز از سرور دریافت نشده است");
      return;
    }
    if (!profile.cvText) {
      notify("متن رزومهٔ این پروفایل هنوز تکمیل نشده است");
      return;
    }
    const text = profile.cvText;
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
    <div className={"app " + (!arash ? "amir" : "")}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <Activity />
          </span>
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
                : "متخصص داخلی · مسیر استرالیا"}
            </small>
          </div>
          {!cloud && <span className="switch">⇄</span>}
        </button>
        <div className="demo-label">
          {cloud
            ? "ورود امن · دسترسی محدود به حساب شما"
            : "تعویض نمای آزمایشی · ورود امن هنوز متصل نیست"}
        </div>
        <nav>
          {nav.map(([id, title, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? "active" : ""}
            >
              <Icon size={19} />
              <span>
                {!arash && id === "pesci" ? "مسیر تخصص و ارزیابی" : title}
              </span>
              {id === "opportunities" && <b>{clinics.length}</b>}
            </button>
          ))}
        </nav>
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
        <div className="page">
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
                {tab === "overview"
                  ? "از کشف فرصت تا آمادگی حرفه‌ای؛ قدم بعدی را آگاهانه بردارید."
                  : "داده‌های قابل پیگیری، تصمیم‌های روشن، پیشرفت مستمر."}
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
          {tab === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="pill">
                    {arash ? "STANDARD PATHWAY" : "SPECIALIST PATHWAY"}{" "}
                    <span>•</span> AUSTRALIA
                  </div>
                  <h2>
                    {arash ? (
                      <>
                        آیندهٔ پزشکی شما،
                        <br />
                        <em>از همین‌جا شروع می‌شود.</em>
                      </>
                    ) : (
                      <>
                        تخصص شما،
                        <br />
                        <em>افق‌های تازه در استرالیا.</em>
                      </>
                    )}
                  </h2>
                  <p>
                    {arash
                      ? "فرصت‌های کاری را بررسی کنید، رزومه را آماده نگه دارید و برای PESCI تمرین کنید."
                      : "مسیر ارزیابی تخصص داخلی، فرصت‌های بیمارستانی و شرایط ثبت پزشکی را مستند دنبال کنید."}
                  </p>
                  <button
                    className="primary"
                    onClick={() => setTab("opportunities")}
                  >
                    کاوش فرصت‌ها <ArrowLeft size={17} />
                  </button>
                </div>
                <div className="orbit">
                  <div className="orbit-ring r1" />
                  <div className="orbit-ring r2" />
                  <div className="australia">
                    AU
                    <span>
                      BUILD YOUR
                      <br />
                      NEXT CHAPTER
                    </span>
                  </div>
                  <span className="orbit-point p1" />
                  <span className="orbit-point p2" />
                  <div className="floating-badge">
                    <ShieldCheck size={18} />
                    <span>تصمیم بر پایهٔ منابع رسمی</span>
                  </div>
                </div>
              </section>
              <div className="stats">
                <Stat
                  icon={BriefcaseBusiness}
                  value={clinics.length.toLocaleString("fa")}
                  title="مرکز در بانک اطلاعات"
                  sub="سرنخ تماس؛ آگهی تأییدشده نیست"
                />
                <Stat
                  icon={Mail}
                  value={drafts.length.toLocaleString("fa")}
                  title="پیش‌نویس این پروفایل"
                  sub="ارسال فقط پس از اتصال Gmail"
                />
                <Stat
                  icon={FileText}
                  value={profile ? "۱" : "—"}
                  title="پروفایل حرفه‌ای"
                  sub={
                    profile?.cvText
                      ? "دادهٔ اولیه وارد شده"
                      : "رزومه هنوز دریافت نشده"
                  }
                />
                <Stat
                  icon={GraduationCap}
                  value={arash ? "۱" : "—"}
                  title={arash ? "ایستگاه تمرینی" : "ارزیابی تخصص"}
                  sub={arash ? "نمونه آموزشی، غیررسمی" : "نیازمند بررسی RACP"}
                />
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <span className="eyebrow">YOUR NEXT STEPS</span>
                      <h3>قدم‌های بعدی شما</h3>
                    </div>
                    <span className="tag">شروع مسیر</span>
                  </div>
                  <div className="steps">
                    {(arash
                      ? [
                          [
                            "تأیید اطلاعات حرفه‌ای",
                            "مدارک، تاریخ‌ها و وضعیت آزمون‌ها",
                            "cv",
                          ],
                          [
                            "بررسی مراکز و فرصت‌ها",
                            "فیلتر داده‌ها و ساخت فهرست هدف",
                            "opportunities",
                          ],
                          [
                            "تمرین ارائهٔ بالینی",
                            "یک ایستگاه آموزشی PESCI",
                            "pesci",
                          ],
                        ]
                      : [
                          [
                            "تکمیل رزومه تخصصی",
                            "سوابق داخلی، بورد و برنامهٔ آموزشی",
                            "cv",
                          ],
                          [
                            "مطالعهٔ مسیر ارزیابی تخصص",
                            "تفکیک ارزیابی کالج از استخدام",
                            "sources",
                          ],
                          [
                            "بررسی موقعیت‌های بیمارستانی",
                            "پیگیری شرایط ثبت و سطح شغلی",
                            "opportunities",
                          ],
                        ]
                    ).map(([a, b, t], i) => (
                      <button
                        className="step"
                        key={a}
                        onClick={() => setTab(t)}
                      >
                        <span className="step-num">{i + 1}</span>
                        <div>
                          <strong>{a}</strong>
                          <small>{b}</small>
                        </div>
                        <ChevronLeft size={17} />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel agents">
                  <div className="section-head">
                    <div>
                      <span className="eyebrow">WORKFLOW HEALTH</span>
                      <h3>وضعیت دستیارها</h3>
                    </div>
                    <Activity size={20} />
                  </div>
                  {[
                    [
                      "واردسازی بانک مراکز",
                      online ? "دادهٔ سرور در دسترس" : "منتظر سرور",
                    ],
                    ["پایش منابع و فرصت‌ها", "نیازمند اتصال منبع"],
                    ["دستیار مکاتبات", "نیازمند اتصال Gmail"],
                    ["هماهنگی تقویم", "نیازمند اتصال Google"],
                  ].map(([a, b], i) => (
                    <div className="agent-row" key={a}>
                      <span
                        className={
                          "dot " + (i === 0 && online ? "green" : "amber")
                        }
                      />
                      <span>{a}</span>
                      <small>{b}</small>
                    </div>
                  ))}
                  <div className="agent-note">
                    <ShieldCheck size={16} /> هیچ ارسال یا جمع‌آوری خارجی بدون
                    اتصال فعال انجام نمی‌شود.
                  </div>
                </section>
              </div>
            </>
          )}
          {(tab === "opportunities" || tab === "overview") && (
            <section className="panel opportunities">
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
            </section>
          )}
          {tab === "mail" && (
            <div className="two-col compose-grid">
              <section className="panel">
                <div className="section-head">
                  <h3>پیش‌نویس مکاتبه</h3>
                  <span className="tag">Gmail متصل نیست</span>
                </div>
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
                <h3>صندوق هوشمند</h3>
                <div className="empty">
                  <Mail size={34} />
                  <h3>ابتدا حساب Google را متصل کنید</h3>
                  <p>
                    خواندن پاسخ‌ها، تشخیص قوت مکاتبه و پیگیری رشتهٔ ایمیل به
                    مجوز حساب خودتان نیاز دارد.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setTab("settings")}
                  >
                    بررسی اتصال‌ها <ArrowLeft size={15} />
                  </button>
                </div>
                <h3>پیش‌نویس‌های این پروفایل</h3>
                {drafts.map((d, i) => (
                  <div className="agent-row" key={i}>
                    <FileText size={16} />
                    {d.subject || subject}
                    <span className="status">ذخیره شد</span>
                  </div>
                ))}
              </section>
            </div>
          )}
          {tab === "cv" && (
            <>
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
                      : "متخصص داخلی · بررسی مسیر تخصص استرالیا"}
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
                  <button className="primary" onClick={download}>
                    <ArrowDownToLine size={16} /> دانلود اطلاعات پروفایل
                  </button>
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
              <div className="two-col">
                <section className="panel station">
                  <div className="section-head">
                    <div>
                      <span className="eyebrow">
                        CLINICAL COMMUNICATION LAB
                      </span>
                      <h3>تمرین ارائهٔ بالینی</h3>
                    </div>
                    <span className="tag">نمونهٔ آموزشی</span>
                  </div>
                  <div className="notice">
                    این تمرین ساخته‌شده برای آموزش است؛ سؤال رسمی یا بازسازی
                    تأییدشدهٔ آزمون نیست. زمان قابل تنظیم است.
                  </div>
                  <div dir="ltr">
                    <small>{station.id}</small>
                    <h2>{station.title}</h2>
                    <p className="case-text">
                      {station.prompt ||
                        station.case ||
                        station.scenario ||
                        station.description ||
                        fallbackStation.case}
                    </p>
                  </div>
                  <div className="form-actions">
                    <button className="secondary" onClick={speak}>
                      <Volume2 size={17} /> خواندن انگلیسی
                    </button>
                    <select
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      aria-label="سرعت خواندن"
                    >
                      <option value="0.8">آهسته · 0.8×</option>
                      <option value="1">عادی · 1×</option>
                      <option value="1.2">سریع · 1.2×</option>
                    </select>
                    <button
                      className="text-button"
                      onClick={() => speechSynthesis.cancel()}
                    >
                      توقف صدا
                    </button>
                  </div>
                  <label>یادداشت پاسخ شما</label>
                  <textarea
                    rows="8"
                    placeholder="ارزیابی، مدیریت، ارتباط و برنامهٔ پیگیری…"
                  />
                </section>
                <section className="panel timer-panel">
                  <Clock size={30} />
                  <h3>زمان تمرین</h3>
                  <div className="timer" dir="ltr">
                    {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                    {String(seconds % 60).padStart(2, "0")}
                  </div>
                  <div className="form-actions">
                    <button
                      className="primary"
                      onClick={() => setRunning(!running)}
                    >
                      {running ? <Pause size={17} /> : <Play size={17} />}{" "}
                      {running ? "مکث" : "شروع تمرین"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSeconds(480);
                        setRunning(false);
                      }}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <label>مدت تمرین</label>
                  <select
                    onChange={(e) => {
                      setSeconds(Number(e.target.value));
                      setRunning(false);
                    }}
                    defaultValue="480"
                  >
                    <option value="300">۵ دقیقه</option>
                    <option value="480">۸ دقیقه</option>
                    <option value="600">۱۰ دقیقه</option>
                  </select>
                  <p className="muted">
                    مدت‌های بالا انتخاب تمرینی هستند؛ استاندارد جلسه را از
                    برگزارکننده بررسی کنید.
                  </p>
                  <h3>محورهای خودارزیابی</h3>
                  {[
                    "ایمنی بیمار و تشخیص فوریت",
                    "استدلال بالینی و مدیریت",
                    "ارتباط با بیمار و تیم",
                    "ارجاع و انتقال امن",
                  ].map((x) => (
                    <label className="checkline" key={x}>
                      <input type="checkbox" />
                      {x}
                    </label>
                  ))}
                </section>
              </div>
            ) : (
              <section className="panel">
                <h3>مسیر تخصص داخلی شما</h3>
                <p>
                  استخدام بیمارستانی، ثبت پزشکی و ارزیابی تخصص توسط کالج مراحل
                  متفاوتی هستند. پذیرش در سال مشخص رزیدنتی را نباید از پیشنهاد
                  همکاری نتیجه گرفت.
                </p>
                <a
                  className="primary link"
                  href="https://www.racp.edu.au/overseas-trained-physicians/international-medical-graduates/standard-specialist-assessment-pathway"
                  target="_blank"
                  rel="noreferrer"
                >
                  بررسی ارزیابی RACP <ExternalLink size={16} />
                </a>
                <p className="muted">
                  برای شخصی‌سازی این بخش، رزومه، برنامهٔ تخصص و وضعیت بورد شما
                  باید تکمیل شود.
                </p>
              </section>
            ))}
          {tab === "sources" && (
            <>
              <div className="notice">
                اطلاعات مسیر مهاجرت و ثبت پزشکی باید در زمان اقدام از مرجع رسمی
                بررسی شود. این فهرست نقطهٔ شروع است.
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
              <h3 className="portal-heading">
                درگاه‌های استخدام ایالت‌ها و قلمروها
              </h3>
              <p className="muted">
                این لینک‌ها درگاه‌های رسمی هستند؛ دریافت خودکار آگهی برای آن‌ها
                هنوز تنظیم نشده است.
              </p>
              <div className="source-grid">
                {sourceRegistry.map((source) => (
                  <a
                    className="panel source-card"
                    href={source.portalUrl}
                    key={source.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="tag">{source.state}</span>
                    <h3 dir="ltr">{source.name}</h3>
                    <span className="status amber">
                      خوراک خودکار تنظیم نشده · feed_not_configured
                    </span>
                    <p className="muted">
                      {source.portalCheck.includes("403")
                        ? "محتوای این درگاه به دلیل پاسخ ۴۰۳ تأیید نشده است."
                        : "درگاه بررسی شده؛ محتوای آگهی زنده دریافت نمی‌شود."}
                    </p>
                    <small>تاریخ بررسی: {source.checkedAt}</small>
                    <span>
                      بازکردن درگاه <ExternalLink size={15} />
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
          {tab === "settings" && (
            <div className="two-col">
              <section className="panel">
                <h3>اتصال سرویس‌ها</h3>
                {[
                  ["Google Workspace", "Gmail، Drive و Calendar"],
                  ["Telegram", "اعلان موقعیت‌ها و پیگیری‌ها"],
                  ["پایش منابع", "دریافت آگهی و تشخیص تغییر"],
                  ["هوش مصنوعی", "تولید و تحلیل با ارائه‌دهندهٔ انتخابی"],
                ].map(([a, b]) => (
                  <div className="integration" key={a}>
                    <span className="clinic-icon">
                      <Globe size={20} />
                    </span>
                    <div>
                      <strong>{a}</strong>
                      <small>{b}</small>
                    </div>
                    <span className="status amber">متصل نیست</span>
                  </div>
                ))}
                <div className="notice">
                  کلیدها و توکن‌ها فقط سمت سرور نگهداری می‌شوند. برای اتصال
                  Google، تنظیم OAuth و تأیید دسترسی هر حساب لازم است.
                </div>
              </section>
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
        <div className="toast" role="status">
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
  <AccessGate>{(props) => <App {...props} />}</AccessGate>,
);
