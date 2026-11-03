import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.backup_private import (
    BackupError, MAX_FILE_BYTES, build_archive, collect_exports, decrypt_exports,
    encrypt_exports, safe_name, validate_archive, write_backup,
)
from scripts.restore_private import restore_exports

HAS_CRYPTO = importlib.util.find_spec('cryptography') is not None
PASSWORD = 'synthetic long passphrase for tests'


class ArchiveValidationTests(unittest.TestCase):
    def test_manifest_validates_hashes_scope_and_structure_before_extraction(self):
        files = {'profile.json': b'{"synthetic":true}', 'mail/messages.json': b'[]'}
        archive = build_archive(files, 'amir')
        self.assertEqual(validate_archive(archive, 'amir'), files)
        with self.assertRaises(BackupError):
            validate_archive(archive, 'arash')
        archive['manifest'][0]['sha256'] = '0' * 64
        with self.assertRaises(BackupError):
            validate_archive(archive, 'amir')

    def test_traversal_absolute_windows_duplicate_and_non_json_files_are_rejected(self):
        for name in ('../secret.json', '/secret.json', 'x/../../secret.json', 'C:/secret.json', 'x\\secret.json', 'x//secret.json', './secret.json', 'secrets.txt', 'CON.json', 'folder./profile.json'):
            with self.subTest(name=name), self.assertRaises(BackupError):
                safe_name(name)
        archive = build_archive({'profile.json': b'{}'}, 'amir')
        archive['manifest'].append(dict(archive['manifest'][0]))
        with self.assertRaises(BackupError):
            validate_archive(archive, 'amir')

    def test_explicit_json_input_does_not_follow_symlinks_or_accept_other_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'exports'
            source.mkdir()
            (source / 'profile.json').write_text('{"synthetic":true}')
            self.assertEqual(list(collect_exports(source)), ['profile.json'])
            (source / 'link.json').symlink_to(root / 'outside.json')
            with self.assertRaises(BackupError):
                collect_exports(source)
            (source / 'link.json').unlink()
            (source / 'raw.pdf').write_bytes(b'synthetic')
            with self.assertRaises(BackupError):
                collect_exports(source)

    def test_local_restore_refuses_existing_targets_and_creates_private_regular_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'restore'
            files = {'profile.json': b'{"synthetic":true}', 'mail/messages.json': b'[]'}
            restore_exports(files, target)
            self.assertEqual((target / 'mail/messages.json').read_bytes(), b'[]')
            if sys.platform != 'win32':
                self.assertEqual((target.stat().st_mode & 0o777), 0o700)
                self.assertEqual(((target / 'profile.json').stat().st_mode & 0o777), 0o600)
            with self.assertRaises(BackupError):
                restore_exports({'profile.json': b'[]'}, target)
            self.assertEqual((target / 'profile.json').read_bytes(), files['profile.json'])

    def test_conflicting_file_directory_paths_fail_before_creating_destination(self):
        archive = build_archive({'a.json': b'{}', 'a.json/b.json': b'[]'}, 'amir')
        with self.assertRaises(BackupError):
            validate_archive(archive, 'amir')
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'restored'
            with self.assertRaises(BackupError):
                restore_exports({'a.json': b'{}', 'a.json/b.json': b'[]'}, target)
            self.assertFalse(target.exists())

    def test_backup_write_never_overwrites_existing_data(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'backup.imbackup'
            write_backup(output, b'synthetic ciphertext')
            with self.assertRaises(BackupError):
                write_backup(output, b'replacement')
            self.assertEqual(output.read_bytes(), b'synthetic ciphertext')


@unittest.skipUnless(HAS_CRYPTO, 'Optional encrypted backup dependency cryptography==50.0.0 is not installed')
class EncryptedBackupTests(unittest.TestCase):
    def test_randomized_authenticated_roundtrip_preserves_json_and_unicode(self):
        files = {'profile.json': json.dumps({'synthetic': 'دادهٔ آزمایشی'}).encode()}
        first = encrypt_exports(files, PASSWORD, 'amir')
        second = encrypt_exports(files, PASSWORD, 'amir')
        self.assertNotEqual(first, second)
        self.assertNotIn(b'profile.json', first)
        self.assertNotIn(b'synthetic', first)
        archive, actual = decrypt_exports(first, PASSWORD, 'amir')
        self.assertEqual(actual, files)
        self.assertEqual(archive['formatVersion'], 1)

    def test_wrong_password_tamper_or_owner_scope_fails_without_restoring(self):
        blob = encrypt_exports({'profile.json': b'{"synthetic":true}'}, PASSWORD, 'amir')
        tampered = blob[:-1] + bytes([blob[-1] ^ 1])
        for value, password, scope in ((blob, 'incorrect password', 'amir'), (tampered, PASSWORD, 'amir'), (blob, PASSWORD, 'arash')):
            with self.subTest(scope=scope), self.assertRaises(BackupError):
                decrypt_exports(value, password, scope)

    def test_cli_default_is_dry_run_then_explicit_local_apply_and_no_password_in_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'exports'
            source.mkdir()
            (source / 'profile.json').write_text('{"synthetic":true}')
            output = root / 'backup.imbackup'
            target = root / 'restored'
            project = Path(__file__).resolve().parents[1]
            password_input = PASSWORD + '\n'
            command = [sys.executable, str(project / 'scripts/backup_private.py'), str(source), str(output), '--scope', 'amir', '--password-fd', '0']
            result = subprocess.run(command, input=password_input, capture_output=True, text=True, check=True)
            self.assertNotIn(PASSWORD, result.stdout + result.stderr)
            restore = [sys.executable, str(project / 'scripts/restore_private.py'), str(output), '--scope', 'amir', '--password-fd', '0', '--target', str(target)]
            result = subprocess.run(restore, input=password_input, capture_output=True, text=True, check=True)
            self.assertIn('dry run: no files written', result.stdout)
            self.assertFalse(target.exists())
            subprocess.run(restore + ['--apply'], input=password_input, capture_output=True, text=True, check=True)
            self.assertEqual((target / 'profile.json').read_text(), '{"synthetic":true}')
