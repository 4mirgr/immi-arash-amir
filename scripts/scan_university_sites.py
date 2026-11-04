"""Bounded public university homepage discovery; never creates job opportunities."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import ssl
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, HTTPSHandler
from urllib.robotparser import RobotFileParser

AGENT = "MasirUniversityDiscovery/1.0"
HOME_LIMIT, ROBOTS_LIMIT = 1_048_576, 65_536
RELEVANT = re.compile(r"ph\.?d|dottorat|band[oi]|bors[ae]|scholarship|ricerca|research|finanziam|funding|grant", re.I)
SENSITIVE = re.compile(r"(?:^|/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|apply|application|candidate)(?:/|$)", re.I)
REPO_ROOT = Path(__file__).resolve().parents[1]
_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


class ScanFailure(Exception):
    pass


def safe_url(value: str, base: str | None = None) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ScanFailure("invalid_url")
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").encode("idna").decode("ascii").lower()
        if parts.scheme != "https" or parts.username or parts.password or parts.port:
            raise ScanFailure("invalid_url")
        if not host or "." not in host or host.endswith((".local", ".localhost", ".internal")):
            raise ScanFailure("invalid_url")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ScanFailure("invalid_url")
        if not re.fullmatch(r"[a-z0-9.-]+", host) or ".." in host:
            raise ScanFailure("invalid_url")
        if base and host != base and not host.endswith("." + base):
            raise ScanFailure("foreign_host")
        return urlunsplit(("https", host, parts.path or "/", parts.query, ""))
    except (ValueError, UnicodeError):
        raise ScanFailure("invalid_url") from None


def official_base(url: str) -> str:
    host = urlsplit(safe_url(url)).hostname
    return host[4:] if host.startswith("www.") else host


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_once(url: str, limit: int) -> dict:
    """TLS verified, no cookie jar, no credential headers, no automatic redirect."""
    opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    request = Request(url, headers={"User-Agent": AGENT, "Accept": "text/html,text/plain;q=0.9"})
    try:
        response = opener.open(request, timeout=12)
    except HTTPError as error:
        response = error
    with response:
        headers = {key.lower(): value for key, value in response.headers.items()}
        try:
            if int(headers.get("content-length", "0")) > limit:
                raise ScanFailure("body_too_large")
        except ValueError:
            raise ScanFailure("invalid_response") from None
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ScanFailure("body_too_large")
        return {"status": response.status, "headers": headers, "body": body}


def fetch_chain(url, base, limit, fetcher, before=None):
    for hop in range(3):
        url = safe_url(url, base)
        if before:
            before(url)
        response = fetcher(url, limit)
        if response["status"] in (301, 302, 303, 307, 308):
            if hop == 2 or not response["headers"].get("location"):
                raise ScanFailure("redirect_limit")
            url = safe_url(urljoin(url, response["headers"]["location"]), base)
            continue
        return url, response
    raise ScanFailure("redirect_limit")


def crawl_delay(text: str) -> float:
    """Conservative maximum from wildcard or this scanner's named groups."""
    groups, agents, delay = [], [], 0.0
    has_rules = False
    for line in text.splitlines() + ["User-agent: __end__"]:
        key, sep, value = line.split("#", 1)[0].partition(":")
        if not sep:
            continue
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if has_rules:
                groups.append((agents, delay))
                agents, delay, has_rules = [], 0.0, False
            agents.append(value.lower())
        else:
            has_rules = True
            if key == "crawl-delay":
                try:
                    number = float(value)
                    if number >= 0:
                        delay = max(delay, number)
                except ValueError:
                    raise ScanFailure("invalid_crawl_delay") from None
    named = [d for users, d in groups if any(u != "*" and u in AGENT.lower() for u in users)]
    selected = named or [d for users, d in groups if "*" in users]
    return max(selected, default=0.0)


