// Shared presentation/advisory deadline semantics. A source with a precise,
// timezone-qualified deadline expires at that instant. A date-only record keeps
// the existing whole-recorded-day convention; it never invents a venue timezone.
const DAY=86400000;
export const evidenceDeadlineValue=item=>typeof item?.deadline==='string'?item.deadline:item?.deadline?.date;
function validDay(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;
}
export function evidenceDeadlineCutoff(item){
 const value=evidenceDeadlineValue(item);
 if(typeof value!=='string'||!validDay(value.slice(0,10)))return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return Date.parse(value+'T00:00:00Z')+DAY;
 // Missing timezone or ambiguous free text is an unknown deadline, not a date
 // interpreted differently by the user's browser and the Worker host.
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;
}
export function evidenceDeadlinePassed(item,now=Date.now()){
 const cutoff=evidenceDeadlineCutoff(item);
 return Number.isFinite(now)&&cutoff!==null&&now>=cutoff;
}
export function evidenceClosed(item,now=Date.now()){
 return ['closed','expired'].includes(item?.status)||['closed','expired'].includes(item?.deadline?.status)||evidenceDeadlinePassed(item,now);
}
