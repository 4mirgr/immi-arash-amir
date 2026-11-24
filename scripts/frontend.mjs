// Public React build and loopback-only preview. Uses the already pinned esbuild;
// never reads .env, credentials, imported CVs or the private/server directories.
import {build} from 'esbuild';
import {createServer,request as httpRequest} from 'node:http';
import {watch} from 'node:fs';
import {cp,lstat,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseOptions(args){
 const mode=args[0]||'build';if(!['build','dev','preview'].includes(mode))throw Error('Select build, dev or preview');
 const options={mode,base:'/',host:'127.0.0.1',port:mode==='dev'?5173:4173};
 for(let i=1;i<args.length;i++){
  const match=/^--(base|host|port)(?:=(.*))?$/.exec(args[i]);
  if(args[i]==='--strictPort')continue;
  if(!match)throw Error('Unknown frontend option');
  const value=match[2]===undefined?args[++i]:match[2];if(value===undefined||value.startsWith('--'))throw Error('Frontend option needs a value');
  options[match[1]]=match[1]==='port'?Number(value):value;
 }
 if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(options.base))throw Error('Base must be a local path ending in /');
 if(!['127.0.0.1','localhost','::1'].includes(options.host))throw Error('Development and preview bind to loopback only');
 if(!Number.isInteger(options.port)||options.port<1||options.port>65535)throw Error('Invalid frontend port');
 return options;
}
async function assertPublicTree(folder){
 const info=await lstat(folder);if(info.isSymbolicLink())throw Error('Linked public inputs are not allowed');
 if(info.isDirectory())for(const entry of await readdir(folder))await assertPublicTree(path.join(folder,entry));
}
function publicURL(base,value){return value.startsWith('/')&&!value.startsWith('//')?base+value.slice(1):value;}
function rewriteHTML(html,base){return html.replace(/\b(src|href)=(['"])(\/(?!\/)[^'"]*)\2/g,(_m,attr,quote,value)=>attr+'='+quote+publicURL(base,value)+quote);}
const cssPublicURLs=(css,base)=>css.replace(/url\(\s*(['"]?)(\/(?!\/)[^)'"\s]*)\1\s*\)/g,(_m,quote,url)=>'url('+quote+publicURL(base,url)+quote+')');

export async function buildFrontend({root=process.cwd(),base='/',development=false}={}){
 // Validate the same mount contract for imports/tests and the command line.
 parseOptions(['build','--base='+base]);root=path.resolve(root);
 const dist=path.join(root,'dist'),publicDir=path.join(root,'public');
 await assertPublicTree(publicDir);
 await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
 await cp(publicDir,dist,{recursive:true,dereference:false});
 const plugin={name:'public-mount',setup(builder){
  builder.onLoad({filter:/\.css$/},async({path:filename})=>({contents:cssPublicURLs(await readFile(filename,'utf8'),base),loader:'css',resolveDir:path.dirname(filename)}));
  builder.onLoad({filter:/\.[cm]?jsx?$/},async({path:filename})=>{
   if(!filename.startsWith(path.join(root,'src')+path.sep))return;
   // Root-relative brand strings are public assets, not API/provider URLs.
   const contents=(await readFile(filename,'utf8')).replace(/(['"])\/(brand-aa-[A-Za-z0-9_.-]+)\1/g,(_m,quote,name)=>quote+base+name+quote);
   return {contents,loader:filename.endsWith('.jsx')?'jsx':'js',resolveDir:path.dirname(filename)};
  });
 }};
 let html=await readFile(path.join(root,'index.html'),'utf8');
 const original=/<script\b[^>]*\btype=['"]module['"][^>]*\bsrc=['"]\/(src\/(?:entry|main)\.jsx)['"][^>]*><\/script>/g;
 const entries=[...html.matchAll(original)];
 if(entries.length!==1)throw Error('Public HTML entry contract changed');
 const entryPoint=entries[0][1],deferWorkspace=html.includes('<!-- workspace-styles -->');
 const result=await build({absWorkingDir:root,entryPoints:{index:entryPoint},outdir:dist,bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:!development,sourcemap:false,metafile:true,entryNames:'assets/[name]-[hash]',chunkNames:'assets/[name]-[hash]',assetNames:'assets/[name]-[hash]',external:['/fonts/*',base+'fonts/*'],plugins:[plugin],define:{'process.env.NODE_ENV':JSON.stringify(development?'development':'production'),'import.meta.env.BASE_URL':JSON.stringify(base),'import.meta.env.DEV':String(development),'import.meta.env.PROD':String(!development)},logLevel:'silent'});
 const outputs=Object.entries(result.metafile.outputs),entry=outputs.find(([,meta])=>meta.entryPoint===entryPoint);
 if(!entry)throw Error('Public frontend entry is missing');
 const relative=filename=>path.relative(dist,path.resolve(root,filename)).split(path.sep).join('/');
 const script=base+relative(entry[0]),cssBundle=entry[1].cssBundle;
 // esbuild includes CSS from dynamic imports in the entry's CSS bundle. Verify
 // that contract instead of shipping a lazy screen with missing styles.
 const cssInputs=new Set(Object.entries(result.metafile.outputs[cssBundle]?.inputs||{}).filter(([filename])=>filename.endsWith('.css')).map(([filename])=>filename));
 for(const [filename,meta]of outputs.filter(([filename])=>filename.endsWith('.css')))for(const input of Object.keys(meta.inputs||{}))if(input.endsWith('.css')&&!cssInputs.has(input))throw Error('Lazy screen CSS is missing from the public entry');
 html=html.replace(original,'<!-- public-frontend-entry -->');
 html=rewriteHTML(html,base);
 html=html.replace('<!-- public-frontend-entry -->','<script type="module" src="'+script+'"></script>');
 if(deferWorkspace){
  const preloads=entry[1].imports.filter(item=>item.kind==='import-statement'&&!item.external)
   .map(item=>'<link rel="modulepreload" href="'+base+relative(item.path)+'" crossorigin>');
  html=html.replace('</head>',preloads.join('')+'</head>');
 }
 if(cssBundle){
  const stylesheet='<link rel="stylesheet" href="'+base+relative(cssBundle)+'"/>';
  html=deferWorkspace?html.replace('<!-- workspace-styles -->','<template id="workspace-styles">'+stylesheet+'</template>'):html.replace('</head>',stylesheet+'</head>');
 }
 if(development)html=html.replace('</body>','<script type="module" src="'+base+'__frontend_reload.js"></script></body>');
 await writeFile(path.join(dist,'index.html'),html);
 return {dist,base,script,css:cssBundle?base+relative(cssBundle):null,metafile:result.metafile};
}

const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'};
export function createFrontendServer({root=process.cwd(),base='/',development=false}={}){
 parseOptions(['preview','--base='+base]);
 const dist=path.join(path.resolve(root),'dist'),clients=new Set();
 const server=createServer(async(req,res)=>{
  let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400).end();return;}
  const host=String(req.headers.host||'').replace(/:\d+$/,'');if(!['127.0.0.1','localhost','[::1]'].includes(host)){res.writeHead(403).end('Local preview only');return;}
  if(base!=='/'&&url.pathname===base.slice(0,-1)){res.writeHead(302,{Location:base}).end();return;}
  if(!url.pathname.startsWith(base)){res.writeHead(404).end();return;}
  const route=url.pathname.slice(base.length);
  if(route==='api'||route.startsWith('api/')){
   const upstream=httpRequest({hostname:'127.0.0.1',port:8787,path:'/'+route+url.search,method:req.method,headers:{...req.headers,host:'127.0.0.1:8787'}},response=>{res.writeHead(response.statusCode||502,response.headers);response.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end('Local API is unavailable');});
   upstream.setTimeout(15000,()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());req.pipe(upstream);return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  if(development&&route==='__frontend_reload'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(development&&route==='__frontend_reload.js'){
   res.writeHead(200,{'Content-Type':mime['.js'],'Cache-Control':'no-store'}).end('new EventSource('+JSON.stringify(base+'__frontend_reload')+').onmessage=()=>location.reload();');return;
  }
  let decoded;try{decoded=decodeURIComponent(route);}catch{res.writeHead(400).end();return;}
  const filename=path.resolve(dist,decoded||'index.html');
  if(!filename.startsWith(dist+path.sep)){res.writeHead(404).end();return;}
  try{
   let target=filename;
   try{if(!(await stat(target)).isFile())throw Error();}catch{if(path.extname(decoded)||decoded.startsWith('assets/')){res.writeHead(404).end();return;}target=path.join(dist,'index.html');}
   const bytes=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404).end();}
 });
 server.reload=()=>{for(const response of clients)response.write('data: reload\n\n');};
 const close=server.close.bind(server);
 server.close=callback=>{for(const response of clients)response.end();clients.clear();return close(callback);};
 return server;
}

async function cli(){
 const options=parseOptions(process.argv.slice(2)),root=process.cwd();
 if(options.mode!=='preview')await buildFrontend({root,base:options.base,development:options.mode==='dev'});
 if(options.mode==='build'){console.log('Public React frontend built with pinned esbuild.');return;}
 const server=createFrontendServer({root,base:options.base,development:options.mode==='dev'});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,resolve);});
 console.log('Local frontend: http://'+(options.host==='::1'?'[::1]':options.host)+':'+options.port+options.base);
 const watchers=[];let timer,running=false,again=false;
 const rebuild=async()=>{if(running){again=true;return;}running=true;try{await buildFrontend({root,base:options.base,development:true});server.reload();}catch{console.error('Frontend rebuild failed; fix the source and save again.');}finally{running=false;if(again){again=false;await rebuild();}}};
 if(options.mode==='dev')for(const filename of ['src','public','index.html'])watchers.push(watch(path.join(root,filename),{recursive:filename!=='index.html'},()=>{clearTimeout(timer);timer=setTimeout(rebuild,120);}));
 const close=()=>{clearTimeout(timer);for(const watcher of watchers)watcher.close();server.close(()=>process.exit(0));};
 process.once('SIGTERM',close);process.once('SIGINT',close);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(error=>{console.error(error instanceof Error?error.message:'Frontend command failed');process.exitCode=1;});
