import React, { useEffect, useRef, useState } from "react";
import { Activity, LogIn, RefreshCw } from "lucide-react";
import { api, setAccessToken } from "./api";

export function AccessGate({ children }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    loadConfig();
    return () => {
      mounted.current = false;
      authEpoch.current++;
      setAccessToken("");
    };
  }, []);
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
        `${config.supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(location.origin)}`,
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
        <h2>ورود به فضای کاری پزشکی</h2>
        <p>
          هر پزشک با حساب خودش وارد می‌شود. اطلاعات خصوصی فقط در فضای مجاز همان
          حساب در دسترس است.
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
        {config ? (
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
