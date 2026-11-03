// Bundle public UI assets and Worker only. Never reads private/ or environment secrets.
import {build} from 'esbuild';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), assets={};
async function collect(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await collect(file);else{const relative='/'+path.relative(path.join(root,'dist'),file).split(path.sep).join('/');if(!/\.(html|css|js|svg|txt|json)$/.test(file))throw Error('Unexpected public asset format');assets[relative]=await readFile(file,'utf8');}}}
await collect(path.join(root,'dist'));
if(!assets['/index.html'])throw Error('Run npm run build first');
await mkdir('worker-dist',{recursive:true});
const entry=`import worker from '../cloud/worker.mjs';
const files=${JSON.stringify(assets)};
export default {async fetch(request,env,ctx){
const ASSETS={async fetch(req){const p=new URL(req.url).pathname;const key=Object.hasOwn(files,p)?p:(p.startsWith('/assets/')?null:'/index.html');if(!key)return new Response('Not found',{status:404});const ext=key.split('.').pop();const types={html:'text/html',css:'text/css',js:'application/javascript',svg:'image/svg+xml',json:'application/json',txt:'text/plain'};return new Response(req.method==='HEAD'?null:files[key],{headers:{'Content-Type':(types[ext]||'text/plain')+'; charset=utf-8','Cache-Control':key.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'}})}};
const response=await worker.fetch(request,{...env,ASSETS},ctx);const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');headers.set('Content-Security-Policy',\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\");return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}};`;
await writeFile('worker-dist/entry.mjs',entry);
await build({entryPoints:['worker-dist/entry.mjs'],outfile:'worker-dist/bundle.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
console.log('Public Worker bundle prepared; no private input included.');
