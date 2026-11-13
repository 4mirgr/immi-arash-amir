"""Deploy only the reviewed existing AUS Worker, preserving its bindings and schedules.

This script never creates tokens/resources, runs migrations, changes cron or logs
request bodies. A failed/ambiguous upload is not retried automatically.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = 'c570d16fc41cf9f0fa9be67c4bcceafd'
WORKER = 'immi-arash-amir'
REPOSITORY = '4mirgr/immi-arash-amir'
SCHEMA_BASELINE = 'd4045d66ae795b80c2a3c51e479783961c4e42d5'
BASE = '/accounts/' + ACCOUNT + '/workers/scripts/' + WORKER
SECRET_NAMES = frozenset(['AUTOMATION_MEMBERSHIP_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
    'GOOGLE_TOKEN_KEY','LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET','TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET'])
DATABASES = {'GOOGLE_DB':'faf37526-9c8c-4a86-9f91-3ab41ee8ddff',
             'OPPORTUNITY_DB':'a9605bec-79b7-430d-8d15-cfacb4cb1a58'}
CRONS = frozenset(['0 * * * *','*/15 * * * *','15 */6 * * *','2-57/5 * * * *','*/5 * * * *'])
SHA = re.compile(r'^[0-9a-f]{40}$')


class DeploymentError(Exception):
    """Safe, fixed diagnostic codes only; never include API bodies or credentials."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DeploymentError('cloudflare_redirect_rejected')


class Cloudflare:
    def __init__(self, token: str, opener=None):
        if not token or token.strip() != token or any(c.isspace() for c in token):
            raise DeploymentError('cloudflare_token_not_configured')
        self._token = token
        self._opener = opener or build_opener(NoRedirect())

    def request(self, method: str, path: str, data: bytes | None = None,
                content_type: str = 'application/json') -> dict:
        if (method,path) not in {('GET',BASE+'/settings'),('GET',BASE+'/schedules'),('PUT',BASE)}:
            raise DeploymentError('cloudflare_scope_rejected')
        request = Request('https://api.cloudflare.com/client/v4' + path, data=data,
            method=method, headers={'Authorization':'Bearer ' + self._token,
                'User-Agent':'AUS-Worker-CI/1.0','Content-Type':content_type})
        try:
            with self._opener.open(request, timeout=45) as response:
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise DeploymentError('cloudflare_response_too_large')
                result = json.loads(raw)
        except DeploymentError:
            raise
        except HTTPError as error:
            status = error.code
            error.close()
            raise DeploymentError('cloudflare_http_' + str(status)) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise DeploymentError('upload_outcome_unknown_verify_before_retry' if method == 'PUT'
                                  else 'cloudflare_read_failed') from None
        if not isinstance(result, dict) or result.get('success') is not True or not isinstance(result.get('result'),dict):
            raise DeploymentError('upload_rejected_verify_before_retry' if method == 'PUT'
                                  else 'cloudflare_read_rejected')
        return result


def git(root: Path, *arguments: str) -> str:
    try:
        return subprocess.check_output(['git', *arguments], cwd=root, text=True,
            timeout=30, stderr=subprocess.DEVNULL).strip()
    except (subprocess.SubprocessError, OSError):
        raise DeploymentError('git_verification_failed') from None


def verify_checkout(root: Path, expected_sha: str, baseline: str = SCHEMA_BASELINE) -> None:
    if not SHA.fullmatch(expected_sha) or not SHA.fullmatch(baseline):
        raise DeploymentError('invalid_release_commit')
    if git(root, 'rev-parse', 'HEAD') != expected_sha:
        raise DeploymentError('checkout_commit_mismatch')
    if git(root, 'status', '--porcelain', '--untracked-files=no'):
        raise DeploymentError('tracked_files_changed_after_verification')
    remote = git(root, 'ls-remote', 'origin', 'refs/heads/main').split()
    if len(remote) != 2 or remote[0] != expected_sha:
        raise DeploymentError('main_moved_regenerate_and_reverify')
    if git(root, 'merge-base', baseline, expected_sha) != baseline:
        raise DeploymentError('schema_baseline_not_ancestor')
    # Every SQL change needs a deliberate operator migration confirmation. The
    # workflow never applies SQL or guesses that a migration has already run.
    changed = git(root, 'diff', '--name-only', baseline, expected_sha, '--', '*.sql')
    if changed:
        raise DeploymentError('sql_changes_require_operator_confirmation')


def canonical_schedules(value: dict) -> list[str]:
    schedules = value.get('schedules')
    if not isinstance(schedules, list) or len(schedules) != 5:
        raise DeploymentError('unexpected_cron_configuration')
    crons = [entry.get('cron') for entry in schedules if isinstance(entry, dict)]
    if len(crons) != 5 or frozenset(crons) != CRONS:
        raise DeploymentError('unexpected_cron_configuration')
    return sorted(crons)


