"""Synthetic Cloudflare and Git fixtures only: no real transport or credentials."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location('worker_deployment', Path(__file__).resolve().parents[1]/'scripts/deploy_worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

SHA = 'a'*40


def settings():
    return {'compatibility_date':'2026-11-04','compatibility_flags':[],
      'bindings':[{'name':name,'type':'secret_text'} for name in sorted(module.SECRET_NAMES)]+
                 [{'name':name,'type':'d1','database_id':identity} for name,identity in module.DATABASES.items()]+
                 [{'name':'AI','type':'ai'},{'name':'PUBLIC_DISCOVERY_AI_ENABLED','type':'plain_text','text':'true'}],
      'observability':{'enabled':False},'limits':{'cpu_ms':10}}


def schedules():
    return {'schedules':[{'cron':cron} for cron in sorted(module.CRONS)]}


class FakeAPI:
    def __init__(self, *, after=None, crons=None, upload_error=False):
        self.calls=[];self.after=after;self.crons=crons;self.upload_error=upload_error;self.uploaded=False

    def request(self, method, path, body=None, content_type=None):
        self.calls.append((method,path,body,content_type))
        if method=='PUT':
            if self.upload_error:raise module.DeploymentError('upload_outcome_unknown_verify_before_retry')
            self.uploaded=True
            return {'success':True,'result':{'deployment_id':'synthetic-deploy-1234567890'}}
        if path.endswith('/settings'):return {'success':True,'result':self.after if self.uploaded and self.after is not None else settings()}
        return {'success':True,'result':self.crons if self.uploaded and self.crons is not None else schedules()}


class DeploymentTests(unittest.TestCase):
    def test_existing_bindings_secrets_crons_and_date_are_preserved(self):
        api=FakeAPI();verified=[]
        result=module.deploy(api,b'export default {};',SHA,lambda:verified.append(True))
        self.assertEqual(verified,[True]);self.assertEqual(result['status'],'deployed')
        self.assertEqual(result['secretsPreserved'],8);self.assertEqual(result['cronsPreserved'],5)
        puts=[call for call in api.calls if call[0]=='PUT'];self.assertEqual(len(puts),1)
        body=puts[0][2].decode();self.assertIn('"keep_bindings": ["secret_text"]',body)
        self.assertNotIn('"type": "secret_text"',body)
        self.assertIn('"compatibility_date": "2026-11-04"',body)
        self.assertIn('"cpu_ms": 10',body)
        self.assertNotIn('token',json.dumps(result).lower())
        self.assertTrue(all(call[0]=='GET' or call[1]==module.BASE for call in api.calls))

    def test_changed_main_blocks_before_single_transport_attempt(self):
        api=FakeAPI()
        def moved():raise module.DeploymentError('main_moved_regenerate_and_reverify')
        with self.assertRaisesRegex(module.DeploymentError,'main_moved'):
            module.deploy(api,b'export default {};',SHA,moved)
        self.assertFalse(any(call[0]=='PUT' for call in api.calls))

    def test_ambiguous_upload_never_retries(self):
        api=FakeAPI(upload_error=True)
        with self.assertRaisesRegex(module.DeploymentError,'unknown_verify'):
            module.deploy(api,b'export default {};',SHA,lambda:None)
        self.assertEqual(sum(call[0]=='PUT' for call in api.calls),1)

    def test_post_upload_configuration_drift_is_not_reported_as_success(self):
        after=settings();after['bindings'][0]['name']='UNEXPECTED_SECRET'
        with self.assertRaises(module.DeploymentError):module.deploy(FakeAPI(after=after),b'export default {};',SHA,lambda:None)
        crons=schedules();crons['schedules'].pop()
        with self.assertRaises(module.DeploymentError):module.deploy(FakeAPI(crons=crons),b'export default {};',SHA,lambda:None)

    def test_missing_secret_wrong_database_or_unknown_binding_fail_closed(self):
        with self.assertRaisesRegex(module.DeploymentError,'not_configured'):module.Cloudflare('')
        for mutation in ('secret','database','binding'):
            value=settings()
            if mutation=='secret':value['bindings'].pop(0)
            elif mutation=='database':next(x for x in value['bindings'] if x['type']=='d1')['database_id']='wrong'
            else:value['bindings'].append({'name':'UNREVIEWED','type':'kv_namespace','namespace_id':'x'})
            with self.subTest(mutation=mutation),self.assertRaises(module.DeploymentError):module.metadata(value)

    def test_checkout_refuses_sql_drift_untrusted_baseline_and_dirty_state(self):
        responses={'rev-parse':SHA,'status':'','ls-remote':SHA+'\trefs/heads/main','merge-base':module.SCHEMA_BASELINE,'diff':''}
        with patch.object(module,'git',side_effect=lambda root,*args:responses[args[0]]):
            module.verify_checkout(Path('/synthetic'),SHA)
            for key,value in [('diff','cloud/new-migration.sql'),('status',' M package-lock.json'),('ls-remote','b'*40+'\trefs/heads/main'),('merge-base','c'*40)]:
                old=responses[key];responses[key]=value
                with self.subTest(key=key),self.assertRaises(module.DeploymentError):module.verify_checkout(Path('/synthetic'),SHA)
                responses[key]=old

    def test_http_errors_and_unknown_outcome_do_not_include_provider_text(self):
        class Opener:
            def open(self,*args,**kwargs):raise HTTPError('https://api.cloudflare.com',403,'secret-private-provider-text',{},None)
        with self.assertRaises(module.DeploymentError) as caught:module.Cloudflare('synthetic-secret',Opener()).request('GET',module.BASE+'/settings')
        self.assertEqual(str(caught.exception),'cloudflare_http_403');self.assertNotIn('secret',str(caught.exception))
        class Unknown:
            def open(self,*args,**kwargs):raise URLError('private-provider-text')
        with self.assertRaisesRegex(module.DeploymentError,'upload_outcome_unknown'):
            module.Cloudflare('synthetic-secret',Unknown()).request('PUT',module.BASE,b'synthetic')
        with self.assertRaisesRegex(module.DeploymentError,'scope_rejected'):
            module.Cloudflare('synthetic-secret',Unknown()).request('GET',module.BASE+'-other/settings')

    def test_empty_or_oversized_bundle_is_blocked(self):
        with self.assertRaises(module.DeploymentError):module.multipart(b'',module.metadata(settings()))
        with patch.object(module.gzip,'compress',return_value=b'x'*3_000_001):
            with self.assertRaises(module.DeploymentError):module.multipart(b'export default {};',module.metadata(settings()))

    def test_workflow_trust_boundary_and_missing_secret_are_explicit(self):
        workflow=(Path(__file__).resolve().parents[1]/'.github/workflows/deploy-worker.yml').read_text()
        for expected in ["github.event.workflow_run.event == 'push'","github.event.workflow_run.head_branch == 'main'",
                         'github.event.workflow_run.head_repository.full_name == github.repository',
                         "github.event.workflow_run.conclusion == 'success'",'configured=false',
                         "needs.configuration.outputs.configured == 'true'",'persist-credentials: false']:
            self.assertIn(expected,workflow)
        self.assertNotIn('pull_request_target',workflow)
        self.assertNotIn('continue-on-error',workflow)
        self.assertNotIn('contents: write',workflow)


if __name__=='__main__':unittest.main()
