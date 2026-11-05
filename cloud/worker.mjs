import {createDocx} from './docx.mjs';
import {GoogleError,handleGoogleCallback,handleGoogleLaunch,googleStartOriginAllowed,handleGoogleRequest,googleStatus} from './google-oauth.mjs';
import {handleGoogleMailRequest,getOwnedMailReplyContext} from './google-mail.mjs';
import {handleGoogleSendRequest} from './google-send.mjs';
import {handleGoogleServicesRequest} from './google-services.mjs';
import {handleOpportunityV2Request} from './opportunity-store.mjs';
import {handleRegisteredSourcesRequest,collectRegisteredSources} from './source-collectors.mjs';
import {runScheduledCollection} from './source-automation.mjs';
import {handleLinkedInRequest} from './linkedin-workspace.mjs';
import {handleLinkedInOAuthCallback,handleLinkedInOAuthRequest} from './linkedin-oauth.mjs';
import {handleRoadmapRequest} from './roadmap.mjs';
import {watchEvidenceSources} from './evidence-watch.mjs';
import {runMaintenance} from './maintenance.mjs';
import {handleOperationsRequest} from './operations.mjs';
import {handleUniversityCatalogueRequest} from './university-catalogue.mjs';
import {handlePublicPagesRequest} from './public-page-store.mjs';
import {dispatchPublicPageReading} from './public-page-worker.mjs';
import {dispatchPublicDiscoveryAI} from './public-discovery-ai.mjs';
import {googleAccountContext} from './google-account-scope.mjs';
import {handleLinkedInInsightsRequest} from './linkedin-insights.mjs';
import {handleNetworkTargetsRequest} from './network-targets.mjs';
import {handlePesciPracticeRequest} from './pesci-practice.mjs';
import {handleAiAssistantRequest} from './ai-assistant.mjs';
import {handleMailAutomationRequest} from './mail-automation.mjs';
import {handleOpportunityMailRequest} from './opportunity-mail.mjs';
import {handleTelegramWebhook,handleTelegramRequest,dispatchTelegramNotifications} from './telegram-notifications.mjs';
import {handleOwnerBackupRequest} from './owner-backup.mjs';
import {handleLinkedInSchedulerRequest,dispatchScheduledLinkedIn} from './linkedin-scheduler.mjs';
import {handleMailSchedulerRequest,dispatchScheduledMail} from './mail-automation-scheduler.mjs';
import educationalCase from '../library/pesci/PESCI-PRACTICE-COMM-001.json' with { type: 'json' };

