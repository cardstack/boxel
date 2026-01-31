import { module, test } from 'qunit';
import { join, basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { systemInitiatedPriority } from '@cardstack/runtime-common';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
import { setupPermissionedRealmAtURL, waitUntil } from '../helpers';
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
    },
  );

  module('Published realm index responses', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/');
    let request: SuperTest<Test>;

    function onRealmSetup(args: {
      request: SuperTest<Test>;
    }) {
      request = args.request;
    }

    setupPermissionedRealmAtURL(hooks, realmURL, {
      permissions: {
        '*': ['read'],
      },
      published: true,
      onRealmSetup,
    });

    test('serves index HTML by default for published realm', async function (assert) {
      let response = await request.get('/').set('Accept', 'application/json');

      assert.strictEqual(response.status, 200, 'serves HTML response');
      assert.ok(
        response.headers['content-type']?.includes('text/html'),
        'content type is text/html',
      );
      assert.ok(
        response.text.includes('data-test-home-card'),
        'index HTML is served',
      );
    });

    test('skips index HTML when vendor mime type is requested', async function (assert) {
      let response = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'serves JSON response');
      assert.ok(
        response.headers['content-type']?.includes('application/vnd.card+json'),
        'content type is vendor JSON',
      );
    });
  });
});
