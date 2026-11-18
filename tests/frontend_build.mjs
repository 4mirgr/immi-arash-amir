import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {buildFrontend,createFrontendServer,parseOptions} from '../scripts/frontend.mjs';

async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'aus-frontend-test-'));
 for(const folder of ['src','public/fonts','private','cloud'])await mkdir(path.join(root,folder),{recursive:true});
 const put=(name,value)=>writeFile(path.join(root,name),value);
 await put('index.html','<!doctype html><html><head><link rel="icon" href="/brand-aa-32.png"/><link rel="preload" href="/fonts/test.woff2"/></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>');
 await put('src/main.jsx',"import './style.css'; window.__mount=import.meta.env.BASE_URL;window.__mode=process.env.NODE_ENV;window.__brand='/brand-aa-32.png';document.getElementById('root').textContent='Ready';window.__lazy=()=>import('./lazy.jsx');");
 await put('src/style.css',"@font-face{font-family:Local;src:url('/fonts/test.woff2')} #root{color:rgb(1,2,3)}");
 await put('src/lazy.jsx',"import './lazy.css';export const answer='Lazy module ready';export const show=()=>{document.getElementById('root').className='lazy-panel';};");
 await put('src/lazy.css','.lazy-panel{background:rgb(20,30,40);padding:17px}');
 await put('public/fonts/test.woff2',new Uint8Array([0,1,2,3]));await put('public/brand-aa-32.png',new Uint8Array([0,1,2,3]));
 await put('.env','SECRET_MUST_NOT_ENTER_PUBLIC_BUILD=private-marker');await put('private/cv.txt','Private CV marker');await put('cloud/private.txt','Private server marker');
 return {root,put,async cleanup(){await rm(root,{recursive:true,force:true});}};
}

test('build emits deterministic hashed modules, lazy CSS and mount-prefixed local fonts without private inputs',async()=>{
 const f=await fixture();
 try{
  const first=await buildFrontend({root:f.root,base:'/aus/'}),html=await readFile(path.join(first.dist,'index.html'),'utf8');
  assert.match(first.script,/^\/aus\/assets\/index-[A-Z0-9]+\.js$/);assert.equal((html.match(/\/aus\/assets\/index-/g)||[]).length,2);
  assert(html.includes('href="/aus/brand-aa-32.png"'));assert(html.includes('href="/aus/fonts/test.woff2"'));assert(!html.includes('/aus/aus/'));assert(!html.includes('/src/main.jsx'));
  const css=await readFile(path.join(first.dist,first.css.slice('/aus/'.length)),'utf8');assert.match(css,/\.lazy-panel/);assert.match(css,/\/aus\/fonts\/test\.woff2/);
  const entry=await readFile(path.join(first.dist,first.script.slice('/aus/'.length)),'utf8');assert.match(entry,/_mount="\/aus\/"/);assert.match(entry,/_mode="production"/);assert.match(entry,/\/aus\/brand-aa-32\.png/);
  const outputs=await readdir(first.dist);assert(!outputs.includes('private'));assert(!outputs.includes('cloud'));assert(!outputs.includes('.env'));assert(!html.includes('private-marker'));
  const assets=await readdir(path.join(first.dist,'assets'));assert(assets.some(name=>name.startsWith('lazy-')&&name.endsWith('.js')));
  await f.put('.env','CHANGED_PRIVATE_VALUE=not-public');const second=await buildFrontend({root:f.root,base:'/aus/'});assert.equal(second.script,first.script);assert.equal(second.css,first.css);
 }finally{await f.cleanup();}
});
test('unsafe mounts/options and linked public files fail before exposing data',async()=>{
 for(const base of ['https://elsewhere.invalid/','//elsewhere.invalid/','/../','/aus','/bad path/','/a%2fb/'])assert.throws(()=>parseOptions(['build','--base='+base]));
 assert.throws(()=>parseOptions(['preview','--host=0.0.0.0']));assert.throws(()=>parseOptions(['dev','--port=NaN']));assert.throws(()=>parseOptions(['build','--unknown']));
 assert.equal(parseOptions(['build','--base','/aus/']).base,'/aus/');assert.equal(parseOptions(['dev']).port,5173);assert.equal(parseOptions(['preview']).port,4173);
 const f=await fixture();try{await symlink(path.join(f.root,'.env'),path.join(f.root,'public','linked.txt'));await assert.rejects(buildFrontend({root:f.root}),/Linked public inputs/);}finally{await f.cleanup();}
});
test('loopback preview serves the chosen mount, keeps SPA navigation and refuses missing assets and traversal',async()=>{
 const f=await fixture();let server;
 try{
  const built=await buildFrontend({root:f.root,base:'/aus/'});server=createFrontendServer({root:f.root,base:'/aus/'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const html=await fetch(origin+'/aus/');assert.equal(html.status,200);assert.match(html.headers.get('content-type'),/text\/html/);assert.equal((await fetch(origin+built.script)).status,200);
  assert.equal((await fetch(origin+'/aus/next/route')).status,200);assert.equal((await fetch(origin+'/aus/assets/missing.js')).status,404);assert.equal((await fetch(origin+'/private/cv.txt')).status,404);assert.equal((await fetch(origin+'/aus/%2f..%2f.env')).status,404);
  const rejectedHost=await new Promise((resolve,reject)=>{const request=httpRequest(origin+'/aus/',{headers:{Host:'evil.example.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});assert.equal(rejectedHost,403);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.cleanup();}
});
