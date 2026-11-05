// Recovery credentials live only in AccessGate memory. Never persist them or
// forward them to workspace APIs; Supabase validates the bearer itself.
export function consumeAuthCallback(href, replaceUrl, now = Date.now()) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const keys = ['access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at', 'type', 'error', 'error_code', 'error_description'];
  const queryAuth = [...keys, 'token_hash', 'code'].some(key => url.searchParams.has(key));
  if (!keys.some(key => hash.has(key)) && !queryAuth) return { kind: 'none' };
  const type = hash.get('type');
  url.hash = '';
  // Also remove accidental auth credentials from the query, never reuse them.
  for (const key of [...keys, 'code', 'token_hash']) url.searchParams.delete(key);
  replaceUrl(url.pathname + url.search);
  if (queryAuth || keys.some(key => hash.getAll(key).length > 1) || hash.has('error') || hash.has('error_code')) return { kind: 'invalid' };
  if (type !== 'recovery') return { kind: type === 'signup' ? 'confirmation' : 'invalid' };
  const accessToken = hash.get('access_token') || '';
  const lifetime = Number(hash.get('expires_in'));
  const expiresAt = hash.has('expires_at') ? Number(hash.get('expires_at')) * 1000 : now + lifetime * 1000;
  if (!accessToken || accessToken.length > 8192 || /\s/.test(accessToken)
    || hash.get('token_type')?.toLowerCase() !== 'bearer'
    || !Number.isFinite(lifetime) || lifetime <= 0 || !Number.isFinite(expiresAt) || expiresAt <= now) return { kind: 'invalid' };
  return { kind: 'recovery', accessToken, expiresAt: Math.min(expiresAt, now + 3600000) };
}

export function recoveryRedirect(href) {
  const url = new URL(href);
  // Keep the deployed /aus/ mount, without reflecting query strings/fragments.
  return url.origin + (url.pathname === '/aus' || url.pathname.startsWith('/aus/') ? '/aus/' : '/');
}

export function passwordProblem(password, confirmation) {
  if (password.length < 12) return 'رمز جدید باید حداقل ۱۲ کاراکتر داشته باشد.';
  if (password.length > 128) return 'رمز جدید باید حداکثر ۱۲۸ کاراکتر داشته باشد.';
  if (password !== confirmation) return 'رمز جدید و تکرار آن یکسان نیستند.';
  return '';
}

export function passwordUpdateError(status, code) {
  if (status === 401 || status === 403 || ['session_not_found', 'session_expired', 'bad_jwt'].includes(code))
    return 'اعتبار لینک بازیابی پایان یافته است. دوباره لینک بگیرید.';
  if (code === 'same_password') return 'رمز جدید باید با رمز قبلی فرق داشته باشد.';
  if (code === 'weak_password') return 'این رمز به اندازهٔ کافی قوی نیست. رمز طولانی‌تری با ترکیب حروف، عدد و نشانه انتخاب کنید.';
  if (status === 429) return 'تعداد درخواست‌ها زیاد شده است. چند دقیقه صبر کنید و دوباره امتحان کنید.';
  return 'تغییر رمز انجام نشد. اتصال را بررسی کنید و دوباره امتحان کنید.';
}
