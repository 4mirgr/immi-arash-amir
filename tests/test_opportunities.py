import json, sqlite3, unittest
from unittest.mock import patch
from server.opportunities import init_schema, parse_feed, validate_url, collect_source, list_opportunities, list_sources, rank_opportunity

SOURCE={'id':'synthetic','state':'NSW','allowedHosts':['example.gov.au'],'feedUrl':'https://example.gov.au/feed'}
RSS=b'''<rss version="2.0"><channel><item><guid>one</guid><title>General practitioner</title><link>https://example.gov.au/job/1</link><description>&lt;script&gt;bad()&lt;/script&gt;&lt;p&gt;A public listing&lt;/p&gt;</description><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>'''
class OpportunityTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');init_schema(self.db)
    def tearDown(self):self.db.close()
    def test_rss_is_plain_text_not_verified_job(self):
        record=parse_feed(RSS,SOURCE)[0]
        self.assertEqual(record['summary'],'A public listing')
        self.assertEqual(record['status'],'source_listing_unverified')
        self.assertIsNone(record['sponsorship'])
        self.assertEqual(record['id'],parse_feed(RSS,SOURCE)[0]['id'])
    def test_repeated_ingestion_deduplicates_and_records_etag(self):
        calls=[]
        def fetch(source,etag):calls.append(etag);return RSS,'v1'
        with patch('server.opportunities.socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]):
            self.assertEqual(collect_source(self.db,SOURCE,fetch)['status'],'ok')
            collect_source(self.db,SOURCE,fetch)
        self.assertEqual(len(list_opportunities(self.db,'arash')),1)
        self.assertEqual(calls,[None,'v1'])
    def test_invalid_and_private_source_urls_rejected(self):
        for url in ('http://example.gov.au/feed','https://evil.gov.au/feed','https://user:pass@example.gov.au/feed','https://example.gov.au:8443/feed'):
            with self.assertRaises(ValueError):validate_url(url,SOURCE,False)
        with patch('server.opportunities.socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):validate_url(SOURCE['feedUrl'],SOURCE)
    def test_entities_and_external_listing_links_rejected(self):
        with self.assertRaises(ValueError):parse_feed(b'<!DOCTYPE rss><rss/>',SOURCE)
        self.assertEqual(parse_feed(RSS.replace(b'https://example.gov.au/job/1',b'https://evil.test/job'),SOURCE),[])
    def test_unconfigured_registry_does_not_claim_collector_live(self):
        result=collect_source(self.db,{**SOURCE,'feedUrl':None})
        self.assertEqual(result['status'],'feed_not_configured')
        self.assertEqual(list_opportunities(self.db,'amir'),[])
        self.assertEqual(len(list_sources(self.db)),8)
    def test_atom_and_known_fact_ranking(self):
        atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>two</id><title>Internal medicine physician</title><link href="https://example.gov.au/job/2"/><summary>Public listing</summary></entry></feed>'
        record=parse_feed(atom,SOURCE)[0]
        self.assertEqual(rank_opportunity(record,'amir',['NSW'])['score'],3)
        self.assertEqual(rank_opportunity(record,'arash')['score'],0)
        with self.assertRaises(ValueError):list_opportunities(self.db,'unknown')
    def test_fetch_failure_retained_without_sensitive_error_text(self):
        with patch('server.opportunities.socket.getaddrinfo',side_effect=OSError('private query details')):
            result=collect_source(self.db,SOURCE)
        self.assertEqual(result['error'],'OSError')
        self.assertNotIn('private query details',json.dumps(result))
if __name__=='__main__':unittest.main()