class PageLinks(HTMLParser):
    def __init__(self, page_url, base):
        super().__init__(convert_charrefs=True)
        self.page_url, self.base = page_url, base
        self.title, self.links = "", []
        self.in_title, self.anchor, self.anchor_parts = False, None, []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self.in_title = True
        elif tag == "a":
            self.anchor, self.anchor_parts = attrs.get("href"), []

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.anchor:
            self.anchor_parts.append(data)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag != "a" or not self.anchor:
            return
        label = " ".join(" ".join(self.anchor_parts).split())[:200]
        try:
            url = safe_url(urljoin(self.page_url, self.anchor), self.base)
            parts = urlsplit(url)
            if not parts.query and not SENSITIVE.search(parts.path) and RELEVANT.search(label + " " + parts.path):
                if len(self.links) < 12 and not any(x["url"] == url for x in self.links):
                    self.links.append({"url": url, "label": label or parts.path[:200]})
        except ScanFailure:
            pass
        self.anchor, self.anchor_parts = None, []


def scan_institution(record: dict, fetcher=fetch_once, sleeper=time.sleep) -> dict:
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result = {"institutionId": record.get("id"), "checkedAt": checked_at, "status": "failed", "title": "", "finalUrl": None, "links": [], "limitations": ["Technical homepage scan only; linked pages are not fetched and no vacancy, deadline, funding or eligibility is verified."]}
    try:
        homepage = safe_url(record.get("url"))
        base = official_base(homepage)
        robots = {}

        def before(url):
            origin = "https://" + urlsplit(url).hostname
            if origin not in robots:
                _, response = fetch_chain(origin + "/robots.txt", base, ROBOTS_LIMIT, fetcher)
                status = response["status"]
                if status in (401, 403):
                    raise ScanFailure("robots_blocked")
                if status != 404 and status != 200:
                    raise ScanFailure("robots_unavailable")
                text = response["body"].decode("utf-8", "replace") if status == 200 else ""
                if "<html" in text[:500].lower():
                    raise ScanFailure("invalid_robots")
                policy = RobotFileParser()
                policy.parse(text.splitlines())
                delay = crawl_delay(text)
                if delay > 30:
                    raise ScanFailure("crawl_delay_exceeds_budget")
                robots[origin] = (policy, delay)
            policy, delay = robots[origin]
            if not policy.can_fetch(AGENT, url):
                raise ScanFailure("robots_blocked")
            if delay:
                sleeper(delay)

        final_url, response = fetch_chain(homepage, base, HOME_LIMIT, fetcher, before)
        if response["status"] != 200:
            raise ScanFailure("homepage_http_error")
        if response["headers"].get("content-type") and not any(t in response["headers"]["content-type"].lower() for t in ("text/html", "application/xhtml+xml")):
            raise ScanFailure("homepage_not_html")
        body = response["body"].decode("utf-8", "replace")
        if not re.search(r"<(?:html|head|body)\b", body, re.I):
            raise ScanFailure("homepage_not_html")
        parser = PageLinks(final_url, base)
        parser.feed(body)
        result.update(status="checked", title=" ".join(parser.title.split())[:300], finalUrl=final_url, links=parser.links)
    except ScanFailure as error:
        result["status"] = str(error)
    except Exception:
        result["status"] = "fetch_failed"
    return result


def scan_catalogue(records, workers=4, fetcher=fetch_once, sleeper=time.sleep):
    if not isinstance(records, list) or len(records) > 250:
        raise ValueError("Expected at most250 official directory records")
    ids = [r.get("id") for r in records if isinstance(r, dict)]
    if len(ids) != len(records) or any(not isinstance(x, str) or not x or len(x) > 120 for x in ids) or len(set(ids)) != len(ids):
        raise ValueError("Unique bounded institution IDs required")

    def scan(record):
        try:
            base = official_base(record.get("url"))
        except ScanFailure:
            return scan_institution(record, fetcher, sleeper)
        with _locks_guard:
            lock = _locks.setdefault(base, threading.Lock())
        with lock:
            return scan_institution(record, fetcher, sleeper)

    with ThreadPoolExecutor(max_workers=max(1, min(4, workers))) as executor:
        return list(executor.map(scan, records))


