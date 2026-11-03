const DAY = 86400000;
export const AUSTRALIA_ZONES = Object.freeze([
  ['Australia/Sydney', 'سیدنی / کانبرا'], ['Australia/Melbourne', 'ملبورن'],
  ['Australia/Brisbane', 'بریزبن'], ['Australia/Adelaide', 'آدلاید'],
  ['Australia/Perth', 'پرت'], ['Australia/Darwin', 'داروین'], ['Australia/Hobart', 'هوبارت'],
]);
const formatters=new Map();
function formatter(timeZone, calendar='gregory') {
  const key=timeZone+'|'+calendar;if(formatters.has(key))return formatters.get(key);
  const result=new Intl.DateTimeFormat('en-US', {calendar, numberingSystem:'latn', timeZone, year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatters.set(key,result);return result;
}
export function civilParts(value, timeZone='UTC', calendar='gregory') {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) throw Error('تاریخ معتبر نیست.');
  return Object.fromEntries(formatter(timeZone,calendar).formatToParts(d).filter(p=>['year','month','day','hour','minute'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
}
const civilEpoch = p => Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0);
const same = (a,b) => ['year','month','day','hour','minute'].every(k=>(a[k]||0)===(b[k]||0));
export function zonedLocalISO(value, timeZone) {
  const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)throw Error('روز و ساعت را کامل انتخاب کنید.');
  const [year,month,day,hour,minute]=match.slice(1).map(Number), requested={year,month,day,hour,minute};
  if(year<1900||year>2200||month<1||month>12||day<1||hour>23||minute>59||!same(civilParts(civilEpoch(requested),'UTC'),requested))throw Error('روز یا ساعت انتخاب‌شده معتبر نیست.');
  const target=civilEpoch(requested), offsets=new Set();
  // Sampling both sides of the local day finds both DST offsets, including half-hour zones.
  for(let h=-36;h<=36;h+=6){const probe=target+h*3600000;offsets.add(civilEpoch(civilParts(probe,timeZone))-probe);}
  const candidates=[...offsets].map(offset=>target-offset).filter(candidate=>same(civilParts(candidate,timeZone),requested));
  const unique=[...new Set(candidates)];
  if(!unique.length)throw Error('این ساعت به‌دلیل تغییر ساعت رسمی در این منطقه وجود ندارد؛ ساعت دیگری انتخاب کنید.');
  if(unique.length>1)throw Error('این ساعت هنگام تغییر ساعت رسمی دو بار رخ می‌دهد؛ برای جلوگیری از ابهام، ساعت دیگری انتخاب کنید.');
  return new Date(unique[0]).toISOString();
}
export const dateKey = parts => [parts.year,String(parts.month).padStart(2,'0'),String(parts.day).padStart(2,'0')].join('-');
export const timeKey = parts => String(parts.hour).padStart(2,'0')+':'+String(parts.minute).padStart(2,'0');
export const dayAnchor = (value,timeZone='UTC') => {const p=civilParts(value,timeZone);return Date.UTC(p.year,p.month-1,p.day,12);};
export function calendarMonth(anchor,calendar='persian') {
  const p=civilParts(anchor,'UTC',calendar),start=dayAnchor(anchor)-(p.day-1)*DAY,days=[];
  for(let i=0;i<32;i++){const timestamp=start+i*DAY,part=civilParts(timestamp,'UTC',calendar);if(part.year!==p.year||part.month!==p.month)break;days.push({timestamp,calendarDay:part.day,gregorian:dateKey(civilParts(timestamp,'UTC'))});}
  return {start,year:p.year,month:p.month,days,offset:calendar==='persian'?(new Date(start).getUTCDay()+1)%7:(new Date(start).getUTCDay()+6)%7};
}
export function shiftCalendarMonth(anchor,direction,calendar='persian') {
  const {start}=calendarMonth(anchor,calendar),probe=start+(direction<0?-1:32)*DAY;
  const p=civilParts(probe,'UTC',calendar);return dayAnchor(probe)-(p.day-1)*DAY;
}
