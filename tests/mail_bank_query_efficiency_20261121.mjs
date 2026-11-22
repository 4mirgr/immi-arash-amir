import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ingestMailOpportunities,extractMailOpportunityCandidates} from '../cloud/mail-opportunities.mjs';
import {normalizeMessage} from '../cloud/google-mail.mjs';
import {inferMailLeadEmployerName} from '../cloud/mail-lead-discovery.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-11-21T09:00:00Z'),at=new Date(now-60000).toISOString(),name='Harbour Medical Centre';
const context={userId:owner,rootUserId:owner,profileId:'arash'},identity={subject:'sub1',email:'candidate@example.org'};
const schema=readFileSync(new URL('../cloud/clinic-bank-schema.sql',import.meta.url),'utf8')+readFileSync(new URL('../cloud/mail-lead-discovery-schema.sql',import.meta.url),'utf8');
function fixture(){
 const db=new DatabaseSync(':memory:'),queries=[];
 for(const file of ['google-schema.sql','mail-opportunities-schema.sql','clinic-bank-schema.sql','mail-lead-discovery-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const binding={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){const rows=db.prepare(sql).all(...args);if(sql.includes('name_domain_count')&&sql.includes('clinic_bank_leads'))queries.push({sql,args,rows});return {results:rows};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,'arash',identity.subject,identity.email,'[]','synthetic',0,'connected',now);
 const insert=db.prepare('INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 return {db,queries,env:{GOOGLE_DB:binding},put(id,url,storedName='',options={}){insert.run(id,options.owner||owner,'arash',url,storedName,options.status||'public_page_read',at,options.lastSuccess||at,JSON.stringify({sourceStatus:'read',marker:id}),at,at);}};
}
async function lookup(f,url='https://www.linkedin.com/jobs/view/123/'){
 const raw={id:'mail1',threadId:'thread1',internalDate:String(now-1000),labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'jobs-noreply@linkedin.com'},{name:'Subject',value:'General Practitioner jobs in Australia'}],body:{data:Buffer.from('General Practitioner — Harbour Medical Centre, Australia. Job opportunity.').toString('base64url')}}};
 const message={...normalizeMessage(raw),links:[{url,label:'General Practitioner — '+name}]};
 await ingestMailOpportunities(f.env,context,[message],identity,{writingContext:{},now});
 assert.equal(f.queries.length,1);return f.queries[0];
}

test('name ambiguity counts the entire owned bank before selecting twenty recent matches',async()=>{
 const f=fixture();
 for(let i=0;i<22;i++)f.put('recent'+String(i).padStart(2,'0'),'https://harbour.example.org/branch/'+i,i%2?name.toUpperCase():name);
 f.put('older_other_site','https://different.example.org/',name,{lastSuccess:new Date(now-86400000).toISOString()});
 f.put('foreign_owner','https://foreign.example.org/',name,{owner:other});
 const read=await lookup(f);
 assert.equal(read.rows.length,20);assert(read.rows.every(row=>row.owner_id===owner&&row.name_domain_count===2));
 assert(!read.rows.some(row=>row.id==='older_other_site'||row.id==='foreign_owner'));
});

test('case-insensitive name counts exclude other owners and do not merge different clinic names on a host',async()=>{
 const f=fixture();f.put('own','https://harbour.example.org/',name);f.put('samehost','https://harbour.example.org/contact',name.toUpperCase());
 f.put('other_clinic','https://harbour.example.org/another','Different Medical Centre');
 f.put('other_owner','https://another.example.org/',name,{owner:other});
 const read=await lookup(f);
 assert.deepEqual(read.rows.map(row=>row.id).sort(),['own','samehost']);assert(read.rows.every(row=>row.name_domain_count===1));
});

