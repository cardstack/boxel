import { module, test } from 'qunit';
import { join, basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { systemInitiatedPriority, type Realm } from '@cardstack/runtime-common';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
import { setupPermissionedRealmCached, waitUntil } from '../helpers';
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
            join(context.testRealmDir, 'unsafe-head-card.gts'),
            `
            import { Component, CardDef } from 'https://cardstack.com/base/card-api';

            export class UnsafeHeadCard extends CardDef {
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div data-test-isolated-html>Unsafe head card</div>
                </template>
              };

              static head = class Head extends Component<typeof this> {
                <template>
                  {{! template-lint-disable no-forbidden-elements }}
                  <title>Safe Title</title>
                  <meta name="description" content="safe description" />
                  <script>void 0</script>
                  <style>.injected-style { color: red }</style>
                </template>
              };
            }
            `,
          );

          writeJSONSync(join(context.testRealmDir, 'unsafe-head-test.json'), {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './unsafe-head-card.gts',
                  name: 'UnsafeHeadCard',
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

          // Cards for testing scoped CSS from linked card instances.
          // The parent declares linksTo with a base type, but the actual linked
          // instance is a subclass with its own scoped CSS. This means the child's
          // CSS is NOT reachable through the parent's static module imports — it
          // can only be found by iterating over serialized.included resources.
          writeFileSync(
            join(context.testRealmDir, 'linked-css-base.gts'),
            `
            import { Component, CardDef } from 'https://cardstack.com/base/card-api';

            export class LinkedCssBase extends CardDef {
              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <div data-test-linked-base>Base</div>
                </template>
              };
            }
            `,
          );

          writeFileSync(
            join(context.testRealmDir, 'linked-css-child.gts'),
            `
            import { Component } from 'https://cardstack.com/base/card-api';
            import { LinkedCssBase } from './linked-css-base.gts';

            export class LinkedCssChild extends LinkedCssBase {
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div class="linked-child-marker" data-test-linked-child>Linked Child</div>
                  <style scoped>
                    .linked-child-marker {
                      --linked-child-css: 1;
                    }
                  </style>
                </template>
              };
              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <div class="linked-child-marker" data-test-linked-child>Linked Child</div>
                  <style scoped>
                    .linked-child-marker {
                      --linked-child-css: 1;
                    }
                  </style>
                </template>
              };
            }
            `,
          );

          writeFileSync(
            join(context.testRealmDir, 'linked-css-parent.gts'),
            `
            import { Component, CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
            import { LinkedCssBase } from './linked-css-base.gts';

            export class LinkedCssParent extends CardDef {
              @field child = linksTo(() => LinkedCssBase);
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div data-test-linked-parent>Parent</div>
                  <@fields.child @format='embedded' />
                </template>
              };
            }
            `,
          );

          writeJSONSync(join(context.testRealmDir, 'linked-css-child-1.json'), {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: './linked-css-child.gts',
                  name: 'LinkedCssChild',
                },
              },
            },
          });

          writeJSONSync(
            join(context.testRealmDir, 'linked-css-parent-1.json'),
            {
              data: {
                type: 'card',
                attributes: {},
                relationships: {
                  child: {
                    links: {
                      self: './linked-css-child-1',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './linked-css-parent.gts',
                    name: 'LinkedCssParent',
                  },
                },
              },
            },
          );

          // Cards for testing default head template with cardInfo.theme
          writeJSONSync(join(context.testRealmDir, 'a-test-theme.json'), {
            data: {
              type: 'card',
              attributes: {
                cardInfo: {
                  cardThumbnailURL: 'https://example.com/brand-icon.png',
                },
              },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'Theme',
                },
              },
            },
          });

          writeJSONSync(
            join(context.testRealmDir, 'a-brand-guide-theme.json'),
            {
              data: {
                type: 'card',
                attributes: {
                  markUsage: {
                    socialMediaProfileIcon:
                      'https://example.com/social-icon.png',
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/brand-guide',
                    name: 'default',
                  },
                },
              },
            },
          );

          // NOTE: card-with-theme.json is NOT written here because from-scratch
          // indexing uses a batched write strategy (boxel_index_working → boxel_index).
          // Cards within the same batch can't resolve linksTo references to each other
          // because the data isn't in the production table yet. Instead, card-with-theme
          // is created via API in the test itself, triggering incremental indexing
          // after the theme card is already committed to boxel_index.
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

      test('HTML response does not include boxel-ready class on body', async function (assert) {
        let response = await context.request2
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.notOk(
          response.text.includes('boxel-ready'),
          'boxel-ready class is not present in server-rendered HTML',
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

      test('serves scoped CSS from linked cards in index responses', async function (assert) {
        let response = await context.request2
          .get('/test/linked-css-parent-1')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-test-linked-parent'),
          'parent isolated HTML is in the response',
        );
        assert.ok(
          response.text.includes('--linked-child-css: 1'),
          'scoped CSS from linked card is included in the HTML response',
        );
      });

      test('sanitizes disallowed tags from head HTML in index responses', async function (assert) {
        let response = await context.request2
          .get('/test/unsafe-head-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        // Extract content between head markers
        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          headContent.includes('<title>'),
          'title tag is preserved in head HTML',
        );
        assert.ok(
          headContent.includes('<meta'),
          'meta tag is preserved in head HTML',
        );
        assert.notOk(
          headContent.includes('<script'),
          'script tag is stripped from head HTML',
        );
        assert.notOk(
          headContent.includes('void 0'),
          'script content is stripped from head HTML',
        );
        assert.notOk(
          headContent.includes('.injected-style'),
          'user-injected style content is stripped from head HTML',
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

      test('HTML response always includes default static favicon and apple-touch-icon', async function (assert) {
        // Even a card with no theme should get the static icons from index.html
        // (which live outside the head injection markers)
        let response = await context.request2
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('rel="icon"'),
          'static favicon link is present in the HTML response',
        );
        assert.ok(
          response.text.includes('rel="apple-touch-icon"'),
          'static apple-touch-icon link is present in the HTML response',
        );
      });

      test('head HTML does not include icon links when card has no theme', async function (assert) {
        let response = await context.request2
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        // The default head template should NOT emit icon links when there's no theme
        // (the static icons from index.html serve as defaults)
        assert.notOk(
          headContent.includes('rel="icon"'),
          'injected head HTML does not contain favicon link (static ones from index.html are the default)',
        );
        assert.notOk(
          headContent.includes('rel="apple-touch-icon"'),
          'injected head HTML does not contain apple-touch-icon link',
        );
      });

      test('non-public realm preserves static favicon and apple-touch-icon', async function (assert) {
        await context.dbAdapter.execute(
          `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealm2URL.href}' AND username = '*'`,
        );

        let response = await context.request2
          .get('/test/private-index-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        // Even without head injection, static icons from index.html remain
        assert.ok(
          response.text.includes('rel="icon"'),
          'static favicon link is present even without head injection',
        );
        assert.ok(
          response.text.includes('rel="apple-touch-icon"'),
          'static apple-touch-icon link is present even without head injection',
        );
      });

      test('default head template includes favicon and apple-touch-icon from cardInfo.theme', async function (assert) {
        // Create card-with-theme via API so it's indexed incrementally AFTER
        // the theme card is already in boxel_index (from-scratch indexing
        // batches writes and can't resolve cross-card linksTo references).
        let cardWithThemeJSON = JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              firstName: 'Themed Card',
              cardInfo: {
                name: null,
                summary: null,
                cardThumbnailURL: null,
                notes: null,
              },
            },
            relationships: {
              'cardInfo.theme': {
                links: {
                  self: './a-test-theme',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: './person.gts',
                name: 'Person',
              },
            },
          },
        });

        let writeResponse = await context.request2
          .post('/test/card-with-theme.json')
          .set('Accept', 'application/vnd.card+source')
          .send(cardWithThemeJSON);

        assert.strictEqual(
          writeResponse.status,
          204,
          'card-with-theme file write was accepted',
        );

        // Wait for the card to be indexed (head_html populated, even if empty string).
        await waitUntil(
          async () => {
            let rows = (await context.dbAdapter.execute(
              `SELECT url, head_html FROM boxel_index
               WHERE url LIKE '%card-with-theme%'
                 AND type = 'instance'
                 AND is_deleted IS NOT TRUE
               LIMIT 1`,
            )) as { url: string; head_html: string | null }[];

            return rows.length > 0 && rows[0].head_html != null;
          },
          {
            timeout: 30000,
            interval: 500,
            timeoutMessage:
              'Timed out waiting for card-with-theme to be indexed',
          },
        );

        let response = await context.request2
          .get('/test/card-with-theme')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          headContent.includes(
            '<link rel="icon" href="https://example.com/brand-icon.png"',
          ),
          `head HTML includes favicon link from theme. headContent=${headContent.substring(0, 500)}`,
        );
        assert.ok(
          headContent.includes(
            '<link rel="apple-touch-icon" href="https://example.com/brand-icon.png"',
          ),
          `head HTML includes apple-touch-icon link from theme`,
        );
      });

      test('default head template uses markUsage.socialMediaProfileIcon from BrandGuide theme', async function (assert) {
        let cardJSON = JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              firstName: 'BrandGuide Themed Card',
              cardInfo: {
                name: null,
                summary: null,
                cardThumbnailURL: null,
                notes: null,
              },
            },
            relationships: {
              'cardInfo.theme': {
                links: {
                  self: './a-brand-guide-theme',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: './person.gts',
                name: 'Person',
              },
            },
          },
        });

        let writeResponse = await context.request2
          .post('/test/card-with-brand-guide-theme.json')
          .set('Accept', 'application/vnd.card+source')
          .send(cardJSON);

        assert.strictEqual(
          writeResponse.status,
          204,
          'card file write was accepted',
        );

        await waitUntil(
          async () => {
            let rows = (await context.dbAdapter.execute(
              `SELECT url, head_html FROM boxel_index
               WHERE url LIKE '%card-with-brand-guide-theme%'
                 AND type = 'instance'
                 AND is_deleted IS NOT TRUE
               LIMIT 1`,
            )) as { url: string; head_html: string | null }[];

            return rows.length > 0 && rows[0].head_html != null;
          },
          {
            timeout: 30000,
            interval: 500,
            timeoutMessage:
              'Timed out waiting for card-with-brand-guide-theme to be indexed',
          },
        );

        let response = await context.request2
          .get('/test/card-with-brand-guide-theme')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          headContent.includes(
            '<link rel="icon" href="https://example.com/social-icon.png"',
          ),
          `head HTML includes favicon from BrandGuide markUsage.socialMediaProfileIcon. headContent=${headContent.substring(0, 500)}`,
        );
        assert.ok(
          headContent.includes(
            '<link rel="apple-touch-icon" href="https://example.com/social-icon.png"',
          ),
          `head HTML includes apple-touch-icon from BrandGuide markUsage.socialMediaProfileIcon`,
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

  module('Published realm index responses', function (hooks) {
    // Use a URL with a path segment. Server-level routes are now namespaced
    // as /_federated-info, /_federated-search, etc., so they no longer collide
    // with the realm's own /_info and /_search handlers.
    let realmURL = new URL('http://127.0.0.1:4444/published/');
    let request: SuperTest<Test>;
    let testRealm: Realm;

    function onRealmSetup(args: {
      request: SuperTest<Test>;
      testRealm: Realm;
    }) {
      request = args.request;
      testRealm = args.testRealm;
    }

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: {
        '*': ['read'],
      },
      published: true,
      onRealmSetup,
    });

    hooks.beforeEach(async function () {
      // Wait for indexing to complete before running tests
      // This ensures isolated_html is available in the database
      await testRealm.indexing();
    });

    test('serves index HTML by default for published realm', async function (assert) {
      let response = await request
        .get('/published/')
        .set('Accept', 'application/json');

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
        .get('/published/person-1')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'serves JSON response');
      assert.ok(
        response.headers['content-type']?.includes('application/vnd.card+json'),
        'content type is vendor JSON',
      );
    });
  });
});
