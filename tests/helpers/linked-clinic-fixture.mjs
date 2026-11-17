import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {enqueuePublicPages,storePublicReading} from '../../cloud/public-page-store.mjs';
import {extractPublicContacts} from '../../cloud/public-contact-extraction.mjs';
import {visiblePageText} from '../../cloud/public-page-worker.mjs';
import {enrichReadPages} from '../../cloud/opportunity-store.mjs';
export async function linkedClinicFixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['opportunity-v2-schema.sql','public-page-schema.sql','public-page-enrichment-schema.sql'])db.exec(readFileSync(new URL('../../cloud/'+file,import.meta.url),'utf8'));
 let queries=0;
 const binding={prepare(sql){queries++;const s=db.prepare(sql);let args=[];return{bind(...values){args=values;return this;},async first(){return s.get(...args)||null;},async all(){return{results:s.all(...args)};},async run(){return{meta:s.run(...args)};}};},async batch(items){db.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const now=Date.now(),id='opp_'+'a'.repeat(32),parentId='page_'+'1'.repeat(32),root='https://clinic.example/jobs/gp',parentAt=new Date(now-60000).toISOString(),childAt=new Date(now-50000).toISOString();
 const source={id,country:'AU',state:'NSW',opportunityType:'job',organization:'Synthetic Medical Practice',title:'General Practitioner',url:root,summary:'A general practice role with a community clinic.',fullText:'A general practice role. Apply to jobs@clinic.example.',kind:'vacancy'};
 db.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org',source.organization,'clinic.example','AU','NSW','{}',parentAt,parentAt);
 db.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'source','one','org','edition','both','official','job','AU','NSW',source.title,root,null,null,'open',JSON.stringify(source),new Date(now-7200000).toISOString(),parentAt);
 await enqueuePublicPages(binding,[{id:parentId,url:root,country:'AU',officialBases:['clinic.example'],institutionIds:[],labels:['General Practitioner']}]);
 const rootHTML='<title>Synthetic Medical Practice</title><main><p>A general practice role. Apply to jobs@clinic.example.</p></main><nav><a href="/services">Our services</a><a href="/training">Training</a><a href="/contact">Contact</a></nav>';
 async function storePage(page,html,stamp,capturedParent){
  const parsed=visiblePageText(html),record={id:page.id,url:page.url,finalUrl:page.url,status:'read',readAt:stamp,contentType:'text/html',...parsed,enrichment:extractPublicContacts({html,sourceURL:page.url,readAt:stamp}),...(capturedParent?{parentReadAt:capturedParent}:{})};
  await storePublicReading(binding,record,Date.parse(stamp));return record;
 }
 await storePage({id:parentId,url:root},rootHTML,parentAt);
 const child=db.prepare("SELECT * FROM public_page_queue WHERE url='https://clinic.example/services'").get();
 const service='Our practice provides chronic disease management and preventive care.',training='We train medical students and GP registrars through our teaching programme.',childHTML='<main><p>'+service+'</p><p>'+training+'</p></main>';
 await storePage(child,childHTML,childAt,parentAt);
 const rows=()=>db.prepare('SELECT * FROM opportunity_editions WHERE id=?').all(id);
 return {db,binding,env:{OPPORTUNITY_DB:binding,PUBLIC_PAGE_READING_ENABLED:'true'},now,id,parentId,root,parentAt,childAt,source,child,service,training,rootHTML,childHTML,storePage,rows,get queries(){return queries;},async view(ms=now){return(await enrichReadPages(binding,rows(),'arash',ms,true))[0];}};
}
