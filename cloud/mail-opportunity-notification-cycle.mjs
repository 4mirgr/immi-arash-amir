import {dispatchMailOpportunityNotifications,dispatchTelegramNotifications} from './telegram-notifications.mjs';
import {dispatchMailOpportunityResearch} from './mail-opportunity-research.mjs';
import {getAutomationWritingContext} from './automation-writing-context.mjs';

export async function runMailOpportunityNotificationCycle(env,{fetcher=fetch,now=Date.now(),alerts=dispatchMailOpportunityNotifications,research=dispatchMailOpportunityResearch,publicAlerts=dispatchTelegramNotifications}={}){
 let privateResult;
 try{privateResult=await alerts(env,{fetcher,now});}
 catch{return {private:{status:'outcome_unknown_no_retry'},public:{status:'deferred'}};}
 if(privateResult?.attempted!==0||!['idle','disabled'].includes(privateResult?.status))return {private:privateResult,public:{status:'deferred'}};
 // Keep the other doctor's public alerts moving while a large private research
 // queue is pending. Mail alerts retain first priority on every invocation.
 if(Math.floor(now/900000)%2===1)return {private:privateResult,research:{status:'rotated'},public:await publicAlerts(env,fetcher,now)};
 let reading;
 try{reading=await research(env,{fetcher,now,writingContextProvider:(e,context,f)=>getAutomationWritingContext(e,context.rootUserId,'arash',f)});}
 catch{return {private:privateResult,research:{status:'temporarily_unavailable'},public:{status:'deferred'}};}
 if(reading?.attempted!==false&&reading?.attempted!==0||!['idle','disabled'].includes(reading?.status))return {private:privateResult,research:reading,public:{status:'deferred_research'}};
 return {private:privateResult,research:reading,public:await publicAlerts(env,fetcher,now)};
}
