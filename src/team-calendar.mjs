// Local calendar export only. No provider connection, invitation or attendance.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const escape=value=>String(value||'').replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const instant=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'):null;};
function fold(line){let out='',part='',bytes=0;for(const char of line){const count=new TextEncoder().encode(char).length;if(bytes+count>74){out+=part+'\r\n ';part='';bytes=1;}part+=char;bytes+=count;}return out+part;}
export function teamTaskCalendar(task,at=Date.now()){
 if(!uuid.test(task?.id||'')||typeof task.title!=='string'||!task.title.trim()||task.title.length>180||typeof task.dueAt!=='string'||!Number.isFinite(Date.parse(task.dueAt))||!Number.isFinite(at))return null;
 const start=instant(task.dueAt),end=instant(Date.parse(task.dueAt)+30*60000),stamp=instant(at);
 if(!start||!end||!stamp)return null;
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AUS Plan//Shared task export//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT','UID:'+task.id+'@aus-plan.local','DTSTAMP:'+stamp,'DTSTART:'+start,'DTEND:'+end,'SUMMARY:'+escape(task.title),'DESCRIPTION:'+escape(String(task.description||'').slice(0,1000)),'END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
