// Geography is quoted advertisement evidence, never a geocoded MMM/DPA decision.
export function gpOpportunitySignals(item){
 const title=typeof item?.title==='string'?item.title:'';
 const body=['title','summary','fullText','location','city'].map(k=>typeof item?.[k]==='string'?item[k].slice(0,20000):'').join('\n');
 const monash=[];for(const m of body.matchAll(/\b(?:MMM|MM|Modified\s+Monash(?:\s+Model)?)\s*(?:category|classification)?\s*[:=\-]?\s*([1-7])(?:\s*[-–]\s*([1-7]))?\b/gi)){const a=Number(m[1]),b=Number(m[2]||m[1]);if(b<a)continue;for(let n=a;n<=b;n++)if(!monash.includes(n))monash.push(n);}
 const dpa=[];for(const sentence of body.split(/(?<=[.!?;])\s+|\n+/)){if(sentence.length>1000)continue;if(/\b(?:DPA|Distribution\s+Priority\s+Area)\b/i.test(sentence))dpa.push(sentence.slice(0,400));}
 return {generalPracticeTitle:/\b(?:general practitioner|general practice|rural generalist|GP)\b/i.test(title)&&!/\b(?:nurs(?:e|ing)|manager|reception|administrator)\b/i.test(title),ruralWording:/\b(?:rural|regional|remote)\b/i.test(body),monashMentioned:monash.sort(),dpaExcerpts:dpa.slice(0,2),meaning:'advertisement_wording_only_not_verified_geography',eligibility:'not_assessed'};
}
