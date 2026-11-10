import test from 'node:test';
import assert from 'node:assert/strict';
import {readCheckpoint,writeCheckpoint} from '../src/workspace-checkpoint.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',opp='opp_'+'a'.repeat(32),cv='33333333-3333-4333-8333-333333333333';
const storage=()=>{const data=new Map();return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('same verified owner can resume only UI selections, never mail content or send approval',()=>{
 const s=storage();writeCheckpoint(a,'arash','opportunities',{state:'NSW',sort:'fit',page:2,openOpportunityId:opp,cvVersionId:cv,variant:'B',subjectIndex:1,step:'mail',body:'private letter',recipient:'private@example.invalid',reviewHash:'secret',confirmSend:true,access_token:'token'},s);
 const restored=readCheckpoint(a,'arash','opportunities',s);
 assert.ok(restored,'UI checkpoint was discarded');assert.equal(restored.openOpportunityId,opp);assert.equal(restored.cvVersionId,cv);assert.equal(restored.subjectIndex,1);assert.equal(restored.page,2);
 const raw=[...s.data.values()].join('');for(const privateValue of ['private letter','private@example.invalid','secret','token','confirmSend'])assert.equal(raw.includes(privateValue),false);
 assert.equal(readCheckpoint(b,'arash','opportunities',s),null);assert.equal(readCheckpoint(a,'amir','opportunities',s),null);
});
test('invalid identity, manipulated navigation and expired UI snapshots cannot restore a workspace',()=>{
 const s=storage();writeCheckpoint('', 'arash','navigation',{tab:'mail'},s);assert.equal(s.data.size,0);
 writeCheckpoint(a,'arash','navigation',{tab:'javascript:evil',body:'private'},s);assert.equal(readCheckpoint(a,'arash','navigation',s),null);
 writeCheckpoint(a,'arash','navigation',{tab:'opportunities'},s);assert.deepEqual(readCheckpoint(a,'arash','navigation',s),{tab:'opportunities'});
 const key=[...s.data.keys()][0],entry=JSON.parse(s.data.get(key));entry.savedAt=1;s.data.set(key,JSON.stringify(entry));assert.equal(readCheckpoint(a,'arash','navigation',s),null);
});
test('storage denial and corrupt snapshots do not interrupt normal work',()=>{
 const denied={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.doesNotThrow(()=>writeCheckpoint(a,'amir','navigation',{tab:'cv'},denied));assert.equal(readCheckpoint(a,'amir','navigation',denied),null);
 const s=storage();writeCheckpoint(a,'amir','navigation',{tab:'cv'},s);for(const key of s.data.keys())s.data.set(key,'{bad-json');assert.equal(readCheckpoint(a,'amir','navigation',s),null);
});
