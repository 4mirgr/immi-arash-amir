// Three feed slots/hour are shared by both doctors. Every third hour one
// overdue partial feed may continue early; the other slots retain rotation.
export const CONTINUATION_PRIORITY_HOURS=3;
export function planSourceRotation(sources,checks,position,now,limit=3){
 const count=sources.length;
 if(!count)return{sources:[],nextPosition:0,continuationSource:null};
 const start=Number.isSafeInteger(position)&&position>=0?position%count:0;
 const known=new Map(checks.map(row=>[row.source_id,row]));
 const due=source=>{const row=known.get(source.id);return !row||(Number(row.next_check_at)||0)<=now&&(Number(row.lock_until)||0)<now;};
 const order=Array.from({length:count},(_,offset)=>sources[(start+offset)%count]);
 const priorityHour=Math.floor(now/3600000)%CONTINUATION_PRIORITY_HOURS===0;
 const continuation=priorityHour?order.filter(source=>{const row=known.get(source.id);return due(source)&&row?.partial===1&&Number(row.record_cursor)>0;}).sort((a,b)=>(Number(known.get(a.id).last_attempt_at)||0)-(Number(known.get(b.id).last_attempt_at)||0))[0]:null;
 const selected=continuation?[continuation]:[];
 let traversed=0;
 while(selected.length<Math.min(limit,count)&&traversed<count){
  const source=order[traversed++];
  if(source.id!==continuation?.id&&due(source))selected.push(source);
 }
 return{sources:selected,nextPosition:(start+traversed)%count,continuationSource:continuation?.id||null};
}
