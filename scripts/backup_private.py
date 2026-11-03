#!/usr/bin/env python3
"""Encrypt explicitly supplied JSON exports; no database or network access."""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import hmac
import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath

MAGIC = b"IMMI-PRIVATE-BACKUP-V1\n"
MAX_FILES = 128
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_BYTES = 24 * 1024 * 1024
MAX_BACKUP_BYTES = MAX_ARCHIVE_BYTES + len(MAGIC) + 44
SCOPES = {"amir", "arash", "all"}


class BackupError(ValueError):
    """Safe errors contain no export contents or credentials."""


def crypto_types():
    try:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    except ImportError as exc:
        raise BackupError("Install the optional cryptography==50.0.0 dependency first") from exc
    return AESGCM, Scrypt, InvalidTag


def strict_json(raw: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise BackupError("Duplicate JSON keys are not supported")
            result[key] = value
        return result

    def constant(_):
        raise BackupError("Non-finite JSON numbers are not supported")

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise BackupError("Invalid UTF-8 JSON export") from exc


def safe_name(name: str) -> str:
    if not isinstance(name, str) or not name:
        raise BackupError("Invalid export path")
    try:
        if len(name.encode("utf-8")) > 240:
            raise BackupError("Invalid export path")
    except UnicodeError:
        raise BackupError("Invalid export path") from None
    if "\\" in name or ":" in name or any(ord(c) < 32 for c in name):
        raise BackupError("Invalid export path")
    path = PurePosixPath(name)
    if path.is_absolute() or PureWindowsPath(name).drive or any(p in {"", ".", ".."} for p in name.split("/")):
        raise BackupError("Export path must stay inside its destination")
    reserved = {"CON", "PRN", "AUX", "NUL", *["COM" + str(n) for n in range(1, 10)], *["LPT" + str(n) for n in range(1, 10)]}
    if any(part.rstrip(". ") != part or part.split(".")[0].upper() in reserved for part in path.parts):
        raise BackupError("Export path is not portable across local filesystems")
    if path.suffix.lower() != ".json":
        raise BackupError("Only JSON export files are supported")
    return name


def collect_exports(source: Path) -> dict[str, bytes]:
    source = Path(source)
    if source.is_symlink() or not source.is_dir():
        raise BackupError("Source must be an explicit regular directory")
    files, total = {}, 0
    for folder, dirs, names in os.walk(source, followlinks=False):
        if any((Path(folder) / d).is_symlink() for d in dirs):
            raise BackupError("Symlinks are not allowed in exports")
        for name in sorted(names):
            path = Path(folder) / name
            if path.is_symlink() or not path.is_file():
                raise BackupError("Only regular export files are supported")
            relative = safe_name(path.relative_to(source).as_posix())
            if path.stat().st_size > MAX_FILE_BYTES:
                raise BackupError("An export exceeds the per-file size limit")
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise BackupError("Only regular export files are supported")
                raw = stream.read(MAX_FILE_BYTES + 1)
            if len(raw) > MAX_FILE_BYTES:
                raise BackupError("An export exceeds the per-file size limit")
            if not isinstance(strict_json(raw), (dict, list)):
                raise BackupError("Each JSON export must be an object or array")
            total += len(raw)
            if total > MAX_TOTAL_BYTES or len(files) >= MAX_FILES:
                raise BackupError("Export set exceeds the backup size or file limit")
            files[relative] = raw
    if not files:
        raise BackupError("No JSON exports found")
    return dict(sorted(files.items()))


def build_archive(files: dict[str, bytes], scope: str) -> dict:
    if scope not in SCOPES or not files or len(files) > MAX_FILES:
        raise BackupError("Explicit valid scope and bounded exports are required")
    manifest, encoded, total = [], {}, 0
    for name, raw in sorted(files.items()):
        safe_name(name)
        if not isinstance(raw, bytes) or len(raw) > MAX_FILE_BYTES:
            raise BackupError("Invalid or oversized export")
        if not isinstance(strict_json(raw), (dict, list)):
            raise BackupError("Each JSON export must be an object or array")
        total += len(raw)
        if total > MAX_TOTAL_BYTES:
            raise BackupError("Export set exceeds the total size limit")
        manifest.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        encoded[name] = base64.b64encode(raw).decode("ascii")
    return {"formatVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "scope": scope, "manifest": manifest, "files": encoded}


def validate_archive(archive: dict, expected_scope: str) -> dict[str, bytes]:
    if expected_scope not in SCOPES or not isinstance(archive, dict):
        raise BackupError("Explicit valid restore scope is required")
    if set(archive) != {"formatVersion", "createdAt", "scope", "manifest", "files"} or archive["formatVersion"] != 1:
        raise BackupError("Unsupported backup format")
    if archive["scope"] != expected_scope:
        raise BackupError("Backup scope does not match the requested restore scope")
    try:
        created = datetime.fromisoformat(archive["createdAt"])
        if created.tzinfo is None:
            raise ValueError
    except (TypeError, ValueError):
        raise BackupError("Invalid backup timestamp") from None
    manifest, encoded = archive["manifest"], archive["files"]
    if not isinstance(manifest, list) or not 1 <= len(manifest) <= MAX_FILES or not isinstance(encoded, dict) or len(encoded) != len(manifest):
        raise BackupError("Invalid backup manifest")
    restored, total = {}, 0
    for record in manifest:
        if not isinstance(record, dict) or set(record) != {"path", "bytes", "sha256"}:
            raise BackupError("Invalid manifest record")
        name = safe_name(record["path"])
        if name in restored or name not in encoded or not isinstance(encoded[name], str) or len(encoded[name]) > MAX_FILE_BYTES * 2:
            raise BackupError("Duplicate or missing export")
        if type(record["bytes"]) is not int or not 0 <= record["bytes"] <= MAX_FILE_BYTES:
            raise BackupError("Invalid export size")
        try:
            raw = base64.b64decode(encoded[name], validate=True)
        except (ValueError, UnicodeError):
            raise BackupError("Invalid export encoding") from None
        digest = record["sha256"]
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise BackupError("Invalid export digest")
        total += len(raw)
        if len(raw) != record["bytes"] or total > MAX_TOTAL_BYTES or not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), digest):
            raise BackupError("Export integrity check failed")
        if not isinstance(strict_json(raw), (dict, list)):
            raise BackupError("Invalid structured export")
        restored[name] = raw
    if set(restored) != set(encoded):
        raise BackupError("Unexpected export files")
    for name in restored:
        if any(parent.as_posix() in restored for parent in PurePosixPath(name).parents if parent.as_posix() != "."):
            raise BackupError("Conflicting export file and directory paths")
    return restored


