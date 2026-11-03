// Bounded public-page change detection; a checksum is NOT an eligibility review.
import {ROADMAP_EVIDENCE,evidenceFor} from './roadmap.mjs';
const DAY=86400000,LIMIT=262144;
const urls=[...new Set(ROADMAP_EVIDENCE.flatMap(x=>x.sourceUrls||[]))].filter(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash;}catch{return false;}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function watchEvidenceSources(env,fetcher=fetch,now=Date.now()){
 if(!env.OPPORTUNITY_DB)return {checked:0,status:'storage_missing'};
 const db=env.OPPORTUNITY_DB,old=(await stmt(db,'SELECT * FROM evidence_source_checks').all()).results||[],byUrl=new Map(old.map(r=>[r.source_url,r]));
 const due=urls.filter(u=>(byUrl.get(u)?.next_check_at||0)<=now).sort((a,b)=>(byUrl.get(a)?.last_attempt_at||0)-(byUrl.get(b)?.last_attempt_at||0)).slice(0,2);
 const receipts=[];
 for(const url of due){
  const row=byUrl.get(url);let status='check_failed',hash=row?.content_hash||null,etag=row?.etag||null,modified=row?.last_modified||null,success=row?.last_success_at||null,changed=row?.change_detected_at||null,error=null;
  // Persist claim before I/O; overlapping invocations skip this source for the cooldown.
  const claim=await stmt(db,'INSERT INTO evidence_source_checks(source_url,status,last_attempt_at,next_check_at) VALUES(?,?,?,?) ON CONFLICT(source_url) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,next_check_at=excluded.next_check_at WHERE evidence_source_checks.next_check_at<=? RETURNING source_url',url,'checking',now,now+DAY,now).first();
  if(!claim)continue;
  try{
   const headers={Accept:'text/html,application/pdf,text/plain','User-Agent':'Masir-SourceReview/1.0'};if(etag)headers['If-None-Match']=etag;if(modified)headers['If-Modified-Since']=modified;
   const response=await fetcher(url,{headers,redirect:'manual',signal:AbortSignal.timeout(12000)});
   if(response.redirected||(response.status>=300&&response.status<400&&response.status!==304))throw Error('redirect_rejected');
   if(response.status===304){status=changed?'changed_review_required':'available';success=now;}
   else{
    if(!response.ok)throw Error('http_'+response.status);
    if(Number(response.headers.get('Content-Length')||0)>LIMIT)throw Error('body_too_large');
    const reader=response.body?.getReader();if(!reader)throw Error('empty_response');const chunks=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT){await reader.cancel();throw Error('body_too_large');}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const next=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(hash&&hash!==next)changed=now;
    hash=next;success=now;etag=response.headers.get('ETag')?.slice(0,300)||null;modified=response.headers.get('Last-Modified')?.slice(0,100)||null;status=changed?'changed_review_required':'available';
   }
  }catch(e){error=/^(http_\d{3}|body_too_large|empty_response|redirect_rejected)$/.test(e.message)?e.message:'fetch_failed';}
  await stmt(db,'UPDATE evidence_source_checks SET status=?,content_hash=?,etag=?,last_modified=?,last_success_at=?,change_detected_at=?,error_code=? WHERE source_url=? AND last_attempt_at=?',status,hash,etag,modified,success,changed,error,url,now).run();
  receipts.push({url,status});
 }
 return {checked:receipts.length,sources:receipts,analysisRegenerated:false};
}
export function visibleEvidenceUrls(profileId){return new Set(evidenceFor(profileId).flatMap(x=>x.sourceUrls||[]));}
