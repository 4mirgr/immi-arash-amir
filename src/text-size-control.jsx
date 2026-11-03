import React, {useLayoutEffect, useState} from 'react';

const MINIMUM = 85, MAXIMUM = 130, DEFAULT = 110;
const validOwner = id => ['amir', 'arash'].includes(id) ? id : null;
const preferenceKey = id => `masir:text-size:v1:${id}`;
function savedSize(id) {
  if (!id) return DEFAULT;
  try {
    const value = Number(localStorage.getItem(preferenceKey(id)));
    return Number.isInteger(value) && value >= MINIMUM && value <= MAXIMUM && value % 5 === 0 ? value : DEFAULT;
  } catch { return DEFAULT; }
}

// Display preference only; never stores profile, session, or integration data.
export function TextSizeControl({personId}) {
  const owner = validOwner(personId);
  const [preference, setPreference] = useState(() => ({owner, percent: savedSize(owner)}));
  useLayoutEffect(() => {
    setPreference({owner, percent: savedSize(owner)});
    const onStorage = event => {
      if (owner && (event.key === preferenceKey(owner) || event.key === null)) {
        setPreference({owner, percent: savedSize(owner)});
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.documentElement.style.removeProperty('--workspace-text-scale');
    };
  }, [owner]);
  useLayoutEffect(() => {
    if (!owner) {
      document.documentElement.style.removeProperty('--workspace-text-scale');
    } else if (preference.owner === owner) {
      document.documentElement.style.setProperty('--workspace-text-scale', String(preference.percent / 100));
    }
  }, [owner, preference]);
  const percent = preference.owner === owner ? preference.percent : savedSize(owner);
  function change(value) {
    if (!owner) return;
    const next = Math.max(MINIMUM, Math.min(MAXIMUM, value));
    setPreference({owner, percent: next});
    try { localStorage.setItem(preferenceKey(owner), String(next)); } catch { /* Current-session setting remains usable. */ }
  }
  if (!owner) return null;
  return <div className="text-size-control" role="group" aria-label="اندازهٔ متن همین کاربر" title="اندازهٔ متن؛ جداگانه برای همین کاربر در این مرورگر ذخیره می‌شود">
    <button type="button" aria-label="کوچک‌تر کردن متن" title="کوچک‌تر کردن متن" disabled={percent <= MINIMUM} onClick={() => change(percent - 5)}>A−</button>
    <button type="button" className="text-size-reset" aria-label={`اندازهٔ متن ${percent} درصد؛ بازنشانی به ۱۰۰ درصد`} title="بازنشانی به ۱۰۰٪" onClick={() => change(100)}><span role="status" aria-live="polite">{percent}%</span></button>
    <button type="button" aria-label="بزرگ‌تر کردن متن" title="بزرگ‌تر کردن متن" disabled={percent >= MAXIMUM} onClick={() => change(percent + 5)}>A+</button>
  </div>;
}
