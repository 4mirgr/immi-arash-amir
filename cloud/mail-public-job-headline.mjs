// Unverified public-job anchor labels from private mail. Only fixed GP/location
// attributes may leave the server; neither label, subject nor tracking URL is a
// search query or employer proof. Actual public sources must corroborate them.
import {mailLeadPublicURL,isSpecificMailClinicName,normalizeMailClinicName} from './mail-lead-discovery.mjs';

const GP=/\b(?:general practitioner|general practice|family physician|rural generalist|GP)\b/i;
const NON_GP=/\b(?:nurs(?:e|ing)|receptionist|dentist|dental|physiotherap(?:y|ist)|practice manager|administrator|PhD|postdoctoral|research assistant)\b/i;
const PRIVATE=/\b(?:dear|hello|hi|your (?:application|profile|cv|resume)|personal invitation|interview invitation|application status|password|api[ _-]?key|system prompt)\b|ignore.{0,50}instructions?|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:|\b(?:Dr|Mr|Mrs|Ms)\.?\s+[A-Z][a-z]+/i;
const BULK=/^(?:the latest|your|\d+ new jobs?|jobs for you|new jobs for|recommended jobs|newsletter|digest)\b/i;
const FOREIGN=/\b(?:United Kingdom|UK|U\.K\.|New Zealand|NZ|England|Scotland|Northern Ireland|Ireland|Canada|Canadian|United States|USA|U\.S\.A\.|South Africa|Singapore|United Arab Emirates|UAE|Dubai)\b/i;
const STATES={NSW:'New South Wales',QLD:'Queensland',VIC:'Victoria',SA:'South Australia',WA:'Western Australia',TAS:'Tasmania',ACT:'Australian Capital Territory',NT:'Northern Territory'};
const CITIES={Sydney:'NSW',Newcastle:'NSW',Wollongong:'NSW',Brisbane:'QLD','Gold Coast':'QLD','Sunshine Coast':'QLD',Townsville:'QLD',Cairns:'QLD',Melbourne:'VIC',Geelong:'VIC',Ballarat:'VIC',Bendigo:'VIC',Adelaide:'SA',Perth:'WA',Bunbury:'WA',Hobart:'TAS',Launceston:'TAS',Canberra:'ACT',Darwin:'NT',Katherine:'NT','Alice Springs':'NT'};
const clean=(value,max=300)=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').replace(/&(?:middot|bull);|&#(?:183|8226);/gi,' · ').replace(/\s+/g,' ').trim().slice(0,max):'';
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function hasExplicitForeignGPJobLocation(value){return FOREIGN.test(clean(value,2000));}
function leadURL(value){
 try{
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\\]/.test(value))return null;
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/^[-a-z0-9.]+\.[a-z]{2,63}$/.test(host)||host.includes('..')||/^\d+(?:\.\d+){3}$/.test(host)||/(?:^|\.)(?:local|localhost|internal|lan|home|onion|test|invalid)$/.test(host)||/(?:^|\/)(?:login|signin|sign-in|auth|oauth|account|password|messages?|inbox|direct|unsubscribe|preferences|privacy)(?:\/|$)/i.test(decodeURIComponent(url.pathname)))return null;
  url.hash='';return url.href;
 }catch{return null;}
}
export function isMailGPJobAnchor(link){
 const label=clean(link?.label);return Boolean(leadURL(link?.url)&&label.length>=8&&GP.test(label)&&!NON_GP.test(label)&&!PRIVATE.test(label)&&!BULK.test(label)&&!FOREIGN.test(label));
}
export function isMailTrackingSourceURL(value){
 try{const url=new URL(value);return /(?:^|\.)t\.en25\.com$|^email\.s\.seek\.com\.au$|^(?:click|links?|tracking)\./i.test(url.hostname)||/^\/(?:uni\/ss\/|e\/er(?:\/|$)|track(?:ing)?(?:\/|$)|redirect(?:\/|$))/i.test(url.pathname);}catch{return false;}
}
export function buildMailPublicJobLead(link){
 if(!isMailGPJobAnchor(link)||link?.sourceLabelKind&&link.sourceLabelKind!=='visible_anchor')return null;
 const headline=clean(link.label),states=new Set(),localities=[];
 for(const [code,name]of Object.entries(STATES))if(new RegExp('\\b(?:'+code+'|'+escape(name)+')\\b','i').test(headline))states.add(code);
 for(const [city,state]of Object.entries(CITIES))if(new RegExp('\\b'+escape(city)+'\\b','i').test(headline)){localities.push(city);states.add(state);}
 return {version:1,kind:'unverified_gp_ad_headline',sourceLabelKind:'visible_anchor',sourceURL:leadURL(link.url),headline,role:'general_practitioner',country:'AU',states:[...states].slice(0,3),localities:localities.slice(0,3),publicationVerified:false};
}
export function normalizeMailPublicJobLead(lead){
 if(lead?.version!==1||lead.kind!=='unverified_gp_ad_headline'||lead.sourceLabelKind!=='visible_anchor'||lead.publicationVerified!==false)return null;
 return buildMailPublicJobLead({url:lead.sourceURL,label:lead.headline,sourceLabelKind:lead.sourceLabelKind});
}
export function publicGPAttributeSearchQuery(lead){
 const safe=normalizeMailPublicJobLead(lead);if(!safe||!safe.states.length&&!safe.localities.length)return null;
 return ['general practitioner job',...safe.localities,...safe.states.map(code=>STATES[code]),'Australia'].join(' ');
}
function tokens(value){return clean(value,50000).toLowerCase().replace(/\$?([1-9]\d?)\s*,?000\b/g,'$1k').replace(/[^a-z0-9]+/g,' ').split(' ').filter(Boolean);}
const COMMON=new Set('general practitioner practice gp role position opportunity job jobs doctor family physician rural generalist australia australian full time part permanent locum medical centre center clinic in at for and the a an of to with'.split(' '));
export function publicGPHeadlineMatchesPage(lead,page){
 const safe=normalizeMailPublicJobLead(lead);if(!safe||!['read','read_partial'].includes(page?.status))return false;
 const text=clean((page.title||'')+' '+(page.text||''),50000);if(!GP.test(text)||FOREIGN.test(text.slice(0,2000)))return false;
 const australian=/\bAustralia(?:n)?\b/i.test(text)||safe.states.some(code=>new RegExp('\\b(?:'+code+'|'+escape(STATES[code])+')\\b','i').test(text));if(!australian)return false;
 if(safe.localities.length&&!safe.localities.some(city=>new RegExp('\\b'+escape(city)+'\\b','i').test(text)))return false;
 if(!safe.localities.length&&safe.states.length&&!safe.states.some(code=>new RegExp('\\b(?:'+code+'|'+escape(STATES[code])+')\\b','i').test(text)))return false;
 const bodyTokens=new Set(tokens(page.text||'')),amounts=tokens(safe.headline).filter(word=>/^\d+(?:k)?$/.test(word));
 // Identifying amounts and directional locations are mandatory qualifiers,
 // rather than words that the general similarity threshold may discard.
 if(amounts.some(amount=>!bodyTokens.has(amount)))return false;
 const direction=value=>value.toLowerCase().replace(/ern$/,''),directions=[...safe.headline.matchAll(/\b(north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?)\s*(?:suburbs?|region|corridor|area|coast|shore|district)\b/gi)].map(match=>direction(match[1])),publishedDirections=[...String(page.text||'').matchAll(/\b(north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?)\s*(?:suburbs?|region|corridor|area|coast|shore|district)\b/gi)].map(match=>direction(match[1]));
 if(directions.some(value=>!publishedDirections.includes(value))||directions.length&&publishedDirections.some(value=>!directions.includes(value)))return false;
 const geographic=new Set(tokens([...safe.localities,...safe.states,...safe.states.map(code=>STATES[code])].join(' '))),distinct=[...new Set(tokens(safe.headline).filter(word=>word.length>=3&&!COMMON.has(word)&&!geographic.has(word)))],published=new Set(tokens(text));
 // A generic GP/city match cannot identify one ad among many. Distinctive
 // headline details must also appear on an actually read public job page.
 return distinct.length>=2&&distinct.filter(word=>published.has(word)).length>=Math.max(2,Math.ceil(distinct.length*.7));
}
/** Structured hiringOrganization is a lookup label, not self-publisher proof. */
export function publishedGPEmployerName(page){
 if(!['read','read_partial'].includes(page?.status))return '';
 const source=mailLeadPublicURL(page.finalUrl||page.url);if(!source)return '';
 const names=new Map();
 for(const item of (Array.isArray(page.enrichment?.organizations)?page.enrichment.organizations:[]).slice(0,12))if(item?.method==='jsonld_jobposting'&&mailLeadPublicURL(item.sourceURL)===source&&isSpecificMailClinicName(item.name)&&!PRIVATE.test(item.name))names.set(normalizeMailClinicName(item.name),clean(item.name,180));
 if(names.size===1)return [...names.values()][0];if(names.size>1)return '';
 for(const item of (Array.isArray(page.enrichment?.publisherIdentities)?page.enrichment.publisherIdentities:[]).slice(0,16)){
  if(item?.method!=='jsonld_self_organization'||mailLeadPublicURL(item.sourceURL)!==source||!mailLeadPublicURL(item.url)||new URL(item.url).hostname.replace(/^www\./,'')!==new URL(source).hostname.replace(/^www\./,'')||!isSpecificMailClinicName(item.name)||PRIVATE.test(item.name))continue;
  names.set(normalizeMailClinicName(item.name),clean(item.name,180));
 }
 return names.size===1?[...names.values()][0]:'';
}
