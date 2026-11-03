import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloud/worker.mjs';

test('scheduled public collection never accesses Google grants or sends mail', async () => {
  const queries = [];
  const env = {
    OPPORTUNITY_DB: {
      prepare(sql) {
        queries.push(sql);
        return {
          bind() {
            return {
              async run() { return { meta: { changes: 1 } }; },
              async first() {
                return sql.startsWith('UPDATE') ? null : {
                  lock_until: Date.now() + 60000,
                  next_check_at: Date.now() + 60000,
                };
              },
            };
          },
        };
      },
    },
  };
  Object.defineProperty(env, 'GOOGLE_DB', {
    get() { throw Error('Scheduled collector must not read private Google storage'); },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Busy collector must not fetch'); };
  try {
    await worker.scheduled({ cron: '0 */3 * * *' }, env);
    assert(queries.length > 0);
    assert(queries.every(sql => !sql.includes('google_')));
  } finally { globalThis.fetch = original; }
});

test('Telegram schedule is isolated from public crawling while secrets are absent',async()=>{let reads=0;const env={};Object.defineProperty(env,'GOOGLE_DB',{get(){reads++;throw Error('No configured bot must read private storage');}});Object.defineProperty(env,'OPPORTUNITY_DB',{get(){reads++;throw Error('Notification cron must not collect feeds');}});await worker.scheduled({cron:'*/15 * * * *'},env);assert.equal(reads,0);});

test('disabled approved-mail and LinkedIn schedules do not touch grants or transport',async()=>{for(const cron of ['*/5 * * * *','2-57/5 * * * *']){let reads=0;const env={};Object.defineProperty(env,'GOOGLE_DB',{get(){reads++;throw Error('Unconfigured schedule must not read grants');}});Object.defineProperty(env,'OPPORTUNITY_DB',{get(){reads++;throw Error('Private schedule must not run collectors');}});await worker.scheduled({cron},env);assert.equal(reads,0);}});
