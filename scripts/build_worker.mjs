// Public app/assets only. Credentials and private input are never read by this build.
import {build} from 'esbuild';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),assets={};
const types={html:'text/html',css:'text/css',js:'application/javascript',svg:'image/svg+xml',json:'application/json',webmanifest:'application/manifest+json',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',ico:'image/x-icon',woff2:'font/woff2'};
const binary=new Set(['png','jpg','jpeg','webp','ico','woff2']);
async function collect(folder){
 for(const entry of await readdir(folder,{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(entry.isDirectory()){await collect(file);continue;}
  const ext=path.extname(file).slice(1);if(!types[ext])throw Error('Unexpected public asset format');
  const relative='/'+path.relative(path.join(root,'dist'),file).split(path.sep).join('/');
  const bytes=await readFile(file);
  assets[relative]={type:types[ext],binary:binary.has(ext),body:bytes.toString(binary.has(ext)?'base64':'utf8')};
 }
}
await collect(path.join(root,'dist'));if(!assets['/index.html'])throw Error('Run npm run build first');
await mkdir('worker-dist',{recursive:true});
const entry=`import worker from '../cloud/worker.mjs';
const files=${JSON.stringify(assets)};
export default {async scheduled(event,env,ctx){return worker.scheduled(event,env,ctx);},async fetch(request,env,ctx){
 const ASSETS={async fetch(req){const p=new URL(req.url).pathname;const key=Object.hasOwn(files,p)?p:(p.startsWith('/assets/')?null:'/index.html');if(!key)return new Response('Not found',{status:404});const item=files[key];const data=item.binary?Uint8Array.from(atob(item.body),c=>c.charCodeAt(0)):item.body;return new Response(req.method==='HEAD'?null:data,{headers:{'Content-Type':item.type+(item.binary?'':'; charset=utf-8'),'Cache-Control':key.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'}})}};
 const response=await worker.fetch(request,{...env,ASSETS},ctx);const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');if(!headers.has('Content-Security-Policy'))headers.set('Content-Security-Policy',\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://immi-arash-amir.dr-gerami-md.workers.dev\");return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}};`;
await writeFile('worker-dist/entry.mjs',entry);
await build({entryPoints:['worker-dist/entry.mjs'],outfile:'worker-dist/bundle.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
console.log('Public Worker bundle prepared; binary brand assets supported; no private input included.');
