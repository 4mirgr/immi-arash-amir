#!/usr/bin/env python3
"""Verify/decrypt a backup; extraction requires --apply and a NEW local directory."""
from __future__ import annotations

import argparse
import os
from pathlib import Path, PurePosixPath

try:
    from .backup_private import BackupError, MAX_BACKUP_BYTES, SCOPES, decrypt_exports, read_password, safe_name
except ImportError:
    from backup_private import BackupError, MAX_BACKUP_BYTES, SCOPES, decrypt_exports, read_password, safe_name


def restore_exports(files: dict[str, bytes], destination: Path) -> None:
    """Extract already-validated bytes to a fresh local folder; never touches a DB."""
    destination = Path(destination)
    if "://" in str(destination) or str(destination).startswith("//"):
        raise BackupError("Restore destination must be a local filesystem directory")
    if destination.exists() or destination.is_symlink():
        raise BackupError("Refusing to restore over an existing destination")
    if not destination.parent.is_dir():
        raise BackupError("Restore parent directory must already exist")
    for name in files:
        safe_name(name)
    for name in files:
        if any(parent.as_posix() in files for parent in PurePosixPath(name).parents if parent.as_posix() != "."):
            raise BackupError("Conflicting export file and directory paths")
    # All contents are verified before any directory or file is created.
    destination.mkdir(mode=0o700)
    for name, raw in sorted(files.items()):
        path = destination.joinpath(*name.split("/"))
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(path, flags, 0o600), "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--scope", required=True, choices=sorted(SCOPES))
    parser.add_argument("--password-fd", type=int)
    parser.add_argument("--apply", action="store_true", help="Extract JSON exports locally; never imports production databases")
    parser.add_argument("--target", type=Path, help="New local directory for explicit extraction")
    args = parser.parse_args()
    try:
        if args.apply and args.target is None:
            raise BackupError("--apply requires --target pointing to a new local directory")
        if args.backup.is_symlink() or not args.backup.is_file() or args.backup.stat().st_size > MAX_BACKUP_BYTES:
            raise BackupError("Backup must be a bounded regular local file")
        archive, files = decrypt_exports(args.backup.read_bytes(), read_password(args.password_fd), args.scope)
        if args.apply:
            restore_exports(files, args.target)
    except (BackupError, OSError) as exc:
        parser.exit(1, "Restore failed: " + (str(exc) if isinstance(exc, BackupError) else "local file operation failed") + "\n")
    if args.apply:
        print(f"Restored {len(files)} JSON exports locally (scope {archive['scope']}); no database import performed.")
    else:
        print(f"Verified {len(files)} JSON exports (scope {archive['scope']}); dry run: no files written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
