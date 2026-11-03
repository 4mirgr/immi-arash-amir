"""Bounded opt-in RSS/Atom ingestion; source portals are not verified vacancies."""
import datetime, hashlib, html, ipaddress, json, re, socket
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import xml.etree.ElementTree as ET

REGISTRY = Path(__file__).resolve().parents[1] / 'library' / 'sources.json'
MAX_BYTES = 2_000_000

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def init_schema(db):
    db.execute('create table if not exists opportunities (id text primary key, source_id text not null, data text not null)')
    db.execute('create table if not exists source_checks (source_id text primary key, data text not null)')
    db.commit()

def registry():
    return json.loads(REGISTRY.read_text(encoding='utf-8'))

def list_sources(db):
    checks = {row[0]: json.loads(row[1]) for row in db.execute('select source_id,data from source_checks')}
    return [{**s, 'collectorStatus': 'configured' if s.get('feedUrl') else 'feed_not_configured', 'lastCheck': checks.get(s['id'])} for s in registry()]

def list_opportunities(db, profile):
    if profile not in ('arash', 'amir'):
        raise ValueError('Unknown profile')
    return [json.loads(row[0]) for row in db.execute('select data from opportunities order by id')]

def validate_url(url, source, resolve=True):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.hostname not in source['allowedHosts']:
        raise ValueError('URL is not an allowlisted HTTPS source')
    if resolve:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ValueError('Private or reserved source address rejected')
    return url

class SafeRedirect(HTTPRedirectHandler):
    def __init__(self, source):
        self.source = source
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, self.source)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def plain(value):
    value = re.sub(r'<(script|style)\b[^>]*>.*?</\1\s*>', '', value or '', flags=re.I|re.S)
    return html.unescape(re.sub(r'<[^>]+>', '', value)).strip()[:10000]

def parse_feed(raw, source):
    if len(raw) > MAX_BYTES:
        raise ValueError('Feed exceeds size limit')
    if re.search(br'<!\s*(DOCTYPE|ENTITY)', raw, re.I):
        raise ValueError('DTD and entities are unsupported')
    root = ET.fromstring(raw)
    is_atom = root.tag == '{http://www.w3.org/2005/Atom}feed'
    entries = root.findall('{http://www.w3.org/2005/Atom}entry') if is_atom else root.findall('./channel/item')
    if root.tag not in ('rss', '{http://www.w3.org/2005/Atom}feed'):
        raise ValueError('Expected RSS or Atom')
    records = []
    for item in entries[:1000]:
        prefix = '{http://www.w3.org/2005/Atom}' if is_atom else ''
        def value(key):
            node = item.find(prefix + key)
            return ''.join(node.itertext()) if node is not None else ''
        link = item.find(prefix + 'link')
        url = (link.attrib.get('href', '') if is_atom and link is not None else value('link')).strip()
        try:
            validate_url(url, source, resolve=False)
        except ValueError:
            continue
        title = plain(value('title'))
        if not title:
            continue
        identity = value('id' if is_atom else 'guid') or url
        record = dict(id='job_'+hashlib.sha256((source['id']+'|'+identity).encode()).hexdigest()[:24], sourceId=source['id'], title=title, url=url, state=source['state'], summary=plain(value('summary' if is_atom else 'description')), publishedAt=value('published' if is_atom else 'pubDate') or None, fetchedAt=now(), status='source_listing_unverified', sponsorship=None, supervision=None, monash=None, eligibility=None)
        records.append(record)
    return records

def rank_opportunity(record, profile, preferred_states=()):
    """Known-text match signals, not acceptance probability or eligibility."""
    if profile not in ('arash','amir'):
        raise ValueError('Unknown profile')
    text = (record.get('title','')+' '+record.get('summary','')).casefold()
    words = ('general practitioner', 'gp ', 'medical officer') if profile == 'arash' else ('internal medicine', 'physician', 'medical registrar')
    reasons = []
    if any(word in text for word in words):
        reasons.append({'signal':'role_keyword','points':2})
    if record.get('state') in preferred_states:
        reasons.append({'signal':'preferred_state','points':1})
    return {'score':sum(r['points'] for r in reasons),'reasons':reasons,'meaning':'text_match_only_not_acceptance_probability'}

def collect_source(db, source, fetcher=None):
    if not source.get('feedUrl'):
        return {'sourceId':source['id'],'status':'feed_not_configured','imported':0}
    check = {'sourceId':source['id'],'checkedAt':now(),'status':'error','imported':0}
    previous = db.execute('select data from source_checks where source_id=?',(source['id'],)).fetchone()
    previous = json.loads(previous[0]) if previous else {}
    try:
        validate_url(source['feedUrl'],source)
        if fetcher:
            raw, etag = fetcher(source, previous.get('etag'))
        else:
            headers={'User-Agent':'IMMI-source-collector/0.1'}
            if previous.get('etag'):
                headers['If-None-Match']=previous['etag']
            try:
                with build_opener(SafeRedirect(source)).open(Request(source['feedUrl'],headers=headers),timeout=15) as response:
                    raw=response.read(MAX_BYTES+1); etag=response.headers.get('ETag')
            except HTTPError as error:
                if error.code != 304:
                    raise
                raw=None; etag=previous.get('etag')
        if raw is None:
            check.update(status='not_modified',etag=etag)
        else:
            records=parse_feed(raw,source)
            for record in records:
                db.execute('insert or replace into opportunities values (?,?,?)',(record['id'],source['id'],json.dumps(record)))
            check.update(status='ok',imported=len(records),etag=etag)
    except Exception as error:
        check['error']=type(error).__name__ # Do not store private URL/query/error bodies.
    db.execute('insert or replace into source_checks values (?,?)',(source['id'],json.dumps(check)))
    db.commit()
    return check
