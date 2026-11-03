// Fresh server-to-server account authorization. This never grants provider access.
const unavailable=()=>({active:false,reason:'membership_check_unavailable'});
export async function checkAutomationMembership(env,ownerId,profileId,fetcher=fetch){
 try{
  if(typeof ownerId!=='string'||!ownerId||ownerId.length>120||/[\x00-\x1f]/.test(ownerId)||!['amir','arash'].includes(profileId))return unavailable();
  if(typeof env.AUTOMATION_MEMBERSHIP_KEY!=='string'||!/^[-A-Za-z0-9_]{32,256}$/.test(env.AUTOMATION_MEMBERSHIP_KEY)||typeof env.SUPABASE_PUBLISHABLE_KEY!=='string'||!env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'))return unavailable();
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(base.hostname)||base.pathname!=='/'||base.search||base.hash||base.username||base.password||base.port)return unavailable();
  const response=await fetcher(base.origin+'/rest/v1/rpc/immi_automation_owner_active',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_owner:ownerId,p_profile:profileId,p_key:env.AUTOMATION_MEMBERSHIP_KEY}),redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(!response.ok||response.status>=300&&response.status<400){await response.body?.cancel();return unavailable();}
  if(Number(response.headers.get('Content-Length')||0)>1024){await response.body?.cancel();return unavailable();}
  const reader=response.body?.getReader();if(!reader)return unavailable();let bytes=0,body='';const decoder=new TextDecoder();
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024){await reader.cancel();return unavailable();}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{reader.releaseLock();}
  const active=JSON.parse(body);if(typeof active!=='boolean')return unavailable();
  return {active,reason:active?'active':'owner_inactive'};
 }catch{return unavailable();}
}
