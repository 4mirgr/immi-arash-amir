import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchClinicCorrespondence,runCorrespondenceMailCycle} from '../cloud/clinic-correspondence-cycle.mjs';

const owner='11111111-1111-4111-8111-111111111111';
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['google-schema.sql','clinic-correspondence-cycle-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const env={MAIL_CORRESPONDENCE_ENABLED:'true',GOOGLE_DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return {meta:db.prepare(sql).run(...args)};}};}}};
 for(const [id,profile,sub]of [[owner,'arash','s1'],[owner+':secondary','arash','s2'],['22222222-2222-4222-8222-222222222222','amir','s3']])db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(id,profile,sub,'synthetic@example.invalid','[]','not-a-real-token',0,'connected',0);
 return {db,env};
}
test('only explicitly idle approved-mail lane shares its invocation; uncertain transport never triggers Gmail reads',async()=>{
 for(const mail of [{enabled:true,attempted:1},{enabled:true,attempted:0,blocked:1},{enabled:true,attempted:0},{enabled:false,attempted:0},undefined]){
  let reads=0;const result=await runCorrespondenceMailCycle({}, {transport:async()=>mail,reading:async()=>{reads++;}});assert.equal(reads,0);assert.equal(result.correspondence.status,'deferred_transport');
 }
 let reads=0;await runCorrespondenceMailCycle({}, {transport:async(_e,_f,options)=>{assert.equal(options.reportIdle,true);return {enabled:true,attempted:0,idle:true};},reading:async()=>{reads++;return{attempted:true};}});assert.equal(reads,1);
 const thrown=await runCorrespondenceMailCycle({}, {transport:async()=>{throw Error('private provider text');},reading:async()=>{throw Error('must not read');}});assert.equal(thrown.mail.status,'outcome_unknown_no_retry');assert(!JSON.stringify(thrown).includes('private provider'));
});
test('rotates only Arash-owned slots, validates fresh membership with root ID and never falls back to Amir',async()=>{
 const f=fixture(),selected=[];
 const options={now:2000000,recordStops:async()=>({recorded:0}),membership:async(_env,id,profile)=>{assert.equal(id,owner);assert.equal(profile,'arash');return {active:true};},sync:async(_env,context)=>{selected.push(context);return {status:'connected',providerReads:12,scannedThisRun:10,privateBody:'must not be recorded'};}};
 await dispatchClinicCorrespondence(f.env,options);await dispatchClinicCorrespondence(f.env,options);assert.equal(selected.length,2);assert.deepEqual(selected.map(x=>x.mailbox),['primary','secondary']);assert.equal(selected[1].userId,owner+':secondary');
 assert.equal((await dispatchClinicCorrespondence(f.env,options)).status,'idle');
 for(const row of f.db.prepare('SELECT * FROM google_mail_correspondence_activity').all()){assert(!row.receipt_json.includes('must not'));assert(!row.receipt_json.includes('privateBody'));}
});
test('disabled scanning and failed membership make no provider call; safe receipt never includes arbitrary errors',async()=>{
 const f=fixture();let reads=0;
 const options={now:2000000,recordStops:async()=>({recorded:0}),membership:async()=>({active:false,reason:'untrusted private reason'}),sync:async()=>{reads++;}};
 assert.equal((await dispatchClinicCorrespondence({...f.env,MAIL_CORRESPONDENCE_ENABLED:'false'},options)).status,'disabled');
 const result=await dispatchClinicCorrespondence(f.env,options);assert.equal(result.code,'membership_check_unavailable');assert.equal(reads,0);
 await dispatchClinicCorrespondence(f.env,{...options,now:3000000,membership:async()=>({active:true}),sync:async()=>{throw Error('private message body');}});
 assert(!JSON.stringify(f.db.prepare('SELECT * FROM google_mail_correspondence_activity').all()).includes('private message body'));
});
