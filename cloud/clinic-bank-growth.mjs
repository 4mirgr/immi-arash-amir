// Budgeted growth of an existing owner-private clinic bank from first-party GP
// advertisements. This creates unverified website leads, never jobs or messages.
import {clinicBankURL} from './clinic-bank.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
import {gpOpportunitySignals} from './gp-opportunity-signals.mjs';
export const CLINIC_BANK_GROWTH_LIMIT=10;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const parse=v=>{try{return JSON.parse(v||'{}');}catch{return {};}};
const clean=v=>typeof v==='string'?v.replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,180):'';
const host=v=>String(v||'').toLowerCase().replace(/^www\./,'');
const publishers=['seek.com.au','indeed.com','indeed.com.au','linkedin.com','facebook.com','smartrecruiters.com','pageuppeople.com','ruralhealthwest.com.au','ruralhealth.org.au','ntphn.org.au','rwav.com.au','ruraldoc.com.au','hrplustas.com.au','healthworkforce.com.au','careerone.com.au','healthcarelink.com.au','medicaljobsaustralia.com','ochrerecruitment.com','jwmedical.com.au','wavelengthinternational.com','prescript.com.au','medrecruit.medworld.com'];
export function clinicCandidateFromOpportunity(row,at=Date.now()){
 if(!row||row.country!=='AU'||row.profile_scope!=='both'||row.trust!=='official'||row.opportunity_type!=='job'||!['open','unknown'].includes(row.status))return null;
 const observed=Date.parse(row.last_seen_at);if(!Number.isFinite(observed)||observed>at||at-observed>72*3600000)return null;
 if(row.closing_at&&(!Number.isFinite(Date.parse(row.closing_at))||Date.parse(row.closing_at)<=at))return null;
 const data=parse(row.data),organization=parse(row.organization_data);
 if(data.kind!=='vacancy'||organization.domainEvidence!=='source_provided'||!gpOpportunitySignals({title:row.title}).generalPracticeTitle)return null;
 const page=clinicBankURL(row.url);if(!page)return null;
 const sourceHost=host(new URL(page).hostname),organizationHost=host(organization.domain);
 if(!organizationHost||sourceHost!==organizationHost||publishers.some(d=>sourceHost===d||sourceHost.endsWith('.'+d))||/recruit(?:ment|er)|publisher|job.?board|employment agency/i.test(organization.name||''))return null;
 // Retain the same verified host spelling: no speculative parent or sister site.
 const url=clinicBankURL(new URL(page).origin+'/');if(!url)return null;
 return{url,name:clean(organization.name),provenance:{sourceOpportunityId:row.id,sourceURL:row.url,sourceObservedAt:row.last_seen_at,sourceKind:'first_party_gp_advertisement',candidateOnly:true}};
}
async function idFor(owner,url){return'bank_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+'\n'+url)))].map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32);}
export async function reconcileClinicBankGrowth(env,fetcher=fetch,at=Date.now(),membershipCheck=checkAutomationMembership){
 if(env.CLINIC_BANK_READING_ENABLED!=='true'||!env.GOOGLE_DB||!env.OPPORTUNITY_DB)return{enabled:false,scanned:0,added:0};
 if(!Number.isFinite(at))return{enabled:true,status:'invalid_time',scanned:0,added:0};
 try{
  const db=env.GOOGLE_DB;
  // Existing imported bank ownership is the enrollment boundary; this never
  // creates a new account or copies another doctor's bank/contact information.
  const ownerRow=await db.prepare("SELECT b.owner_id FROM clinic_bank_leads b LEFT JOIN clinic_bank_growth_state s ON s.owner_id=b.owner_id WHERE b.profile_id='arash' GROUP BY b.owner_id ORDER BY coalesce(s.last_run_at,''),b.owner_id LIMIT 1").bind().first();
  const owner=ownerRow?.owner_id;if(!UUID.test(owner||''))return{enabled:true,status:'owner_bank_missing',scanned:0,added:0};
  if(!(await membershipCheck(env,owner,'arash',fetcher))?.active)return{enabled:true,status:'membership_check_blocked',scanned:0,added:0};
  const cursor=await db.prepare('SELECT * FROM clinic_bank_growth_state WHERE owner_id=?').bind(owner).first(),iso=new Date(at).toISOString();
  const rows=(await env.OPPORTUNITY_DB.prepare(`SELECT e.*,o.data AS organization_data FROM opportunity_editions e JOIN opportunity_organizations o ON o.id=e.organization_id
   WHERE e.country='AU' AND e.profile_scope='both' AND e.opportunity_type='job' AND e.trust='official' AND e.last_seen_at>=? AND e.last_seen_at<=?
   AND (e.last_seen_at>? OR (e.last_seen_at=? AND e.id>?)) ORDER BY e.last_seen_at,e.id LIMIT ?`).bind(new Date(at-72*3600000).toISOString(),iso,cursor?.observed_at||'',cursor?.observed_at||'',cursor?.opportunity_id||'',CLINIC_BANK_GROWTH_LIMIT).all()).results||[];
  const candidates=[];
  for(const row of rows){const candidate=clinicCandidateFromOpportunity(row,at);if(candidate)candidates.push({id:await idFor(owner,candidate.url),url:candidate.url,name:candidate.name,provenance:JSON.stringify(candidate.provenance)});}
  const latest=rows.at(-1),observed=latest?.last_seen_at||cursor?.observed_at||'',opportunityId=latest?.id||cursor?.opportunity_id||'';
  // Insert all candidates as one statement; duplicates preserve their prior
  // read receipts and contacts. Cursor and additions are committed atomically.
  const writes=[db.prepare(`INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,provenance_json,created_at,updated_at)
   SELECT json_extract(value,'$.id'),?,'arash',json_extract(value,'$.url'),json_extract(value,'$.name'),json_extract(value,'$.provenance'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(owner_id,url) DO NOTHING`).bind(owner,iso,iso,JSON.stringify(candidates)),
   db.prepare(`INSERT INTO clinic_bank_growth_state(owner_id,observed_at,opportunity_id,last_run_at,scanned_count,added_count) VALUES(?,?,?,?,?,0)
   ON CONFLICT(owner_id) DO UPDATE SET observed_at=excluded.observed_at,opportunity_id=excluded.opportunity_id,last_run_at=excluded.last_run_at,scanned_count=scanned_count+excluded.scanned_count`).bind(owner,observed,opportunityId,iso,rows.length)];
  const result=await db.batch(writes),added=Number(result[0]?.meta?.changes||0);
  if(added)await db.prepare('UPDATE clinic_bank_growth_state SET added_count=added_count+? WHERE owner_id=?').bind(added,owner).run();
  return{enabled:true,status:'reconciled',scanned:rows.length,added,limitPerRun:CLINIC_BANK_GROWTH_LIMIT};
 }catch{return{enabled:true,status:'growth_storage_unavailable',scanned:0,added:0};}
}
