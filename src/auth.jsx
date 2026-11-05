import React, { useEffect, useRef, useState } from "react";
import { KeyRound, LogIn, Mail, RefreshCw } from "lucide-react";
import { api, setAccessToken } from "./api";
import { consumeAuthCallback, recoveryRedirect, passwordProblem, passwordUpdateError } from './auth-recovery.mjs';

export function AccessGate({ children }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [callback, setCallback] = useState(() => consumeAuthCallback(location.href, value => history.replaceState(null, '', value)));
  const [view, setView] = useState(callback.kind === 'recovery' ? 'validating' : callback.kind === 'invalid' ? 'forgot' : 'login');
  const [recovery, setRecovery] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const recoveryLink = useRef(callback.kind === 'recovery' ? callback : null);
  const recoveryStarted = useRef(false);
  // A completed request from a previous login/refresh must never restore a
  // signed-out identity or overwrite the next doctor's session.
  const authEpoch = useRef(0);
  const mounted = useRef(true);
  const isCurrentAuth = (epoch) => mounted.current && authEpoch.current === epoch;
  async function loadConfig() {
    setBusy(true);
    setError("");
    try {
      const result = await api("public-config");
      if (
        result.mode === "local_demo" &&
        result.authRequired === false &&
        ["localhost", "127.0.0.1"].includes(location.hostname)
      )
        setConfig(result);
      else if (
        result.authRequired === true &&
        result.supabaseUrl &&
        result.publishableKey &&
        new URL(result.supabaseUrl).protocol === "https:"
      )
        setConfig(result);
      else
        throw Error("پیکربندی ورود امن کامل نیست. دسترسی به داده‌ها بسته است.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setCallback({ kind: callback.kind });
    loadConfig();
    if (callback.kind === 'invalid') setError('این لینک بازیابی معتبر نیست یا اعتبار آن پایان یافته است. دوباره لینک بگیرید.');
    if (callback.kind === 'confirmation') setInfo('ایمیل تأیید شد. اکنون با ایمیل و رمز حساب خود وارد شوید.');
    return () => {
      mounted.current = false;
      authEpoch.current++;
      recoveryLink.current = null;
      setAccessToken("");
    };
  }, []);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => { const now = Date.now(); setClock(now); if (now >= retryAt) setRetryAt(0); }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  useEffect(() => {
    if (!config || !recoveryLink.current || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const link = recoveryLink.current;
    recoveryLink.current = null;
    const epoch = ++authEpoch.current;
    setAccessToken('');
    setSession(null);
    setBusy(true);
    (async () => {
      try {
        if (config.mode === 'local_demo' || link.expiresAt <= Date.now()) throw Error();
        const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${link.accessToken}` },
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw Error();
        const user = await response.json();
        if (!user.id || !user.email || link.expiresAt <= Date.now()) throw Error();
        if (!isCurrentAuth(epoch)) return;
        setRecovery({ ...link, userId: user.id, email: user.email });
        setView('reset');
      } catch {
        if (isCurrentAuth(epoch)) {
          setRecovery(null);
          setView('forgot');
          setError('لینک بازیابی تأیید نشد. اگر منقضی شده یا قبلاً استفاده شده، دوباره لینک بگیرید.');
        }
      } finally { if (isCurrentAuth(epoch)) setBusy(false); }
    })();
  }, [config]);
  function changeView(next) {
    authEpoch.current++;
    recoveryLink.current = null;
    setRecovery(null);
    setNewPassword('');
    setConfirmation('');
    setPassword('');
    setError('');
    setInfo('');
    setView(next);
    setBusy(false);
  }
  async function requestRecovery(event) {
    event.preventDefault();
    if (busy || Date.now() < retryAt) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('ایمیل حسابی را که با آن وارد سایت می‌شوید وارد کنید.'); return;
    }
    const epoch = ++authEpoch.current;
    setBusy(true); setError(''); setInfo('');
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(recoveryRedirect(location.href))}`, {
        method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }), redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (!isCurrentAuth(epoch)) return;
      setRetryAt(Date.now() + 60000); setClock(Date.now());
      if (!response.ok) throw Error(response.status === 429
        ? 'تعداد درخواست‌ها زیاد شده است. چند دقیقه صبر کنید و دوباره امتحان کنید.'
        : 'درخواست بازیابی ارسال نشد. اتصال را بررسی کنید یا کمی بعد دوباره امتحان کنید.');
      setInfo('اگر حسابی با این ایمیل وجود داشته باشد، لینک بازیابی برای آن ارسال می‌شود. پوشهٔ Spam را هم بررسی کنید؛ برای تغییر رمز، لینک داخل ایمیل را باز کنید.');
    } catch (e) {
      if (isCurrentAuth(epoch)) setError(e.name === 'TypeError' || e.name === 'TimeoutError' ? 'ارتباط برقرار نشد. اتصال را بررسی کنید و دوباره امتحان کنید.' : e.message);
    } finally { if (isCurrentAuth(epoch)) setBusy(false); }
  }
  async function updatePassword(event) {
    event.preventDefault();
    if (busy || !recovery) return;
    const problem = passwordProblem(newPassword, confirmation);
    if (problem) { setError(problem); return; }
    if (recovery.expiresAt <= Date.now()) {
      changeView('forgot'); setError('اعتبار لینک بازیابی پایان یافته است. دوباره لینک بگیرید.'); return;
    }
    const epoch = ++authEpoch.current, current = recovery;
    setBusy(true); setError(''); setInfo('');
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: config.publishableKey, Authorization: `Bearer ${current.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }), redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (!isCurrentAuth(epoch)) return;
      if (!response.ok) {
        let code; try { code = (await response.json()).code; } catch {}
        const message = passwordUpdateError(response.status, code);
        if (response.status === 401 || response.status === 403) { setRecovery(null); setView('forgot'); setNewPassword(''); setConfirmation(''); }
        throw Error(message);
      }
      setRecovery(null); setNewPassword(''); setConfirmation(''); setPassword(''); setAccessToken('');
      setEmail(current.email); setView('login');
      setInfo('رمز عبور تغییر کرد. اکنون با رمز جدید وارد شوید.');
      // Revoke refresh sessions after success; do not persist or bootstrap a
      // workspace using a recovery token, even if logout transport fails.
      try {
        await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: 'POST',
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${current.accessToken}` },
          redirect: 'error', signal: AbortSignal.timeout(10000) });
      } catch {}
    } catch (e) {
      if (isCurrentAuth(epoch)) setError(e.name === 'TypeError' || e.name === 'TimeoutError' ? 'پاسخ سرور دریافت نشد. برای اطمینان، با رمز جدید ورود را امتحان کنید؛ در صورت نیاز لینک تازه بگیرید.' : e.message);
    } finally { if (isCurrentAuth(epoch)) setBusy(false); }
  }
  async function tokenRequest(grant, payload) {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/token?grant_type=${grant}`,
      {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok)
      throw Error(
        "ورود انجام نشد. ایمیل، رمز عبور و فعال‌بودن حساب را بررسی کنید.",
      );
    return response.json();
  }
  async function openSession(tokens, epoch) {
    if (!isCurrentAuth(epoch)) return false;
    try {
      // Use this response's token explicitly, rather than a mutable global
      // bearer that may already belong to a newer session.
      const bootstrap = await api("me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!isCurrentAuth(epoch)) return false;
      const profileId =
        bootstrap.currentProfileId ||
        bootstrap.profileId ||
        bootstrap.profiles?.[0]?.id;
      if (!["arash", "amir"].includes(profileId))
        throw Error("حساب به هیچ فضای کاری مجاز متصل نشده است.");
      setAccessToken(tokens.access_token);
      setSession({
        ...tokens,
        profileId,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      });
      return true;
    } catch (e) {
      if (isCurrentAuth(epoch)) {
        setAccessToken("");
        setSession(null);
      }
      throw e;
    }
  }
  async function login(event) {
    event.preventDefault();
    const epoch = ++authEpoch.current;
    setBusy(true);
    setError("");
    try {
      await openSession(await tokenRequest("password", { email, password }), epoch);
      if (isCurrentAuth(epoch)) setPassword("");
    } catch (e) {
      if (isCurrentAuth(epoch)) setError(e.message);
    } finally {
      if (isCurrentAuth(epoch)) setBusy(false);
    }
  }
  async function signup() {
    setError("");
    setInfo("");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 12
    ) {
      setError("ایمیل معتبر و رمز عبور حداقل ۱۲ کاراکتری وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${config.supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(recoveryRedirect(location.href))}`,
        {
          method: "POST",
          headers: {
            apikey: config.publishableKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: email.trim(), password }),
        },
      );
      if (!response.ok)
        throw Error(
          "ثبت درخواست ساخت حساب انجام نشد؛ کمی بعد دوباره امتحان کنید یا وضعیت حساب را بررسی کنید.",
        );
      setPassword("");
      setInfo(
        "درخواست ساخت حساب ثبت شد. ایمیل تأیید را بررسی کنید؛ پس از تأیید و مجازشدن حساب، از همین صفحه وارد شوید.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    const current = session;
    authEpoch.current++;
    setSession(null);
    setAccessToken("");
    setPassword("");
    if (current && config?.supabaseUrl) {
      try {
        await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${current.access_token}`,
          },
        });
      } catch {}
    }
  }
  useEffect(() => {
    if (!session) return;
    const epoch = authEpoch.current;
    const timer = setTimeout(
      async () => {
        try {
          await openSession(
            await tokenRequest("refresh_token", {
              refresh_token: session.refresh_token,
            }),
            epoch,
          );
        } catch {
          if (isCurrentAuth(epoch)) {
            setSession(null);
            setAccessToken("");
            setError("نشست پایان یافت؛ دوباره وارد شوید.");
          }
        }
      },
      Math.max(1000, session.expiresAt - Date.now() - 60000),
    );
    return () => clearTimeout(timer);
  }, [session]);
  if (config?.mode === "local_demo")
    return children({
      cloud: false,
      initialPerson: "arash",
      onSignOut: logout,
    });
  if (session)
    return children({
      cloud: true,
      initialPerson: session.profileId,
      onSignOut: logout,
    });
  return (
    <div className="access-screen" dir="rtl">
      <section className="panel access-card">
        <div className="access-brand">
          <img src="/brand-aa-180.png" alt="AA" width="64" height="64" style={{borderRadius:14}}/>
          <h1>مسیر</h1>
        </div>
        <h2>{view === 'forgot' ? 'بازیابی رمز عبور' : view === 'reset' ? 'تعیین رمز عبور جدید' : view === 'validating' ? 'بررسی لینک بازیابی' : 'ورود به فضای کاری پزشکی'}</h2>
        <p>
          {view === 'forgot' ? 'ایمیل ورود به سایت را وارد کنید. ایمیل‌های متصل به Gmail ممکن است با ایمیل ورود شما متفاوت باشند.'
            : view === 'reset' ? 'برای حساب تأییدشدهٔ زیر، رمز جدیدی انتخاب کنید. حساب و اتصال‌های شما حفظ می‌شوند.'
            : view === 'validating' ? 'لطفاً صبر کنید؛ اعتبار لینک شما در حال بررسی است.'
            : 'هر پزشک با حساب خودش وارد می‌شود. اطلاعات خصوصی فقط در فضای مجاز همان حساب در دسترس است.'}
        </p>
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        {info && (
          <div className="notice" role="status">
            {info}
          </div>
        )}
        {config && view === 'forgot' ? (
          <form onSubmit={requestRecovery}>
            <label htmlFor="recovery-email">ایمیل ورود به سایت</label>
            <input id="recovery-email" type="email" autoComplete="username" dir="ltr" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
            <button className="primary" disabled={busy || clock < retryAt} type="submit"><Mail size={17}/>{busy ? 'در حال ارسال…' : clock < retryAt ? `ارسال دوباره پس از ${Math.ceil((retryAt-clock)/1000)} ثانیه` : 'ارسال لینک بازیابی'}</button>
            <button className="secondary" disabled={busy} type="button" onClick={() => changeView('login')}>بازگشت به ورود</button>
          </form>
        ) : config && view === 'reset' && recovery ? (
          <form onSubmit={updatePassword}>
            <p className="recovery-identity" dir="ltr">{recovery.email}</p>
            <label htmlFor="new-password">رمز جدید</label>
            <input id="new-password" type="password" autoComplete="new-password" dir="ltr" minLength={12} maxLength={128} required value={newPassword} onChange={e => setNewPassword(e.target.value)} aria-describedby="password-help" />
            <label htmlFor="confirm-password">تکرار رمز جدید</label>
            <input id="confirm-password" type="password" autoComplete="new-password" dir="ltr" minLength={12} maxLength={128} required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
            <p className="muted" id="password-help">حداقل ۱۲ کاراکتر؛ ترکیبی از حروف، عدد و نشانه انتخاب کنید. پس از ثبت، به صفحهٔ ورود برمی‌گردید.</p>
            <button className="primary" disabled={busy} type="submit"><KeyRound size={17}/>{busy ? 'در حال ثبت…' : 'ثبت رمز جدید'}</button>
            <button className="secondary" disabled={busy} type="button" onClick={() => changeView('login')}>انصراف و بازگشت به ورود</button>
          </form>
        ) : config && view === 'validating' ? <p role="status">در حال بررسی اعتبار لینک…</p> : config ? (
          <form onSubmit={login}>
            <label htmlFor="login-email">ایمیل حساب</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="login-password">رمز عبور</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="primary" disabled={busy} type="submit">
              <LogIn size={17} />
              {busy ? "در حال ورود…" : "ورود امن"}
            </button>
            <button className="text-button recovery-link" type="button" disabled={busy} onClick={() => changeView('forgot')}><KeyRound size={16}/>رمز عبور را فراموش کرده‌ام</button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={signup}
            >
              ساخت حساب و ارسال ایمیل تأیید
            </button>
            <p className="muted">
              برای حساب جدید، ایمیل و رمز حداقل ۱۲ کاراکتری وارد کنید و دکمهٔ
              ساخت حساب را بزنید؛ این اقدام ممکن است ایمیل تأیید برای شما ارسال
              کند. فقط ایمیل‌های ازپیش‌مجازشده به فضای کاری دسترسی می‌گیرند.
              نشست فقط در حافظهٔ همین صفحه نگهداری می‌شود.
            </p>
          </form>
        ) : (
          <button className="secondary" disabled={busy} onClick={loadConfig}>
            <RefreshCw size={16} />
            {busy ? "بررسی اتصال…" : "تلاش دوباره"}
          </button>
        )}
      </section>
    </div>
  );
}
