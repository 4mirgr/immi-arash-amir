// Fixed server-owned cache policy. Never reads a grant, message body or private content.
const DAY=86400000, BATCH=500;
const STEPS=Object.freeze([
 {name:'expired_google_links',table:'google_oauth_states',where:'expires_at<=?',cutoff:now=>now},
 {name:'expired_linkedin_links',table:'linkedin_oauth_states',where:'expires_at<=?',cutoff:now=>now},
 {name:'expired_telegram_links',table:'telegram_link_states',where:'expires_at<=?',cutoff:now=>now},
 {name:'stale_mail_cache',table:'google_mail_messages',where:'updated_at<?',cutoff:now=>now-30*DAY},
 {name:'stale_oauth_diagnostics',table:'google_oauth_diagnostics',where:'created_at<?',cutoff:now=>now-30*DAY}
]);
export async function runMaintenance(env,now=Date.now()){
 if(!env.GOOGLE_DB)return {configured:false,queries:0,deleted:0};
 if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid maintenance time');
 const results=[];
 for(const step of STEPS){
  // rowid exists on each fixed schema. LIMIT applies before deletion, including across owners.
  const sql=`DELETE FROM ${step.table} WHERE rowid IN (SELECT rowid FROM ${step.table} WHERE ${step.where} ORDER BY rowid LIMIT ${BATCH})`;
  try{const result=await env.GOOGLE_DB.prepare(sql).bind(step.cutoff(now)).run();results.push({task:step.name,status:'completed',deleted:Number.isSafeInteger(result?.meta?.changes)?result.meta.changes:null});}
  catch{results.push({task:step.name,status:'failed',deleted:0});}
 }
 return {configured:true,queries:STEPS.length,batchLimit:BATCH,deleted:results.reduce((sum,row)=>sum+(row.deleted||0),0),status:results.some(row=>row.status==='failed')?'partial_failure':'completed',results};
}
