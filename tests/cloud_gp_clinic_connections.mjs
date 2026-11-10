import test from 'node:test';
import assert from 'node:assert/strict';
import {readClinicConnections} from '../cloud/gp-clinic-connections.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('connection suggestions read only the owner and match a specific organization, never infer a relationship',async()=>{
 const env={GOOGLE_DB:{prepare(sql){assert.match(sql,/owner_id=\?/);assert.match(sql,/LIMIT 200/);return{bind(owner){assert.equal(owner,'arash-owner');return{async all(){return{results:[{id,data:JSON.stringify({name:'Synthetic Contact',organization:'Synthetic Practice Pty Ltd',profileUrl:'https://www.linkedin.com/in/synthetic-person/',source:'linkedin_connections_csv'})},{id:'22222222-2222-4222-8222-222222222222',data:JSON.stringify({name:'Other Contact',organization:'Another Clinic'})}]};}};}};}}};
 const r=await readClinicConnections(env,{profileId:'arash',userId:'arash-owner'},['Synthetic Practice']);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].relationshipStatus,'owner_review_required');assert.equal(r.liveLinkedInGraph,false);
 assert.deepEqual((await readClinicConnections(env,{profileId:'amir',userId:'amir-owner'},['Synthetic Practice'])).candidates,[]);
});
test('generic names and unavailable storage do not invent a connection',async()=>{
 assert.equal((await readClinicConnections({}, {profileId:'arash',userId:'owner'},['Clinic'])).status,'unavailable');
 const env={GOOGLE_DB:{prepare(){throw Error('Must not search generic organizations');}}};
 assert.equal((await readClinicConnections(env,{profileId:'arash',userId:'owner'},['Medical centre'])).status,'clinic_identity_missing');
});
