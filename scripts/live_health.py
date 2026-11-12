"""Bounded anonymous probes: no login, private data, submissions or provider writes."""
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import re

ORIGIN = 'https://drgerami-md.ir'


def read(path: str, expected: int = 200) -> bytes:
    request = Request(ORIGIN + path, headers={'User-Agent':'Mozilla/5.0 AUS-ReadOnly-Health/1.0','Cache-Control':'no-cache'})
    try:
        response = urlopen(request, timeout=20)
    except HTTPError as error:
        if error.code != expected:
            error.close()
            raise RuntimeError('Unexpected production HTTP status: ' + path) from None
        response = error
    with response:
        body = response.read(1_000_001)
        if response.status != expected or len(body) > 1_000_000:
            raise RuntimeError('Production response failed bounds/status: ' + path)
        return body


def check_login() -> str:
    html = read('/aus/').decode('utf-8')
    match = re.search(r'src="(/aus/assets/index-[A-Za-z0-9_-]+\.js)"', html)
    if not match:
        raise RuntimeError('AUS entry asset missing')
    if not read(match.group(1)):
        raise RuntimeError('AUS entry bundle empty')
    config = json.loads(read('/aus/api/public-config'))
    if config.get('mode') != 'cloud' or config.get('authRequired') is not True:
        raise RuntimeError('Production authentication configuration changed')
    return 'PASS production entry, bundle and required authentication'


def check_private(path: str) -> str:
    body = json.loads(read(path, 401))
    if not isinstance(body.get('error'), str):
        raise RuntimeError('Unexpected anonymous API boundary')
    return 'PASS anonymous API denied: ' + path.split('?')[0]


def run() -> None:
    print(check_login())
    paths = ['/aus/api/bootstrap?profile=amir','/aus/api/research-funding?profile=amir','/aus/api/team-board?profile=arash','/aus/api/google/status?profile=amir']
    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(check_private, paths):
            print(result)


if __name__ == '__main__':
    run()
