import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  waitUntil,
  type RealmRequest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

function makeFileSystem() {
  return {
    'person.gts': `
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /></h1>
          </template>
        }
      }
    `,
  };
}

// The index swap writes `realm_type_generations` last, after it has already
// promoted `boxel_index`, advanced `realm_generations` and replaced
// `realm_meta`. A trigger that raises there is a real database failure at the
// latest point of the swap, so it separates a swap that is one transaction
// from one whose earlier statements have already committed.
const FAIL_FUNCTION = 'index_commit_atomicity_test_fail';
const FAIL_TRIGGER = 'index_commit_atomicity_test_fail_trigger';

async function installSwapFailure(dbAdapter: DBAdapter, realmURL: string) {
  // DDL takes no bound parameters, so the realm URL is inlined; it is a test
  // constant with no quote characters.
  await dbAdapter.execute(`
    CREATE OR REPLACE FUNCTION ${FAIL_FUNCTION}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected index swap failure';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await dbAdapter.execute(`
    CREATE TRIGGER ${FAIL_TRIGGER}
    BEFORE INSERT OR UPDATE ON realm_type_generations
    FOR EACH ROW WHEN (NEW.realm_url = '${realmURL}')
    EXECUTE FUNCTION ${FAIL_FUNCTION}();
  `);
}

async function removeSwapFailure(dbAdapter: DBAdapter) {
  await dbAdapter.execute(
    `DROP TRIGGER IF EXISTS ${FAIL_TRIGGER} ON realm_type_generations`,
  );
  await dbAdapter.execute(`DROP FUNCTION IF EXISTS ${FAIL_FUNCTION}()`);
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: DBAdapter;
  let request: RealmRequest;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    fileSystem: makeFileSystem(),
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      request = withRealmPath(args.request, testRealm);
    },
  });

  hooks.afterEach(async function () {
    await removeSwapFailure(dbAdapter);
  });

  async function currentGeneration(): Promise<number> {
    let [row] = (await dbAdapter.execute(
      `SELECT current_generation FROM realm_generations WHERE realm_url = $1`,
      { bind: [realm.url] },
    )) as { current_generation: number }[];
    return Number(row?.current_generation);
  }

  async function realmMetaRows(): Promise<unknown[]> {
    return await dbAdapter.execute(
      `SELECT generation, value FROM realm_meta WHERE realm_url = $1 ORDER BY generation`,
      { bind: [realm.url] },
    );
  }

  async function liveInstanceRows(url: string): Promise<number> {
    let [row] = (await dbAdapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index
         WHERE realm_url = $1 AND (url = $2 OR file_alias = $2)
           AND type = 'instance'
           AND is_deleted IS NOT TRUE`,
      { bind: [realm.url, url] },
    )) as { n: number }[];
    return row?.n ?? 0;
  }

  async function latestIndexJobId(): Promise<number> {
    let [row] = (await dbAdapter.execute(
      `SELECT coalesce(max(id), 0)::int AS id FROM jobs
         WHERE job_type = 'incremental-index' AND concurrency_group = $1`,
      { bind: [`indexing:${realm.url}`] },
    )) as { id: number }[];
    return row?.id ?? 0;
  }

  async function settledIndexJobAfter(
    afterJobId: number,
  ): Promise<{ id: number; status: string; result: any }> {
    return await waitUntil(
      async () => {
        let [job] = (await dbAdapter.execute(
          `SELECT id, status, result FROM jobs
             WHERE job_type = 'incremental-index' AND concurrency_group = $1
               AND id > $2 AND status <> 'unfulfilled'
             ORDER BY id LIMIT 1`,
          { bind: [`indexing:${realm.url}`, afterJobId] },
        )) as { id: number; status: string; result: any }[];
        return job;
      },
      {
        timeout: 60_000,
        timeoutMessage: 'the incremental index job never finished',
      },
    );
  }

  async function writePerson(
    op: 'add' | 'update',
    href: string,
    firstName: string,
  ) {
    let response = await request
      .post('/_atomic')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
      )
      .send(
        JSON.stringify({
          'atomic:operations': [
            {
              op,
              href,
              data: {
                type: 'card',
                attributes: { firstName },
                meta: {
                  adoptsFrom: { module: rri('./person'), name: 'Person' },
                },
              },
            },
          ],
        }),
      );
    if (response.status !== 201) {
      throw new Error(
        `/_atomic ${op} of ${href} failed with ${response.status}: ${response.text}`,
      );
    }
  }

  test('a failure late in the index swap leaves the realm exactly as the previous pass published it', async function (assert) {
    let cardURL = `${realm.url}person-1.json`;
    let generationBefore = await currentGeneration();
    let realmMetaBefore = await realmMetaRows();
    let jobBaseline = await latestIndexJobId();
    assert.strictEqual(
      await liveInstanceRows(cardURL),
      0,
      'precondition: the card is not indexed yet',
    );

    await installSwapFailure(dbAdapter, realm.url);
    await writePerson('add', 'person-1.json', 'Mango');
    let failedJob = await settledIndexJobAfter(jobBaseline);
    assert.strictEqual(
      failedJob.status,
      'rejected',
      'the pass whose swap failed is rejected',
    );

    assert.strictEqual(
      await currentGeneration(),
      generationBefore,
      'the realm generation did not advance',
    );
    assert.strictEqual(
      await liveInstanceRows(cardURL),
      0,
      'the failed pass promoted no rows into boxel_index',
    );
    assert.deepEqual(
      await realmMetaRows(),
      realmMetaBefore,
      'realm_meta still holds the previous pass’s summary',
    );

    // The failed swap's connection went back to the pool with its transaction
    // rolled back, not left open. A backend that has sat idle inside a
    // transaction since before the failure is one the swap abandoned; a
    // transaction some other caller opened since then can be mid-flight.
    let [{ at: failureObservedAt }] = (await dbAdapter.execute(
      `SELECT now()::text AS at`,
    )) as { at: string }[];
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let [abandoned] = (await dbAdapter.execute(
      `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database()
           AND state = 'idle in transaction'
           AND state_change < $1::timestamptz`,
      { bind: [failureObservedAt] },
    )) as { n: number }[];
    assert.strictEqual(
      abandoned.n,
      0,
      'no pooled connection was left idle inside an open transaction',
    );

    await removeSwapFailure(dbAdapter);
    let retryBaseline = await latestIndexJobId();
    // Different content, so the write is not a no-op and enqueues a pass.
    await writePerson('update', 'person-1.json', 'Van Gogh');
    let retriedJob = await settledIndexJobAfter(retryBaseline);
    assert.strictEqual(
      retriedJob.status,
      'resolved',
      'the next pass over the same card succeeds once the failure is gone',
    );
    assert.strictEqual(
      await currentGeneration(),
      generationBefore + 1,
      'the successful pass advances the generation by exactly one',
    );
    assert.strictEqual(
      await liveInstanceRows(cardURL),
      1,
      'the successful pass promotes the card',
    );
    assert.strictEqual(
      retriedJob.result?.phaseTimings?.swapAttempts,
      1,
      'an uncontended swap commits on its first attempt',
    );
    assert.strictEqual(
      retriedJob.result?.phaseTimings?.swapRetryMs,
      0,
      'an uncontended swap spends no time on rolled-back attempts',
    );
  });
});
