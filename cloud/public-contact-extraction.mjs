// Pure extraction from a retrieved public page. Nothing here fetches or executes markup.
const MAX_INPUT=1000000,MAX_CONTACTS=20,MAX_PEOPLE=10;
const EMAIL=/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/g;
const PRIVATE_PATH=/(?:^|\/)(?:login|logout|signin|sign-in|auth|oauth|account|admin|wp-admin|candidate|register|registration|apply|application|submit|delete|remove|save|update|checkout|messages?|messaging|inbox|direct)(?:\/|$)/i;
const FOLLOW=/(?:jobs?|careers?|vacanc|contact|about|team|clinic|supervis|funding|admission|recruit|lavora|contatti|concorsi|bandi|dipartiment)/i;
const SOCIAL=/(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com)$/;
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const DROP=new Set(['script','style','noscript','template','svg','nav','form','head','button']);
const PERSON_ROLES=/\b(practice\s+manager|(?:GP\s+)?recruitment\s+(?:manager|officer|consultant|coordinator|contact|enquiries|inquiries)|talent\s+acquisition\s+(?:manager|partner|specialist))\b/gi;
const PERSON_WORD="[\\p{Lu}][\\p{L}\\p{M}'’.-]{0,34}";
const PERSON_NAME=new RegExp('^(?:(?:Dr|Mr|Mrs|Ms|Miss)\\.?\\s+)?'+PERSON_WORD+'(?:\\s+(?:(?:van|von|de|del|da)\\s+)?'+PERSON_WORD+'){1,4}','u');
const PERSON_FULL_NAME=new RegExp('^(?:(?:Dr|Mr|Mrs|Ms|Miss)\\.?\\s+)?'+PERSON_WORD+'(?:\\s+(?:(?:van|von|de|del|da)\\s+)?'+PERSON_WORD+'){1,4}$','u');
const PERSON_STOP=/\b(?:email|e-mail|phone|telephone|mobile|linkedin|contact|person|organization|organisation|practice|manager|general|medical|centre|center|clinic|hospital|surgery|GP|recruitment|send|apply|applications?|closing|hours|submit|book|call|location|address|fax|our|your|please|welcome|team|human|resources|department|doctor|doctors|privacy|position|vacant|vacancy|available|information|details|reception|office|website|staff|enquiries|inquiries|find|out|more|support|administrative|clinical|no|not|none|TBA|TBC)\b/i;
const PERSON_ORGANIZATION_WORD=/^(?:general|medical|centre|center|clinic|hospital|surgery|practice|GP|health|care|support|administrative|clinical|staff|team|department|recruitment|office|resources)$/i;
const PERSON_UNSAFE=/[\x00-\x1f<>@{}]|ignore.{0,30}instructions|system prompt|api.?key|password/i;
const PERSON_QUOTE_UNSAFE=/[<>\x00-\x1f{}]|ignore.{0,30}instructions|system prompt|api.?key|password/i;
const PERSON_GROUPS=new Set(['div','section','article','li','tr','dl','main','header','footer']);
function decode(value){return String(value||'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[m.toLowerCase()])).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>=32&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):' ';});}
const clean=value=>decode(value).replace(/\s+/g,' ').trim();
function attributes(token){const out={};for(const a of token.replace(/^<\/?[\w:-]+/,'').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))out[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]??'');return out;}
function publicURL(value,base){try{const u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password||u.port||!/^[-a-z0-9.]+$/.test(u.hostname)||!u.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes('..')||/\.(?:local|localhost|internal|test|invalid)$/.test(u.hostname)||PRIVATE_PATH.test(decodeURIComponent(u.pathname))||[...u.searchParams.keys()].some(k=>/token|secret|session|password|code|auth/i.test(k)))return null;u.hash='';return u.href;}catch{return null;}}
function role(text,footer=false){if(/privacy|data protection|\bdpo\b|unsubscribe|abuse|webmaster/i.test(text))return null;if(footer)return 'organization_general';if(/\b(?:practice\s+manager|recruitment\s+(?:manager|officer|consultant|coordinator|contact|enquiries|inquiries)|talent\s+acquisition)\b|(?:apply|application|send|submit|forward|invia|candidatur)[\s\S]{0,100}(?:cv|resume|résumé|application|email|e-mail|curriculum)|(?:email|e-mail)[\s\S]{0,70}(?:apply|application|cv|resume)/i.test(text))return 'application';if(/contact|enquir|reception|office|clinic|general|contatt|segreteria/i.test(text))return 'organization_general';return 'unknown';}
function personName(value,{prefix=false}={}){
 const raw=clean(prefix?String(value||'').slice(0,300):value);if(!raw||raw.length>500)return null;
 const stop=raw.match(PERSON_STOP),rawBeforeStop=stop?raw.slice(0,stop.index).trim():raw;
 // A location or clinic heading after a role is not a person's name. Do not
 // truncate "George Town Medical Centre" into the plausible-looking George Town.
 if(prefix&&stop&&PERSON_ORGANIZATION_WORD.test(stop[0])&&!/[.,;:|–—-]$/.test(rawBeforeStop))return null;
 const beforeStop=rawBeforeStop.replace(/[,:;|–—-]+$/,'').trim();
 const name=(prefix?beforeStop.match(PERSON_NAME)?.[0]?.trim():beforeStop)?.replace(/[.,;:]+$/,'');
 if(!name||name.length>120||PERSON_UNSAFE.test(name)||!PERSON_FULL_NAME.test(name)||PERSON_STOP.test(name))return null;
 // Reject headings made entirely of initials; an email username is never a name.
 if(name.split(/\s+/).every(word=>word.replace(/[^\p{L}]/gu,'').length<2))return null;
 return name;
}
function precedingPerson(value){
 const tail=clean(value.slice(-300)).replace(/[-–—,:|(]+\s*$/,'').trim();
 const last=tail.match(new RegExp('('+PERSON_WORD+'(?:\\s+(?:(?:van|von|de|del|da)\\s+)?'+PERSON_WORD+'){1,5})$','u'))?.[1];
 if(!last)return null;
 // Flattened team cards often include navigation/headings before the actual
 // name. Retain only the proper-name suffix after the last reserved UI word.
 let start=0;for(const match of last.matchAll(new RegExp(PERSON_STOP.source,'gi')))start=match.index+match[0].length;
 return personName(last.slice(start));
}
function emailValue(value){const v=String(value||'').toLowerCase().trim();return v.length<=254&&new RegExp('^'+EMAIL.source+'$').test(v)?v:null;}
function publicEncodedEmail(hex){
 if(typeof hex!=='string'||hex.length%2||! /^[a-f0-9]{6,512}$/i.test(hex))return null;
 const key=parseInt(hex.slice(0,2),16);let value='';
 for(let i=2;i<hex.length;i+=2)value+=String.fromCharCode(parseInt(hex.slice(i,i+2),16)^key);
 return emailValue(value);
}
function phoneValue(value){const v=clean(value).replace(/^tel:/i,'').split(/[?;]/)[0];const digits=v.replace(/\D/g,'');return digits.length>=7&&digits.length<=15&&/^\+?[\d\s().-]+$/.test(v)?v:null;}
// A stored page can be one flattened paragraph. Its unrelated footer/privacy text
// must neither suppress every contact nor become the quote for a distant email.
function localPassage(text,index,length,after=140){
 const left=text.slice(Math.max(0,index-180),index),right=text.slice(index+length,index+length+after);
 const boundaries=[...left.matchAll(/[.!?;]\s+/g)],last=boundaries.at(-1),start=last?last.index+last[0].length:0;
 const end=right.search(/[.!?;](?:\s|$)/);
 return clean(left.slice(start)+text.slice(index,index+length)+right.slice(0,end<0?right.length:end+1));
}
function markup(html){
 const parts=[],links=[],jsonld=[],encodedEmails=[],stack=[];let anchor=null,skip=0,navigationSkips=0,footer=0,cursor=0,tokensSeen=0,limited=false,groupId=0;
 const tokens=/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>|<!--[\s\S]*?-->/gi;
 function append(value){const text=clean(value);if(!text)return;if(skip){if(anchor?.navigationOnly&&skip===navigationSkips)anchor.label+=' '+text;return;}parts.push({text,footer:footer>0,group:stack.findLast(item=>PERSON_GROUPS.has(item.tag))?.group||0,contactGroup:stack.findLast(item=>PERSON_GROUPS.has(item.tag)||item.tag==='p')?.group||0});if(anchor)anchor.label+=' '+text;}
 for(const m of html.matchAll(tokens)){
  if(++tokensSeen>50000||stack.length>=128){limited=true;break;}
  append(html.slice(cursor,m.index));cursor=m.index+m[0].length;const token=m[0];if(token.startsWith('<!--'))continue;
  const tag=m[1].toLowerCase(),closing=token.startsWith('</');
  if(closing){let index=stack.length-1;while(index>=0&&stack[index].tag!==tag)index--;if(index<0)continue;while(stack.length>index){const item=stack.pop();if(item.skip)skip--;if(item.navigation)navigationSkips--;if(item.footer)footer--;if(item.anchor&&anchor===item.anchor){if((!skip||anchor.navigationOnly&&skip===navigationSkips)&&links.length<200)links.push({...anchor,label:clean(anchor.label),context:anchor.navigationOnly?clean(anchor.label):parts.slice(-3).filter(p=>p.footer===anchor.footer&&role(p.text,p.footer)!==null).map(p=>p.text).join(' ').slice(0,500)});anchor=null;}}continue;}
  const attrs=attributes(token),hidden=Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']?.toLowerCase()==='true'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important)?\s*(?:;|$)/i.test(attrs.style||'');
  if(tag==='script'&&!skip&&!hidden&&attrs.type?.toLowerCase()==='application/ld+json'&&jsonld.length<30){const body=html.slice(cursor).match(/^([\s\S]*?)<\/script\s*>/i)?.[1];if(body&&body.length<=100000)jsonld.push(body);}
  const hides=hidden||DROP.has(tag),isFooter=tag==='footer';let opened=null;
  if(!skip&&!hides&&encodedEmails.length<30){
   const fromLink=tag==='a'?attrs.href?.match(/^\/cdn-cgi\/l\/email-protection#([a-f0-9]+)$/i)?.[1]:null;
   const hex=attrs['data-cfemail']||fromLink;
   if(hex)encodedEmails.push({hex,sourceAttribute:attrs['data-cfemail']?'data-cfemail':'email_protection_link',footer:footer>0,partIndex:parts.length,contactGroup:stack.findLast(item=>PERSON_GROUPS.has(item.tag)||item.tag==='p')?.group||0});
  }
  if(tag==='a'&&(!skip||navigationSkips>0&&skip===navigationSkips)&&!hides&&attrs.href){opened={href:attrs.href,label:'',footer:footer>0,...(skip?{navigationOnly:true}:{})};anchor=opened;}
  if(!VOID.has(tag)&&!token.endsWith('/>')){const navigation=tag==='nav'&&!hidden;stack.push({tag,skip:hides,navigation,footer:isFooter,anchor:opened,group:++groupId});if(hides)skip++;if(navigation)navigationSkips++;if(isFooter)footer++;}
 }
 if(!limited)append(html.slice(cursor));return {parts,links,jsonld,encodedEmails,limited};
}
export function extractPublicContacts({html='',text='',sourceURL,readAt}={}){
 const source=publicURL(sourceURL),result={extractorVersion:3,sourceURL:source||String(sourceURL||'').slice(0,2000),readAt:typeof readAt==='string'?readAt:null,contacts:[],people:[],organizations:[],followLinks:[],publicationDates:[],limitations:['Published contact evidence requires review; it is not verified identity, a vacancy, eligibility or permission to send.','Static markup extraction does not evaluate external CSS, JavaScript or authenticated content.']};
 if(!source){result.limitations.push('invalid_public_source_url');return result;}
 const seen=new Set(),peopleSeen=new Set(),orgs=new Set(),follow=new Set(),host=new URL(source).hostname;
 function addPerson(name,label,quote){
  if(result.people.length>=MAX_PEOPLE||!name||role(quote)===null||PERSON_QUOTE_UNSAFE.test(quote))return;
  const personRole=/^practice\s+manager$/i.test(label)?'practice_manager':'recruitment_contact',key=personRole+':'+name.toLowerCase();
  if(peopleSeen.has(key))return;peopleSeen.add(key);
  result.people.push({name,role:personRole,sourceURL:source,quote:clean(quote).slice(0,500),method:'visible_role_label',sourceRelation:'same_page'});
 }
 function add(type,value,quote,method,contactRole='unknown'){
  if(result.contacts.length>=MAX_CONTACTS||contactRole===null)return;
  if(type==='email')value=emailValue(value);else if(type==='phone')value=phoneValue(value);else value=publicURL(value,source);
  if(!value)return;const key=type+':'+value;if(seen.has(key)){const prior=result.contacts.find(x=>x.type===type&&x.value===value);if(prior?.contactRole==='unknown'&&contactRole!=='unknown')Object.assign(prior,{contactRole,quote:clean(quote).slice(0,500),method});return;}seen.add(key);
  result.contacts.push({type,value,sourceURL:source,quote:clean(quote).slice(0,500),method,contactRole,sourceRelation:'same_page'});
 }
 const htmlString=typeof html==='string'?html.slice(0,MAX_INPUT):'',plain=typeof text==='string'?text.slice(0,MAX_INPUT):'';
 // Prefer visible markup when both inputs exist: caller's body text must not reintroduce hidden contacts.
 const parsed=htmlString?markup(htmlString):{parts:plain.split(/\r?\n/).map(text=>({text:clean(text),footer:false,group:0})),links:[],jsonld:[],encodedEmails:[]};
 if(parsed.limited)result.limitations.push('Markup token/depth budget reached; contact extraction is partial.');
 const textWebsites=[];
 for(let i=0;i<parsed.parts.length;i++){
  const part=parsed.parts[i],context=parsed.parts.slice(Math.max(0,i-1),i+2).filter(p=>p.footer===part.footer&&role(p.text,p.footer)!==null).map(p=>p.text).join(' ').slice(0,800),contactRole=role(part.text,part.footer)===null?null:role(context,part.footer);
  // Explicit role labels only. Adjacent name/role cards must share a structural
  // container, preventing a doctor from a neighbouring card becoming manager.
  if(!part.footer&&(part.text.length>500||role(part.text)!==null)){
   for(const match of part.text.matchAll(PERSON_ROLES)){
    const before=part.text.slice(0,match.index),after=part.text.slice(match.index+match[0].length);
    const passage=part.text.length>500?localPassage(part.text,match.index,match[0].length,180):part.text;
    const preceding=precedingPerson(before);
    if(preceding)addPerson(preceding,match[0],passage);
    else if(/^\s*(?::|[-–—|])?\s*\p{Lu}/u.test(after))addPerson(personName(after.replace(/^\s*(?::|[-–—|])\s*/,''),{prefix:true}),match[0],passage);
    if(part.text.replace(match[0],'').replace(/[\s:–—|-]/g,'')===''){
     for(const neighbour of [parsed.parts[i-1],parsed.parts[i+1]]){
      if(!neighbour||neighbour.footer||neighbour.group!==part.group||role(neighbour.text)===null)continue;
      const name=personName(neighbour.text);if(name)addPerson(name,match[0],clean(neighbour===parsed.parts[i-1]?neighbour.text+' '+part.text:part.text+' '+neighbour.text));
     }
    }
   }
  }
  for(const match of part.text.matchAll(EMAIL)){const local=!htmlString||part.text.length>500,quote=local?localPassage(part.text,match.index,match[0].length):context;add('email',match[0],quote,'visible_text',local?role(localPassage(part.text,match.index,match[0].length,0),part.footer):contactRole);}
  if(!htmlString&&textWebsites.length<200)for(const match of part.text.matchAll(/https:\/\/[^\s<>"']+/gi)){const url=publicURL(match[0].replace(/[),.;]+$/,''),source),quote=localPassage(part.text,match.index,match[0].length);if(url)textWebsites.push({url,quote,contactRole:role(quote,part.footer)});if(textWebsites.length>=200)break;}
  // Unlabelled digit strings may be deadlines or identifiers; accept only an explicit phone label.
  for(const match of part.text.matchAll(/(?:telephone|phone|tel|mobile|telefono)\s*[:.]?\s*(\+?[\d][\d\s().-]{5,28}[\d])/gi)){const quote=!htmlString||part.text.length>500?localPassage(part.text,match.index,match[0].length):context;add('phone',match[1],quote,'visible_text',!htmlString||part.text.length>500?role(quote,part.footer):contactRole);}
  const name=part.text.match(/^(?:organization|organisation|clinic name|hospital name|ente|istituzione)\s*:\s*(.{2,180})$/i)?.[1];if(name&&!orgs.has(name)){orgs.add(name);result.organizations.push({name,sourceURL:source,quote:part.text.slice(0,500),method:'visible_label'});}
 }
 for(const encoded of parsed.encodedEmails){
  const value=publicEncodedEmail(encoded.hex);if(!value)continue;
  const context=parsed.parts.slice(Math.max(0,encoded.partIndex-1),encoded.partIndex+3).filter(p=>p.footer===encoded.footer&&p.contactGroup===encoded.contactGroup).map(p=>p.text).join(' ');
  const contactRole=role(context,encoded.footer);if(contactRole===null)continue;
  const quote=clean(context.replace(/\[email\s*protected\]/gi,value)+' '+value);
  add('email',value,quote,'visible_cfemail',contactRole);
  const contact=result.contacts.find(c=>c.type==='email'&&c.value===value&&c.method==='visible_cfemail');
  if(contact)Object.assign(contact,{encodedValue:encoded.hex,sourceAttribute:encoded.sourceAttribute});
 }
 for(const item of textWebsites)add(SOCIAL.test(new URL(item.url).hostname)?'social':'website',item.url,item.quote,'visible_text',item.contactRole);
 for(const link of parsed.links){
  if(link.navigationOnly){
   const url=publicURL(link.href,source);if(!url)continue;const target=new URL(url);
   if(target.hostname===host&&url!==source&&!follow.has(url)&&result.followLinks.length<6&&!/\.(?:pdf|docx?|xlsx?|zip)(?:$|\?)/i.test(target.pathname)&&/\b(?:contact|about|team|staff)\b/i.test(target.pathname+' '+link.label)){follow.add(url);result.followLinks.push({url,label:link.label.slice(0,180),sourceURL:source,depth:1,navigationOnly:true});}
   continue;
  }
  const quote=link.label||link.href,context=link.context||quote,contactRole=role(quote,link.footer)===null?null:role(context,link.footer);
  if(/^mailto:/i.test(link.href)){try{add('email',decodeURIComponent(link.href.slice(7).split('?')[0]),quote,'visible_link',contactRole);}catch{}continue;}
  if(/^tel:/i.test(link.href)){add('phone',link.href,quote,'visible_link',contactRole);continue;}
  const url=publicURL(link.href,source);if(!url||contactRole===null)continue;const target=new URL(url),social=SOCIAL.test(target.hostname);
  if(social||target.hostname!==host||/website|official site|sito web/i.test(link.label))add(social?'social':'website',url,quote,'visible_link',contactRole);
  if(!social&&target.hostname===host&&url!==source&&!follow.has(url)&&result.followLinks.length<6&&!/\.(?:pdf|docx?|xlsx?|zip)(?:$|\?)/i.test(target.pathname)&&FOLLOW.test(target.pathname+' '+link.label)){follow.add(url);result.followLinks.push({url,label:link.label.slice(0,180),sourceURL:source,depth:1});}
 }
 // Parse a bounded number of JSON-LD documents/nodes. Never eval, follow contexts or execute scripts.
 let nodes=0;
 function visit(value,depth=0){if(depth>8||nodes++>200||!value||typeof value!=='object')return;if(Array.isArray(value)){for(const x of value.slice(0,40))visit(x,depth+1);return;}
  const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
  if(types.includes('JobPosting')){
   const organizations=Array.isArray(value.hiringOrganization)?value.hiringOrganization:[value.hiringOrganization];
   for(const org of organizations.slice(0,5)){if(!org||typeof org!=='object')continue;const name=typeof org.name==='string'?clean(org.name).slice(0,180):'';if(name&&!orgs.has(name)){orgs.add(name);result.organizations.push({name,...(publicURL(org.url,source)?{url:publicURL(org.url,source)}:{}),sourceURL:source,quote:JSON.stringify({hiringOrganization:{name:org.name,url:org.url}}).slice(0,500),method:'jsonld_jobposting'});}if(org.url)add('website',org.url,JSON.stringify({hiringOrganization:{url:org.url}}),'jsonld_jobposting','organization_general');
    for(const cp of [org,...(Array.isArray(org.contactPoint)?org.contactPoint:[org.contactPoint])].slice(0,5)){if(!cp||typeof cp!=='object')continue;const q=JSON.stringify({hiringOrganization:{name,email:cp.email,telephone:cp.telephone}});if(cp.email)add('email',cp.email,q,'jsonld_jobposting','organization_general');if(cp.telephone)add('phone',cp.telephone,q,'jsonld_jobposting','organization_general');}
   }
   for(const cp of (Array.isArray(value.applicationContact)?value.applicationContact:[value.applicationContact]).slice(0,5)){if(!cp||typeof cp!=='object')continue;const q=JSON.stringify({applicationContact:cp});if(cp.email)add('email',cp.email,q,'jsonld_jobposting','application');if(cp.telephone)add('phone',cp.telephone,q,'jsonld_jobposting','application');}
   for(const field of ['datePosted','validThrough'])if(typeof value[field]==='string'&&value[field].length<=80)result.publicationDates.push({field,value:value[field],sourceURL:source,quote:JSON.stringify({[field]:value[field]}),method:'jsonld_jobposting'});
  }
  if(value['@graph'])visit(value['@graph'],depth+1);if(value.mainEntity)visit(value.mainEntity,depth+1);
 }
 for(const document of parsed.jsonld)try{visit(JSON.parse(document));}catch{}
 if(typeof html==='string'&&html.length>MAX_INPUT||typeof text==='string'&&text.length>MAX_INPUT)result.limitations.push('Only the first 1000000 input characters were examined.');
 return result;
}
