let bearer = "";
export function setAccessToken(value) {
  bearer = value || "";
}
export async function apiResponse(path, options = {}) {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    let message =
      response.status === 501
        ? "این قابلیت در نسخهٔ ابری هنوز فعال نشده است."
        : "درخواست انجام نشد؛ اتصال و دسترسی حساب را بررسی کنید.";
    try {
      const payload = await response.json();
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