test('direct-domain unnamed imports retain bounded data and newer failure rows without scanning every unnamed site per result',async()=>{
 const f=fixture();for(let i=0;i<25;i++)f.put('branch'+String(i).padStart(2,'0'),'https://harbour.example.org/branch/'+i);
 f.put('latest_failure','https://harbour.example.org/latest','',{status:'failed',lastSuccess:new Date(now-1000).toISOString()});
 f.put('unrelated','https://unrelated.example.org/');f.put('other_owner','https://harbour.example.org/private','',{owner:other});
 const read=await lookup(f,'https://harbour.example.org/jobs/gp');
 assert.equal(read.rows.length,20);assert.equal(read.rows[0].id,'latest_failure');assert.equal(read.rows[0].status,'failed');
 assert(read.rows.every(row=>row.owner_id===owner&&row.url.startsWith('https://harbour.example.org/')&&row.name_domain_count===0));
});

test('an opaque GP alert with a public job domain but no employer name does not query unused bank matches',async()=>{
 const f=fixture();f.put('unusable','https://jobboard.example.org/','Harbour Medical Centre');
 const raw={id:'opaque',threadId:'opaque_thread',internalDate:String(now-1000),labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'jobs-noreply@linkedin.com'},{name:'Subject',value:'General Practitioner jobs in Australia'}],body:{data:Buffer.from('General Practitioner job opportunity in Sydney, NSW, Australia.').toString('base64url')}}};
 const message={...normalizeMessage(raw),links:[{url:'https://jobboard.example.org/jobs/gp',label:'General Practitioner — Australia'}]};
 const candidates=await extractMailOpportunityCandidates(message,{now});
 assert.equal(candidates.length,1);assert(candidates[0].candidateHosts.includes('jobboard.example.org'));assert.equal(inferMailLeadEmployerName(candidates[0]),'');
 await ingestMailOpportunities(f.env,context,[message],identity,{writingContext:{},now});
 assert.equal(f.queries.length,0);assert.equal(f.db.prepare('SELECT count(*) AS total FROM private_mail_opportunities').get().total,1);
});

