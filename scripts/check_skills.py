"""Verify the selected, immutable local documentation without executing it."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]


def verify(root: Path = ROOT) -> int:
    lock = json.loads((root / '.agents/skills/sources.lock.json').read_text())
    catalog = root / 'CODEX-EXTENDED-LIBRARY.md'
    if hashlib.sha256(catalog.read_bytes()).hexdigest() != lock['catalogSha256']:
        raise ValueError('Library catalog differs from reviewed version')
    for item in lock['files']:
        path = root / item['path']
        if not path.resolve().is_relative_to(root.resolve() / '.agents/skills') or path.is_symlink():
            raise ValueError('Skill reference path rejected')
        if hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Skill reference differs from reviewed version: ' + item['path'])
    return len(lock['files'])


if __name__ == '__main__':
    print(f'PASS: {verify()} pinned reference documents and library catalog; no external code executed.')
