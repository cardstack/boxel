import QUnit from 'qunit';
import { basename } from 'node:path';
const { module } = QUnit;
import { searchEntryWireQueryFromQuery } from '@cardstack/runtime-common/search-entry';
import {
  Deferred,
  rri,
  type LooseSingleCardDocument,
  type Realm,
  type Prerenderer as Renderer,
} from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';

const origin = 'http://127.0.0.1:4459/';
const realmURL = `${origin}save-drain/`;
const actor = '@save-drain:localhost';
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
const definition = `
  import { CardDef, contains, field, Component } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field fullName = contains(StringField, {
      computeVia: function(this: Person) { return this.firstName + ' ' + this.lastName; },
    });
    static isolated = class extends Component<typeof this> {
      <template><h1>{{@model.fullName}}</h1></template>
    };
  }
`;
function document(attributes: Record<string, string>): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: { module: rri(`${realmURL}person`), name: 'Person' },
      },
    },
  };
}

// Hold a real incremental job at the renderer boundary. Its durable queue
// reservation remains held, so following saves cannot finish their own index
// jobs either. This catches both the pre-write drain and post-write wait.
module(basename(import.meta.filename), function () {
  for (const enabled of [false, true]) {
    QUnit.module(
      `card saves during unrelated indexing | enabled=${enabled}`,
      (hooks) => {
        let realm: Realm;
        let render: Prerenderer;
        let barrier:
          | { entered: Deferred<void>; release: Deferred<void> }
          | undefined;
        let sameCardBarrier:
          | { entered: Deferred<void>; release: Deferred<void> }
          | undefined;
        let restore: ReturnType<
          typeof installRealmServerAssertOwnRealmServerBypassPatch
        >;
        const renderer: Renderer = {
          async prerenderVisit(args) {
            if (
              barrier &&
              args.visitType === 'index' &&
              args.url.endsWith('/unrelated.json')
            ) {
              barrier.entered.fulfill();
              await barrier.release.promise;
            }
            if (
              sameCardBarrier &&
              args.visitType === 'index' &&
              args.url.endsWith('/person-1.json')
            ) {
              // Hold the job AFTER it has rendered the card, so the bytes it
              // read are the older revision by the time the next save lands.
              let response = (await render.prerenderVisit(args)).response;
              sameCardBarrier.entered.fulfill();
              await sameCardBarrier.release.promise;
              return response;
            }
            return (await render.prerenderVisit(args)).response;
          },
          async prerenderModule(args) {
            return (await render.prerenderModule(args)).response;
          },
          async releaseBatch(args) {
            await render.releaseBatch(args);
          },
          async runCommand() {
            throw new Error('Unexpected save-drain command');
          },
        };
        hooks.before(() => {
          restore = installRealmServerAssertOwnRealmServerBypassPatch();
          render = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
        });
        setupPermissionedRealm(hooks, {
          latticeEnabled: enabled,
          realmURL: new URL(realmURL),
          assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
          permissions: {
            '*': ['read'],
            [actor]: ['read', 'write', 'realm-owner'],
          },
          prerenderer: renderer,
          fileSystem: {
            'person.gts': definition,
            'person-1.json': document({
              firstName: 'Before',
              lastName: 'Save',
            }),
            'unrelated.json': document({
              firstName: 'Other',
              lastName: 'Person',
            }),
          },
          onRealmSetup({ testRealm }) {
            realm = testRealm;
          },
        });
        hooks.after(async () => {
          await restore?.restore();
          await render?.stop();
        });
        QUnit.test(
          'saves preserve source ordering while their indexing is queued',
          async (assert) => {
            assert.timeout(180_000);
            const save = async (
              path: string,
              method: 'POST' | 'PATCH',
              body: unknown,
            ) => {
              const response = await fetch(realmURL + path, {
                method,
                headers,
                body: JSON.stringify(body),
              });
              return { status: response.status, body: await response.json() };
            };
            // Prime schema resolution before holding the unrelated job; the claim
            // concerns an already-loaded definition, not cold module admission.
            const warm = await save(
              'person-1',
              'PATCH',
              document({ firstName: 'Before', lastName: 'Save' }),
            );
            assert.strictEqual(warm.status, 200, 'definition is available');
            barrier = {
              entered: new Deferred<void>(),
              release: new Deferred<void>(),
            };
            let saves: ReturnType<typeof save>[] = [];
            try {
              await realm.write(
                'unrelated.json',
                JSON.stringify(
                  document({ firstName: 'Changed', lastName: 'Elsewhere' }),
                ),
                {
                  waitForIndex: false,
                  initiatingUser: '@other-writer:localhost',
                },
              );
              await barrier.entered.promise;
              saves = [
                save('person-1', 'PATCH', document({ firstName: 'After' })),
                save('person-1', 'PATCH', document({ lastName: 'Saved' })),
                save(
                  '',
                  'POST',
                  document({ firstName: 'New', lastName: 'Card' }),
                ),
              ];
              let completed = false;
              const saved = Promise.all(saves).then((responses) => {
                completed = true;
                return responses;
              });
              await Promise.race([
                saved,
                new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
              ]);
              assert.strictEqual(
                completed,
                enabled,
                enabled
                  ? 'enabled saves acknowledge within 2 seconds while unrelated indexing is still held'
                  : 'disabled saves retain the synchronous indexed-response contract',
              );
              if (completed) {
                const responses = await saved;
                assert.deepEqual(
                  responses.map((r) => r.status),
                  [200, 200, 201],
                  'PATCHes and create succeed',
                );
                assert.true(
                  responses.every(
                    (r) => !('fullName' in r.body.data.attributes),
                  ),
                  'saved source is not presented as newly computed data',
                );
                const sourceResponse = await fetch(`${realmURL}person-1.json`, {
                  headers: {
                    ...headers,
                    Accept: 'application/vnd.card+source',
                  },
                });
                const source = await sourceResponse.json();
                assert.strictEqual(
                  source.data.attributes.firstName,
                  'After',
                  'writer reads first patch from the durable source',
                );
                assert.strictEqual(
                  source.data.attributes.lastName,
                  'Saved',
                  'second patch preserves the first patch',
                );
                const noOp = await save('person-1', 'PATCH', source);
                assert.strictEqual(
                  noOp.status,
                  200,
                  'retrying the same save succeeds before indexing',
                );
                assert.strictEqual(
                  noOp.body.data.attributes.firstName,
                  'After',
                  'no-op response does not resurrect the stale indexed value',
                );
                assert.ok(
                  realm.incrementalIndexing(),
                  'index work is still pending after acknowledgment',
                );
              }
            } finally {
              barrier.release.fulfill();
              barrier = undefined;
              await Promise.allSettled(saves);
              await realm.incrementalIndexing();
            }
            const read = await fetch(`${realmURL}person-1`, { headers });
            const indexed = await read.json();
            assert.strictEqual(
              read.status,
              200,
              'writer can read the indexed card after the queue settles',
            );
            assert.strictEqual(
              indexed.data.attributes.fullName,
              'After Saved',
              'derived data eventually reflects both ordered writes',
            );
          },
        );

        // Ledger 4b review: without the pre-write drain, a second save of a
        // card can land while the job indexing its first save is running. The
        // queue must not join that save onto the running job (whose worker has
        // already read the older bytes); it needs its own job, so the index row
        // and the search doc end on the newer revision.
        if (enabled) {
          QUnit.test(
            'a save that lands while the previous save of the same card is being indexed is indexed itself',
            async (assert) => {
              assert.timeout(180_000);
              const patch = async (attributes: Record<string, string>) => {
                const response = await fetch(`${realmURL}person-1`, {
                  method: 'PATCH',
                  headers,
                  body: JSON.stringify(document(attributes)),
                });
                return { status: response.status, body: await response.json() };
              };
              const warm = await patch({ firstName: 'Zero', lastName: 'Save' });
              assert.strictEqual(warm.status, 200, 'definition is available');
              await realm.incrementalIndexing();
              sameCardBarrier = {
                entered: new Deferred<void>(),
                release: new Deferred<void>(),
              };
              let second: { status: number; body: any } | undefined;
              try {
                const first = await patch({ firstName: 'One' });
                assert.strictEqual(
                  first.status,
                  200,
                  'first save acknowledged',
                );
                await sameCardBarrier.entered.promise;
                // The running job has read and rendered revision One.
                second = await patch({ firstName: 'Two' });
                assert.strictEqual(
                  second.status,
                  200,
                  'second save acknowledged',
                );
                assert.strictEqual(
                  second.body.data.attributes.firstName,
                  'Two',
                  'second save echoes its own source',
                );
              } finally {
                sameCardBarrier.release.fulfill();
                sameCardBarrier = undefined;
                await realm.incrementalIndexing();
              }
              const read = await fetch(`${realmURL}person-1`, { headers });
              const indexed = await read.json();
              assert.strictEqual(read.status, 200, 'card reads from the index');
              assert.strictEqual(
                indexed.data.attributes.firstName,
                'Two',
                'index row holds the second save',
              );
              assert.strictEqual(
                indexed.data.attributes.fullName,
                'Two Save',
                'computed data was derived from the second save',
              );
              const search = await fetch(`${realmURL}_search`, {
                method: 'QUERY',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(
                  searchEntryWireQueryFromQuery(
                    {
                      filter: {
                        on: {
                          module: rri(`${realmURL}person`),
                          name: 'Person',
                        },
                        eq: { firstName: 'Two' },
                      },
                    },
                    { fields: ['item'] },
                  ),
                ),
              });
              const found = await search.json();
              assert.strictEqual(
                search.status,
                200,
                `search succeeds: ${JSON.stringify(found).slice(0, 200)}`,
              );
              assert.deepEqual(
                (found.data ?? []).map((row: any) =>
                  String(row.id).replace(/\.json$/, ''),
                ),
                [`${realmURL}person-1`],
                'search doc holds the second save',
              );
            },
          );
        }
      },
    );
  }
});
