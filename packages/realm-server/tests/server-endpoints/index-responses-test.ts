import { module, test } from 'qunit';
import { join, basename } from 'path';
import { systemInitiatedPriority } from '@cardstack/runtime-common';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
import { waitUntil } from '../helpers';
import { ensureDirSync, writeFileSync, writeJSONSync } from 'fs-extra';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let context = setupServerEndpointsTest(hooks, {
        beforeStartRealmServer: async (context) => {
          let subdirectoryPath = join(context.testRealmDir, 'subdirectory');
          ensureDirSync(subdirectoryPath);
          writeJSONSync(join(subdirectoryPath, 'index.json'), {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Subdirectory Index',
              },
              meta: {
                adoptsFrom: {
                  module: '../person.gts',
                  name: 'Person',
                },
              },
            },
          });

          writeFileSync(
            join(context.testRealmDir, 'isolated-card.gts'),
            `
              import { Component, CardDef } from 'https://cardstack.com/base/card-api';

              export class IsolatedCard extends CardDef {
                static isolated = class Isolated extends Component<typeof this> {
                  <template>
                    <div data-test-isolated-html>Isolated HTML</div>
                  </template>
                };
              }
              `,
          );

          writeJSONSync(join(context.testRealmDir, 'isolated-test.json'), {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './isolated-card.gts',
                  name: 'IsolatedCard',
                },
              },
            },
          });

          writeFileSync(
            join(context.testRealmDir, 'dollar-sign-card.gts'),
            `
            import { Component, CardDef } from 'https://cardstack.com/base/card-api';

            export class DollarSignCard extends CardDef {
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div data-test-dollar-sign>Price: $0.50 per unit</div>
                </template>
              };
            }
            `,
          );

          writeJSONSync(join(context.testRealmDir, 'dollar-sign-test.json'), {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './dollar-sign-card.gts',
                  name: 'DollarSignCard',
                },
              },
            },
          });

          writeFileSync(
            join(context.testRealmDir, 'head-card.gts'),
            `
            import { Component, CardDef } from 'https://cardstack.com/base/card-api';

            export class HeadCard extends CardDef {
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div data-test-isolated-html>Private isolated HTML</div>
                </template>
              };

              static head = class Head extends Component<typeof this> {
                <template>
                  <meta data-test-head-html content="private-head" />
                </template>
              };
            }
            `,
          );

          writeJSONSync(join(context.testRealmDir, 'private-index-test.json'), {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './head-card.gts',
                  name: 'HeadCard',
                },
              },
            },
          });

          writeFileSync(
            join(context.testRealmDir, 'scoped-css-card.gts'),
            `
            import { Component, CardDef } from 'https://cardstack.com/base/card-api';

            export class ScopedCssCard extends CardDef {
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div class="scoped-css-marker" data-test-scoped-css>Scoped CSS</div>
                  <style scoped>
                    .scoped-css-marker {
                      --scoped-css-marker: 1;
                    }
                  </style>
                </template>
              };
            }
            `,
          );

          writeJSONSync(join(context.testRealmDir, 'scoped-css-test.json'), {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './scoped-css-card.gts',
                  name: 'ScopedCssCard',
                },
              },
            },
          });
        },
      });

      test('startup indexing uses system initiated queue priority', async function (assert) {
        let [job] = (await context.dbAdapter.execute(
          `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${testRealm2URL.href}' ORDER BY created_at DESC LIMIT 1`,
        )) as { priority: number }[];

        assert.ok(job, 'found startup from-scratch index job for realm');
        assert.strictEqual(
          job.priority,
          systemInitiatedPriority,
          'realm startup uses system initiated priority',
        );
      });

      test('serves isolated HTML for realm index request', async function (assert) {
        let response = await context.request2
          .get('/test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-test-home-card'),
          'isolated HTML for index card is injected into the HTML response',
        );
      });

      test('serves isolated HTML in index responses for card URLs', async function (assert) {
        let response = await context.request2
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-test-isolated-html'),
          'isolated HTML is injected into the HTML response',
        );
      });

      test('serves isolated HTML for /subdirectory/index.json at /subdirectory/', async function (assert) {
        let response = await context.request2
          .get('/test/subdirectory/')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        assert.ok(
          response.text.includes('Subdirectory Index'),
          'isolated HTML is injected into the HTML response',
        );
      });

      test('does not inject head or isolated HTML when realm is not public', async function (assert) {
        await context.dbAdapter.execute(
          `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealm2URL.href}' AND username = '*'`,
        );

        let response = await context.request2
          .get('/test/private-index-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.notOk(
          response.text.includes('data-test-head-html'),
          'head HTML is not injected into the HTML response',
        );
        assert.notOk(
          response.text.includes('data-test-isolated-html'),
          'isolated HTML is not injected into the HTML response',
        );
      });

      test('serves scoped CSS in index responses for card URLs', async function (assert) {
        let response = await context.request2
          .get('/test/scoped-css-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-boxel-scoped-css'),
          'scoped CSS style tag is injected into the HTML response',
        );
        assert.ok(
          response.text.includes('--scoped-css-marker: 1'),
          'scoped CSS is included in the HTML response',
        );
      });

      test('serves isolated HTML containing dollar signs without corruption', async function (assert) {
        let response = await context.request2
          .get('/test/dollar-sign-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-test-dollar-sign'),
          'isolated HTML with dollar signs is injected into the HTML response',
        );
        assert.ok(
          response.text.includes('$0.50'),
          'dollar sign content is preserved without regex replacement pattern corruption',
        );
        assert.ok(
          response.text.includes('boxel-isolated-end'),
          'isolated end boundary marker is present (not corrupted by $0 backreference)',
        );
      });

      test('ignores deleted index entries for head, isolated, and scoped CSS injection', async function (assert) {
        let deleteSlugs = ['private-index-test', 'scoped-css-test'];

        for (let slug of deleteSlugs) {
          let deleteResponse = await context.request2
            .delete(`/test/${slug}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            deleteResponse.status,
            204,
            `deleted ${slug} via card API`,
          );
        }

        await waitUntil(
          async () => {
            let realmURLNoProtocol = testRealm2URL.href.replace(
              /^https?:\/\//,
              '',
            );

            for (let slug of deleteSlugs) {
              for (let table of ['boxel_index', 'boxel_index_working']) {
                let rows = (await context.dbAdapter.execute(
                  `SELECT COUNT(*) AS count
                   FROM ${table}
                   WHERE type = 'instance'
                     AND is_deleted IS NOT TRUE
                     AND (regexp_replace(url, '^https?://', '') LIKE '${realmURLNoProtocol}%${slug}%'
                          OR regexp_replace(file_alias, '^https?://', '') LIKE '${realmURLNoProtocol}%${slug}%')`,
                )) as { count: string | number }[];

                if (Number(rows[0]?.count ?? 0) > 0) {
                  return false;
                }
              }
            }

            return true;
          },
          {
            timeout: 5000,
            interval: 200,
            timeoutMessage:
              'Timed out waiting for deleted index entries to be tombstoned',
          },
        );

        let headResponse = await context.request2
          .get('/test/private-index-test')
          .set('Accept', 'text/html');

        assert.strictEqual(headResponse.status, 200, 'serves HTML response');
        assert.notOk(
          headResponse.text.includes('data-test-head-html'),
          'deleted head HTML is not injected into the HTML response',
        );
        assert.notOk(
          headResponse.text.includes('data-test-isolated-html'),
          'deleted isolated HTML is not injected into the HTML response',
        );

        let scopedCSSResponse = await context.request2
          .get('/test/scoped-css-test')
          .set('Accept', 'text/html');

        assert.strictEqual(
          scopedCSSResponse.status,
          200,
          'serves HTML response',
        );
        assert.notOk(
          scopedCSSResponse.text.includes('data-boxel-scoped-css'),
          'deleted scoped CSS is not injected into the HTML response',
        );
        assert.notOk(
          scopedCSSResponse.text.includes('--scoped-css-marker: 1'),
          'deleted scoped CSS contents are not included in the HTML response',
        );
        assert.notOk(
          scopedCSSResponse.text.includes('data-test-scoped-css'),
          'deleted isolated HTML is not injected for scoped CSS card',
        );
      });

      test('returns 404 for request that has malformed URI', async function (assert) {
        let response = await context.request2.get('/%c0').set('Accept', '*/*');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      });

      test('preserves scoped CSS in HTML response after card enters error state', async function (assert) {
        // First verify the card is indexed successfully and scoped CSS is served
        let initialResponse = await context.request2
          .get('/test/scoped-css-test')
          .set('Accept', 'text/html');

        assert.strictEqual(
          initialResponse.status,
          200,
          'initial HTML response is successful',
        );
        assert.ok(
          initialResponse.text.includes('--scoped-css-marker: 1'),
          'scoped CSS is present in initial response',
        );

        // Break the instance by making it reference a non-existent module
        // This is more reliable than breaking the module and waiting for propagation
        let brokenInstanceJSON = JSON.stringify({
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: './non-existent-module.gts',
                name: 'NonExistentCard',
              },
            },
          },
        });

        let writeResponse = await context.request2
          .post('/test/scoped-css-test.json')
          .set('Accept', 'application/vnd.card+source')
          .send(brokenInstanceJSON);

        assert.strictEqual(
          writeResponse.status,
          204,
          'instance file write was accepted',
        );

        // Wait for the index to reflect the error state
        await waitUntil(
          async () => {
            let rows = (await context.dbAdapter.execute(
              `SELECT has_error FROM boxel_index
               WHERE url = '${testRealm2URL.href}scoped-css-test.json'
                 AND type = 'instance'`,
            )) as { has_error: boolean }[];

            return rows.length > 0 && rows[0].has_error === true;
          },
          {
            timeout: 10000,
            interval: 200,
            timeoutMessage:
              'Timed out waiting for instance to enter error state',
          },
        );

        // Verify the database row has an error
        let errorRows = (await context.dbAdapter.execute(
          `SELECT has_error, last_known_good_deps FROM boxel_index
           WHERE url = '${testRealm2URL.href}scoped-css-test.json'
             AND type = 'instance'`,
        )) as { has_error: boolean; last_known_good_deps: string[] | null }[];

        assert.strictEqual(errorRows.length, 1, 'found the index entry');
        assert.true(
          errorRows[0].has_error,
          'instance is in error state in the database',
        );
        assert.ok(
          errorRows[0].last_known_good_deps,
          'last_known_good_deps is preserved',
        );
        assert.ok(
          errorRows[0].last_known_good_deps!.some((dep: string) =>
            dep.includes('.glimmer-scoped.css'),
          ),
          'last_known_good_deps contains scoped CSS URL',
        );

        // Now request the HTML again - it should still include scoped CSS from last_known_good_deps
        let errorStateResponse = await context.request2
          .get('/test/scoped-css-test')
          .set('Accept', 'text/html');

        assert.strictEqual(
          errorStateResponse.status,
          200,
          'HTML response is still successful even with errored card',
        );
        assert.ok(
          errorStateResponse.text.includes('data-boxel-scoped-css'),
          'scoped CSS style tag is still present after error (from last_known_good_deps)',
        );
        assert.ok(
          errorStateResponse.text.includes('--scoped-css-marker: 1'),
          'scoped CSS content is preserved from last_known_good_deps after card enters error state',
        );
      });
    },
  );
});
