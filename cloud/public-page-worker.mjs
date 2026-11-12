import {extractPublicContacts} from './public-contact-extraction.mjs';
import {reconcileContactCoverage} from './contact-coverage.mjs';
import {storePublicReading,PUBLIC_PAGE_REFRESH_MS,PUBLIC_PAGE_RETRY_MS} from './public-page-store.mjs';
const AGENT='MasirUniversityDiscovery/1.0',MAX_BODY=1000000;
export const PUBLIC_PAGE_REQUEST_LIMIT=6;
const sensitive=/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|apply|application|candidate)(?:\/|$)/i;
const error=code=>{throw Error(code);};
function safe(value,bases){if(typeof value!=='string'||/[\x00-\x20\\]/.test(value))error('invalid_url');const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!bases.some(base=>u.hostname===base||u.hostname.endsWith('.'+base))||!/^[-a-z0-9.]+$/.test(u.hostname)||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes('..')||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||['nip.io','sslip.io','localtest.me','vcap.me','lvh.me'].some(base=>u.hostname===base||u.hostname.endsWith('.'+base))||sensitive.test(decodeURIComponent(u.pathname))||[...u.searchParams.keys()].some(key=>/token|secret|session|password|code|auth/i.test(key)))error('invalid_url');u.hash='';return u.href;}
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
// Bounded static markup filtering, not a browser CSS/layout engine.
function withoutHiddenMarkup(html){
 const tags=/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,stack=[],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 let out='',cursor=0,hidden=0,match;
 while((match=tags.exec(html))){
  if(!hidden)out+=html.slice(cursor,match.index);
  const token=match[0],tag=match[1].toLowerCase();
  if(token.startsWith('</')){
   const wasHidden=hidden;
   let index=stack.length-1;while(index>=0&&stack[index].tag!==tag)index--;
   if(index>=0){while(stack.length>index){if(stack.pop().hidden)hidden--;}}
   if(!wasHidden)out+=token;else if(!hidden)out+=' ';
  }else{
   const attrs={};const attrText=token.slice(match[1].length+1,-1);
   for(const a of attrText.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4]??'';
   const hide=Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']?.toLowerCase()==='true'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important)?\s*(?:;|$)/i.test(attrs.style||'');
   if(!hidden&&!hide)out+=token;
   if(!voids.has(tag)&&!token.endsWith('/>')){stack.push({tag,hidden:hide});if(hide)hidden++;}
  }
  cursor=tags.lastIndex;
 }
 if(!hidden)out+=html.slice(cursor);return out;
}
export function visiblePageText(html){
 html=withoutHiddenMarkup(html);
 const title=(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,' ').slice(0,500);
 const body=html.replace(/<(script|style|noscript|nav|footer|header|aside|form|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<!--[^]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>31&&cp<=0x10ffff?String.fromCodePoint(cp):' ';}).replace(/\s+/g,' ').trim();
 return {title,text:body.slice(0,50000),partial:body.length>50000};
}
export async function readQueuedPage(row,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),requestBudget={remaining:PUBLIC_PAGE_REQUEST_LIMIT}){
 const record={id:row.id,url:row.url,title:'',text:'',status:'fetch_failed',readAt:new Date().toISOString(),limitations:['Server HTML/text extraction only; dynamic content and hidden layout may require separate review.']};
 try{
  let data;try{data=JSON.parse(row.data);}catch{error('invalid_url');}
  const bases=(Array.isArray(data?.officialBases)?data.officialBases:[]).filter(v=>typeof v==='string'&&/^[a-z0-9.-]+$/.test(v)&&v.includes('.')&&!/^\d+(?:\.\d+){3}$/.test(v));
  const boundedFetch=async(url,options)=>{if(!Number.isInteger(requestBudget?.remaining)||requestBudget.remaining<=0)error('request_budget_exhausted');requestBudget.remaining--;return fetcher(url,options);};
  // Some sites redirect /robots.txt to a canonical HTTPS host. Follow only the
  // same approved domain, with a shared budget covering robots and page reads.
  async function robotsPolicy(origin){
   let target=origin+'/robots.txt';
   for(let hop=0;hop<3;hop++){
    const response=await boundedFetch(target,{headers:{'User-Agent':AGENT,Accept:'text/plain'},redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(response.status>=300&&response.status<400){const location=response.headers.get('Location');await response.body?.cancel();if(!location||hop===2)error('robots_unavailable');target=safe(new URL(location,target).href,bases);continue;}
    if(response.status===401||response.status===403){await response.body?.cancel();error('robots_blocked');}
    if(![200,404].includes(response.status)){await response.body?.cancel();error('robots_unavailable');}
    const text=response.status===404?'':await bounded(response,64000);if(response.status===404)await response.body?.cancel();if(/<html/i.test(text.slice(0,500)))error('robots_unavailable');return {text,canonicalOrigin:new URL(target).pathname==='/robots.txt'&&!new URL(target).search?new URL(target).origin:null};
   }
   error('robots_unavailable');
  }
  let url=safe(row.url,bases);const policies=requestBudget.policies instanceof Map?requestBudget.policies:(requestBudget.policies=new Map());
  for(let hop=0;hop<3;hop++){
   const origin=new URL(url).origin;if(!policies.has(origin)){const policy=await robotsPolicy(origin);policies.set(origin,policy.text);if(policy.canonicalOrigin)policies.set(policy.canonicalOrigin,policy.text);}
   const permission=robotsAllows(policies.get(origin),url);if(!permission.allowed)error('robots_blocked');if(permission.delay>30)error('crawl_delay_exceeds_budget');if(permission.delay)await sleep(permission.delay*1000);
   const response=await boundedFetch(url,{headers:{'User-Agent':AGENT,Accept:'text/html,text/plain'},redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(response.status>=300&&response.status<400){const location=response.headers.get('Location');await response.body?.cancel();if(!location||hop===2)error('redirect_limit');url=safe(new URL(location,url).href,bases);continue;}
   if(!response.ok){await response.body?.cancel();error(response.status===401||response.status===403?'access_denied':response.status>=500||[408,425,429].includes(response.status)?'http_error':'http_rejected');}
   const contentType=response.headers.get('Content-Type')||'';record.contentType=contentType;
   if(/application\/pdf/i.test(contentType)){await response.body?.cancel();error('pdf_reader_required');}
   if(!/text\/html|application\/xhtml|text\/plain/i.test(contentType)){await response.body?.cancel();error('unsupported_content');}
   const body=await bounded(response,MAX_BODY),parsed=/html/i.test(contentType)?visiblePageText(body):{title:'',text:body.slice(0,50000),partial:body.length>50000};
   if(!parsed.text.trim())error('empty_text');Object.assign(record,parsed,{status:parsed.partial?'read_partial':'read',finalUrl:url});
   record.enrichment=extractPublicContacts({...(/html/i.test(contentType)?{html:body}:{text:parsed.text}),sourceURL:url,readAt:record.readAt});
   if(parsed.partial)record.limitations.push('Only the first 50000 text characters were evaluated.');return record;
  }
 }catch(e){record.status=/^(invalid_url|body_too_large|empty_text|robots_blocked|robots_unavailable|crawl_delay_exceeds_budget|redirect_limit|access_denied|http_error|http_rejected|pdf_reader_required|unsupported_content|request_budget_exhausted)$/.test(e.message)?e.message:'fetch_failed';}
 return record;
}
export async function dispatchPublicPageReading(env,fetcher=fetch,now=Date.now()){
 if(env.PUBLIC_PAGE_READING_ENABLED!=='true'||!env.OPPORTUNITY_DB)return {enabled:false,processed:0};
 const db=env.OPPORTUNITY_DB,receipts=[];
 // Repair missed historical imports before processing the same bounded queue.
 // This is registration/refresh bookkeeping, never a fetched-page receipt.
 const contactCoverage=await reconcileContactCoverage(env,now);
 for(let i=0;i<2;i++){
  // Keep a previous successful status/evidence visible while a refresh holds its lease.
  // Legacy successful rows with available_at=0 still obey the seven-day read_at age.
  const eligible="lease_until<=? AND available_at<=? AND (status IN ('pending','reading','fetch_failed','robots_unavailable','http_error','request_budget_exhausted','reading_storage_failed') AND attempts<3 OR (status IN ('read','read_partial') AND (attempts<3 OR lease_until=0) AND (read_at<=? OR json_extract(data,'$.refreshRequested')=1)))";
  const cutoff=new Date(now-PUBLIC_PAGE_REFRESH_MS).toISOString();
  const clinicalText="lower(title||' '||coalesce(json_extract(data,'$.labels'),''))";
  const clinical=`(${clinicalText} LIKE '%general pract%' OR ${clinicalText} LIKE '%medical officer%' OR ${clinicalText} LIKE '%rural generalist%' OR ${clinicalText} LIKE '%level 1%' OR instr(' '||replace(replace(${clinicalText},'-',' '),'\"',' ')||' ',' gp ')>0)`;
  const contactFollowup="(json_extract(data,'$.contactFollowup')=1 OR (json_extract(data,'$.depth')=1 AND (lower(url) LIKE '%contact%' OR lower(url) LIKE '%team%' OR lower(url) LIKE '%staff%' OR lower(url) LIKE '%about%')))";
  const priority=i===0?`CASE WHEN country='AU' AND ${contactFollowup} THEN 0 WHEN country='AU' AND ${clinical} AND NOT EXISTS(SELECT 1 FROM public_page_enrichment x,json_each(x.data,'$.contacts') contact WHERE x.page_id=public_page_queue.id AND json_extract(contact.value,'$.type')='email') THEN 1 WHEN country='AU' THEN 2 ELSE 3 END`:"CASE WHEN country='IT' THEN 0 ELSE 1 END";
  const row=await db.prepare(`UPDATE public_page_queue SET status=CASE WHEN status IN ('read','read_partial') THEN status ELSE 'reading' END,lease_until=?,attempts=CASE WHEN status IN ('read','read_partial') AND lease_until=0 THEN 1 ELSE attempts+1 END WHERE id=(SELECT id FROM public_page_queue WHERE ${eligible} ORDER BY ${priority},available_at,attempts,id LIMIT 1) AND ${eligible} RETURNING *`).bind(now+180000,now,now,cutoff,now,now,cutoff).first();
  if(!row)break;
  try{receipts.push(await storePublicReading(db,await readQueuedPage(row,fetcher),now));}catch{
   // A failed result must not leave a prior extracted conclusion active.
   await db.batch([
    db.prepare("UPDATE public_page_queue SET status='reading_storage_failed',lease_until=0,last_error='reading_storage_failed',available_at=? WHERE id=? AND lease_until=?").bind(now+PUBLIC_PAGE_RETRY_MS,row.id,now+180000),
    db.prepare('DELETE FROM public_page_evidence WHERE page_id=?').bind(row.id),
    db.prepare('DELETE FROM public_page_enrichment WHERE page_id=?').bind(row.id)
   ]);receipts.push({id:row.id,status:'reading_storage_failed'});
  }
 }
 return {enabled:true,processed:receipts.length,receipts,contactCoverage};
}
