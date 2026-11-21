// Finite operator pause after a verified D1 daily read-limit failure. This does
// not change a provider grant, erase a queue or authorize a transport retry.
const DAY=86400000;
export function storageDailyReadFailure(error){
 const seen=new Set();for(let value=error;value&&typeof value==='object'&&!seen.has(value);value=value.cause){seen.add(value);const message=String(value.message||'');if(/(?:D1|database|free tier|free-tier)/i.test(message)&&/(?:daily|day)[\s\S]{0,100}(?:rows?[ -]?reads?|reads?[ -]?rows?)|(?:rows?[ -]?reads?|reads?[ -]?rows?)[\s\S]{0,100}(?:daily|day)/i.test(message)&&/limit|exceed/i.test(message))return true;}return false;
}
export function storageReadPause(env,{now=Date.now(),failure=false}={}){
 if(!Number.isSafeInteger(now)||now<0)return null;
 const configured=typeof env?.D1_READS_RESUME_AFTER==='string'?env.D1_READS_RESUME_AFTER.trim():'';
 const stamp=/^\d{13}$/.test(configured)?Number(configured):/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(configured)?Date.parse(configured):NaN;
 const until=Number.isSafeInteger(stamp)&&stamp>now&&stamp<=now+2*DAY?stamp:failure?Math.floor(now/DAY)*DAY+DAY+5000:null;
 if(!until)return null;
 return {error:'storage_daily_read_limit',retryAt:new Date(until).toISOString(),retryAfterSeconds:Math.max(1,Math.ceil((until-now)/1000))};
}
export function storageBackedPath(path){
 return path==='/api/bootstrap'||['/api/google/','/api/linkedin/','/api/telegram/','/api/clinic-bank/','/api/research/','/api/discovery/','/api/gp-writing/','/api/gp-applications/','/api/gp-workflow/','/api/operations/','/api/ai/','/api/mail-automation/','/api/opportunity-mail','/api/backup/','/api/owner-backup','/api/network/','/api/pesci/','/api/roadmap','/api/team-board','/api/research-funding','/api/opportunities','/api/sources'].some(prefix=>path===prefix.replace(/\/$/,'')||path.startsWith(prefix));
}
export function storagePauseResponse(pause,{actionNotStarted=false}={}){return new Response(JSON.stringify({...pause,...(actionNotStarted?{actionNotStarted:true}:{})}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':String(pause.retryAfterSeconds),'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