const DEFAULT_SETTINGS = { emailPolicy: 'auto_after_connection', defaultTemplate: '', notifications: false };
const station = { ...educationalCase, prompt: educationalCase.case, questions: educationalCase.prompts, rubric: educationalCase.reflection_rubric, minutes: educationalCase.timing.practice_seconds / 60, educational: true };
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
function config(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new ApiError(503, 'Cloud database setup is incomplete');
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new ApiError(503, 'Invalid cloud configuration');
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  let publicKey = key.startsWith('sb_publishable_');
  if (!publicKey && key.split('.').length === 3) {
    try { const claims = JSON.parse(atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/'))); publicKey = claims.role === 'anon'; } catch { /* Reject malformed or privileged keys. */ }
  }
  if (!publicKey) throw new ApiError(503, 'Only a publishable or legacy anon key may be configured');
  return { url: url.origin, key };
}
async function payload(request) {
  if (Number(request.headers.get('content-length') || 0) > 100000) throw new ApiError(413, 'Payload too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 100000) throw new ApiError(413, 'Payload too large');
  let value; try { value = JSON.parse(text); } catch { throw new ApiError(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Object required');
  return value;
}
export function createHandler(fetcher = fetch) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', {status:404});
    try {
      if(url.pathname==='/api/telegram/webhook')return await handleTelegramWebhook(request,env,fetcher);
      if(url.pathname==='/api/google/launch')return await handleGoogleLaunch(request,env);
      if(url.pathname==='/api/google/callback')return await handleGoogleCallback(request,env,fetcher);
      if(url.pathname==='/api/linkedin/callback')return await handleLinkedInOAuthCallback(request,env,fetcher);
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ok:true, mode:'cloud_auth', authenticationRequired:true, integrationsStatus:'per_account_status_required'});
      const cfg = config(env);
      if (request.method === 'GET' && url.pathname === '/api/public-config') return json({mode:'cloud',authRequired:true,supabaseUrl:cfg.url,publishableKey:cfg.key});
      if (!['GET', 'POST', 'PUT'].includes(request.method)) throw new ApiError(405, 'Method not allowed');
      if (request.method !== 'GET' && request.headers.has('Origin') && request.headers.get('Origin') !== url.origin && !(url.pathname==='/api/google/start'&&googleStartOriginAllowed(request,env))) throw new ApiError(403, 'Origin rejected');
      const authorization = request.headers.get('Authorization');
      if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) throw new ApiError(401, 'Sign in required');
      const headers = {apikey:cfg.key,Authorization:authorization,'Content-Type':'application/json'};
      const userResponse = await fetcher(cfg.url+'/auth/v1/user',{headers});
      if (!userResponse.ok) throw new ApiError(401, 'Session is invalid or expired');
      const user = await userResponse.json();
      if (!user.id || user.is_anonymous) throw new ApiError(403, 'An invited account is required');
      async function rest(table, query = '', options = {}) {
        const response = await fetcher(cfg.url+'/rest/v1/'+table+query,{...options,headers:{...headers,...options.headers}});
        if (!response.ok) throw new ApiError(response.status === 401 ? 401 : response.status === 400 ? 400 : response.status === 409 ? 409 : 502, response.status === 400 ? 'Database rejected invalid content' : 'Database request failed');
        if (response.status === 204) return null;
        return response.json();
      }
      const members = await rest('immi_memberships','?select=profile_id&user_id=eq.'+encodeURIComponent(user.id));
      const profileId = members[0]?.profile_id;
      if (!['arash','amir'].includes(profileId)) throw new ApiError(403, 'Account has not been provisioned for this workspace');
      const requestedProfile = url.searchParams.get('profile');
      if (requestedProfile && requestedProfile !== profileId) throw new ApiError(403, 'Profile access denied');
      if(url.pathname==='/api/research/pages')return await handlePublicPagesRequest(request,env,{userId:user.id,profileId})||json({error:'Not found'},404);
      if(url.pathname==='/api/discovery/universities')return await handleUniversityCatalogueRequest(request,env,{userId:user.id,profileId})||json({error:'Not found'},404);
      if(url.pathname.startsWith('/api/operations/'))return await handleOperationsRequest(request,env,{userId:user.id,profileId,rest})||json({error:'Not found'},404);
      if(url.pathname.startsWith('/api/ai/'))return await handleAiAssistantRequest(request,env,{userId:user.id,profileId,rest})||json({error:'Not found'},404);
      if(url.pathname==='/api/mail-automation/scheduler'||url.pathname.startsWith('/api/mail-automation/scheduler/'))return await handleMailSchedulerRequest(request,env,{userId:user.id,profileId,rest},fetcher)||json({error:'Not found'},404);
      if(url.pathname==='/api/mail-automation'||url.pathname.startsWith('/api/mail-automation/'))return await handleMailAutomationRequest(request,env,{userId:user.id,profileId,rest},fetcher)||json({error:'Not found'},404);
      if(url.pathname.startsWith('/api/telegram/'))return await handleTelegramRequest(request,env,{userId:user.id,profileId,rest},fetcher)||json({error:'Not found'},404);
      if(url.pathname==='/api/backup/export')return await handleOwnerBackupRequest(request,env,{userId:user.id,profileId,rest})||json({error:'Not found'},404);
      if(url.pathname==='/api/pesci/practice'||url.pathname.startsWith('/api/pesci/practice/'))return await handlePesciPracticeRequest(request,env,{userId:user.id,profileId});
      if(url.pathname==='/api/roadmap'||url.pathname==='/api/roadmap/actions'){
        return await handleRoadmapRequest(request,env,{userId:user.id,profileId,rest});
      }
      if(url.pathname==='/api/opportunities'||url.pathname.startsWith('/api/opportunities/')){
        for(const handler of [handleOpportunityMailRequest,handleRegisteredSourcesRequest,handleOpportunityV2Request]){
          const response=await handler(request,env,{userId:user.id,profileId,rest},fetcher);
          if(response)return response;
        }
        throw new ApiError(404,'Not found');
      }
      if(url.pathname.startsWith('/api/linkedin/')){
        for(const handler of [handleLinkedInSchedulerRequest,handleNetworkTargetsRequest,handleLinkedInInsightsRequest,handleLinkedInOAuthRequest,handleLinkedInRequest]){
          const response=await handler(request,env,{userId:user.id,profileId,rest},fetcher);
          if(response)return response;
        }
        throw new ApiError(404,'Not found');
      }
      if(url.pathname.startsWith('/api/google/')){
        const context=googleAccountContext(request,{userId:user.id,profileId,rest});
        for(const handler of [handleGoogleRequest,handleGoogleMailRequest,handleGoogleSendRequest,handleGoogleServicesRequest]){
          const response=await handler(request,env,context,fetcher);
          if(response)return response;
        }
        throw new ApiError(404,'Not found');
      }
      const ownQuery = '?select=data&profile_id=eq.'+profileId;
      const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
      async function versions(table, defaultsTable, defaultColumn) {
        const [items, defaults] = await Promise.all([rest(table,ownQuery),rest(defaultsTable,'?select='+defaultColumn+'&profile_id=eq.'+profileId)]);
        const defaultId = defaults[0]?.[defaultColumn];
        return items.map(r=>({...r.data,isDefault:r.data.id===defaultId})).sort((a,b)=>(b.version||b.revision)-(a.version||a.revision));
      }
      async function chooseDefault(table, defaultsTable, column, id) {
        if (!validId(id)) throw new ApiError(400,'Valid version ID required');
        const items = await rest(table,ownQuery+'&id=eq.'+id);
        if (!items[0]) throw new ApiError(404,'Version not found');
        await rest(defaultsTable,'?on_conflict=profile_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({profile_id:profileId,user_id:user.id,[column]:id})});
        return {...items[0].data,isDefault:true};
      }
      const profiles = async () => (await rest('immi_profiles',ownQuery)).map(r=>r.data);
      const settings = async () => (await rest('immi_settings',ownQuery))[0]?.data || {...DEFAULT_SETTINGS};
      async function clinics() {
        const records = [];
        for (let offset = 0; offset < 20000; offset += 1000) {
          const batch = await rest('immi_clinics','?select=data&order=id&limit=1000&offset='+offset);
          records.push(...batch.map(r=>r.data));
          if (batch.length < 1000) break;
        }
        return records;
      }
      const integrations = Object.fromEntries(['gmail','drive','calendar','telegram','ai','crawler'].map(k=>[k,{connected:false,status:'setup_required'}]));
      integrations.ai={connected:env.AI_ENABLED==='true'&&typeof env.AI?.run==='function',status:env.AI_ENABLED==='true'&&typeof env.AI?.run==='function'?'bounded_requests_enabled':'setup_required'};
      integrations.crawler={connected:Boolean(env.OPPORTUNITY_DB),status:'bounded_registered_sources_only'};
      if (request.method === 'GET') {
        switch (url.pathname) {
          case '/api/bootstrap': { if(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_WEBHOOK_SECRET&&env.GOOGLE_DB){try{const tr=await handleTelegramRequest(new Request(url.origin+'/api/telegram/status?profile='+profileId),env,{userId:user.id,profileId},fetcher);if(tr?.ok){const t=await tr.json();integrations.telegram={connected:Boolean(t.configured&&t.connected),enabled:Boolean(t.enabled),status:t.connected?'linked':'setup_required'};}}catch{}} const [c,p,s,revision,g] = await Promise.all([clinics(),profiles(),settings(),rest('rpc/immi_dataset_revision'),googleStatus(env,user.id)]); for(const [key,capability] of [['gmail','gmailRead'],['drive','drive'],['calendar','calendar']])integrations[key]={connected:g.connected&&Boolean(g.capabilities?.[capability]),status:g.status,email:g.email}; return json({clinics:c,profiles:p,stations:[station],settings:s,integrations,mode:'cloud',currentProfileId:profileId,profileId,revision}); }
          case '/api/updates': return json({revision:await rest('rpc/immi_dataset_revision')});
          case '/api/cv/versions': return json(await versions('immi_cv_versions','immi_cv_defaults','version_id'));
          case '/api/presets': return json(await versions('immi_presets','immi_preset_defaults','preset_id'));
          case '/api/cv/export': {
            const id=url.searchParams.get('id'); const format=url.searchParams.get('format')||'txt';
            if (!validId(id)) throw new ApiError(400,'Valid version ID required');
            if (!['txt','docx'].includes(format)) throw new ApiError(400,'Supported export formats: txt, docx');
            const items=await rest('immi_cv_versions','?select=text,version&profile_id=eq.'+profileId+'&id=eq.'+id);
            if (!items[0]) throw new ApiError(404,'CV version not found');
            return new Response(format==='docx'?createDocx(items[0].text):items[0].text,{headers:{'Content-Type':format==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="cv-'+profileId+'-v'+items[0].version+'.'+format+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
          }
          case '/api/me': return json({profileId,userId:user.id});
          case '/api/clinics': return json(await clinics());
          case '/api/profiles': return json(await profiles());
          case '/api/stations': return json([station]);
          case '/api/settings': return json(await settings());
          case '/api/drafts': return json((await rest('immi_drafts',ownQuery+'&order=created_at.desc')).map(r=>r.data));
          default: throw new ApiError(404, 'Not found');
        }
      }
      const body = await payload(request);
      if ((body.profileId && body.profileId !== profileId) || (body.profile_id && body.profile_id !== profileId)) throw new ApiError(403, 'Profile access denied');
      if (request.method === 'POST' && url.pathname === '/api/cv/versions') {
        if (Object.keys(body).some(k=>!['name','expectedSourceHash'].includes(k)) || typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>120 || /[\x00-\x1f]/.test(body.name)) throw new ApiError(400,'Valid template name required');
        if (body.expectedSourceHash!=null && (typeof body.expectedSourceHash!=='string' || !/^[a-f0-9]{64}$/.test(body.expectedSourceHash))) throw new ApiError(400,'Invalid source hash');
        return json(await rest('rpc/immi_create_cv_version','',{method:'POST',body:JSON.stringify({p_name:body.name.trim(),p_expected_hash:body.expectedSourceHash||null})}),201);
      }
      if (request.method === 'POST' && url.pathname === '/api/cv/default') return json(await chooseDefault('immi_cv_versions','immi_cv_defaults','version_id',body.id));
      if (request.method === 'POST' && url.pathname === '/api/presets/default') return json(await chooseDefault('immi_presets','immi_preset_defaults','preset_id',body.id));
      if (request.method === 'POST' && url.pathname === '/api/presets') {
        if (typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>120||typeof body.subject!=='string'||!body.subject.trim()||body.subject.length>500||/[\r\n]/.test(body.subject)||typeof body.body!=='string'||!body.body.trim()||body.body.length>50000) throw new ApiError(400,'Valid preset name, subject and body required');
        return json(await rest('rpc/immi_save_preset','',{method:'POST',body:JSON.stringify({p_name:body.name.trim(),p_subject:body.subject,p_body:body.body})}),201);
      }
      if (request.method === 'POST' && url.pathname === '/api/drafts') {
        if (typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 500 || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 50000) throw new ApiError(400, 'Valid subject and body required');
        if (!Array.isArray(body.clinicIds) || body.clinicIds.length > 200 || body.clinicIds.some(id=>typeof id !== 'string' || !/^cl_[a-f0-9]{20}$/.test(id))) throw new ApiError(400, 'Invalid clinic selection');
        const clinicIds = [...new Set(body.clinicIds)];
        if (clinicIds.length) {
          const known = await rest('immi_clinics','?select=id&id=in.('+clinicIds.join(',')+')');
          if (known.length !== clinicIds.length) throw new ApiError(400, 'Unknown clinic');
        }
        const draftUrl=new URL(request.url);draftUrl.searchParams.set('mailbox',body.mailbox===undefined?'primary':body.mailbox);
        const draftAccount=googleAccountContext(new Request(draftUrl),{userId:user.id,profileId,rest});
        const data = {id:crypto.randomUUID(),profileId,clinicIds,subject:body.subject,body:body.body,status:'draft',mailbox:draftAccount.mailbox};
        if(body.replyContext!==undefined){
          if(!body.replyContext||typeof body.replyContext!=='object'||Array.isArray(body.replyContext)||Object.keys(body.replyContext).some(k=>!['messageId','threadId','to'].includes(k)))throw new ApiError(400,'Invalid reply context');
          try{data.replyContext=await getOwnedMailReplyContext(env,draftAccount.userId,body.replyContext,fetcher);}catch(error){if(/^[a-z_]{3,80}$/.test(error.code||'')&&Number.isInteger(error.status)&&error.status>=400&&error.status<600)throw new ApiError(error.status,error.code);throw error;}
        }
        await rest('immi_drafts','',{method:'POST',body:JSON.stringify({id:data.id,user_id:user.id,profile_id:profileId,data}),headers:{Prefer:'return=minimal'}});
        return json(data,201);
      }
      if (request.method === 'PUT' && url.pathname === '/api/settings') {
        const data = await settings();
        if ('emailPolicy' in body) { if (!['approval_required','auto_after_connection'].includes(body.emailPolicy)) throw new ApiError(400,'Unknown email policy'); data.emailPolicy=body.emailPolicy; }
        if ('defaultTemplate' in body) { if (typeof body.defaultTemplate !== 'string' || body.defaultTemplate.length > 200) throw new ApiError(400,'Invalid template'); data.defaultTemplate=body.defaultTemplate; }
        if ('notifications' in body) { if (typeof body.notifications !== 'boolean') throw new ApiError(400,'Invalid notification preference'); data.notifications=body.notifications; }
        await rest('immi_settings','?on_conflict=profile_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({profile_id:profileId,user_id:user.id,data})});
        return json(data);
      }
      throw new ApiError(404,'Not found');
    } catch (error) { const expected=error instanceof ApiError||error instanceof GoogleError;return json({error:expected ? error.message : 'Request failed',...(error instanceof GoogleError?{code:error.code}:{})},expected ? error.status : 500); }
  };
}
export default {fetch:createHandler(),async scheduled(event,env){const cron=event.cron||'0 * * * *';if(cron==='*/15 * * * *')return await dispatchTelegramNotifications(env);if(cron==='*/5 * * * *'){const publication=await dispatchScheduledLinkedIn(env);const reading=await dispatchPublicPageReading(env);const discoveryAI=await dispatchPublicDiscoveryAI(env);return {publication,reading,discoveryAI};}if(cron==='2-57/5 * * * *')return await dispatchScheduledMail(env);if(cron==='15 */6 * * *'){const maintenance=await runMaintenance(env);const evidence=await watchEvidenceSources(env);return {maintenance,evidence};}return await runScheduledCollection(event,env,collectRegisteredSources);}};
