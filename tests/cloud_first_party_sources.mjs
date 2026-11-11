import test from 'node:test';
import assert from 'node:assert/strict';
import {GP_REVIEWED_SOURCE_DEFINITIONS as definitions,normalizeReviewedGpSourceRecords as normalize} from '../cloud/gp-reviewed-source-adapter.mjs';
import {robotsAllows} from '../cloud/public-page-worker.mjs';
const html=value=>'<html><head><title>Public practice information</title></head><body>'+value+'</body></html>';
const byId=id=>definitions.find(source=>source.id===id);
test('two reviewed first-party employers are restricted to their own public hostname',()=>{
 for(const id of ['reviewed-longford-gp-img','reviewed-yarriambiack-gp-img']){
  const source=byId(id);assert(source.executable);assert.equal(source.requiresRobots,true);assert.equal(source.adapter,'gp_reviewed_html');assert.deepEqual(source.allowedHosts,[new URL(source.feedUrl).hostname]);assert.equal(source.verifiedAt,'2026-11-11');assert.match(source.reason,/Level 1/);assert.equal(source.publishedContacts,undefined);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /',source.feedUrl).allowed,false);
 }
});
test('current page wording and contacts are extracted while vacancy status and dates remain unknown',()=>{
 const source=byId('reviewed-longford-gp-img'),[row]=normalize(source,html('<h1>Current Vacancies — General Practitioner</h1><p>Our practice is seeking a GP to join the practice on either a full-time or part-time basis. We have experience teaching international medical graduates.</p><p>For questions about recruitment email recruit@example.invalid.</p>'));
 assert.equal(row.kind,'vacancy');assert.equal(row.status,undefined);assert.equal(row.publishedAt,null);assert.equal(row.closingAt,null);assert.match(row.fullText,/recruit@example.invalid/);assert.equal(row.level1,undefined);assert.equal(row.sponsorship,undefined);
});
test('explicit GP hiring wording supports evergreen enquiry without converting it into a dated vacancy',()=>{
 const source=byId('reviewed-yarriambiack-gp-img'),[row]=normalize(source,html('<h1>Our community medical clinic</h1><p>We are looking for General Practitioners and Allied Health staff. We encourage enthusiastic GPs to apply, including International Medical Graduates.</p><p>Contact our Practice Manager at <a href="mailto:manager@example.invalid">manager@example.invalid</a>.</p>'));
 assert.equal(row.kind,'employment_register');assert.match(row.title,/expression of interest/);assert.equal(row.closingAt,null);assert.match(row.fullText,/manager@example.invalid/);
 const educational='<p>Our general practitioners provide holistic medical services to a welcoming community. We provide family medicine, immunisation and chronic disease care.</p>';
 for(const body of [educational,educational+'<p hidden>We are looking for GPs.</p>',educational+'<p>We are looking for allied health staff.</p>'])assert.throws(()=>normalize(source,html(body)),e=>e.code==='reviewed_gp_recruitment_not_found');
});
