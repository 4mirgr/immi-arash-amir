import {dispatchMailOpportunityNotifications,dispatchTelegramNotifications} from './telegram-notifications.mjs';
import {dispatchMailOpportunityResearch} from './mail-opportunity-research.mjs';
import {getAutomationWritingContext} from './automation-writing-context.mjs';

export async function runMailOpportunityNotificationCycle(env,{fetcher=fetch,now=Date.now(),alerts=dispatchMailOpportunityNotifications,research=dispatchMailOpportunityResearch,publicAlerts=dispatchTelegramNotifications}={}){
 if(!Number.isSafeInteger(now)||now<0)return {private:{status:'invalid_scheduled_time'},public:{status:'deferred'}};
 // Three turns within six minutes: a dedicated research turn, a private-alert
 // turn with research fallback, then a private/public-alert turn. A source or
 // Telegram error cannot permanently starve public corroboration. Each turn
 // retains the existing one-work-lane/free-tier request budget.
 const phase=Math.floor(now/120000)%3;
 const read=()=>research(env,{fetcher,now,writingContextProvider:(e,context,f)=>getAutomationWritingContext(e,context.rootUserId,'arash',f)});
 if(phase===0){
  try{return {private:{status:'deferred_research_turn'},research:await read(),public:{status:'deferred_research'}};}
  catch{return {private:{status:'deferred_research_turn'},research:{status:'temporarily_unavailable'},public:{status:'deferred'}};}
 }
 let privateResult;
 try{privateResult=await alerts(env,{fetcher,now});}
 catch{return {private:{status:'outcome_unknown_no_retry'},public:{status:'deferred'}};}
 if(privateResult?.attempted!==0||!['idle','disabled'].includes(privateResult?.status))return {private:privateResult,public:{status:'deferred'}};
 // The other doctor's public alerts retain a scheduled turn even with a large
 // private research backlog. Never append work after an uncertain send.
 if(phase===2)return {private:privateResult,research:{status:'rotated'},public:await publicAlerts(env,fetcher,now)};
 let reading;
 try{reading=await read();}
 catch{return {private:privateResult,research:{status:'temporarily_unavailable'},public:{status:'deferred'}};}
 if(reading?.attempted!==false&&reading?.attempted!==0||!['idle','disabled'].includes(reading?.status))return {private:privateResult,research:reading,public:{status:'deferred_research'}};
 return {private:privateResult,research:reading,public:await publicAlerts(env,fetcher,now)};
}
