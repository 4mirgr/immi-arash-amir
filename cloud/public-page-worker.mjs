import {storePublicReading} from './public-page-store.mjs';
const AGENT='MasirUniversityDiscovery/1.0',MAX_BODY=1000000;
const sensitive=/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|apply|application|candidate)(?:\/|$)/i;
const error=code=>{throw Error(code);};
function safe(value,bases){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!bases.some(base=>u.hostname===base||u.hostname.endsWith('.'+base))||!/^[-a-z0-9.]+$/.test(u.hostname)||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes('..')||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||sensitive.test(decodeURIComponent(u.pathname)))error('invalid_url');u.hash='';return u.href;}
export function robotsAllows(text,target){
 const groups=[];let agents=[],rules=[],delay=0,hasRule=false;
 function save(){if(agents.length)groups.push({agents,rules,delay});agents=[];rules=[];delay=0;hasRule=false;}
 for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0],i=line.indexOf(':');if(i<0)continue;const k=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();if(k==='user-agent'){if(hasRule)save();agents.push(v.toLowerCase());}else{hasRule=true;if(['allow','disallow'].includes(k)&&v)rules.push({allow:k==='allow',path:v});if(k==='crawl-delay'&&Number.isFinite(Number(v)))delay=Math.max(delay,Number(v));}}
 save();const score=g=>Math.max(0,...g.agents.filter(a=>a!=='*'&&AGENT.toLowerCase().includes(a)).map(a=>a.length)),bestAgent=Math.max(0,...groups.map(score)),selected=bestAgent?groups.filter(g=>score(g)===bestAgent):groups.filter(g=>g.agents.includes('*'));
 const u=new URL(target),path=u.pathname+u.search;let best=-1,allowed=true;
 for(const rule of selected.flatMap(g=>g.rules)){const end=rule.path.endsWith('$'),pattern=rule.path.replace(/\$$/,'').split('*').map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');if(new RegExp('^'+pattern+(end?'$':'')).test(path)){const n=rule.path.replaceAll('*','').length;if(n>best||n===best&&rule.allow){best=n;allowed=rule.allow;}}}
 return {allowed,delay:Math.max(0,...selected.map(g=>g.delay))};
}
async function bounded(response,limit){if(Number(response.headers.get('Content-Length')||0)>limit){await response.body?.cancel();error('body_too_large');}const reader=response.body?.getReader();if(!reader)error('empty_text');let text='',bytes=0;const decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();error('body_too_large');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}}
export function visiblePageText(html){
 const title=(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,' ').slice(0,500);
 const body=html.replace(/<(script|style|noscript|nav|footer|header|aside|form|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<!--[^]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>31&&cp<=0x10ffff?String.fromCodePoint(cp):' ';}).replace(/\s+/g,' ').trim();
 return {title,text:body.slice(0,50000),partial:body.length>50000};
}
export async function readQueuedPage(row,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const data=JSON.parse(row.data),bases=(data.officialBases||[]).filter(v=>typeof v==='string'&&/^[a-z0-9.-]+$/.test(v)&&v.includes('.')&&!/^\d+(?:\.\d+){3}$/.test(v));
 const record={id:row.id,url:row.url,title:'',text:'',status:'fetch_failed',readAt:new Date().toISOString(),limitations:['Server HTML/text extraction only; dynamic content and hidden layout may require separate review.']};
 try{
  let url=safe(row.url,bases);const policies=new Map();
  for(let hop=0;hop<3;hop++){
   const origin=new URL(url).origin;let policy=policies.get(origin);
   if(!policy){const robots=await fetcher(origin+'/robots.txt',{headers:{'User-Agent':AGENT,Accept:'text/plain'},redirect:'manual',signal:AbortSignal.timeout(8000)});if(robots.status===401||robots.status===403){await robots.body?.cancel();error('robots_blocked');}if(![200,404].includes(robots.status)){await robots.body?.cancel();error('robots_unavailable');}const text=robots.status===404?'':await bounded(robots,64000);if(robots.status===404)await robots.body?.cancel();if(/<html/i.test(text.slice(0,500)))error('robots_unavailable');policy=text;policies.set(origin,policy);}
   const permission=robotsAllows(policy,url);if(!permission.allowed)error('robots_blocked');if(permission.delay>30)error('crawl_delay_exceeds_budget');if(permission.delay)await sleep(permission.delay*1000);
   const response=await fetcher(url,{headers:{'User-Agent':AGENT,Accept:'text/html,text/plain'},redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(response.status>=300&&response.status<400){const location=response.headers.get('Location');await response.body?.cancel();if(!location||hop===2)error('redirect_limit');url=safe(new URL(location,url).href,bases);continue;}
   if(!response.ok){await response.body?.cancel();error(response.status===401||response.status===403?'access_denied':'http_error');}
   const contentType=response.headers.get('Content-Type')||'';record.contentType=contentType;
   if(/application\/pdf/i.test(contentType)){await response.body?.cancel();error('pdf_reader_required');}
   if(!/text\/html|application\/xhtml|text\/plain/i.test(contentType)){await response.body?.cancel();error('unsupported_content');}
   const body=await bounded(response,MAX_BODY),parsed=/html/i.test(contentType)?visiblePageText(body):{title:'',text:body.slice(0,50000),partial:body.length>50000};
   if(!parsed.text.trim())error('empty_text');Object.assign(record,parsed,{status:parsed.partial?'read_partial':'read',finalUrl:url});
   if(parsed.partial)record.limitations.push('Only the first 50000 text characters were evaluated.');return record;
  }
 }catch(e){record.status=/^(invalid_url|body_too_large|empty_text|robots_blocked|robots_unavailable|crawl_delay_exceeds_budget|redirect_limit|access_denied|http_error|pdf_reader_required|unsupported_content)$/.test(e.message)?e.message:'fetch_failed';}
 return record;
}
export async function dispatchPublicPageReading(env,fetcher=fetch,now=Date.now()){
 if(env.PUBLIC_PAGE_READING_ENABLED!=='true'||!env.OPPORTUNITY_DB)return {enabled:false,processed:0};
 const db=env.OPPORTUNITY_DB,receipts=[];
 for(let i=0;i<2;i++){
  const row=await db.prepare("UPDATE public_page_queue SET status='reading',lease_until=?,attempts=attempts+1 WHERE id=(SELECT id FROM public_page_queue WHERE ((status='pending') OR (status='reading' AND lease_until<?)) AND available_at<=? AND attempts<3 ORDER BY attempts,id LIMIT 1) AND ((status='pending') OR (status='reading' AND lease_until<?)) RETURNING *").bind(now+180000,now,now,now).first();
  if(!row)break;
  try{receipts.push(await storePublicReading(db,await readQueuedPage(row,fetcher)));}catch{await db.prepare("UPDATE public_page_queue SET status='failed',lease_until=0,last_error='reading_storage_failed' WHERE id=? AND status='reading'").bind(row.id).run();receipts.push({id:row.id,status:'failed'});}
 }
 return {enabled:true,processed:receipts.length,receipts};
}
