"""Build a private URL-only staging seed; never import sheet contacts as evidence.

Input: normalized-leads.jsonl or deduplicated-email-leads.jsonl from the private
contact review. Output must be outside the repository. This prepares candidates;
it does not fetch sites, create vacancies or authorize/send messages.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, unquote, quote
from uuid import UUID

REPO=Path(__file__).resolve().parents[1]
SENSITIVE=re.compile(r'(?:^|/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|oauth|apply|application|candidate)(?:/|$)',re.I)
AGGREGATORS=('linkedin.com','facebook.com','instagram.com','twitter.com','x.com','youtube.com','youtu.be','google.com','google.com.au','maps.app.goo.gl','goo.gl','seek.com.au','indeed.com','indeed.com.au','healthdirect.gov.au')
PRIVATE_ALIASES=('nip.io','sslip.io','localtest.me','vcap.me','lvh.me')

def candidate_url(value):
    if not isinstance(value,str) or len(value)>2000 or re.search(r'[\x00-\x20\\]',value):return None
    try:
        u=urlsplit(value)
        if u.scheme.lower() not in ('http','https') or u.username or u.password or u.query or u.fragment or u.port not in (None,443 if u.scheme.lower()=='https' else 80):return None
        host=(u.hostname or '').encode('idna').decode('ascii').lower()
        if not re.fullmatch(r'[-a-z0-9.]+\.[a-z]{2,63}',host) or '..' in host:return None
        if host.rsplit('.',1)[-1] in ('localhost','local','internal','lan','home','onion'):return None
        if any(host==d or host.endswith('.'+d) for d in AGGREGATORS+PRIVATE_ALIASES):return None
        if SENSITIVE.search(unquote(u.path)):return None
        # HTTP sites are candidates for a verified HTTPS read, never a verified URL.
        return urlunsplit(('https',host,quote(u.path or '/',safe="/%:@-._~!$&'()*+,;=[]|^"),'',''))
    except (UnicodeError,ValueError):return None

def clean(value,limit):
    return re.sub(r'[\x00-\x1f<>]',' ',value).strip()[:limit] if isinstance(value,str) else ''

def prepare(lines,owner,at=None):
    owner=str(UUID(owner));at=at or datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    rows={};summary={'inputRows':0,'invalidRows':0,'candidateURLs':0,'rejectedURLs':0,'duplicateURLs':0,'httpCandidatesUpgraded':0}
    for index,line in enumerate(lines,1):
        if not line.strip():continue
        summary['inputRows']+=1
        try:item=json.loads(line)
        except (ValueError,TypeError):summary['invalidRows']+=1;continue
        if not isinstance(item,dict) or item.get('ownerProfile') not in (None,'arash'):summary['invalidRows']+=1;continue
        values=item.get('websiteCandidates',[])
        if not isinstance(values,list):summary['invalidRows']+=1;continue
        names=item.get('nameCandidates',[])
        name=clean(item.get('name') or (names[0] if isinstance(names,list) and len(names)==1 else ''),180)
        p=item.get('provenance')
        if not isinstance(p,dict):
            examples=item.get('sourceExamples',[]);p=examples[0] if isinstance(examples,list) and examples and isinstance(examples[0],dict) else {}
        provenance={'sourceFile':clean(p.get('file') or p.get('sourceFile'),180),'sourceSheet':clean(p.get('sheet') or p.get('sourceSheet'),100)}
        source_row=p.get('row') or p.get('sourceRow')
        if isinstance(source_row,int) and not isinstance(source_row,bool) and 0<source_row<10000000:provenance['sourceRow']=source_row
        for value in values:
            url=candidate_url(value)
            if not url:summary['rejectedURLs']+=1;continue
            if url in rows:summary['duplicateURLs']+=1;continue
            upgraded=isinstance(value,str) and value.lower().startswith('http:')
            if upgraded:summary['httpCandidatesUpgraded']+=1
            metadata={**provenance,'candidateOnly':True,**({'httpsUpgradeCandidate':True} if upgraded else {})}
            rows[url]={'id':'bank_'+hashlib.sha256((owner+'\n'+url).encode()).hexdigest()[:32],'owner_id':owner,'profile_id':'arash','url':url,'name':name,'provenance_json':json.dumps(metadata,ensure_ascii=False),'created_at':at,'updated_at':at}
    summary['candidateURLs']=len(rows)
    return {'ownerId':owner,'profileId':'arash','leadOnly':True,'sendingApproved':False,'items':list(rows.values()),'summary':summary}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--owner',required=True);a=p.parse_args()
    output=a.output.resolve()
    if output.is_relative_to(REPO):p.error('private output must be outside the repository')
    if output==a.input.resolve():p.error('input and output must differ')
    try:
        with a.input.open(encoding='utf-8') as f:result=prepare(f,a.owner)
    except (OSError,ValueError):p.error('input is unavailable or owner UUID is invalid')
    output.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,separators=(',',':'))
    os.chmod(output,0o600)
    print(json.dumps(result['summary']))

if __name__=='__main__':main()
