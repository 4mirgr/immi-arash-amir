import unittest,importlib.util,json,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('clinic_seed',Path(__file__).resolve().parents[1]/'scripts/prepare_clinic_bank.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
class ClinicBankSeedTests(unittest.TestCase):
 def test_url_candidates_exclude_auth_secrets_private_and_aggregator_sites(self):
  for value in ['https://127.0.0.1/','https://[::1]/','https://host.local/','https://127.0.0.1.nip.io/','https://facebook.com/clinic','https://www.linkedin.com/company/clinic','https://clinic.example/?token=private','https://clinic.example/%61uth','https://x:y@clinic.example/','https://clinic.example:444/','https://clinic.example/white space','https://clinic.example\\private']:
   self.assertIsNone(m.candidate_url(value),value)
  self.assertEqual(m.candidate_url('http://Clinic.example/contact'),'https://clinic.example/contact')
 def test_seed_never_promotes_raw_emails_or_geography_and_matches_server_id(self):
  row={'ownerProfile':'arash','name':'Synthetic clinic','websiteCandidates':['http://Clinic.example/','https://clinic.example/'],'emails':['private@sheet.example'],'address':'unverified raw address','state':'NSW','mmmVerified':False,'provenance':{'file':'synthetic.xlsx','sheet':'Sheet1','row':3}}
  output=m.prepare([json.dumps(row)],OWNER,'2026-11-11T00:00:00.000Z');self.assertEqual(output['summary']['candidateURLs'],1);self.assertEqual(output['summary']['duplicateURLs'],1)
  data=output['items'][0];self.assertEqual(data['id'],'bank_'+hashlib.sha256((OWNER+'\nhttps://clinic.example/').encode()).hexdigest()[:32]);self.assertEqual(data['owner_id'],OWNER);self.assertNotIn('private@sheet.example',json.dumps(output));self.assertNotIn('unverified raw address',json.dumps(output));self.assertNotIn('NSW',json.dumps(output));self.assertFalse(output['sendingApproved']);self.assertTrue(json.loads(data['provenance_json'])['httpsUpgradeCandidate'])
 def test_foreign_owner_rows_and_malformed_rows_are_not_merged(self):
  result=m.prepare(['not json',json.dumps({'ownerProfile':'amir','websiteCandidates':['https://other.example/']}),json.dumps({'ownerProfile':'arash','websiteCandidates':['https://own.example/'],'nameCandidates':['A','B']})],OWNER)
  self.assertEqual(result['summary']['invalidRows'],2);self.assertEqual(len(result['items']),1);self.assertEqual(result['items'][0]['name'],'')
if __name__=='__main__':unittest.main()
