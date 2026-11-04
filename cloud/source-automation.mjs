// Public operational evidence only; never reads private accounts or provider grants.
export async function runScheduledCollection(event,env,collector){
 const db=env.OPPORTUNITY_DB,started=Date.now(),scheduled=Number.isFinite(event.scheduledTime)?event.scheduledTime:started;
 await db.prepare("INSERT INTO source_scheduler_state(id,started_at,scheduled_at,status) VALUES('public_collector',?,?,'running') ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,scheduled_at=excluded.scheduled_at,finished_at=NULL,status='running'").bind(started,scheduled).run();
 let status='failed';
 try{const result=await collector(env);status=result.status==='partial_failure'?'partial_failure':'completed';return result;}
 finally{await db.prepare("UPDATE source_scheduler_state SET finished_at=?,status=? WHERE id='public_collector' AND started_at=?").bind(Date.now(),status,started).run();}
}
export async function sourceAutomationStatus(env,now=Date.now(),sourceCount=null){
 const row=await env.OPPORTUNITY_DB.prepare("SELECT started_at,finished_at,scheduled_at,status FROM source_scheduler_state WHERE id='public_collector'").bind().first();
 const iso=v=>Number.isFinite(v)?new Date(v).toISOString():null;
 return {mechanism:'cloudflare_cron',requiresOnlineUser:false,cadenceMinutes:60,activeSourceCount:sourceCount,typicalSourceCycleHours:Number.isInteger(sourceCount)&&sourceCount>0?[Math.floor(sourceCount/3),Math.ceil(sourceCount/3)]:[],scope:'registered_public_sources_only',observed:!!row,status:row?.status||'not_observed',overdue:!!row&&now-row.started_at>150*60000,lastStartedAt:iso(row?.started_at),lastFinishedAt:iso(row?.finished_at),scheduledAt:iso(row?.scheduled_at)};
}
