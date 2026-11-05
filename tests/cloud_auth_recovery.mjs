import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeAuthCallback, recoveryRedirect, passwordProblem, passwordUpdateError } from '../src/auth-recovery.mjs';

const now = 1800000000000;
const fragment = 'type=recovery&access_token=synthetic-token&refresh_token=synthetic-refresh&token_type=bearer&expires_in=3600';
const read = href => { let clean; return { data: consumeAuthCallback(href, value => { clean = value; }, now), get clean() { return clean; } }; };
test('valid recovery keeps only bounded short-lived bearer in memory and removes URL credentials', () => {
  const result = read('https://drgerami-md.ir/aus/?tab=login#' + fragment);
  assert.deepEqual(result.data, { kind: 'recovery', accessToken: 'synthetic-token', expiresAt: now + 3600000 });
  assert.equal(result.clean, '/aus/?tab=login');
  assert.equal(JSON.stringify(result.data).includes('synthetic-refresh'), false);
});
test('invalid, expired, wrong-type and ambiguous links cannot become recovery credentials', () => {
  for (const hash of [fragment + '&type=recovery', fragment.replace('expires_in=3600', 'expires_in=0'), fragment + '&expires_at=1', fragment.replace('token_type=bearer', 'token_type=other'), fragment.replace('type=recovery', 'type=invite'), 'error=access_denied&error_description=do-not-echo']) {
    const result = read('https://drgerami-md.ir/aus/#' + hash);
    assert.deepEqual(result.data, { kind: 'invalid' }); assert.equal(result.clean, '/aus/');
  }
});
test('query credentials are scrubbed and rejected even without a callback fragment', () => {
  for (const key of ['access_token', 'refresh_token', 'token_hash', 'code']) {
    const result = read('https://drgerami-md.ir/aus/?tab=login&' + key + '=secret');
    assert.deepEqual(result.data, { kind: 'invalid' }); assert.equal(result.clean, '/aus/?tab=login');
  }
});
test('non-auth anchors are preserved; signup confirmation never bootstraps a workspace', () => {
  const ordinary = read('https://drgerami-md.ir/aus/#opportunities');
  assert.deepEqual(ordinary.data, { kind: 'none' }); assert.equal(ordinary.clean, undefined);
  assert.deepEqual(read('https://drgerami-md.ir/aus/#' + fragment.replace('type=recovery', 'type=signup')).data, { kind: 'confirmation' });
});
test('redirect respects the app mount and never reflects callback secrets or a next URL', () => {
  assert.equal(recoveryRedirect('https://drgerami-md.ir/aus/?next=https://evil.invalid#secret'), 'https://drgerami-md.ir/aus/');
  assert.equal(recoveryRedirect('https://drgerami-md.ir/aus'), 'https://drgerami-md.ir/aus/');
  assert.equal(recoveryRedirect('https://immi-arash-amir.dr-gerami-md.workers.dev/?tab=login'), 'https://immi-arash-amir.dr-gerami-md.workers.dev/');
});
test('password validation and provider failures provide safe useful feedback', () => {
  assert.match(passwordProblem('short', 'short'), /۱۲/);
  assert.match(passwordProblem('long-enough-secret', 'different-secret'), /یکسان/);
  assert.equal(passwordProblem('long-enough-secret', 'long-enough-secret'), '');
  assert.match(passwordProblem('x'.repeat(129), 'x'.repeat(129)), /۱۲۸/);
  assert.match(passwordUpdateError(401, 'bad_jwt'), /اعتبار/);
  assert.match(passwordUpdateError(422, 'same_password'), /قبلی/);
  assert.match(passwordUpdateError(422, 'weak_password'), /قوی/);
  assert.match(passwordUpdateError(429, 'over_request_rate_limit'), /دقیقه/);
});
