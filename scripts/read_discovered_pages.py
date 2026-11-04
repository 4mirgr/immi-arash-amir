"""Read a finite corpus of already discovered official public pages into resumable JSONL."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import fcntl
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPSHandler
from urllib.robotparser import RobotFileParser

from scan_university_sites import safe_url, official_base, fetch_chain, crawl_delay, NoRedirect, ScanFailure, SENSITIVE, AGENT, ROBOTS_LIMIT

ROOT = Path(__file__).resolve().parents[1]
BODY_LIMIT = 3 * 1024 * 1024
TEXT_LIMIT = 50_000
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
EXCLUDED_TAGS = {'head','script','style','noscript','nav','footer','header','aside','form','svg','canvas','iframe','template'}


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.parts, self.title_parts = [], []
        self.title_depth = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'title':
            self.title_depth += 1
        hidden = bool(self.stack and self.stack[-1][1]) or tag in EXCLUDED_TAGS or 'hidden' in attrs or attrs.get('aria-hidden','').lower() == 'true' or bool(re.search(r'display\s*:\s*none|visibility\s*:\s*hidden', attrs.get('style',''), re.I))
        if tag not in VOID:
            self.stack.append((tag, hidden))
        if not hidden and tag in {'p','div','section','article','main','li','tr','h1','h2','h3','h4','br','hr'}:
            self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag == 'title':
            self.title_depth = max(0, self.title_depth - 1)
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag in {'p','div','section','article','main','li','tr','h1','h2','h3','h4'}:
            self.parts.append('\n')
    def handle_data(self, data):
        if self.title_depth:
            self.title_parts.append(data)
        if not self.stack or not self.stack[-1][1]:
            self.parts.append(data)
    def result(self):
        text = '\n'.join(' '.join(line.split()) for line in ''.join(self.parts).splitlines() if line.strip())
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text)
        return ' '.join(' '.join(self.title_parts).split())[:400], text


def build_queue(directory, homepage_receipt, related_receipt):
    if not isinstance(directory, list) or not 1 <= len(directory) <= 250:
        raise ValueError('Invalid official directory')
    institutions = {r.get('id'):r for r in directory if isinstance(r, dict)}
    if len(institutions) != len(directory) or any(r.get('country') != 'IT' or r.get('profileScope') != 'amir' for r in directory):
        raise ValueError('Invalid institution scope or identity')
    pending = {}
    def add(value, institution_id, label='', discovered_from=None):
        if institution_id not in institutions:
            return
        try:
            base = official_base(institutions[institution_id]['url'])
            url = safe_url(value, base)
        except (ScanFailure, KeyError):
            return
        if SENSITIVE.search(urlsplit(url).path):
            return
        identity = 'page_' + hashlib.sha256(url.encode()).hexdigest()[:32]
        row = pending.setdefault(url, {'id':identity,'url':url,'institutionIds':set(),'officialBases':set(),'labels':set(),'discoveredFrom':set(),'country':'IT','profileScope':'amir'})
        row['institutionIds'].add(institution_id)
        row['officialBases'].add(base)
        if isinstance(label,str) and label.strip(): row['labels'].add(label[:200])
        if isinstance(discovered_from,str): row['discoveredFrom'].add(discovered_from)
    for identity, item in institutions.items():
        add(item.get('url'),identity,item.get('name',''))
    for receipt, related in [(homepage_receipt,False),(related_receipt,True)]:
        if not isinstance(receipt,dict) or not isinstance(receipt.get('results'),list):
            raise ValueError('Invalid scan receipt')
        for row in receipt['results']:
            identity = row.get('parentInstitutionId') if related else row.get('institutionId')
            parent = row.get('sourceUrl') or row.get('finalUrl')
            if related: add(parent,identity,row.get('sourceLabel',''),row.get('discoveredFrom'))
            for link in row.get('links',[]):
                if isinstance(link,dict): add(link.get('url'),identity,link.get('label',''),parent)
    if len(pending)>5000: raise ValueError('Finite corpus exceeds5000 URLs')
    rows=[]
    for row in pending.values():
        rows.append({k:sorted(v) if isinstance(v,set) else v for k,v in row.items()})
    # Round-robin institutional hosts so one slow domain cannot occupy every worker.
    groups=defaultdict(deque)
    for row in sorted(rows,key=lambda r:r['url']): groups[row['officialBases'][0]].append(row)
    ordered=[]
    while groups:
        for host in list(groups):
            ordered.append(groups[host].popleft())
            if not groups[host]: del groups[host]
    return ordered


def merge_extra_queue(rows, extras):
    if not isinstance(extras,list) or len(extras)>5000:
        raise ValueError('Expected at most5000publicextraURLs')
    combined={r['url']:dict(r) for r in rows}
    for extra in extras:
        if not isinstance(extra,dict) or extra.get('country') not in ('AU','IT'):
            raise ValueError('Invalid extra public scope')
        raw_base=extra.get('officialBase')
        if not isinstance(raw_base,str) or not raw_base:
            raise ValueError('Explicit official publisher base required')
        base=official_base(raw_base if '://' in raw_base else 'https://'+raw_base)
        value=safe_url(extra.get('url'),base)
        if SENSITIVE.search(urlsplit(value).path):
            continue
        identities=extra.get('institutionIds',[])
        if not isinstance(identities,list) or len(identities)>250 or any(not isinstance(x,str) or len(x)>150 for x in identities):
            raise ValueError('Invalid institution references')
        item=combined.setdefault(value,{'id':'page_'+hashlib.sha256(value.encode()).hexdigest()[:32],'url':value,'institutionIds':[],'officialBases':[],'labels':[],'discoveredFrom':[],'country':extra['country'],'profileScope':'amir' if extra['country']=='IT' else 'both'})
        if item.get('country','IT')!=extra['country']:
            raise ValueError('Same public URL cannot silently change country')
        item['institutionIds']=sorted(set(item.get('institutionIds',[])+identities))
        item['officialBases']=sorted(set(item.get('officialBases',[])+[base]))
        for key in ('labels','discoveredFrom','opportunityIds'):
            values=extra.get(key,[])
            if isinstance(values,list):item[key]=sorted(set(item.get(key,[])+[v[:2048] for v in values if isinstance(v,str)]))[:250]
    if len(combined)>5000:raise ValueError('Finite corpus exceeds5000URLs')
    return list(combined.values())


def fetch_public(url,limit):
    opener=build_opener(NoRedirect(),HTTPSHandler(context=ssl.create_default_context()))
    request=Request(url,headers={'User-Agent':AGENT,'Accept':'text/html,application/pdf,text/plain;q=0.9'})
    try: response=opener.open(request,timeout=10)
    except HTTPError as error: response=error
    with response:
        headers={k.lower():v for k,v in response.headers.items()}
        try:
            if int(headers.get('content-length','0'))>limit: raise ScanFailure('body_too_large')
        except ValueError: raise ScanFailure('invalid_response') from None
        body=response.read(limit+1)
        if len(body)>limit: raise ScanFailure('body_too_large')
        return {'status':response.status,'headers':headers,'body':body}


class PublicReader:
    def __init__(self,fetcher=fetch_public,sleeper=time.sleep,clock=time.monotonic,pdf_converter=None):
        self.fetcher,self.sleeper,self.clock=fetcher,sleeper,clock
        self.locks,self.guard,self.policies,self.last_fetch={},threading.Lock(),{},{}
        self.pdf_converter=pdf_converter if pdf_converter is not None else shutil.which('pdftotext')
    def policy(self,url,base):
        origin='https://'+urlsplit(url).hostname
        if origin not in self.policies:
            try:
                _,response=fetch_chain(origin+'/robots.txt',base,ROBOTS_LIMIT,self.fetcher)
                if response['status'] in (401,403): raise ScanFailure('robots_blocked')
                if response['status'] not in (200,404): raise ScanFailure('robots_unavailable')
                raw=response['body'].decode('utf-8','replace') if response['status']==200 else ''
                if '<html' in raw[:500].lower(): raise ScanFailure('invalid_robots')
                delay=crawl_delay(raw)
                if delay>30: raise ScanFailure('crawl_delay_exceeds_budget')
                policy=RobotFileParser();policy.parse(raw.splitlines())
                self.policies[origin]=(policy,delay,None)
            except ScanFailure as error:
                self.policies[origin]=(None,0,str(error))
            except Exception:
                self.policies[origin]=(None,0,'robots_unavailable')
        policy,delay,error=self.policies[origin]
        if error: raise ScanFailure(error)
        if not policy.can_fetch(AGENT,url): raise ScanFailure('robots_blocked')
        wait=delay-(self.clock()-self.last_fetch.get(origin,float('-inf')))
        if wait>0: self.sleeper(wait)
        self.last_fetch[origin]=self.clock()
    def pdf_text(self,body):
        if not self.pdf_converter: raise ScanFailure('pdf_parser_unavailable')
        with tempfile.TemporaryDirectory(prefix='masir-public-pdf-') as temp:
            source=Path(temp)/'source.pdf';target=Path(temp)/'text.txt';source.write_bytes(body)
            completed=subprocess.run([self.pdf_converter,'-f','1','-l','50','-layout','-nopgbrk','-enc','UTF-8',str(source),str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15,check=False)
            if completed.returncode or not target.exists(): raise ScanFailure('pdf_parse_failed')
            return target.read_bytes()[:2_000_000].decode('utf-8','replace')
    def read(self,row):
        result={'id':row['id'],'url':row['url'],'institutionIds':row['institutionIds'],'country':row.get('country','IT'),'profileScope':row.get('profileScope','amir'),'opportunityIds':row.get('opportunityIds',[]),'readAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'status':'fetch_failed','contentType':None,'title':'','text':'','finalUrl':None,'labels':row.get('labels',[]),'discoveredFrom':row.get('discoveredFrom',[]),'limitations':[]}
        base=row['officialBases'][0]
        with self.guard: lock=self.locks.setdefault(base,threading.Lock())
        with lock:
            try:
                if SENSITIVE.search(urlsplit(row['url']).path): raise ScanFailure('private_path_excluded')
                final,response=fetch_chain(row['url'],base,BODY_LIMIT,self.fetcher,lambda url:self.policy(url,base))
                if response['status'] in (401,403): raise ScanFailure('access_denied')
                if response['status']!=200: raise ScanFailure('http_error')
                body=response['body'];mime=response['headers'].get('content-type','').split(';',1)[0].strip().lower();result['contentType']=mime;result['finalUrl']=final
                if mime=='application/pdf' or body.startswith(b'%PDF-'):
                    text=self.pdf_text(body);title=' '.join(row.get('labels',[]))[:400]
                    result['limitations'].append('PDF extraction is limited to the first50 pages; complete document review remains required.')
                    partial=True
                elif mime in ('text/plain','text/csv'):
                    text=body.decode('utf-8','replace');title=' '.join(row.get('labels',[]))[:400];partial=False
                elif mime in ('text/html','application/xhtml+xml',''):
                    charset=re.search(r'charset=([\w-]+)',response['headers'].get('content-type',''),re.I)
                    encoding=charset.group(1) if charset else 'utf-8'
                    try: decoded=body.decode(encoding,'replace')
                    except LookupError: decoded=body.decode('utf-8','replace')
                    parser=VisibleText();parser.feed(decoded);title,text=parser.result();partial=False
                else: raise ScanFailure('unsupported_content')
                if not text.strip(): raise ScanFailure('empty_text')
                if len(text)>TEXT_LIMIT: partial=True;result['limitations'].append('Visible text truncated at50000characters; further content has not been evaluated.')
                result.update(status='read_partial' if partial else 'read',title=title,text=text[:TEXT_LIMIT],contentHash=hashlib.sha256(text.encode()).hexdigest(),extractedCharacters=min(len(text),TEXT_LIMIT))
                if not result['limitations']: result['limitations'].append('Public visible text only; hidden, authenticated, linked or dynamically rendered material is not implicitly read.')
            except ScanFailure as error: result['status']=str(error)
            except subprocess.TimeoutExpired: result['status']='pdf_parse_timeout'
            except Exception: result['status']='fetch_failed'
        return result


def completed_ids(path):
    if not path.exists(): return set()
    done=set()
    with path.open(encoding='utf-8') as source:
        for line in source:
            if not line.strip(): continue
            try: row=json.loads(line)
            except json.JSONDecodeError: raise ValueError('Malformed resume JSONL; preserve it and repair the last line before resuming') from None
            if not isinstance(row,dict) or not isinstance(row.get('id'),str): raise ValueError('Invalid resume record')
            done.add(row['id'])
    return done


def run_queue(rows,output,workers=4,max_pages=None,reader=None):
    output=Path(output).resolve()
    if output.is_relative_to(ROOT): raise ValueError('Store public content receipts outsideGit')
    output.parent.mkdir(parents=True,exist_ok=True)
    reader=reader or PublicReader();counts=Counter()
    with output.open('a',encoding='utf-8') as target:
        try:fcntl.flock(target.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('Another reader already owns this output file') from None
        done=completed_ids(output)
        previous=sum(r['id'] in done for r in rows)
        pending=[r for r in rows if r['id'] not in done]
        if max_pages is not None:
            if not isinstance(max_pages,int) or max_pages<1: raise ValueError('Positive page limit required')
            pending=pending[:max_pages]
        with ThreadPoolExecutor(max_workers=max(1,min(4,workers))) as executor:
            futures=[executor.submit(reader.read,row) for row in pending]
            for index,future in enumerate(as_completed(futures),1):
                result=future.result();target.write(json.dumps(result,ensure_ascii=False)+'\n');target.flush();counts[result['status']]+=1
                if index%20==0: print(json.dumps({'processed':index,'pendingAtStart':len(pending),'statuses':dict(counts)}),flush=True)
    return {'corpusPages':len(rows),'previouslyCompleted':previous,'processed':len(pending),'remaining':max(0,len(rows)-previous-len(pending)),'statuses':dict(counts)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',default=str(ROOT/'cloud/italian-universities.json'))
    parser.add_argument('--home')
    parser.add_argument('--related')
    parser.add_argument('--queue',help='Optional explicit public AU/IT records array')
    parser.add_argument('--extra-only',action='store_true')
    parser.add_argument('--output',required=True)
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--max-pages',type=int)
    parser.add_argument('--queue-output')
    parser.add_argument('--queue-only',action='store_true')
    args=parser.parse_args()
    read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
    if args.extra_only:
        if not args.queue:parser.error('--extra-only requires --queue')
        rows=[]
    else:
        if not args.home or not args.related:parser.error('Homepage and related receipts required')
        rows=build_queue(read(args.directory),read(args.home),read(args.related))
    if args.queue:rows=merge_extra_queue(rows,read(args.queue))
    if args.queue_output:
        path=Path(args.queue_output).resolve()
        if path.is_relative_to(ROOT): parser.error('WritequeueoutsideGit')
        path.write_text(json.dumps({'format':'masir-public-reading-queue','version':1,'records':rows},ensure_ascii=False,indent=2))
    if args.queue_only:
        print(json.dumps({'corpusPages':len(rows)}));return
    print(json.dumps(run_queue(rows,args.output,args.workers,args.max_pages)),flush=True)


if __name__=='__main__': main()
