import test from 'node:test';
import assert from 'node:assert/strict';
import census from '../cloud/italian-universities.json' with {type:'json'};
const root='https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/';
const categories={public_university:['universita-statali',61],recognized_private_university:['universita-non-statali-riconosciute',21],telematic_university:['universita-telematiche',11],special_institute:['istituti-universitari-ordinamento-speciale',9]};
test('MUR census preserves the complete defined directory universe with campus deduplication',()=>{
 assert.equal(census.length,102);assert.equal(new Set(census.map(x=>x.id)).size,102);assert.equal(new Set(census.map(x=>new URL(x.url).hostname.replace(/^www\./,''))).size,102);
 for(const [category,[path,count]]of Object.entries(categories)){const rows=census.filter(x=>x.directoryCategory===category);assert.equal(rows.length,count);assert(rows.every(x=>x.sourceUrl===root+path));}
 assert.equal(census.reduce((n,x)=>n+x.directoryListings.length,0),112);
 assert.equal(census.filter(x=>x.directoryCategory==='recognized_private_university').reduce((n,x)=>n+x.directoryListings.length,0),31);
});
test('official provenance is distinct from live opportunity or personal eligibility verification',()=>{
 for(const x of census){assert.match(x.id,/^it-university-[a-z0-9-]+$/);assert(x.name.length>3);assert.equal(x.country,'IT');assert.equal(x.profileScope,'amir');assert.equal(x.trust,'official');assert.equal(x.reviewStatus,'official_directory_entry');assert.equal(x.automation,'directory_only');assert.equal(x.reviewedAt,'2026-11-04');assert(x.sourceUpdatedAt<=x.reviewedAt);assert(['official_directory_link_only','https_homepage_observed'].includes(x.websiteVerification));assert(x.region===null||typeof x.region==='string');assert(Array.isArray(x.regions));assert.equal(x.feedUrl,undefined);assert.equal(x.closingAt,undefined);assert.equal(x.eligibility,undefined);}
});
test('canonical homepage links are observed HTTPS and original directory links remain auditable',()=>{
 for(const x of census){const u=new URL(x.url);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(u.port,'');assert(!/^\d+(?:\.\d+){3}$/.test(u.hostname));assert(u.hostname.includes('.'));assert(x.directoryListings.length>=1);for(const old of x.directoryListings){const original=new URL(old.url);assert(['http:','https:'].includes(original.protocol));assert(old.name.length>3);assert.equal(original.username,'');assert.equal(original.password,'');}}
 assert.equal(census.filter(x=>x.websiteVerification==='https_homepage_observed').length,5);
 const catholic=census.find(x=>new URL(x.url).hostname==='www.unicatt.it');assert.equal(catholic.directoryListings.length,5);assert(catholic.regions.includes('Lombardia'));assert(catholic.regions.includes('Lazio'));
 const iasa=census.find(x=>new URL(x.url).hostname==='www.bfeducational.it');assert.match(iasa.limitations,/under construction/);
});