def derive_key(password: str, salt: bytes) -> bytes:
    _, Scrypt, _ = crypto_types()
    if not isinstance(password, str) or not password or len(password.encode("utf-8")) > 4096:
        raise BackupError("A bounded non-empty password is required")
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(password.encode("utf-8"))


def encrypt_exports(files: dict[str, bytes], password: str, scope: str) -> bytes:
    if not isinstance(password, str) or len(password) < 12:
        raise BackupError("Use a unique backup passphrase of at least 12 characters")
    archive = build_archive(files, scope)
    raw = json.dumps(archive, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise BackupError("Encoded archive exceeds the size limit")
    AESGCM, _, _ = crypto_types()
    salt, nonce = os.urandom(16), os.urandom(12)
    return MAGIC + salt + nonce + AESGCM(derive_key(password, salt)).encrypt(nonce, raw, MAGIC)


def decrypt_exports(blob: bytes, password: str, expected_scope: str) -> tuple[dict, dict[str, bytes]]:
    if not isinstance(blob, bytes) or not len(MAGIC) + 44 < len(blob) <= MAX_BACKUP_BYTES or not blob.startswith(MAGIC):
        raise BackupError("Invalid, oversized or unsupported backup")
    AESGCM, _, InvalidTag = crypto_types()
    start = len(MAGIC)
    salt, nonce, ciphertext = blob[start:start+16], blob[start+16:start+28], blob[start+28:]
    try:
        raw = AESGCM(derive_key(password, salt)).decrypt(nonce, ciphertext, MAGIC)
    except InvalidTag:
        raise BackupError("Password or backup authentication is invalid") from None
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise BackupError("Decrypted archive exceeds the size limit")
    archive = strict_json(raw)
    return archive, validate_archive(archive, expected_scope)


def read_password(fd: int | None = None, confirm: bool = False) -> str:
    if fd is not None:
        if fd < 0:
            raise BackupError("Password file descriptor must be non-negative")
        with os.fdopen(os.dup(fd), "r", encoding="utf-8") as stream:
            value = stream.readline(4097)
        if len(value.encode("utf-8")) > 4096:
            raise BackupError("Password exceeds the size limit")
        return value.rstrip("\r\n")
    password = getpass.getpass("Backup passphrase: ")
    if confirm and not hmac.compare_digest(password.encode("utf-8"), getpass.getpass("Confirm passphrase: ").encode("utf-8")):
        raise BackupError("Passphrases do not match")
    return password


def write_backup(path: Path, blob: bytes) -> None:
    path = Path(path)
    if not path.parent.is_dir():
        raise BackupError("Backup destination parent directory must already exist")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise BackupError("Refusing to overwrite an existing backup") from None
    with os.fdopen(fd, "wb") as stream:
        stream.write(blob)
        stream.flush()
        os.fsync(stream.fileno())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Explicit directory containing JSON exports only")
    parser.add_argument("output", type=Path, help="New encrypted backup file; never overwritten")
    parser.add_argument("--scope", required=True, choices=sorted(SCOPES))
    parser.add_argument("--password-fd", type=int, help="Read passphrase from an already-open descriptor; never pass it as an argument")
    args = parser.parse_args()
    try:
        files = collect_exports(args.source)
        blob = encrypt_exports(files, read_password(args.password_fd, confirm=True), args.scope)
        write_backup(args.output, blob)
    except (BackupError, OSError) as exc:
        parser.exit(1, "Backup failed: " + (str(exc) if isinstance(exc, BackupError) else "local file operation failed") + "\n")
    print(f"Encrypted {len(files)} JSON exports (scope {args.scope}); source files were not modified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
