// One free-tier scheduled invocation. Publication is never retried here, and
// expensive public enrichment does not share an invocation with a claimed post.
import {dispatchScheduledLinkedIn} from './linkedin-scheduler.mjs';
import {dispatchPublicPageReading} from './public-page-worker.mjs';
import {dispatchPublicDiscoveryAI} from './public-discovery-ai.mjs';
import {reconcileClinicBankGrowth} from './clinic-bank-growth.mjs';
import {dispatchClinicBankReading} from './clinic-bank.mjs';

export const BACKGROUND_CADENCE_MINUTES=5;
export const AUXILIARY_CADENCE_MINUTES=10;
const defaults={publication:dispatchScheduledLinkedIn,reading:dispatchPublicPageReading,discoveryAI:dispatchPublicDiscoveryAI,clinicBankGrowth:reconcileClinicBankGrowth,clinicBank:dispatchClinicBankReading};
const deferred=reason=>({status:'deferred',reason,retryAfterMinutes:BACKGROUND_CADENCE_MINUTES});
const invocationLimit=error=>/too many (?:d1 )?queries|too many subrequests|(?:query|subrequest)[ _-]budget(?:[ _-]exhausted)?|subrequest.{0,20}limit|limit.{0,20}subrequests/i.test(String(error?.message||''));
async function attempt(fn){try{return{ok:true,value:await fn()};}catch(error){const budgetExhausted=invocationLimit(error);return{ok:false,budgetExhausted,value:{status:budgetExhausted?'invocation_budget_exhausted':'stage_failed',outcome:'unknown_no_retry'}};}}

/**
 * Keep two core readers on the existing five-minute cadence, but alternate the
 * auxiliary AI/growth work. Given the readers' six-request caps, the largest
 * idle-publication lane uses <=45 binding/HTTP subrequests (<=47 with public
 * write recovery) and <=40 D1 queries. Existing batches count as one binding
 * request and each SQL statement counts against the separate D1 query limit.
 *
 * This is a scheduling boundary, not a quota upgrade or automatic retry policy.
 * Pass event.scheduledTime for stable rotation; no persistent cursor is needed.
 */
export async function runBackgroundCycle(env,{now=Date.now(),fetcher=fetch,stages=defaults}={}){
 if(!Number.isFinite(now))return{status:'invalid_scheduled_time',publication:{status:'not_started'}};
 const calls={...defaults,...stages};
 const publicationAttempt=await attempt(()=>calls.publication(env,fetcher,now));
 const result={publication:publicationAttempt.value,backgroundCadenceMinutes:BACKGROUND_CADENCE_MINUTES,auxiliaryCadenceMinutes:AUXILIARY_CADENCE_MINUTES};
 // A throw or unexpected result could follow a claimed/attempted transport.
 // Defer public work without attempting that transport again.
 if(!publicationAttempt.ok||publicationAttempt.value?.processed!==0){
  const reason=publicationAttempt.ok?'publication_budget_reserved':'publication_outcome_unknown';
  return{...result,reading:deferred(reason),discoveryAI:deferred(reason),clinicBankGrowth:deferred(reason),clinicBank:deferred(reason)};
 }
 const reading=await attempt(()=>calls.reading(env,fetcher,now));result.reading=reading.value;
 if(reading.budgetExhausted)return{...result,clinicBank:deferred('invocation_budget_exhausted'),discoveryAI:deferred('invocation_budget_exhausted'),clinicBankGrowth:deferred('invocation_budget_exhausted')};
 const clinicBank=await attempt(()=>calls.clinicBank(env,fetcher,now));result.clinicBank=clinicBank.value;
 if(clinicBank.budgetExhausted)return{...result,discoveryAI:deferred('invocation_budget_exhausted'),clinicBankGrowth:deferred('invocation_budget_exhausted')};
 // One failed reader/AI/growth stage must not prevent another queue's work.
 const aiTurn=Math.floor(now/(BACKGROUND_CADENCE_MINUTES*60000))%2===0;
 result.discoveryAI=aiTurn?(await attempt(()=>calls.discoveryAI(env,now))).value:deferred('auxiliary_rotation');
 result.clinicBankGrowth=aiTurn?deferred('auxiliary_rotation'):(await attempt(()=>calls.clinicBankGrowth(env,fetcher,now))).value;
 return result;
}
