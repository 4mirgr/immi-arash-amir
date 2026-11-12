import test from 'node:test';
import assert from 'node:assert/strict';
import {readQueuedPage,PUBLIC_PAGE_REQUEST_LIMIT} from '../cloud/public-page-worker.mjs';
const row=url=>({id:'page_synthetic',url,data:JSON.stringify({officialBases:['clinic.example']})});
const page=()=>new Response('<html><main>General practitioner enquiries: published@clinic.example</main></html>',{headers:{'Content-Type':'text/html'}});
test('canonical HTTPS robots and www page redirects are followed inside a shared request budget',async()=>{
 const requests=[];
 const out=await readQueuedPage(row('https://www.clinic.example/'),async url=>{requests.push(url);if(url==='https://www.clinic.example/robots.txt')return new Response(null,{status:301,headers:{Location:'https://clinic.example/robots.txt'}});if(url==='https://clinic.example/robots.txt')return new Response('User-agent: *\nAllow: /');if(url==='https://www.clinic.example/')return new Response(null,{status:302,headers:{Location:'https://clinic.example/'}});return page();});
 assert.equal(out.status,'read');assert.equal(out.finalUrl,'https://clinic.example/');assert.equal(requests.length,4);assert.equal(requests.filter(x=>x==='https://clinic.example/robots.txt').length,1);assert(out.enrichment.contacts.some(c=>c.value==='published@clinic.example'));
});
test('foreign, insecure, private-action and credential robots redirects never become fetches',async()=>{
 for(const destination of ['https://foreign.example/robots.txt','http://clinic.example/robots.txt','https://clinic.example/login','https://user:secret@clinic.example/robots.txt','https://clinic.example/robots.txt?token=secret','https://127.0.0.1/robots.txt']){
  const requests=[];const out=await readQueuedPage(row('https://clinic.example/'),async url=>{requests.push(url);return new Response(null,{status:302,headers:{Location:destination}});});
  assert.equal(out.status,'invalid_url',destination);assert.deepEqual(requests,['https://clinic.example/robots.txt']);
 }
});
test('robots redirects preserve disallow and authorization denial, never fetch the protected page',async()=>{
 for(const [status,body]of [[200,'User-agent: *\nDisallow: /'],[401,''],[403,'']]){
  const requests=[];const out=await readQueuedPage(row('https://clinic.example/'),async url=>{requests.push(url);if(url.endsWith('/robots.txt'))return new Response(null,{status:302,headers:{Location:'/robots-canonical.txt'}});return new Response(body,{status});});
  assert.equal(out.status,'robots_blocked');assert.equal(requests.length,2);assert(!requests.includes('https://clinic.example/'));
 }
});
test('all robots and document redirects stop at the six-request budget and malformed metadata fails closed',async()=>{
 const requests=[];const out=await readQueuedPage(row('https://clinic.example/'),async url=>{requests.push(url);const u=new URL(url);if(u.pathname==='/robots.txt')return new Response(null,{status:302,headers:{Location:'/robots-canonical.txt'}});if(u.pathname==='/robots-canonical.txt')return new Response('User-agent: *\nAllow: /');return new Response(null,{status:302,headers:{Location:'https://hop'+requests.length+'.clinic.example/'}});});
 assert.equal(out.status,'request_budget_exhausted');assert.equal(requests.length,PUBLIC_PAGE_REQUEST_LIMIT);
 const malformed=await readQueuedPage({...row('https://clinic.example/'),data:'not-json'},()=>{throw Error('must not fetch');});assert.equal(malformed.status,'invalid_url');
});
test('empty robots 404 policy is cached across same-origin page redirects',async()=>{
 const requests=[];const out=await readQueuedPage(row('https://clinic.example/'),async url=>{requests.push(url);if(url.endsWith('/robots.txt'))return new Response(null,{status:404});if(url==='https://clinic.example/')return new Response(null,{status:301,headers:{Location:'/home'}});return page();});
 assert.equal(out.status,'read');assert.equal(requests.length,3);assert.equal(requests.filter(x=>x.endsWith('/robots.txt')).length,1);
});
