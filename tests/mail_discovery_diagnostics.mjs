import test from 'node:test';
import assert from 'node:assert/strict';
import {syncMailDiscovery} from '../cloud/mail-discovery-pipeline.mjs';

const context={userId:'11111111-1111-4111-8111-111111111111',profileId:'arash'},identity={subject:'synthetic-own-subject',email:'owner@example.invalid'};
const privateError=()=>{throw Error('PRIVATE_PROVIDER_OR_SQL_MESSAGE');};
function options(overrides={}){return {reader:async(env,scoped,fetcher,callbacks)=>{await callbacks.onMessages([{id:'synthetic-message'}],scoped,identity);return {status:'connected'};},writingContextProvider:async()=>({available:true}),ingest:async()=>({queued:0,processed:0}),recordStops:async()=>({recorded:0}),...overrides};}
for(const [key,code] of [['writingContextProvider','mail_writing_context_failed'],['ingest','mail_opportunity_ingestion_failed'],['recordStops','mail_contact_stop_recording_failed']])test('mail discovery exposes only the safe failing stage: '+key,async()=>{
 await assert.rejects(()=>syncMailDiscovery({},context,()=>{},options({[key]:privateError})),error=>error.code===code&&error.message===code&&!JSON.stringify(error).includes('PRIVATE_PROVIDER_OR_SQL_MESSAGE'));
});
test('typed authorization errors retain their meaning rather than being reported as an internal failure',async()=>{
 const failure=Object.assign(Error('Renew this owner grant'),{code:'reconnect_required',status:409});
 await assert.rejects(()=>syncMailDiscovery({},context,()=>{},options({ingest:async()=>{throw failure;}})),error=>error===failure);
});
test('deleted-source handling has an independent safe stage and cannot silently advance the caller',async()=>{
 let returned=false;
 const config=options({reader:async(env,scoped,fetcher,callbacks)=>{await callbacks.onDeleted(['synthetic-message'],scoped,identity);returned=true;return {};},invalidate:privateError});
 await assert.rejects(()=>syncMailDiscovery({},context,()=>{},config),error=>error.code==='mail_opportunity_removal_failed');assert.equal(returned,false);
});
