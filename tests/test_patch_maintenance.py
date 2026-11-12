import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('patches', Path(__file__).resolve().parents[1]/'scripts/update_patch_dependencies.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(version='1.2.3'):
    return {'name':'synthetic','version':'0.1.0','requires':True,'lockfileVersion':3,'packages':{'':{'name':'synthetic','dependencies':{'example':'^1.2.0'}},'node_modules/example':{'version':version,'resolved':'https://registry.npmjs.org/example/-/example-'+version+'.tgz','integrity':'sha512-YWJj'}}}


class MaintenanceTests(unittest.TestCase):
    def test_stable_patch_with_integrity_is_permitted(self):
        self.assertEqual(module.validate_candidate(fixture(), fixture('1.2.4')), [{'package':'node_modules/example','from':'1.2.3','to':'1.2.4'}])

    def test_minor_major_downgrade_prerelease_and_metadata_only_changes_are_rejected(self):
        for version in ['1.3.0','2.0.0','1.2.2','1.2.4-beta.1','1.2.3']:
            after=fixture(version)
            if version=='1.2.3': after['packages']['node_modules/example']['hasInstallScript']=True
            with self.subTest(version=version), self.assertRaises(ValueError):module.validate_candidate(fixture(),after)

    def test_added_removed_root_manifest_and_lock_format_changes_are_rejected(self):
        cases=[]
        a=fixture('1.2.4');a['packages']['node_modules/new']={};cases.append(a)
        a=fixture('1.2.4');del a['packages']['node_modules/example'];cases.append(a)
        a=fixture('1.2.4');a['packages']['']['dependencies']['example']='^2';cases.append(a)
        a=fixture('1.2.4');a['lockfileVersion']=2;cases.append(a)
        for after in cases:
            with self.assertRaises(ValueError):module.validate_candidate(fixture(),after)

    def test_registry_identity_and_integrity_changes_are_rejected(self):
        for url in ['http://registry.npmjs.org/example.tgz','https://evil.example/example.tgz','https://registry.npmjs.org@evil.example/x','https://registry.npmjs.org/x?token=foo','https://registry.npmjs.org/other/-/other-1.2.4.tgz']:
            after=fixture('1.2.4');after['packages']['node_modules/example']['resolved']=url
            with self.assertRaises(ValueError):module.validate_candidate(fixture(),after)
        after=fixture('1.2.4');after['packages']['node_modules/example']['integrity']=''
        with self.assertRaises(ValueError):module.validate_candidate(fixture(),after)

    def test_transitive_minor_update_rejects_entire_candidate(self):
        before=fixture();before['packages']['node_modules/nested']=copy.deepcopy(before['packages']['node_modules/example'])
        after=copy.deepcopy(before);after['packages']['node_modules/example']=fixture('1.2.4')['packages']['node_modules/example'];after['packages']['node_modules/nested']['version']='1.3.0'
        with self.assertRaises(ValueError):module.validate_candidate(before,after)
