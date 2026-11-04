// Pure extraction from a retrieved public page. Nothing here fetches or executes markup.
const MAX_INPUT=1000000,MAX_CONTACTS=20;
const EMAIL=/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/g;
const PRIVATE_PATH=/(?:^|\/)(?:login|logout|signin|sign-in|auth|oauth|account|admin|wp-admin|candidate|register|registration|apply|application|submit|delete|remove|save|update|checkout|messages?|messaging|inbox|direct)(?:\/|$)/i;
const FOLLOW=/(?:jobs?|careers?|vacanc|contact|about|team|clinic|supervis|funding|admission|recruit|lavora|contatti|concorsi|bandi|dipartiment)/i;
const SOCIAL=/(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com)$/;
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const DROP=new Set(['script','style','noscript','template','svg','nav','form','head','button']);
function decode(value){return String(value||'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[m.toLowerCase()])).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>=32&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):' ';});}
const clean=value=>decode(value).replace(/\s+/g,' ').trim();
function attributes(token){const out={};for(const a of token.replace(/^<\/?[\w:-]+/,'').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))out[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]??'');return out;}
function publicURL(value,base){try{const u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password||u.port||!/^[-a-z0-9.]+$/.test(u.hostname)||!u.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes('..')||/\.(?:local|localhost|internal|test|invalid)$/.test(u.hostname)||PRIVATE_PATH.test(decodeURIComponent(u.pathname))||[...u.searchParams.keys()].some(k=>/token|secret|session|password|code|auth/i.test(k)))return null;u.hash='';return u.href;}catch{return null;}}
function role(text,footer=false){if(/privacy|data protection|\bdpo\b|unsubscribe|abuse|webmaster/i.test(text))return null;if(footer)return 'organization_general';if(/(?:apply|application|send|submit|forward|invia|candidatur)[\s\S]{0,100}(?:cv|resume|résumé|application|email|e-mail|curriculum)|(?:email|e-mail)[\s\S]{0,70}(?:apply|application|cv|resume)/i.test(text))return 'application';if(/contact|enquir|reception|office|clinic|general|contatt|segreteria/i.test(text))return 'organization_general';return 'unknown';}
function emailValue(value){const v=String(value||'').toLowerCase().trim();return v.length<=254&&new RegExp('^'+EMAIL.source+'$').test(v)?v:null;}
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
 const parts=[],links=[],jsonld=[],stack=[];let anchor=null,skip=0,footer=0,cursor=0,tokensSeen=0,limited=false;
 const tokens=/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>|<!--[\s\S]*?-->/gi;
 function append(value){if(skip)return;const text=clean(value);if(!text)return;parts.push({text,footer:footer>0});if(anchor)anchor.label+=' '+text;}
 for(const m of html.matchAll(tokens)){
  if(++tokensSeen>50000||stack.length>=128){limited=true;break;}
  append(html.slice(cursor,m.index));cursor=m.index+m[0].length;const token=m[0];if(token.startsWith('<!--'))continue;
  const tag=m[1].toLowerCase(),closing=token.startsWith('</');
  if(closing){let index=stack.length-1;while(index>=0&&stack[index].tag!==tag)index--;if(index<0)continue;while(stack.length>index){const item=stack.pop();if(item.skip)skip--;if(item.footer)footer--;if(item.anchor&&anchor===item.anchor){if(!skip&&links.length<200)links.push({...anchor,label:clean(anchor.label),context:parts.slice(-3).filter(p=>p.footer===anchor.footer&&role(p.text,p.footer)!==null).map(p=>p.text).join(' ').slice(0,500)});anchor=null;}}continue;}
  const attrs=attributes(token),hidden=Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']?.toLowerCase()==='true'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important)?\s*(?:;|$)/i.test(attrs.style||'');
  if(tag==='script'&&!skip&&!hidden&&attrs.type?.toLowerCase()==='application/ld+json'&&jsonld.length<30){const body=html.slice(cursor).match(/^([\s\S]*?)<\/script\s*>/i)?.[1];if(body&&body.length<=100000)jsonld.push(body);}
  const hides=hidden||DROP.has(tag),isFooter=tag==='footer';let opened=null;
  if(tag==='a'&&!skip&&!hides&&attrs.href){opened={href:attrs.href,label:'',footer:footer>0};anchor=opened;}
  if(!VOID.has(tag)&&!token.endsWith('/>')){stack.push({tag,skip:hides,footer:isFooter,anchor:opened});if(hides)skip++;if(isFooter)footer++;}
 }
 if(!limited)append(html.slice(cursor));return {parts,links,jsonld,limited};
}
export function extractPublicContacts({html='',text='',sourceURL,readAt}={}){
 const source=publicURL(sourceURL),result={extractorVersion:2,sourceURL:source||String(sourceURL||'').slice(0,2000),readAt:typeof readAt==='string'?readAt:null,contacts:[],organizations:[],followLinks:[],publicationDates:[],limitations:['Published contact evidence requires review; it is not verified identity, a vacancy, eligibility or permission to send.','Static markup extraction does not evaluate external CSS, JavaScript or authenticated content.']};
 if(!source){result.limitations.push('invalid_public_source_url');return result;}
 const seen=new Set(),orgs=new Set(),follow=new Set(),host=new URL(source).hostname;
 function add(type,value,quote,method,contactRole='unknown'){
  if(result.contacts.length>=MAX_CONTACTS||contactRole===null)return;
  if(type==='email')value=emailValue(value);else if(type==='phone')value=phoneValue(value);else value=publicURL(value,source);
  if(!value)return;const key=type+':'+value;if(seen.has(key)){const prior=result.contacts.find(x=>x.type===type&&x.value===value);if(prior?.contactRole==='unknown'&&contactRole!=='unknown')Object.assign(prior,{contactRole,quote:clean(quote).slice(0,500),method});return;}seen.add(key);
  result.contacts.push({type,value,sourceURL:source,quote:clean(quote).slice(0,500),method,contactRole,sourceRelation:'same_page'});
 }
 const htmlString=typeof html==='string'?html.slice(0,MAX_INPUT):'',plain=typeof text==='string'?text.slice(0,MAX_INPUT):'';
 // Prefer visible markup when both inputs exist: caller's body text must not reintroduce hidden contacts.
 const parsed=htmlString?markup(htmlString):{parts:plain.split(/\r?\n/).map(text=>({text:clean(text),footer:false})),links:[],jsonld:[]};
 if(parsed.limited)result.limitations.push('Markup token/depth budget reached; contact extraction is partial.');
 const textWebsites=[];
 for(let i=0;i<parsed.parts.length;i++){
  const part=parsed.parts[i],context=parsed.parts.slice(Math.max(0,i-1),i+2).filter(p=>p.footer===part.footer&&role(p.text,p.footer)!==null).map(p=>p.text).join(' ').slice(0,800),contactRole=role(part.text,part.footer)===null?null:role(context,part.footer);
  for(const match of part.text.matchAll(EMAIL)){const local=!htmlString||part.text.length>500,quote=local?localPassage(part.text,match.index,match[0].length):context;add('email',match[0],quote,'visible_text',local?role(localPassage(part.text,match.index,match[0].length,0),part.footer):contactRole);}
  if(!htmlString&&textWebsites.length<200)for(const match of part.text.matchAll(/https:\/\/[^\s<>"']+/gi)){const url=publicURL(match[0].replace(/[),.;]+$/,''),source),quote=localPassage(part.text,match.index,match[0].length);if(url)textWebsites.push({url,quote,contactRole:role(quote,part.footer)});if(textWebsites.length>=200)break;}
  // Unlabelled digit strings may be deadlines or identifiers; accept only an explicit phone label.
  for(const match of part.text.matchAll(/(?:telephone|phone|tel|mobile|telefono)\s*[:.]?\s*(\+?[\d][\d\s().-]{5,28}[\d])/gi)){const quote=!htmlString||part.text.length>500?localPassage(part.text,match.index,match[0].length):context;add('phone',match[1],quote,'visible_text',!htmlString||part.text.length>500?role(quote,part.footer):contactRole);}
  const name=part.text.match(/^(?:organization|organisation|clinic name|hospital name|ente|istituzione)\s*:\s*(.{2,180})$/i)?.[1];if(name&&!orgs.has(name)){orgs.add(name);result.organizations.push({name,sourceURL:source,quote:part.text.slice(0,500),method:'visible_label'});}
 }
 for(const item of textWebsites)add(SOCIAL.test(new URL(item.url).hostname)?'social':'website',item.url,item.quote,'visible_text',item.contactRole);
 for(const link of parsed.links){
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
