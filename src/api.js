let bearer = "";
let sessionGuard = null;
let sessionInvalidator = null;
export function setSessionGuard(guard, invalidator) { sessionGuard = typeof guard === "function" ? guard : null; sessionInvalidator = typeof invalidator === "function" ? invalidator : null; }
export function setAccessToken(value) {
  bearer = value || "";
}
export async function apiResponse(path, options = {}) {
  // Preflight only. Never replay a request (especially sends/schedules) after failure.
  const explicitAuthorization = new Headers(options.headers || {}).has('Authorization');
  if (sessionGuard && path !== 'public-config' && !explicitAuthorization) await sessionGuard();
  const requestBearer=bearer;
  const response = await fetch("/api/" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(requestBearer ? { Authorization: `Bearer ${requestBearer}` } : {}),
      ...options.headers,
    },
    cache: "no-store",
    ...(!options.signal && (!options.method || options.method.toUpperCase()==='GET') ? {signal:AbortSignal.timeout(20000)} : {}),
  });
  if (!response.ok) {
    let message =
      response.status === 501
        ? "این قابلیت در نسخهٔ ابری هنوز فعال نشده است."
        : "درخواست انجام نشد؛ اتصال و دسترسی حساب را بررسی کنید.";
    try {
      const payload = await response.json();
      const siteAuthRejection=(response.status===401&&['Sign in required','Session is invalid or expired'].includes(payload.error))||(response.status===403&&['An invited account is required','Account has not been provisioned for this workspace'].includes(payload.error));
      if(siteAuthRejection&&!explicitAuthorization&&bearer===requestBearer)sessionInvalidator?.();
      if (response.status === 403)
        message = "این حساب هنوز به فضای کاری مجاز متصل نشده است.";
      else if (payload.error && response.status !== 500)
        message = typeof payload.error === "string" ? payload.error : message;
    } catch {}
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response;
}
export async function api(path, options) {
  return (await apiResponse(path, options)).json();
}
