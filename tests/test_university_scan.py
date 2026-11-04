import unittest

from scripts.scan_university_sites import (
    HOME_LIMIT, ROBOTS_LIMIT, PageLinks, ScanFailure, crawl_delay,
    safe_url, scan_catalogue, scan_institution, related_records, scan_related,
)


class UniversityScanTests(unittest.TestCase):
    def test_urls_reject_private_ip_auth_ports_downgrades_and_foreign_hosts(self):
        for url in ["http://university.example/", "https://127.0.0.1/", "https://[::1]/", "https://localhost/", "https://a.internal/", "https://user:password@university.example/", "https://university.example:443/"]:
            with self.subTest(url=url), self.assertRaises(ScanFailure):
                safe_url(url)
        with self.assertRaises(ScanFailure):
            safe_url("https://university.example.evil.test/", "university.example")
        self.assertEqual(safe_url("https://research.university.example/phd/#top", "university.example"), "https://research.university.example/phd/")

    def test_only_observed_relevant_public_official_links_are_returned(self):
        page = PageLinks("https://www.university.example/", "university.example")
        page.feed('<html><title>Test University</title><a href="/research/">Research</a><a href="https://phd.university.example/bandi/">PhD calls</a><a href="https://foreign.example/phd/">Foreign PhD</a><a href="/login/phd/">PhD login</a><a href="/phd/?token=secret">Private action</a><a href="/sport/">Sport</a><a href="/research/">Duplicate</a></html>')
        self.assertEqual(page.title, "Test University")
        self.assertEqual([r["url"] for r in page.links], ["https://www.university.example/research/", "https://phd.university.example/bandi/"])

    def test_robots_disallow_stops_homepage_and_never_fabricates_a_scan(self):
        calls = []

        def fetch(url, limit):
            calls.append((url, limit))
            return {"status": 200, "headers": {}, "body": b"User-agent: *\nDisallow: /\n"}

        result = scan_institution({"id": "u", "url": "https://university.example/"}, fetch, lambda _: None)
        self.assertEqual(result["status"], "robots_blocked")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], ROBOTS_LIMIT)
        self.assertEqual(result["links"], [])

    def test_delay_and_limits_are_honored_while_only_homepage_is_fetched(self):
        calls, delays = [], []

        def fetch(url, limit):
            calls.append((url, limit))
            if url.endswith("robots.txt"):
                return {"status": 200, "headers": {}, "body": b"User-agent: *\nAllow: /\nCrawl-delay: 2.5\n"}
            return {"status": 200, "headers": {"content-type": "text/html"}, "body": b'<html><title>Synthetic University</title><a href="/phd/">PhD</a></html>'}

        result = scan_institution({"id": "u", "url": "https://university.example/"}, fetch, delays.append)
        self.assertEqual(result["status"], "checked")
        self.assertEqual(delays, [2.5])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1], HOME_LIMIT)
        self.assertEqual(result["links"][0]["url"], "https://university.example/phd/")
        self.assertFalse(any(url.endswith("/phd/") for url, _ in calls))

    def test_foreign_or_http_redirect_is_rejected_before_it_is_requested(self):
        for destination in ["http://university.example/", "https://foreign.example/"]:
            calls = []

            def fetch(url, limit):
                calls.append(url)
                if url.endswith("robots.txt"):
                    return {"status": 404, "headers": {}, "body": b""}
                return {"status": 302, "headers": {"location": destination}, "body": b""}

            result = scan_institution({"id": "u", "url": "https://university.example/"}, fetch, lambda _: None)
            self.assertNotEqual(result["status"], "checked")
            self.assertNotIn(destination, calls[2:])

    def test_excess_delay_unavailable_robots_and_duplicate_identity_fail_safely(self):
        self.assertEqual(crawl_delay("User-agent: *\nCrawl-delay: 1\nUser-agent: MasirUniversityDiscovery\nCrawl-delay: 7\n"), 7)
        for status, body, expected in [(200, b"User-agent: *\nCrawl-delay: 31\n", "crawl_delay_exceeds_budget"), (403, b"denied", "robots_blocked"), (500, b"down", "robots_unavailable")]:
            result = scan_institution({"id": "u", "url": "https://university.example/"}, lambda *_: {"status": status, "headers": {}, "body": body}, lambda _: None)
            self.assertEqual(result["status"], expected)
        with self.assertRaises(ValueError):
            scan_catalogue([{"id": "u"}, {"id": "u"}])

    def test_related_pages_are_observed_deduplicated_bounded_and_keep_parent_provenance(self):
        payload = {"format": "masir-university-site-scan", "scope": "official_homepages_and_observed_same_domain_links", "results": [{"institutionId": "university-1", "status": "checked", "finalUrl": "https://www.university.example/", "links": [{"url": "https://www.university.example/research/", "label": "Research"}, {"url": "https://www.university.example/phd/", "label": "PhD"}, {"url": "https://www.university.example/phd/#top", "label": "Duplicate PhD"}, {"url": "https://www.university.example/bandi/", "label": "Calls"}, {"url": "https://foreign.example/phd/", "label": "Foreign"}]}]}
        selected = related_records(payload)
        self.assertEqual(len(selected), 2)
        self.assertEqual([r["id"] for r in selected], ["university-1-related-1", "university-1-related-2"])
        self.assertEqual(len(set(r["url"] for r in selected)), 2)
        self.assertTrue(all(r["parentInstitutionId"] == "university-1" for r in selected))
        calls = []

        def fetch(url, limit):
            calls.append(url)
            if url.endswith("robots.txt"):
                return {"status": 404, "headers": {}, "body": b""}
            return {"status": 200, "headers": {"content-type": "text/html"}, "body": b"<html><title>Actual related page</title></html>"}

        results = scan_related(payload, fetcher=fetch, sleeper=lambda _: None)
        self.assertEqual([r["status"] for r in results], ["checked", "checked"])
        for row in results:
            self.assertEqual(row["parentInstitutionId"], "university-1")
            self.assertIn(row["sourceUrl"], [r["url"] for r in selected])
            self.assertEqual(row["discoveredFrom"], "https://www.university.example/")
        self.assertFalse(any(url.endswith("/research/") for url in calls))
        with self.assertRaises(ValueError):
            related_records(payload, 3)
        payload["scope"] = "observed_official_related_pages_only"
        with self.assertRaises(ValueError):
            related_records(payload)


if __name__ == "__main__":
    unittest.main()
