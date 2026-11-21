let bearer = "";
let sessionGuard = null;
let sessionInvalidator = null;
export function setSessionGuard(guard, invalidator) { sessionGuard = typeof guard === "function" ? guard : null; sessionInvalidator = typeof invalidator === "function" ? invalidator : null; }
export function setAccessToken(value) {
  bearer = value || "";
}
const MAX_RETRY_SECONDS=2*86400;
const retrySeconds=value=>(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=MAX_RETRY_SECONDS?Number(value):null;
function responseRetryMetadata(payload,headers,now=Date.now()){
  const seconds=retrySeconds(payload?.retryAfterSeconds),absolute=typeof payload?.retryAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(payload.retryAt)?Date.parse(payload.retryAt):NaN;
  const header=headers.get('Retry-After'),headerSeconds=retrySeconds(header),headerDate=headerSeconds===null&&header?Date.parse(header):NaN;
  const candidates=[Number.isFinite(absolute)&&absolute>=now&&absolute-now<=MAX_RETRY_SECONDS*1000?absolute:NaN,seconds===null?NaN:now+seconds*1000,headerSeconds===null?headerDate:now+headerSeconds*1000].filter(value=>Number.isFinite(value)&&value>=now&&value-now<=MAX_RETRY_SECONDS*1000);
  if(!candidates.length)return {};
  const until=Math.max(...candidates);return {retryAt:new Date(until).toISOString(),retryAfterSeconds:Math.ceil((until-now)/1000)};
}
/** Absolute retry deadline only; this helper never retries any request. */
export function apiRetryAt(error,now=Date.now()){
  const at=typeof error?.retryAt==='string'?Date.parse(error.retryAt):NaN;
  if(Number.isFinite(at)&&at<now)return 0;
  if(Number.isFinite(at)&&at>=now&&at-now<=MAX_RETRY_SECONDS*1000)return at;
  const seconds=retrySeconds(error?.retryAfterSeconds);return seconds===null?0:now+seconds*1000;
}
export function storageDailyReadLimitNotice(error,english=false){
  if((error?.code||error?.message)!=='storage_daily_read_limit')return null;
  const at=apiRetryAt(error);let time='';
  if(at)try{time=new Intl.DateTimeFormat(english?'en-GB':'fa-IR',{timeZone:'Asia/Tehran',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(at));}catch{}
  return english?"Today's free data-reading allowance has been reached. Your loaded information is preserved."+(time?' Updates can resume after '+time+' (Tehran time).':' Updates will be checked again later.'):'سهمیهٔ رایگانِ خواندن اطلاعات امروز تمام شده است. اطلاعات قبلی شما حفظ شده‌اند.'+(time?' دریافت اطلاعات پس از '+time+' به وقت تهران دوباره امکان‌پذیر می‌شود.':' دریافت اطلاعات با فاصلهٔ بیشتر دوباره بررسی می‌شود.');
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
    let code=null,retry={},actionNotStarted=false;
    let message =
      response.status === 501
        ? "این قابلیت در نسخهٔ ابری هنوز فعال نشده است."
        : "درخواست انجام نشد؛ اتصال و دسترسی حساب را بررسی کنید.";
    try {
      const payload = await response.json();
      if(typeof payload?.error==='string'&&/^[a-z][a-z0-9_/-]{0,99}$/.test(payload.error))code=payload.error;
      actionNotStarted=response.status===503&&code==='storage_daily_read_limit'&&payload?.actionNotStarted===true;
      retry=responseRetryMetadata(payload,response.headers);
      const siteAuthRejection=(response.status===401&&['Sign in required','Session is invalid or expired'].includes(payload.error))||(response.status===403&&['An invited account is required','Account has not been provisioned for this workspace'].includes(payload.error));
      if(siteAuthRejection&&!explicitAuthorization&&bearer===requestBearer)sessionInvalidator?.();
      if (response.status === 403)
        message = "این حساب هنوز به فضای کاری مجاز متصل نشده است.";
      else if (payload.error && response.status !== 500)
        message = typeof payload.error === "string" ? payload.error : message;
    } catch {retry=responseRetryMetadata(null,response.headers);}
    throw Object.assign(new Error(message), { status: response.status,...(code?{code}:{}),...retry,...(actionNotStarted?{actionNotStarted:true}:{}) });
  }
  return response;
}
export async function api(path, options) {
  return (await apiResponse(path, options)).json();
}
