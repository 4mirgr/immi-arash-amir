// Server-only minimal writing/CV read. Never returns a session or send consent.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const unavailable=()=>({available:false,code:'writing_context_unavailable'});
export async function getAutomationWritingContext(env,ownerId,profileId,fetcher=fetch){
 if(!UUID.test(ownerId||'')||profileId!=='arash'||!/^[-A-Za-z0-9_]{32,256}$/.test(env.AUTOMATION_MEMBERSHIP_KEY||'')||!env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'))return unavailable();
 let base;try{base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(base.hostname)||base.pathname!=='/'||base.search||base.hash||base.username||base.password||base.port)return unavailable();}catch{return unavailable();}
 try{
  const response=await fetcher(base.origin+'/rest/v1/rpc/immi_automation_writing_context',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_owner:ownerId,p_profile:profileId,p_key:env.AUTOMATION_MEMBERSHIP_KEY}),signal:AbortSignal.timeout(10000),redirect:'manual'});
  if(!response.ok||response.redirected){await response.body?.cancel();return unavailable();}
  if(Number(response.headers.get('content-length')||0)>1000000){await response.body?.cancel();return unavailable();}
  const reader=response.body?.getReader();if(!reader)return unavailable();let raw='',bytes=0;const decoder=new TextDecoder();
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>1000000){await reader.cancel();return unavailable();}raw+=decoder.decode(next.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  const snapshot=JSON.parse(raw);
  if(!snapshot||snapshot.ownerId!==ownerId||snapshot.profileId!==profileId||snapshot.transportApproved!==false||!snapshot.profile||typeof snapshot.profile!=='object'||Array.isArray(snapshot.profile))return unavailable();
  const cv=snapshot.cv;if(cv&&(!UUID.test(cv.id||'')||typeof cv.text!=='string'||cv.text.length>200000||!Number.isSafeInteger(cv.version)||cv.version<1))return unavailable();
  return {available:true,profile:snapshot.profile,cvText:cv?.text||'',cvVersionId:cv?.id||null,cvVersion:cv?.version||null,isDefault:cv?.isDefault===true,snapshotAt:snapshot.snapshotAt,transportApproved:false};
 }catch{return unavailable();}
}
