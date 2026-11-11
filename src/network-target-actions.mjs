// Local planning only. No provider requests, outreach transport or identity inference.
const inactive=new Set(['closed','future','source_removed']);
const stamp=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:null;};
export function targetFollowUpDue(item,now=Date.now()){
 const saved=item?.saved;
 if(!saved||saved.status==='archived'||inactive.has(item?.status))return false;
 if(saved.status==='follow_up')return true;
 const updated=stamp(saved.updatedAt);
 return saved.status==='contacted'&&updated!==null&&Number.isFinite(now)&&now-updated>=7*86400000;
}
export function rankNetworkTargets(items,{focus='all',now=Date.now()}={}){
 const list=Array.isArray(items)?items:[];
 const score=item=>targetFollowUpDue(item,now)?0:inactive.has(item?.status)||item?.saved?.status==='archived'?9:({high:1,medium:2,review:3}[item?.match?.priority]??4);
 return list.filter(item=>focus==='follow_up'?targetFollowUpDue(item,now):focus!=='actionable'||(!inactive.has(item?.status)&&item?.saved?.status!=='archived'&&(!item?.saved||targetFollowUpDue(item,now)||['shortlisted','reviewed','to_research'].includes(item.saved.status))))
 .map((item,index)=>({item,index})).sort((a,b)=>score(a.item)-score(b.item)||(stamp(b.item.publishedAt)||0)-(stamp(a.item.publishedAt)||0)||a.index-b.index).map(({item})=>item);
}
export function networkIntroduction(owner,item){
 const organization=String(item?.organization||'your practice').replace(/[\r\n\t]+/g,' ').trim().slice(0,160)||'your practice';
 if(owner==='arash')return `Hello, I’m Dr Arash Entezar. I came across ${organization} while researching Australian GP opportunities. Could you point me to the right person to discuss IMG recruitment and whether Level 1 supervision could be considered? I would be happy to share my CV. Thank you.`;
 if(owner==='amir')return `Hello, I’m Dr Amir Houshang Gerami. I came across ${organization} while exploring internal medicine and research pathways. Could you point me to the right person to discuss relevant opportunities and eligibility requirements? I would be happy to share my CV. Thank you.`;
 return '';
}
