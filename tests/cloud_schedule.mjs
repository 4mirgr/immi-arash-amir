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
