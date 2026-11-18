// Connect the lossless mailbox cursor to the owner's private discovery queue.
// No candidate, draft or notification constitutes an application approval.
import {syncClinicCorrespondence} from './google-mail-correspondence-reader.mjs';
import {ingestMailOpportunities,invalidateMailOpportunities,invalidateMailOpportunityHistory,processMailOpportunityInputs} from './mail-opportunities.mjs';
import {recordClinicCorrespondenceBatchStops} from './clinic-correspondence.mjs';
import {getAutomationWritingContext} from './automation-writing-context.mjs';

export async function syncMailDiscovery(env,context,fetcher=fetch,options={}){
 const readerOptions={...options,maxProviderReads:Math.min(6,Number.isInteger(options.maxProviderReads)&&options.maxProviderReads>0?options.maxProviderReads:6)};
 if(context.profileId!=='arash')return syncClinicCorrespondence(env,context,fetcher,readerOptions);
 let writingPromise=null,callbackUsed=false,stopsRecorded=false,ingested={processed:0,queued:0},currentIdentity=null;
 const root=context.rootUserId||context.userId.replace(/:secondary$/,'');
 const writing=()=>writingPromise||(writingPromise=(options.writingContextProvider||getAutomationWritingContext)(env,root,'arash',fetcher));
 const reader=options.reader||syncClinicCorrespondence;
 const progress=await reader(env,context,fetcher,{
  ...readerOptions,
  onMessages:async(messages,scoped,identity)=>{
   callbackUsed=true;currentIdentity=identity;
   const snapshot=await writing();
   ingested=await (options.ingest||ingestMailOpportunities)(env,scoped,messages,identity,{now:options.now,writingContext:snapshot.available===false?{}:snapshot});
   await (options.recordStops||recordClinicCorrespondenceBatchStops)(env,scoped,identity,messages);stopsRecorded=true;
  },
  onDeleted:async(ids,scoped,identity)=>{currentIdentity=identity;await (options.invalidate||invalidateMailOpportunities)(env,scoped,ids,identity);},
  onHistoryGap:async(scoped,identity)=>{currentIdentity=identity;await (options.invalidateHistory||invalidateMailOpportunityHistory)(env,scoped,identity);},
 });
 if(!callbackUsed){
  // An idle history pass must still drain long LinkedIn digests left queued by
  // earlier passes. Identity is pinned by the freshly completed own reader.
  if(!currentIdentity){const account=await env.GOOGLE_DB.prepare('SELECT google_sub,email FROM google_accounts WHERE owner_id=? AND profile_id=?').bind(context.userId,'arash').first();if(account)currentIdentity={subject:account.google_sub,email:account.email};}
  if(currentIdentity){const snapshot=await writing();ingested=await (options.process||processMailOpportunityInputs)(env,context,currentIdentity,{now:options.now,writingContext:snapshot.available===false?{}:snapshot});}
 }
 if(!stopsRecorded&&currentIdentity)await (options.recordStops||recordClinicCorrespondenceBatchStops)(env,context,currentIdentity,[]);
 return {...progress,opportunitiesQueued:Number(ingested.queued)||0,opportunitiesProcessed:Number(ingested.processed)||0};
}