def related_records(payload, per_institution=2):
    """Select only URLs actually observed on successfully scanned parent pages."""
    if not isinstance(payload, dict) or payload.get("format") != "masir-university-site-scan" or payload.get("scope") != "official_homepages_and_observed_same_domain_links" or not isinstance(payload.get("results"), list):
        raise ValueError("Expected a homepage scan receipt")
    if not isinstance(per_institution, int) or not 1 <= per_institution <= 2:
        raise ValueError("Select one or two related pages per institution")
    records = []
    parents = set()
    for parent in payload["results"]:
        if not isinstance(parent, dict) or parent.get("status") != "checked":
            continue
        identity = parent.get("institutionId")
        if not isinstance(identity, str) or not identity or len(identity) > 100 or identity in parents:
            raise ValueError("Unique bounded parent identity required")
        parents.add(identity)
        try:
            parent_url = safe_url(parent.get("finalUrl"))
            base = official_base(parent_url)
        except ScanFailure:
            continue
        observed = {}
        links = parent.get("links")
        if not isinstance(links, list):
            continue
        for link in links[:12]:
            if not isinstance(link, dict):
                continue
            try:
                url = safe_url(link.get("url"), base)
            except ScanFailure:
                continue
            parts = urlsplit(url)
            label = link.get("label") if isinstance(link.get("label"), str) else ""
            if url != parent_url and not parts.query and not SENSITIVE.search(parts.path) and RELEVANT.search(label + " " + parts.path):
                observed.setdefault(url, label[:200])
        # Favor explicit call/PhD/funding paths over broad research entry pages.
        ordered = sorted(observed, key=lambda u: (not bool(re.search(r"dottorat|phd|band[oi]|bors[ae]|scholarship|funding", u + " " + observed[u], re.I)), u))
        for index, url in enumerate(ordered[:per_institution], 1):
            records.append({"id": identity + "-related-" + str(index), "url": url, "parentInstitutionId": identity, "sourceUrl": url, "discoveredFrom": parent_url, "sourceLabel": observed[url]})
    if len(records) > 250:
        raise ValueError("Related scan exceeds250 page budget")
    return records


def scan_related(payload, workers=4, per_institution=2, fetcher=fetch_once, sleeper=time.sleep):
    records = related_records(payload, per_institution)
    results = scan_catalogue(records, workers, fetcher, sleeper)
    provenance = {r["id"]: r for r in records}
    for result in results:
        source = provenance[result["institutionId"]]
        result.update({key: source[key] for key in ("parentInstitutionId", "sourceUrl", "discoveredFrom", "sourceLabel")})
        result["limitations"] = ["Technical scan of an actually linked related page only; no further linked page is fetched and no vacancy, deadline, funding or personal eligibility is verified."]
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(REPO_ROOT / "cloud/italian-universities.json"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--related-from", help="Optional previous homepage-scan JSON; scan observed pages only")
    parser.add_argument("--related-per-institution", type=int, default=2, choices=(1, 2))
    args = parser.parse_args()
    destination = Path(args.output).resolve()
    if destination.is_relative_to(REPO_ROOT):
        parser.error("Write scan receipts outside the Git repository")
    if args.related_from:
        home_receipt = json.loads(Path(args.related_from).read_text())
        results = scan_related(home_receipt, args.workers, args.related_per_institution)
        scope = "observed_official_related_pages_only"
    else:
        records = json.loads(Path(args.input).read_text())
        results = scan_catalogue(records, args.workers)
        scope = "official_homepages_and_observed_same_domain_links"
    payload = {"format": "masir-university-site-scan", "version": 1, "scope": scope, "results": results}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    counts = {}
    for row in results:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    print(json.dumps({"institutions": len(results), "observedLinks": sum(len(r["links"]) for r in results), "statuses": counts}))


if __name__ == "__main__":
    main()
