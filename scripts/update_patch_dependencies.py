"""Prepare stable dependency patches in isolation; never run package scripts or deploy."""
from pathlib import Path
import argparse
import copy
import json
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
NAME = re.compile(r'^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+$')


def stable(version: str) -> tuple[int, int, int]:
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('Only stable semantic versions may update automatically')
    return tuple(map(int, match.groups()))


def validate_candidate(before: dict, after: dict) -> list[dict]:
    if before.get('lockfileVersion') != 3 or after.get('lockfileVersion') != 3:
        raise ValueError('Unreviewed lockfile format')
    if {k:v for k,v in before.items() if k!='packages'} != {k:v for k,v in after.items() if k!='packages'}:
        raise ValueError('Root lock metadata changed')
    left, right = before['packages'], after['packages']
    if set(left) != set(right) or left[''] != right['']:
        raise ValueError('Package additions, removals or root manifest changes require review')
    updates = []
    for path, old in left.items():
        if not path or old == right[path]:
            continue
        new = right[path]
        if new.get('hasInstallScript') and not old.get('hasInstallScript') or new.get('link'):
            raise ValueError('New executable installation behaviour requires review: '+path)
        a, b = stable(old.get('version', '')), stable(new.get('version', ''))
        if a[:2] != b[:2] or b <= a:
            raise ValueError('Non-patch change requires review: ' + path)
        for entry in (old, new):
            url = urlparse(entry.get('resolved', ''))
            if (url.scheme != 'https' or url.hostname != 'registry.npmjs.org'
                    or url.username or url.password or url.port or url.query or url.fragment
                    or not re.fullmatch(r'sha512-[A-Za-z0-9+/]+={0,2}', entry.get('integrity', ''))):
                raise ValueError('Unreviewed dependency origin or integrity: ' + path)
        old_url,new_url=urlparse(old['resolved']),urlparse(new['resolved'])
        suffix='-'+old['version']+'.tgz'
        if not old_url.path.endswith(suffix) or new_url.path!=old_url.path[:-len(suffix)]+'-'+new['version']+'.tgz':
            raise ValueError('Dependency tarball identity changed: '+path)
        updates.append({'package': path, 'from': old['version'], 'to': new['version']})
    return updates


def npm(arguments: list[str], directory: Path) -> str:
    return subprocess.check_output(['npm', *arguments], cwd=directory, text=True,
                                   timeout=120, stderr=subprocess.PIPE)


def prepare(root: Path = ROOT, write: bool = False) -> list[dict]:
    original_manifest = (root/'package.json').read_bytes()
    original_lock = (root/'package-lock.json').read_bytes()
    manifest, before = json.loads(original_manifest), json.loads(original_lock)
    with tempfile.TemporaryDirectory(prefix='aus-patch-candidate-') as directory:
        candidate = Path(directory)
        shutil.copyfile(root/'package.json', candidate/'package.json')
        shutil.copyfile(root/'package-lock.json', candidate/'package-lock.json')
        selected = copy.deepcopy(manifest)
        changed = False
        for group in ('dependencies', 'devDependencies'):
            for name in manifest.get(group, {}):
                if not NAME.fullmatch(name):
                    raise ValueError('Unexpected package name')
                current = before['packages']['node_modules/'+name]['version']
                stable(current)
                available = json.loads(npm(['view', name+'@~'+current, 'version', '--json'], candidate))
                versions = available if isinstance(available, list) else [available]
                target = max((v for v in versions if VERSION.fullmatch(str(v))), key=stable, default=current)
                selected[group][name] = target
                changed = changed or target != current
        if not changed:
            return []
        (candidate/'package.json').write_text(json.dumps(selected, indent=2)+'\n')
        npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], candidate)
        after = json.loads((candidate/'package-lock.json').read_text())
        # The original approved version ranges remain authoritative. Exact versions
        # above constrain this candidate calculation only, never the real manifest.
        after['packages'][''] = before['packages']['']
        updates = validate_candidate(before, after)
        if write and updates:
            if (root/'package.json').read_bytes() != original_manifest or (root/'package-lock.json').read_bytes() != original_lock:
                raise ValueError('Dependency files changed during candidate generation')
            (root/'package-lock.json').write_text(json.dumps(after, indent=2)+'\n')
        return updates


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Write only the validated lockfile candidate')
    args = parser.parse_args()
    changes = prepare(write=args.write)
    print(json.dumps({'written': bool(args.write and changes), 'updates': changes}, indent=2))
