// Bounded evidence from pages the clinic reader has actually fetched. These
// publisher statements describe a practice; they do not verify vacancies,
// supervision, sponsorship, patient burden or the quality of clinical care.
export const CLINIC_RESEARCH_VERSION=2;
export const CLINIC_RESEARCH_FACT_LIMIT=24;
export const CLINIC_RESEARCH_PAGE_LIMIT=3;
export const CLINIC_RESEARCH_LINK_LIMIT=2;
const CATEGORIES=['services','team','training','recruitment','population','history'];
const INSTRUCTION=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|send.{0,40}(?:token|secret)|javascript:|<script/i;
const NARRATIVE=/\b(?:testimonial|diagnosed|diagnosis|case report|patient story|patient experience|I|my|mine|Mr|Mrs|Ms|Miss|DOB)\b|\b\d{1,3}[- ]year[- ]old\b/i;
const NEGATIVE=/\b(?:no|not|never|without|unable|cannot|can't|plan to|hope to|aim to)\b/i;
const clean=(value,max=600)=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const host=url=>new URL(url).hostname.replace(/^www\./,'');
function publicURL(value){
 try{
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\\]/.test(value))return null;
  const u=new URL(value),hostname=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!/^[-a-z0-9.]+\.[a-z]{2,63}$/.test(hostname)||hostname.includes('..')||/^\d+(?:\.\d+){3}$/.test(hostname)||/(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(hostname)||['nip.io','sslip.io','localtest.me','vcap.me','lvh.me'].some(d=>hostname===d||hostname.endsWith('.'+d))||/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|oauth|apply|application|candidate)(?:\/|$)/i.test(decodeURIComponent(u.pathname)))return null;
  return u.href;
 }catch{return null;}
}
function sameSite(value,root,validateURL=publicURL){
 const url=publicURL(value),checked=url&&validateURL(url);
 return checked&&host(checked)===host(root)?checked:null;
}
export function clinicResearchPageKind(url,label=''){
 let text=String(label);try{text=new URL(url).pathname+' '+text;}catch{}
 if(/\b(?:services?|treatments?|clinical|healthcare)\b/i.test(text.replace(/[-_/]+/g,' ')))return 'services';
 if(/\b(?:team|staff|doctors?|people)\b/i.test(text.replace(/[-_/]+/g,' ')))return 'team';
 if(/\b(?:training|teaching|education|students?|registrars?)\b/i.test(text.replace(/[-_/]+/g,' ')))return 'training';
 if(/\b(?:careers?|recruitment|recruit|jobs?|vacanc\w*|supervision)\b/i.test(text.replace(/[-_/]+/g,' ')))return 'recruitment';
 if(/contact/i.test(text))return 'contact';
 if(/about/i.test(text))return 'about';
 return 'root';
}
export function selectClinicResearchLinks(rootURL,links,{hasEmail=false,validateURL=publicURL}={}){
 const root=publicURL(rootURL);if(!root)return [];
 const ranked=[],seen=new Set([root]),priorities=hasEmail?['services','team','training','recruitment','about','contact']:['contact','services','team','training','recruitment','about'];
 for(const link of Array.isArray(links)?links.slice(0,20):[]){
  const url=sameSite(link?.url,root,validateURL);if(!url||seen.has(url)||/\b(?:reviews?|testimonials?|patient-stor\w*|case-stud\w*)\b/i.test(new URL(url).pathname+' '+String(link.label||''))||/\.(?:pdf|docx?|xlsx?|zip)$/i.test(new URL(url).pathname))continue;
  const kind=clinicResearchPageKind(url,link.label),rank=priorities.indexOf(kind);if(rank<0)continue;
  seen.add(url);ranked.push({url,label:clean(link.label,180),kind,rank,index:ranked.length});
 }
 return ranked.sort((a,b)=>a.rank-b.rank||a.index-b.index).slice(0,CLINIC_RESEARCH_LINK_LIMIT).map(({rank,index,...link})=>link);
}
function category(text){
 if(/\b(?:established|founded|opened)\b.{0,80}\b(?:18|19|20)\d{2}\b|\b(?:serving|served)\b.{0,80}\b(?:\d{2,3} years|since (?:18|19|20)\d{2})\b/i.test(text))return 'history';
 if(/\b\d[\d,. ]*\b/.test(text)&&/\b(?:registered patients|patients (?:each|every|per|annually)|consultations (?:each|every|per|annually)|appointments (?:each|every|per|annually)|population|residents)\b/i.test(text))return 'population';
 if(/\b(?:recruit(?:ing|ment)?|hir(?:ing|e)|seek(?:s|ing)?|vacanc\w*|opportunit\w*)\b/i.test(text)&&/\b(?:GPs?|general practitioners?|doctors?|registrars?|clinical|medical|practitioners?|careers?|staff)\b/i.test(text))return 'recruitment';
 if(/\b(?:train(?:s|ing)?|teach(?:es|ing)?|medical students?|GP registrars?)\b/i.test(text)&&/\b(?:we|our|practice|clinic|centre|center|university|students?|registrars?|programme|program)\b/i.test(text))return 'training';
 if(/\b(?:team|staff|practitioners|doctors)\b.{0,80}\b(?:includes?|comprises?|consists?|works?|collaborat\w*)\b|\bmultidisciplinary team\b/i.test(text))return 'team';
 if(/\b(?:provides?|offers?|delivers?|specialises?|specializes?|treats?|manages?|supports?|includes?|focuses?)\b/i.test(text)&&/\b(?:general practice|family medicine|primary care|patient|chronic|preventive|diabetes|wound|emergency|acute|community|multidisciplinary|clinical|mental health|women'?s health|men'?s health|children'?s health|immunisation|vaccination)\b/i.test(text))return 'services';
 return null;
}
function statements(value,title=''){
 if(typeof value!=='string')return [];
 let text=value.replace(/<[^>]*>/g,' ').trim();
 if(typeof title==='string'&&title.trim()&&text.startsWith(title.trim()))text=text.slice(title.trim().length).trimStart();
 return text.slice(0,50000).split(/\n+|(?<=[.!?])\s+/).slice(0,300).map(x=>clean(x,601)).filter(x=>x.length>=25&&x.length<=600&&!INSTRUCTION.test(x)&&!NARRATIVE.test(x)&&!NEGATIVE.test(x));
}
// URL/edition proof is the caller's responsibility. This helper only extracts
// bounded publisher wording and never turns a quote into verified clinic facts.
export function extractClinicResearchStatements(value,title='',limit=8){
 const out=[];
 for(const quote of statements(value,title)){
  const kind=category(quote);if(!['services','team','training','recruitment'].includes(kind)||out.some(item=>item.text===quote))continue;
  out.push({text:quote,category:kind});if(out.length>=Math.max(1,Math.min(12,Number(limit)||8)))break;
 }
 return out;
}
export function buildClinicResearchContext({rootURL,observedAt,pages=[]}={}){
 const root=publicURL(rootURL),research={version:CLINIC_RESEARCH_VERSION,observedAt:typeof observedAt==='string'?observedAt:null,sourcePages:[],facts:[],people:[],organizations:[],gaps:[],scope:'bounded_public_publisher_statements_not_full_clinic_due_diligence'};
 if(!root){research.gaps=['valid_clinic_source_required',...CATEGORIES.map(x=>x+'_not_published'),'crisis_history_not_assessed','weaknesses_not_assessed'];return research;}
 const facts=new Set(),people=new Set(),organizations=new Set(),sourcePages=new Set();
 for(const page of Array.isArray(pages)?pages.slice(0,CLINIC_RESEARCH_PAGE_LIMIT):[]){
  const sourceURL=sameSite(page?.finalUrl||page?.url,root),requested=sameSite(page?.url||sourceURL,root);
  if(!sourceURL||!requested||sourcePages.has(sourceURL)||research.sourcePages.length>=CLINIC_RESEARCH_PAGE_LIMIT)continue;
  sourcePages.add(sourceURL);
  const readAt=typeof page.readAt==='string'&&Number.isFinite(Date.parse(page.readAt))?page.readAt:null,status=clean(page.status,60),kind=clinicResearchPageKind(requested,page.kind||'');
  research.sourcePages.push({url:requested,sourceURL,status,readAt,kind});
  if(!['read','read_partial'].includes(status)||!readAt)continue;
  // Give each of the three pages room; a long homepage must not crowd out a
  // concise services/team page. Never retain the full source text.
  let perPage=0;
  for(const text of statements(page.text,page.title)){
   const type=category(text),key=type+'\n'+text;
   if(!type||facts.has(key)||perPage>=8||research.facts.length>=CLINIC_RESEARCH_FACT_LIMIT)continue;
   facts.add(key);perPage++;research.facts.push({category:type,text,sourceURL,readAt});
  }
  for(const item of Array.isArray(page.enrichment?.people)?page.enrichment.people.slice(0,12):[]){
   if(research.people.length>=12)break;
   const name=clean(item?.name,150),quote=clean(item?.quote),itemSource=sameSite(item?.sourceURL,root),role=item?.role,key=role+'\n'+name;
   if(!name||!quote||itemSource!==sourceURL||!['practice_manager','recruitment_contact'].includes(role)||item.method!=='visible_role_label'||!quote.toLowerCase().includes(name.toLowerCase())||INSTRUCTION.test(quote)||NARRATIVE.test(quote)||people.has(key))continue;
   people.add(key);research.people.push({name,role,quote,sourceURL,readAt,method:'visible_role_label'});
   const factKey='team\n'+quote;
   if(!facts.has(factKey)&&research.facts.length<CLINIC_RESEARCH_FACT_LIMIT){facts.add(factKey);research.facts.push({category:'team',text:quote,sourceURL,readAt});}
  }
  for(const item of Array.isArray(page.enrichment?.organizations)?page.enrichment.organizations.slice(0,12):[]){
   if(research.organizations.length>=12)break;
   const name=clean(item?.name,180),quote=clean(item?.quote),itemSource=sameSite(item?.sourceURL,root);
   if(!name||!quote||itemSource!==sourceURL||INSTRUCTION.test(quote)||organizations.has(name))continue;
   organizations.add(name);research.organizations.push({name,quote,sourceURL,readAt,method:clean(item.method,60)});
  }
 }
 research.gaps=[...CATEGORIES.filter(type=>!research.facts.some(fact=>fact.category===type)).map(type=>type+'_not_published'),'crisis_history_not_assessed','weaknesses_not_assessed'];
 return research;
}
