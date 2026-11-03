import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleLinkedInOAuthRequest as handle,handleLinkedInOAuthCallback as callback} from '../cloud/linkedin-oauth.mjs';
const origin='https://immi-arash-amir.dr-gerami-md.workers.dev',a={userId:'a',profileId:'arash'},b={userId:'b',profileId:'amir'};
function fixture() {
 const db=new DatabaseSync(':memory:');
 for(const file of ['linkedin-schema.sql','linkedin-oauth-schema.sql']) db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const GOOGLE_DB={
  prepare(sql) {
   return {
    bind(...args) {
     const s=db.prepare(sql);
     return {
      async first(){return s.get(...args)||null;},
      async run(){return {meta:s.run(...args)};},
      async all(){return {results:s.all(...args)};}
     };
    }
   };
  }
 };
 return {db,env:{GOOGLE_DB,GOOGLE_TOKEN_KEY:Buffer.alloc(32,6).toString('base64'),LINKEDIN_CLIENT_ID:'test-client',LINKEDIN_CLIENT_SECRET:'synthetic-secret',LINKEDIN_REDIRECT_URI:origin+'/api/linkedin/callback'}};
}
const req=(path,body)=>new Request(origin+'/api/linkedin/'+path,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function begin(env,c=a){const r=await handle(req('connect',{}),env,c),data=await r.json();return {response:r,url:new URL(data.authorizationUrl),cookie:r.headers.get('Set-Cookie').split(';')[0]};}
function provider(sub='member-a',scope='openid profile email w_member_social',publish=()=>new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:123'}})){return async(url,options)=>{if(url.endsWith('/accessToken'))return Response.json({access_token:'synthetic-token-'+sub,expires_in:3600,scope});if(url.endsWith('/userinfo'))return Response.json({sub,name:'Synthetic member',email:'synthetic@example.invalid',email_verified:true});if(url.endsWith('/rest/posts'))return publish(url,options);throw Error('Unexpected provider');};}
const finish=(env,p,fetcher=provider())=>callback(new Request(origin+'/api/linkedin/callback?state='+p.url.searchParams.get('state')+'&code=synthetic-code',{headers:{Cookie:p.cookie}}),env,fetcher);
async function link(env,c=a,sub='member-a',scope){const p=await begin(env,c);assert.equal((await finish(env,p,provider(sub,scope))).status,200);return p;}
function post(db,owner='a'){const id=crypto.randomUUID();db.prepare("INSERT INTO linkedin_posts(id,owner_id,title,text,status,created_at) VALUES(?,?,?,?,?,?)").run(id,owner,'Synthetic post','Synthetic approved text','draft',new Date().toISOString());return id;}

test('missing configuration is explicit, no live analytics or automatic publishing promised',async()=>{const r=await handle(req('connection'),{},a);const s=await r.json();assert.equal(s.configured,false);assert.equal(s.capabilities.liveAnalytics,false);assert.equal(s.capabilities.automaticPublishing,false);assert.equal((await handle(req('connect',{}),{},a)).status,503);});
test('authorization requests real OIDC and posting scope with a browser bound one-use state',async()=>{const {env,db}=fixture();const p=await begin(env);assert.equal(p.url.origin,'https://www.linkedin.com');assert(p.url.searchParams.get('scope').includes('w_member_social'));assert.match(p.response.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.notEqual(db.prepare('SELECT state_hash FROM linkedin_oauth_states').get().state_hash,p.url.searchParams.get('state'));const wrong={...p,cookie:'__Host-immi_linkedin_oauth='+'x'.repeat(43)};assert.equal((await finish(env,wrong)).status,400);assert.equal((await finish(env,p)).status,200);assert.equal((await finish(env,p)).status,400);});
test('missing/expired browser state and denied consent fail safely without credentials',async()=>{const {env,db}=fixture();let p=await begin(env);db.prepare('UPDATE linkedin_oauth_states SET expires_at=0').run();assert.equal((await finish(env,p)).status,400);p=await begin(env);const r=await callback(new Request(origin+'/api/linkedin/callback?state='+p.url.searchParams.get('state')+'&error=access_denied',{headers:{Cookie:p.cookie}}),env);assert.equal(r.status,400);const text=await r.text();assert(text.includes('authorization_denied'));assert(!text.includes('synthetic-secret'));});
test('distinct owners have independent encrypted identity, same LinkedIn account cannot bind twice',async()=>{const {env,db}=fixture();await link(env);const s=await(await handle(req('connection'),env,b)).json();assert.equal(s.connected,false);const p=await begin(env,b);assert.equal((await finish(env,p)).status,400);assert.equal((await(await handle(req('connection'),env,a)).json()).connected,true);const row=db.prepare('SELECT token_cipher FROM linkedin_accounts').get();assert(!row.token_cipher.includes('synthetic-token'));await handle(req('disconnect',{}),env,b);assert.equal((await(await handle(req('connection'),env,a)).json()).connected,true);});
test('actual returned scope and expiration control explicit publication only',async()=>{const {env,db}=fixture();await link(env,a,'member-a','openid profile email');let s=await(await handle(req('connection'),env,a)).json();assert.equal(s.connected,true);assert.equal(s.canPublish,false);const id=post(db);assert.equal((await handle(req('publish',{postId:id}),env,a)).status,403);db.prepare('UPDATE linkedin_accounts SET expires_at=0').run();s=await(await handle(req('connection'),env,a)).json();assert.equal(s.status,'reconnect_required');assert.equal(s.connected,false);assert.equal((await handle(req('publish',{postId:id}),env,a)).status,409);});
test('foreign post and owner/author/body injection rejected before network',async()=>{const {env,db}=fixture();await link(env);const id=post(db,'b');let calls=0;const f=async()=>{calls++;throw Error('Must not call provider')};assert.equal((await handle(req('publish',{postId:id}),env,a,f)).status,404);assert.equal((await handle(req('publish',{postId:id,author:'attacker',text:'injected'}),env,a,f)).status,400);assert.equal((await handle(req('publish?profile=amir',{postId:id}),env,a,f)).status,403);assert.equal(calls,0);});
test('explicit publish freezes current owner and saved text; replay never posts twice',async()=>{const {env,db}=fixture();await link(env);const id=post(db);let calls=0;const f=provider('member-a',undefined,(url,o)=>{calls++;const data=JSON.parse(o.body);assert.equal(data.author,'urn:li:person:member-a');assert.equal(data.commentary,'Synthetic approved text');assert.equal(o.headers['LinkedIn-Version'],'202610');return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:123'}})});let data=await(await handle(req('publish',{postId:id}),env,a,f)).json();assert.equal(data.status,'published');data=await(await handle(req('publish',{postId:id}),env,a,f)).json();assert.equal(data.reused,true);assert.equal(calls,1);const history=await(await handle(req('publications'),env,a)).json();assert.equal(history.publications[0].status,'published');assert.deepEqual((await(await handle(req('publications'),env,b)).json()).publications,[]);});
test('network ambiguity remains terminal and errors never leak provider body or token',async()=>{const {env,db}=fixture();await link(env);const id=post(db);let calls=0;const f=async()=>{calls++;throw Error('secret provider details')};let r=await handle(req('publish',{postId:id}),env,a,f),text=await r.text();assert(text.includes('delivery_unknown'));assert(!text.includes('secret provider'));await handle(req('publish',{postId:id}),env,a,f);assert.equal(calls,1);});
test('daily publication quota is atomic and self-reported publications cannot be duplicated',async()=>{const {env,db}=fixture();await link(env);for(let n=0;n<5;n++){const id=post(db);assert.equal((await(await handle(req('publish',{postId:id}),env,a,provider())).json()).status,'published');}assert.equal((await handle(req('publish',{postId:post(db)}),env,a,provider())).status,429);const id=post(db);db.prepare("UPDATE linkedin_posts SET status='published_by_user' WHERE id=?").run(id);assert.equal((await handle(req('publish',{postId:id}),env,a)).status,409);});
test('cross-origin writes and malformed owner contexts cannot publish or bind',async()=>{const {env}=fixture();assert.equal((await handle(new Request(origin+'/api/linkedin/connect',{method:'POST',headers:{Origin:'https://evil.example'}}),env,a)).status,403);assert.equal((await handle(req('connection'),env,{userId:'a',profileId:'admin'})).status,403);});

test('concurrent explicit publication claims a saved post exactly once',async()=>{
 const {env,db}=fixture();await link(env);const id=post(db);let calls=0;
 const f=provider('member-a',undefined,async()=>{calls++;await new Promise(r=>setTimeout(r,5));return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:456'}})});
 const results=await Promise.all([handle(req('publish',{postId:id}),env,a,f),handle(req('publish',{postId:id}),env,a,f)]);
 const bodies=await Promise.all(results.map(r=>r.json()));assert.equal(calls,1);assert(bodies.some(x=>x.status==='published'));assert.equal(db.prepare('SELECT count(*) AS n FROM linkedin_publish_attempts').get().n,1);
});


test('publication provenance remains bound to the original author after relinking',async()=>{
 const {env,db}=fixture();await link(env,a,'original-member');const id=post(db);let calls=0;
 const f=provider('original-member',undefined,()=>{calls++;return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:987'}})});
 const initial=await(await handle(req('publish',{postId:id}),env,a,f)).json();assert.equal(initial.authorSubject,'original-member');
 await link(env,a,'replacement-member');
 const history=await(await handle(req('publications'),env,a)).json();assert.equal(history.publications[0].authorSubject,'original-member');
 assert.equal(history.publications[0].providerUrn,'urn:li:share:987');
 const replay=await(await handle(req('publish',{postId:id}),env,a,f)).json();assert.equal(replay.authorSubject,'original-member');assert.equal(replay.reused,true);assert.equal(calls,1);
 assert.deepEqual((await(await handle(req('publications'),env,b)).json()).publications,[]);
});


test('OAuth completes with Worker-compatible manual redirect fetch, never unsupported error mode',async()=>{
 const {env}=fixture();const p=await begin(env);let calls=0;const base=provider();
 const workerFetch=async(url,options)=>{if(options.redirect==='error')throw new TypeError('Invalid redirect value');assert.equal(options.redirect,'manual');calls++;return base(url,options);};
 assert.equal((await finish(env,p,workerFetch)).status,200);assert.equal(calls,2);
});
test('OAuth rejects token and identity redirects without following credentials or exposing locations',async()=>{
 for(const stage of ['token','identity']){const {env,db}=fixture(),p=await begin(env);let calls=0;const base=provider();const result=await finish(env,p,async(url,options)=>{calls++;assert.equal(options.redirect,'manual');if(stage==='token'||url.endsWith('/userinfo'))return new Response(null,{status:302,headers:{Location:'https://untrusted.example/private-location'}});return base(url,options);});const text=await result.text();assert.equal(result.status,400);assert(text.includes('linkedin_redirect_rejected'));assert(!text.includes('untrusted.example'));assert.equal(calls,stage==='token'?1:2);assert.equal(db.prepare('select count(*) n from linkedin_accounts').get().n,0);}
});
test('OAuth network stages and client rejection are reportable without secrets',async()=>{
 for(const stage of ['token','identity']){const {env}=fixture(),p=await begin(env),base=provider();const result=await finish(env,p,async(url,options)=>{if(stage==='token'||url.endsWith('/userinfo'))throw Error('sensitive synthetic body');return base(url,options);});const text=await result.text();assert(text.includes('linkedin_'+stage+'_unavailable'));assert(!text.includes('sensitive synthetic body'));}
 const {env}=fixture(),p=await begin(env);const result=await finish(env,p,async()=>Response.json({error:'invalid_client',error_description:'sensitive synthetic detail'},{status:401}));const text=await result.text();assert(text.includes('linkedin_client_rejected'));assert(!text.includes('sensitive synthetic detail'));
});
test('explicit publication uses manual redirects and a redirect remains terminal unknown',async()=>{
 const {env,db}=fixture();await link(env);const id=post(db);let calls=0;const result=await handle(req('publish',{postId:id}),env,a,async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://untrusted.example'}});});assert.equal((await result.json()).status,'delivery_unknown');await handle(req('publish',{postId:id}),env,a,()=>{throw Error('Replay forbidden');});assert.equal(calls,1);
});
