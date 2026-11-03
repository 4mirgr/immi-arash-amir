import io
import json
import sqlite3
import unittest
import zipfile
import xml.etree.ElementTree as ET
from server import cv


class CvTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        for profile in ('arash', 'amir'):
            self.db.execute('INSERT INTO profiles VALUES (?,?)', (profile, json.dumps({
                'cvText': 'Synthetic <doctor> & researcher\nزبان فارسی',
                'cvSource': 'synthetic.docx', 'verification': 'user_supplied_unverified'})))
        self.db.commit()
        cv.init_schema(self.db)

    def tearDown(self):
        self.db.close()

    def test_snapshot_is_immutable_and_versions_increase(self):
        first = cv.create_version(self.db, 'arash', {'name': 'Initial'})
        source = {'cvText': 'Updated synthetic CV'}
        self.db.execute('UPDATE profiles SET data=? WHERE id=?', (json.dumps(source), 'arash'))
        self.db.commit()
        second = cv.create_version(self.db, 'arash', {'name': 'Updated'})
        self.assertEqual((first['version'], second['version']), (1, 2))
        old = cv.export_version(self.db, 'arash', first['id'], 'txt')[0].decode()
        self.assertIn('Synthetic <doctor>', old)
        self.assertNotIn('Updated', old)
        self.assertEqual(first['verification'], 'user_supplied_unverified')
        self.assertEqual(cv.list_versions(self.db, 'arash')[0]['id'], second['id'])

    def test_owner_isolation_and_default(self):
        arash = cv.create_version(self.db, 'arash', {'name': 'Arash'})
        amir = cv.create_version(self.db, 'amir', {'name': 'Amir'})
        cv.set_default(self.db, 'arash', arash['id'])
        self.assertTrue(cv.list_versions(self.db, 'arash')[0]['isDefault'])
        self.assertFalse(cv.list_versions(self.db, 'amir')[0]['isDefault'])
        for action in (lambda: cv.set_default(self.db, 'amir', arash['id']),
                       lambda: cv.export_version(self.db, 'amir', arash['id'], 'txt')):
            with self.assertRaisesRegex(ValueError, 'not found'):
                action()
        self.assertEqual(cv.list_versions(self.db, 'amir')[0]['id'], amir['id'])

    def test_docx_contains_escaped_source_only(self):
        saved = cv.create_version(self.db, 'arash', {'name': '../../ unsafe filename'})
        content, mime, filename = cv.export_version(self.db, 'arash', saved['id'], 'docx')
        self.assertEqual(filename, 'cv-arash-v1.docx')
        self.assertIn('wordprocessingml', mime)
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            self.assertEqual(set(archive.namelist()), {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'})
            for path in archive.namelist():
                ET.fromstring(archive.read(path))
            root = ET.fromstring(archive.read('word/document.xml'))
            text = ''.join(root.itertext())
            self.assertIn('Synthetic <doctor> & researcher', text)
            self.assertIn('زبان فارسی', text)

    def test_reject_invalid_profile_empty_source_and_injected_content(self):
        for profile, payload in [('unknown', {'name': 'CV'}), ('arash', {'name': ''}),
                                 ('arash', {'name': 'x', 'cvText': 'Invented award'}),
                                 ('arash', {'name': 'x\nheader'}),
                                 ('arash', {'name': 'x', 'expectedSourceHash': 'stale'})]:
            with self.assertRaises(ValueError):
                cv.create_version(self.db, profile, payload)
        self.db.execute('UPDATE profiles SET data=? WHERE id=?', ('{}', 'amir'))
        self.db.commit()
        with self.assertRaisesRegex(ValueError, 'Import or complete'):
            cv.create_version(self.db, 'amir', {'name': 'Empty'})
        self.assertEqual(cv.list_versions(self.db, 'arash'), [])

    def test_only_supported_exports(self):
        saved = cv.create_version(self.db, 'arash', {'name': 'CV'})
        with self.assertRaisesRegex(ValueError, 'Supported export'):
            cv.export_version(self.db, 'arash', saved['id'], 'pdf')


if __name__ == '__main__':
    unittest.main()
