import QUnit from 'qunit';
const { module } = QUnit;
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PgAdapter } from '@cardstack/postgres';
import type { Prerenderer as Renderer } from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { adversarialFlapperSource } from './helpers/lattice-adversarial-fixture.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const origin = 'http://127.0.0.1:4458/';
const realmURL = origin + 'lattice-write-burst/';
const actor = '@lattice-write-burst:localhost';
const count = Number(process.env.LATTICE_BURST_COUNT ?? '48');
const sessions = JSON.parse(
  testCreatePrerenderAuth(actor, {
    [realmURL]: ['read', 'write', 'realm-owner'],
  }),
);
const headers = {
  Accept: 'application/vnd.card+json',
  'Content-Type': 'application/vnd.card+json',
  Authorization: `Bearer ${sessions[realmURL]}`,
};

// Promote the burst out of the long adversarial suite. These are the same six
// flappers and HTTP PATCH path, without the unrelated permanently failing owners.
module(basename(import.meta.filename), function () {
  for (const enabled of [false, true]) {
    QUnit.module(
      `Lattice | concurrent writes | enabled=${enabled}`,
      (hooks) => {
        let render: Prerenderer;
        let realmPath: string;
        let observer: PgAdapter;
        let restore: ReturnType<
          typeof installRealmServerAssertOwnRealmServerBypassPatch
        >;
        const renderer: Renderer = {
          async prerenderVisit(args) {
            return (await render.prerenderVisit(args)).response;
          },
          async prerenderModule(args) {
            return (await render.prerenderModule(args)).response;
          },
          async releaseBatch(args) {
            await render.releaseBatch(args);
          },
          async runCommand() {
            throw new Error('Unexpected write-burst command');
          },
        };
        hooks.before(() => {
          restore = installRealmServerAssertOwnRealmServerBypassPatch();
          render = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
        });
        setupPermissionedRealm(hooks, {
          latticeEnabled: enabled,
          realmURL: new URL(realmURL),
          permissions: {
            '*': ['read'],
            [actor]: ['read', 'write', 'realm-owner'],
          },
          assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
          prerenderer: renderer,
          fileSystem: {
            'cards.gts': adversarialFlapperSource,
            ...Object.fromEntries(
              Array.from({ length: 6 }, (_, i) => [
                `Flapper/${i}.json`,
                {
                  data: {
                    type: 'card',
                    attributes: { group: 'classroom', on: false, n: i },
                    meta: {
                      adoptsFrom: { module: '../cards', name: 'Flapper' },
                    },
                  },
                },
              ]),
            ),
          },
          onRealmSetup({ testRealmPath }) {
            realmPath = testRealmPath;
            // Independent pool: diagnostics must still work if the request pool
            // is exhausted. It connects only to this test's private database.
            observer = new PgAdapter();
          },
        });
        hooks.afterEach(async () => {
          await observer?.close();
        });
        hooks.after(async () => {
          await restore?.restore();
          await render?.stop();
        });

        QUnit.test(
          'a classroom burst completes and subsequent reads remain current',
          async (assert) => {
            assert.timeout(900_000);
            let maxWaitingLocks = 0;
            let heartbeat = 0;
            let sampling: Promise<void> | undefined;
            const timer = setInterval(() => {
              heartbeat++;
              if (sampling) return;
              sampling = observer
                .execute(
                  `SELECT state,wait_event_type,wait_event,count(*)::int AS count
             FROM pg_stat_activity WHERE datname=current_database()
             GROUP BY state,wait_event_type,wait_event`,
                )
                .then((rows) => {
                  const waiting = rows
                    .filter((row) => row.wait_event === 'advisory')
                    .reduce((sum, row) => sum + Number(row.count), 0);
                  if (waiting > maxWaitingLocks) {
                    maxWaitingLocks = waiting;
                    console.log(
                      'LATTICE_WRITE_BURST_DB',
                      JSON.stringify({ count, enabled, rows }),
                    );
                  }
                })
                .finally(() => {
                  sampling = undefined;
                });
            }, 500);
            const outcomes = await Promise.allSettled(
              Array.from({ length: count }, async (_, i) => {
                const response = await fetch(realmURL + `Flapper/${i % 6}`, {
                  method: 'PATCH',
                  headers,
                  // This path still serializes write + Chrome indexing. The
                  // regression is completion without a pool deadlock, not a
                  // latency target for forty-eight sequential index operations.
                  signal: AbortSignal.timeout(600_000),
                  body: JSON.stringify({
                    data: {
                      type: 'card',
                      attributes: { on: true, n: i + 100 },
                      meta: {
                        adoptsFrom: { module: '../cards', name: 'Flapper' },
                      },
                    },
                  }),
                });
                const body = await response.json();
                return { status: response.status, n: body.data?.attributes?.n };
              }),
            );
            clearInterval(timer);
            await sampling;
            console.log(
              'LATTICE_WRITE_BURST',
              JSON.stringify({
                count,
                enabled,
                maxWaitingLocks,
                heartbeat,
                answered: outcomes.filter((r) => r.status === 'fulfilled')
                  .length,
              }),
            );
            const failed = outcomes.some((r) => r.status === 'rejected');
            if (failed) {
              // Failure-only teardown, never a passing recovery mechanism. Release
              // this private test DB's blocked requests so cleanup does not hang.
              await observer.execute(
                `SELECT pg_cancel_backend(pid) FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event='advisory'`,
              );
            }
            assert.deepEqual(
              outcomes.map((result) =>
                result.status === 'fulfilled'
                  ? result.value.status
                  : String(result.reason),
              ),
              Array(count).fill(200),
              'every write completes successfully',
            );
            if (!failed) {
              assert.deepEqual(
                outcomes.map((result) =>
                  result.status === 'fulfilled' ? result.value.n : undefined,
                ),
                Array.from({ length: count }, (_, i) => i + 100),
                'each response contains its own completed write',
              );
              for (let i = 0; i < 6; i++) {
                const stored = JSON.parse(
                  await readFile(join(realmPath, `Flapper/${i}.json`), 'utf8'),
                ).data.attributes;
                const response = await fetch(realmURL + `Flapper/${i}`, {
                  headers,
                  signal: AbortSignal.timeout(10_000),
                });
                const { data } = await response.json();
                assert.strictEqual(
                  response.status,
                  200,
                  `card ${i} remains readable`,
                );
                assert.strictEqual(
                  data.attributes.n,
                  stored.n,
                  `card ${i} matches the latest source`,
                );
                assert.true(
                  data.attributes.on,
                  `card ${i} contains the edited value`,
                );
              }
            }
          },
        );
      },
    );
  }
});
