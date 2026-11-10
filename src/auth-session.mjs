// In-memory only. Refresh credentials never enter browser storage or UI checkpoints.
export function createSessionRenewal({requestTokens,verifySession,onSession=()=>{},onState=()=>{},onInvalid=()=>{},now=()=>Date.now()}) {
 let session=null,pending=null,flight=null,version=0,attempts=0,retryAt=0,refreshCredential=null;
 const current=()=>session;
 function clear(){version++;session=null;pending=null;flight=null;attempts=0;retryAt=0;refreshCredential=null;}
 function replace(value){clear();session=value;refreshCredential=value?.refresh_token||null;}
 function unavailable(){return Object.assign(Error('session_refresh_pending'),{status:503,transient:true});}
 async function ensure({force=false}={}){
  if(!session)return '';
  if(session.expiresAt-now()<=20000)onState({status:'locked',nextRetryAt:retryAt});
  if(flight)return flight;
  const valid=()=>!!session&&session.expiresAt-now()>20000;
  if(!pending&&session.expiresAt-now()>60000)return session.access_token;
  if(!force&&retryAt>now()){
   if(!valid()){onState({status:'locked',nextRetryAt:retryAt});throw unavailable();}
   return session.access_token;
  }
  const epoch=version,owned=session;
  const active=()=>version===epoch&&session!==null;
  const task=(async()=>{
   try{
    if(!pending){
     const tokens=await requestTokens(refreshCredential);
     if(!active())throw unavailable();
     const lifetime=Number(tokens?.expires_in);
     if(typeof tokens?.access_token!=='string'||!tokens.access_token||!Number.isFinite(lifetime)||lifetime<=0)throw unavailable();
     // Rotation must survive a transient /me failure; never reuse the spent refresh token.
     refreshCredential=tokens.refresh_token||refreshCredential;
     const expiry=now()+lifetime*1000,absolute=Number(tokens.expires_at)*1000;
     pending={...tokens,refresh_token:refreshCredential,expiresAt:Number.isFinite(absolute)?Math.min(expiry,absolute):expiry};
    }
    if(pending.expiresAt-now()<=20000){pending=null;throw unavailable();}
    const verified=await verifySession(pending.access_token);
    if(!active())throw unavailable();
    if(pending.expiresAt-now()<=20000){pending=null;throw unavailable();}
    if(verified.profileId!==owned.profileId||verified.workspaceOwnerId!==owned.workspaceOwnerId)throw Object.assign(Error('workspace_identity_changed'),{authTerminal:true});
    session={...owned,...pending};pending=null;attempts=0;retryAt=0;
    onSession(session);onState({status:'ready',nextRetryAt:0});return session.access_token;
   }catch(error){
    if(!active())throw unavailable();
    if(error?.authTerminal){clear();onInvalid(error);throw error;}
    attempts++;retryAt=now()+Math.min(30000,1000*2**Math.min(attempts,5));
    onState({status:valid()?'retrying':'locked',nextRetryAt:retryAt});
    if(valid())return session.access_token;
    throw unavailable();
   }
  })();
  flight=task;
  try{return await task;}finally{if(flight===task)flight=null;}
 }
 return {current,replace,clear,ensure};
}
