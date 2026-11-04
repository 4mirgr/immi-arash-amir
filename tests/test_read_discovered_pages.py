import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('read_discovered_pages',ROOT/'scripts/read_discovered_pages.py')
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


def response(body=b'',status=200,mime='text/html'):
    return {'status':status,'headers':{'content-type':mime},'body':body}


def fixture():
    return {'id':'uni-example','url':'https://university.example.invalid/','country':'IT','profileScope':'amir'}


def queue():
    return reader.build_queue([fixture()],{'results':[{'institutionId':'uni-example','status':'checked','finalUrl':fixture()['url'],'links':[{'url':'https://university.example.invalid/research/','label':'Research'}]}]},{'results':[{'parentInstitutionId':'uni-example','sourceUrl':'https://university.example.invalid/research/','links':[{'url':'https://university.example.invalid/phd/','label':'PhD'},{'url':'https://evil.invalid/funding','label':'Bad'},{'url':'https://university.example.invalid/login/','label':'Bad login'}]}]})


class ContentReaderTests(unittest.TestCase):
    def test_finite_queue_deduplicates_observed_urls_and_rejects_foreign_or_private_pages(self):
        rows=queue()
        self.assertEqual(len(rows),3)
        self.assertEqual(len({r['id'] for r in rows}),3)
        self.assertTrue(all(r['institutionIds']==['uni-example'] for r in rows))
        self.assertTrue(all(r['country']=='IT' and r['profileScope']=='amir' for r in rows))

    def test_visible_text_keeps_main_content_but_not_boilerplate_or_hidden_scripts(self):
        parser=reader.VisibleText();parser.feed('<html><head><title>Funding</title><script>secret code</script></head><body><nav>menu noise</nav><main><h1>Clinical scholarship</h1><p>Requires a medical degree.</p><span hidden>hidden claim</span><p>Deadline: 20 November.</p></main><footer>cookie noise</footer></body></html>')
        title,text=parser.result()
        self.assertEqual(title,'Funding')
        self.assertIn('Requires a medical degree.',text)
        self.assertNotIn('noise',text);self.assertNotIn('hidden claim',text);self.assertNotIn('secret code',text)

    def test_actual_content_read_preserves_evidence_and_never_calls_provider_actions(self):
        calls=[]
        def fetch(url,limit):
            calls.append(url)
            if url.endswith('/robots.txt'):return response(b'User-agent: *\nAllow: /',mime='text/plain')
            return response(b'<html><body><main><h1>Clinical research</h1><p>Degree required. Funding available.</p></main></body></html>')
        item=reader.PublicReader(fetcher=fetch).read(queue()[0])
        self.assertEqual(item['status'],'read')
        self.assertIn('Degree required',item['text'])
        self.assertEqual(item['institutionIds'],['uni-example'])
        self.assertEqual(len(calls),2)

    def test_robots_denial_and_foreign_redirect_stay_failed_and_no_body_is_evaluated(self):
        calls=[]
        def deny(url,limit):
            calls.append(url);return response(b'User-agent: *\nDisallow: /',mime='text/plain')
        item=reader.PublicReader(fetcher=deny).read(queue()[0]);self.assertEqual(item['status'],'robots_blocked');self.assertEqual(item['text'],'');self.assertEqual(len(calls),1)
        def redirect(url,limit):
            if url.endswith('/robots.txt'):return response(b'',status=404)
            return {'status':302,'headers':{'location':'https://evil.invalid/secret'},'body':b''}
        self.assertEqual(reader.PublicReader(fetcher=redirect).read(queue()[0])['status'],'foreign_host')

    def test_truncated_html_and_pdf_without_parser_are_not_complete_reads(self):
        def large(url,limit):
            if url.endswith('/robots.txt'):return response(b'',status=404)
            return response(b'<html><body><main>'+b'x'*(reader.TEXT_LIMIT+1)+b'</main></body></html>')
        item=reader.PublicReader(fetcher=large).read(queue()[0]);self.assertEqual(item['status'],'read_partial');self.assertEqual(len(item['text']),reader.TEXT_LIMIT)
        def pdf(url,limit):
            return response(b'',status=404) if url.endswith('/robots.txt') else response(b'%PDF-test',mime='application/pdf')
        self.assertEqual(reader.PublicReader(fetcher=pdf,pdf_converter='').read(queue()[0])['status'],'pdf_parser_unavailable')

    def test_resume_flushes_public_records_and_skips_unique_completed_ids(self):
        class Fake:
            def read(self,row):return {'id':row['id'],'url':row['url'],'status':'read','text':'Synthetic public body'}
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'results.jsonl';rows=queue()
            first=reader.run_queue(rows,path,max_pages=1,reader=Fake())
            self.assertEqual(first['processed'],1);self.assertEqual(first['remaining'],2)
            second=reader.run_queue(rows,path,reader=Fake())
            self.assertEqual(second['processed'],2);self.assertEqual(second['remaining'],0)
            self.assertEqual(len(path.read_text().splitlines()),3)

    def test_extra_queue_is_explicit_public_scope_and_respects_official_publisher(self):
        extra={'url':'https://jobs.example.invalid/job/12','country':'AU','institutionIds':[],'officialBase':'jobs.example.invalid','id':'caller-id','opportunityIds':['opp-12']}
        rows=reader.merge_extra_queue([], [extra,extra])
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['country'],'AU');self.assertEqual(rows[0]['profileScope'],'both');self.assertNotEqual(rows[0]['id'],'caller-id')
        with self.assertRaises(reader.ScanFailure):reader.merge_extra_queue([],[{**extra,'url':'https://evil.invalid/job'}])
        with self.assertRaises(ValueError):reader.merge_extra_queue([],[{**extra,'country':'XX'}])


if __name__=='__main__':unittest.main()