def metadata(settings: dict) -> dict:
    if not isinstance(settings, dict) or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', settings.get('compatibility_date','')):
        raise DeploymentError('worker_settings_invalid')
    bindings = settings.get('bindings')
    if not isinstance(bindings, list):
        raise DeploymentError('worker_bindings_missing')
    names = [item.get('name') for item in bindings if isinstance(item, dict)]
    secrets = {item['name'] for item in bindings if isinstance(item, dict) and item.get('type') == 'secret_text'}
    if len(names) != len(bindings) or not all(isinstance(name,str) and re.fullmatch(r'[A-Z][A-Z0-9_]*',name) for name in names) or len(set(names)) != len(names) or secrets != SECRET_NAMES:
        raise DeploymentError('unexpected_secret_or_binding_configuration')
    preserved = []
    databases = {}
    for item in bindings:
        kind = item.get('type')
        if kind == 'secret_text':
            continue
        if kind == 'plain_text' and isinstance(item.get('text'), str):
            preserved.append({'name':item['name'],'type':kind,'text':item['text']})
        elif kind == 'd1':
            identity = item.get('id') or item.get('database_id')
            databases[item['name']] = identity
            preserved.append({'name':item['name'],'type':kind,'id':identity})
        elif kind == 'ai' and item['name'] == 'AI':
            preserved.append({'name':'AI','type':'ai'})
        else:
            raise DeploymentError('unreviewed_binding_type')
    if databases != DATABASES:
        raise DeploymentError('database_binding_mismatch')
    flags = settings.get('compatibility_flags') or []
    if not isinstance(flags, list) or not all(isinstance(flag, str) for flag in flags):
        raise DeploymentError('worker_settings_invalid')
    result = {'main_module':'worker.mjs','compatibility_date':settings['compatibility_date'],
              'compatibility_flags':flags,'keep_bindings':['secret_text'],'bindings':preserved,
              'observability':settings.get('observability') or {'enabled':False}}
    # Retain existing optional runtime limits/placement/logging when present;
    # no limit is raised and no paid resource is introduced here.
    for key in ('limits','placement','logpush','tail_consumers'):
        if key in settings and settings[key] is not None:
            result[key] = settings[key]
    return result


def multipart(bundle: bytes, settings: dict) -> tuple[bytes, str]:
    if not bundle or len(bundle) > 25_000_000 or len(gzip.compress(bundle)) > 3_000_000:
        raise DeploymentError('bundle_exceeds_reviewed_free_plan_budget')
    boundary = '----aus-ci-' + uuid.uuid4().hex
    body = (b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="metadata"\r\n'
            b'Content-Type: application/json\r\n\r\n' + json.dumps(settings).encode() +
            b'\r\n--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="worker.mjs"; '
            b'filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n' + bundle +
            b'\r\n--' + boundary.encode() + b'--\r\n')
    return body, 'multipart/form-data; boundary=' + boundary


def deploy(api, bundle: bytes, expected_sha: str, before_upload) -> dict:
    before = api.request('GET', BASE + '/settings')['result']
    crons = canonical_schedules(api.request('GET', BASE + '/schedules')['result'])
    configuration = metadata(before)
    body, content_type = multipart(bundle, configuration)
    # Recheck main after building and reading configuration, immediately before
    # the one upload attempt. A new main commit blocks this older candidate.
    before_upload()
    uploaded = api.request('PUT', BASE, body, content_type)
    after = api.request('GET', BASE + '/settings')['result']
    after_crons = canonical_schedules(api.request('GET', BASE + '/schedules')['result'])
    if metadata(after) != configuration or after_crons != crons:
        raise DeploymentError('post_upload_configuration_changed_manual_review_required')
    receipt = uploaded.get('result', {}).get('deployment_id')
    if not isinstance(receipt, str) or not re.fullmatch(r'[A-Za-z0-9-]{16,64}', receipt):
        raise DeploymentError('upload_receipt_missing_manual_verification_required')
    return {'status':'deployed','worker':WORKER,'commit':expected_sha,'deploymentId':receipt,
            'bundleSha256':hashlib.sha256(bundle).hexdigest(),'secretsPreserved':8,'cronsPreserved':5}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    args = parser.parse_args()
    try:
        if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
            raise DeploymentError('deployment_requires_expected_repository')
        baseline = os.environ.get('AUS_WORKER_SCHEMA_BASELINE') or SCHEMA_BASELINE
        verify_checkout(ROOT, args.expected_sha, baseline)
        api = Cloudflare(os.environ.get('AUS_CLOUDFLARE_API_TOKEN', ''))
        bundle = (ROOT/'worker-dist/bundle.mjs').read_bytes()
        result = deploy(api, bundle, args.expected_sha,
                        lambda:verify_checkout(ROOT, args.expected_sha, baseline))
        print(json.dumps(result, indent=2))
        return 0
    except DeploymentError as error:
        print('Worker deployment blocked: ' + str(error), file=sys.stderr)
        return 1
    except OSError:
        print('Worker deployment blocked: bundle_or_workspace_unavailable', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