test('indexed matching preserves immediate prior results and does not scale with unrelated imported sites',async t=>{
 const f=fixture(),read=await lookup(f,'https://harbour.example.org/jobs/gp');
 // Compare actual runtime SQL to the previously deployed materialized-owner
 // query. Synthetic SQLite VM work is evidence of query shape, not a live D1
 // row-read bill or a benchmark against production private data.
 const previous=`WITH owned AS MATERIALIZED (
  SELECT id,url,name,lower(name) AS name_key,last_success_at FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash'
 ), matched AS MATERIALIZED (
  SELECT * FROM owned WHERE (url LIKE ? OR url LIKE ? OR name=? COLLATE NOCASE) ORDER BY last_success_at DESC,id LIMIT 20
 ), named_sites AS MATERIALIZED (
  SELECT name_key,count(DISTINCT lower(substr(replace(url,'https://www.','https://'),9,instr(substr(replace(url,'https://www.','https://'),9),'/')-1))) AS name_domain_count
  FROM owned WHERE name_key IN (SELECT DISTINCT name_key FROM matched WHERE trim(name)!='') GROUP BY name_key
 ) SELECT b.id,b.owner_id,b.profile_id,b.url,b.name,b.status,b.read_at,b.last_success_at,b.result_json,coalesce(s.name_domain_count,0) AS name_domain_count
 FROM matched m JOIN clinic_bank_leads b ON b.id=m.id LEFT JOIN named_sites s ON s.name_key=m.name_key ORDER BY m.last_success_at DESC,m.id`;
 const program=String.raw`
import json,sqlite3,sys
d=json.load(sys.stdin)
def trial(size):
 c=sqlite3.connect(':memory:'); c.executescript(d['schema'])
 rows=[]
 for i in range(size):
  url='https://harbour.example.org/branch/'+str(i) if i<20 else 'https://site'+str(i)+'.example.org/'
  rows.append(('bank_'+str(i),d['owner'],'arash',url,'','public_page_read',d['at'],d['at'],'{}',d['at'],d['at']))
 c.executemany('INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',rows)
 def measure(sql,args):
  count=[0]
  def step(): count[0]+=1; return 0
  c.set_progress_handler(step,1)
  result=c.execute(sql,args).fetchall()
  c.set_progress_handler(None,0)
  return {'steps':count[0],'rows':len(result),'result':result,'plan':[r[3] for r in c.execute('EXPLAIN QUERY PLAN '+sql,args)]}
 current=measure(d['sql'],d['args']); previous=measure(d['previous'],d['previousArgs'])
 assert current.pop('result')==previous.pop('result')
 return {'size':size,'current':current,'previous':previous}
print(json.dumps([trial(5233),trial(52330)]))
`;
 const result=spawnSync('python3',['-c',program],{input:JSON.stringify({sql:read.sql,args:read.args,previous,previousArgs:[owner,'https://harbour.example.org/%','https://www.harbour.example.org/%',name],schema,owner,at}),encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);const measured=JSON.parse(result.stdout);
 for(const run of measured){
  assert.equal(run.current.rows,20);assert.equal(run.previous.rows,20);
  assert(!run.current.plan.some(item=>/SCAN (?:owned|b)$/.test(item)),JSON.stringify(run));
  assert(run.current.plan.some(item=>/clinic_bank_owner_name_nocase.*name=/.test(item)),JSON.stringify(run));
  assert(run.current.plan.some(item=>/clinic_bank_owner_url_nocase.*url>/.test(item)),JSON.stringify(run));
  assert(run.previous.plan.some(item=>/SCAN owned/.test(item)));
  assert(run.current.steps*20<run.previous.steps,JSON.stringify(run));
  t.diagnostic(run.size+' synthetic sites: '+run.previous.steps+' prior vs '+run.current.steps+' indexed SQLite VM steps; no live D1 data used.');
 }
 assert(measured[1].current.steps<measured[0].current.steps*2,JSON.stringify(measured));
 assert(measured[1].previous.steps>measured[0].previous.steps*9,JSON.stringify(measured));
});

test('maximum bounded host/name terms retain two D1 compound arms, literal host ranges, and deduplicated matches',async()=>{
 const f=fixture(),read=await lookup(f);
 const names=['Harbour Medical Centre','Second Medical Centre','Third Medical Centre'];
 const hosts=Array.from({length:8},(_,i)=>'clinic'+i+'.example.org');
 const prefixes=hosts.flatMap(host=>['https://'+host+'/','https://www.'+host+'/']).map(prefix=>({prefix,upper:prefix.slice(0,-1)+'0'}));
 f.put('matches_name_and_host','https://clinic0.example.org/jobs/gp',names[0]);
 f.put('unnamed_www_host','https://www.clinic7.example.org/contact');
 f.put('unnamed_uppercase_host','HTTPS://CLINIC6.EXAMPLE.ORG/contact');
 f.put('same_name_outside_hosts','https://older-other-domain.example.org/',names[0],{lastSuccess:new Date(now-86400000).toISOString()});
 f.put('similar_host_not_equal','https://clinic0.example.org.evil.invalid/');
 f.put('range_end_not_equal','https://clinic0.example.org0/');
 f.put('different_host_same_owner','https://not-clinic.example.org/');
 f.put('foreign_owner','https://clinic0.example.org/private',names[0],{owner:other});
 const args=[JSON.stringify(names),owner,JSON.stringify(prefixes),owner,owner];
 assert.equal((read.sql.match(/\bUNION\b/g)||[]).length,1,'D1 gets two arms even with sixteen URL prefixes and three names');
 const rows=f.db.prepare(read.sql).all(...args);
 assert.deepEqual(rows.map(row=>row.id).sort(),['matches_name_and_host','same_name_outside_hosts','unnamed_uppercase_host','unnamed_www_host']);
 assert.equal(rows.filter(row=>row.id==='matches_name_and_host').length,1);
 assert(rows.filter(row=>row.name).every(row=>row.name_domain_count===2),'older same-name domain must remain ambiguous');
 assert(rows.filter(row=>!row.name).every(row=>row.name_domain_count===0),'unnamed same-host rows remain usable but never get a global empty-name identity count');
 const plan=f.db.prepare('EXPLAIN QUERY PLAN '+read.sql).all(...args).map(row=>row.detail);
 assert(plan.some(item=>/clinic_bank_owner_name_nocase.*name=/.test(item)),JSON.stringify(plan));
 assert(plan.some(item=>/clinic_bank_owner_url_nocase.*url>/.test(item)),JSON.stringify(plan));
 assert(!plan.some(item=>/SCAN (?:owned|b)$/.test(item)),JSON.stringify(plan));
});
