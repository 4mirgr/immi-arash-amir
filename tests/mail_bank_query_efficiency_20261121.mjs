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
const schema=readFileSync(new URL('../cloud/clinic-bank-schema.sql',import.meta.url),'utf8');
function fixture(){
 const db=new DatabaseSync(':memory:'),queries=[];
 for(const file of ['google-schema.sql','mail-opportunities-schema.sql','clinic-bank-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
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

test('a 5233-site local bank lookup has no correlated full-bank plan and materially fewer SQLite VM steps',async t=>{
 const f=fixture(),read=await lookup(f,'https://harbour.example.org/jobs/gp');
 // Compare actual runtime SQL with the former query over realistic synthetic
 // URL-only imports. This measures SQLite work, not elapsed wall-clock time or
 // an invented live D1 bill. No provider call or production row is involved.
 const previous="SELECT id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,(SELECT count(DISTINCT lower(substr(replace(b.url,'https://www.','https://'),9,instr(substr(replace(b.url,'https://www.','https://'),9),'/')-1))) FROM clinic_bank_leads b WHERE b.owner_id=clinic_bank_leads.owner_id AND b.profile_id='arash' AND b.name=clinic_bank_leads.name COLLATE NOCASE) AS name_domain_count FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash' AND (url LIKE ? OR url LIKE ? OR name=? COLLATE NOCASE) ORDER BY last_success_at DESC,id LIMIT 20";
 const program=String.raw`
import json,sqlite3,sys
d=json.load(sys.stdin); c=sqlite3.connect(':memory:'); c.executescript(d['schema'])
rows=[]
for i in range(5233):
 url='https://harbour.example.org/branch/'+str(i) if i<20 else 'https://site'+str(i)+'.example.org/'
 rows.append(('bank_'+str(i),d['owner'],'arash',url,'','public_page_read',d['at'],d['at'],'{}',d['at'],d['at']))
c.executemany('INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',rows)
def measure(sql):
 count=[0]
 def step(): count[0]+=1; return 0
 c.set_progress_handler(step,100)
 result=c.execute(sql,d['args']).fetchall()
 c.set_progress_handler(None,0)
 return {'steps':count[0]*100,'rows':len(result),'plan':[r[3] for r in c.execute('EXPLAIN QUERY PLAN '+sql,d['args'])]}
print(json.dumps({'current':measure(d['sql']),'previous':measure(d['previous'])}))
`;
 const result=spawnSync('python3',['-c',program],{input:JSON.stringify({sql:read.sql,args:read.args,previous,schema,owner,at}),encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);const measured=JSON.parse(result.stdout);
 assert.equal(measured.current.rows,20);assert.equal(measured.previous.rows,20);
 assert(!measured.current.plan.some(item=>/CORRELATED SCALAR SUBQUERY/.test(item)),JSON.stringify(measured));
 assert(measured.previous.plan.some(item=>/CORRELATED SCALAR SUBQUERY/.test(item)));
 assert(measured.current.steps*3<measured.previous.steps,JSON.stringify(measured));
 t.diagnostic('Local SQLite VM steps: '+measured.previous.steps+' before, '+measured.current.steps+' after; this is not a live D1 row-read measurement.');
});
