import QUnit from 'qunit';
const { module, test } = QUnit;
import { join, basename } from 'path';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import type { RealmHttpServer as Server } from '../../server.ts';
import { dirSync, type DirResult } from 'tmp';
import {
  DEFAULT_PERMISSIONS,
  systemInitiatedPriority,
  type DBAdapter,
  type Realm,
  rri,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { testRealmURL } from './helpers.ts';
import {
  rejectedPrerenderHtmlJobIds,
  settlePrerenderHtmlJobs,
} from '../helpers/indexing.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupPermissionedRealmCached,
  waitUntil,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import fsExtra from 'fs-extra';
const { ensureDirSync } = fsExtra;
import '@cardstack/runtime-common/helpers/code-equality-assertion';

// A single readiness request holds for as long as its own gates take:
// READINESS_REQUEST_BUDGET_MS across startup / in-flight index / index-lane
// settle, then `awaitPublishedHtmlReady`'s own budget on top. Roughly 70s
// today. `waitUntil` tests its deadline between attempts and never abandons
// one in flight, so a poll can overshoot its budget by a whole request.
const READINESS_POLL_TIMEOUT_MS = 90_000;

// Budget for a publish setup hook: realm boot, the fixture writes, the
// from-scratch index of the published copy, its render, and the settle that
// follows. Sized against the worst case those add up to — the readiness poll
// plus one request's overshoot, plus the settle, plus the write traffic
// before either — so a stalled stage is reported by the wait that owns it
// rather than by QUnit's stageless timeout.
const PUBLISHED_REALM_SETUP_TIMEOUT_MS = 300_000;

// Wait for a freshly published realm to be both indexed and rendered.
//
// `awaitPrerenderHtml=true` is the gate every publish consumer uses
// (boxel-cli's publish command, the host app, the publish handler's own
// Location header): a published realm's deliverable is its HTML, and the
// index pass spawns the prerender_html job fire-and-forget, so index-only
// readiness answers ready while the render is still running. Holding here is
// what keeps the render's duration off whatever budget the caller's next wait
// carries — a from-scratch published-realm render runs the module pre-warm
// sweep and takes as long as the realm is large and the runner is loaded.
//
// Poll rather than asking once: readiness bounds how long it holds a single
// request and answers 503 with `Retry-After` once that budget is spent, so a
// pass longer than the budget takes more than one request to observe.
// `X-Boxel-Not-Ready` names the stage still outstanding, which is the whole
// diagnosis when this times out — index vs prerender-html are different
// failures with different causes.
//
// 503 is the only status worth another attempt. Anything else — the realm
// never mounted, an auth misconfiguration, a throw out of the handler — is
// settled, and retrying it to the end of the budget only converts a specific
// error into a slow generic one.
//
// A rejected render is settled too, and invisible to readiness: the job never
// reaches its batch swap, so no HTML lands and the readiness predicate stays
// false for good. Reading the channel each attempt keeps that failure
// reported as the job that failed rather than as a wait that ran out.
async function waitForPublishedRealmReady(
  request: SuperTest<Test>,
  dbAdapter: DBAdapter,
  publishedRealmURL: string,
  publishedRealmPath: string,
  publishedRealmHost: string,
): Promise<void> {
  let lastStatus = 'no response';
  await waitUntil(
    async () => {
      let rejected = await rejectedPrerenderHtmlJobIds(
        dbAdapter,
        publishedRealmURL,
      );
      if (rejected.length > 0) {
        throw new Error(
          `prerender_html job(s) rejected while awaiting readiness for ${publishedRealmURL}: ${rejected.join(', ')}`,
        );
      }
      let response = await request
        .get(`${publishedRealmPath}_readiness-check?awaitPrerenderHtml=true`)
        .set('Host', publishedRealmHost)
        .set('Accept', 'application/vnd.api+json');
      if (response.status === 200) {
        return true;
      }
      let stage = response.headers['x-boxel-not-ready'];
      lastStatus = `HTTP ${response.status}${stage ? ` (not ready: ${stage})` : ''}${
        response.text ? ` ${response.text.slice(0, 300)}` : ''
      }`;
      if (response.status !== 503) {
        throw new Error(
          `published realm ${publishedRealmHost}${publishedRealmPath} answered a settled failure to its readiness check: ${lastStatus}`,
        );
      }
      return false;
    },
    {
      timeout: READINESS_POLL_TIMEOUT_MS,
      interval: 1000,
      timeoutMessage: () =>
        `published realm ${publishedRealmHost}${publishedRealmPath} never passed its readiness check; last response: ${lastStatus}`,
    },
  );
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let request: SuperTest<Test>;
      let dbAdapter: DBAdapter;

      function onRealmSetup(args: {
        request: SuperTest<Test>;
        testRealm: Realm;
        dbAdapter: DBAdapter;
      }) {
        request = args.request;
        dbAdapter = args.dbAdapter;
      }

      setupPermissionedRealmCached(hooks, {
        realmURL: testRealmURL,
        fileSystem: {
          'index.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./home.gts'),
                  name: 'Home',
                },
              },
            },
          },
          'home.gts': `import { Component, CardDef } from '@cardstack/base/card-api';
                      export class Home extends CardDef {
                        static isolated = class Isolated extends Component<typeof this> {
                          <template>
                            <p data-test-home-card>Hello, world</p>
                          </template>
                        };
                      }`,
          // A binary document for the embed-negotiation tests — the realm
          // serves it verbatim with its extension's content type.
          'report.pdf': '%PDF-1.4 fake-pdf-bytes',
          'person.gts': `import {
                            contains,
                            field,
                            Component,
                            CardDef,
                          } from '@cardstack/base/card-api';
                          import StringField from '@cardstack/base/string';

                          export class Person extends CardDef {
                            static displayName = 'Person';
                            @field firstName = contains(StringField);
                            @field cardTitle = contains(StringField, {
                              computeVia: function (this: Person) {
                                return this.firstName;
                              },
                            });
                            static isolated = class Isolated extends Component<typeof this> {
                              <template>
                                <h1 data-test-card><@fields.firstName /></h1>
                              </template>
                            };
                          }`,
          'subdirectory/index.json': {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Subdirectory Index',
              },
              meta: {
                adoptsFrom: {
                  module: rri('../person.gts'),
                  name: 'Person',
                },
              },
            },
          },
          'isolated-card.gts': `
              import { Component, CardDef } from '@cardstack/base/card-api';

              export class IsolatedCard extends CardDef {
                static isolated = class Isolated extends Component<typeof this> {
                  <template>
                    <div data-test-isolated-html>Isolated HTML</div>
                  </template>
                };
              }
              `,
          'isolated-test.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./isolated-card.gts'),
                  name: 'IsolatedCard',
                },
              },
            },
          },

          'dollar-sign-card.gts': `
            import { Component, CardDef } from '@cardstack/base/card-api';

            export class DollarSignCard extends CardDef {
              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <div data-test-dollar-sign>Price: $0.50 per unit</div>
                </template>
              };
            }
            `,

          'dollar-sign-test.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./dollar-sign-card.gts'),
                  name: 'DollarSignCard',
                },
              },
            },
          },

          'head-card.gts': `
            import { Component, CardDef } from '@cardstack/base/card-api';

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

          'private-index-test.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./head-card.gts'),
                  name: 'HeadCard',
                },
              },
            },
          },

          'unsafe-head-card.gts': `
            import { Component, CardDef } from '@cardstack/base/card-api';

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

          'unsafe-head-test.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./unsafe-head-card.gts'),
                  name: 'UnsafeHeadCard',
                },
              },
            },
          },

          'scoped-css-card.gts': `
            import { Component, CardDef } from '@cardstack/base/card-api';

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
          'scoped-css-test.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./scoped-css-card.gts'),
                  name: 'ScopedCssCard',
                },
              },
            },
          },

          // Cards for testing scoped CSS from linked card instances.
          // The parent declares linksTo with a base type, but the actual linked
          // instance is a subclass with its own scoped CSS. This means the child's
          // CSS is NOT reachable through the parent's static module imports — it
          // can only be found by iterating over serialized.included resources.

          'linked-css-base.gts': `
            import { Component, CardDef } from '@cardstack/base/card-api';

            export class LinkedCssBase extends CardDef {
              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <div data-test-linked-base>Base</div>
                </template>
              };
            }
            `,

          'linked-css-child.gts': `
            import { Component } from '@cardstack/base/card-api';
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

          'linked-css-parent.gts': `
            import { Component, CardDef, field, linksTo } from '@cardstack/base/card-api';
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

          'linked-css-child-1.json': {
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: rri('./linked-css-child.gts'),
                  name: 'LinkedCssChild',
                },
              },
            },
          },

          'linked-css-parent-1.json': {
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
                  module: rri('./linked-css-parent.gts'),
                  name: 'LinkedCssParent',
                },
              },
            },
          },

          // Cards for testing default head template with cardInfo.theme
          'a-test-theme.json': {
            data: {
              type: 'card',
              attributes: {
                cardInfo: {
                  cardThumbnailURL: 'https://example.com/brand-icon.png',
                },
              },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/base/card-api'),
                  name: 'Theme',
                },
              },
            },
          },

          'a-brand-guide-theme.json': {
            data: {
              type: 'card',
              attributes: {
                markUsage: {
                  socialMediaProfileIcon: 'https://example.com/social-icon.png',
                },
              },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/base/brand-guide'),
                  name: 'default',
                },
              },
            },
          },
        },
        permissions: {
          '*': ['read', 'write'],
        },
        onRealmSetup,
      });

      test('startup indexing uses system initiated queue priority', async function (assert) {
        let [job] = (await dbAdapter.execute(
          `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${testRealmURL.href}' ORDER BY created_at DESC LIMIT 1`,
        )) as { priority: number }[];

        assert.ok(job, 'found startup from-scratch index job for realm');
        assert.strictEqual(
          job.priority,
          systemInitiatedPriority,
          'realm startup uses system initiated priority',
        );
      });

      test('serves isolated HTML for realm index request', async function (assert) {
        let response = await request.get('/test').set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-test-home-card'),
          'isolated HTML for index card is injected into the HTML response',
        );
      });

      test('serves isolated HTML in index responses for card URLs', async function (assert) {
        let response = await request
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.ok(
          response.text.includes('data-test-isolated-html'),
          'isolated HTML is injected into the HTML response',
        );
      });

      test('HTML response does not include boxel-ready class on body', async function (assert) {
        let response = await request
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');
        assert.notOk(
          response.text.includes('boxel-ready'),
          'boxel-ready class is not present in server-rendered HTML',
        );
      });

      test('serves isolated HTML for /subdirectory/index.json at /subdirectory/', async function (assert) {
        let response = await request
          .get('/test/subdirectory/')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        assert.ok(
          response.text.includes('Subdirectory Index'),
          'isolated HTML is injected into the HTML response',
        );
      });

      test('does not inject head or isolated HTML when realm is not public', async function (assert) {
        await dbAdapter.execute(
          `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
        );

        let response = await request
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
        let response = await request
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
        let response = await request
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
        let response = await request
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
        let response = await request
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
          let deleteResponse = await request
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
            let realmURLNoProtocol = testRealmURL.href.replace(
              /^https?:\/\//,
              '',
            );

            for (let slug of deleteSlugs) {
              for (let table of ['boxel_index', 'boxel_index_working']) {
                let rows = (await dbAdapter.execute(
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

        let headResponse = await request
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

        let scopedCSSResponse = await request
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

      test('HTML response includes exactly one favicon and one apple-touch-icon', async function (assert) {
        let response = await request
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let faviconCount = (response.text.match(/rel="icon"/g) || []).length;
        let appleTouchIconCount = (
          response.text.match(/rel="apple-touch-icon"/g) || []
        ).length;

        assert.strictEqual(
          faviconCount,
          1,
          'exactly one favicon link is present in the HTML response',
        );
        assert.strictEqual(
          appleTouchIconCount,
          1,
          'exactly one apple-touch-icon link is present in the HTML response',
        );
        assert.ok(
          /<title[\s>]/.test(response.text),
          'title element is present in the HTML response',
        );
      });

      test('default icon links are injected when card has no theme', async function (assert) {
        let response = await request
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          /<title[\s>]/.test(headContent),
          'title element is preserved in head when no theme is present',
        );
        assert.ok(
          headContent.includes('rel="icon"'),
          'default favicon link is injected into head when no theme is present',
        );
        assert.ok(
          headContent.includes('rel="apple-touch-icon"'),
          'default apple-touch-icon link is injected into head when no theme is present',
        );
        assert.ok(
          headContent.includes('boxel-favicon.png'),
          'default favicon points to boxel-favicon.png',
        );
        assert.ok(
          headContent.includes('boxel-webclip.png'),
          'default apple-touch-icon points to boxel-webclip.png',
        );
      });

      test('non-public realm includes exactly one favicon and one apple-touch-icon', async function (assert) {
        await dbAdapter.execute(
          `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
        );

        let response = await request
          .get('/test/private-index-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let faviconCount = (response.text.match(/rel="icon"/g) || []).length;
        let appleTouchIconCount = (
          response.text.match(/rel="apple-touch-icon"/g) || []
        ).length;

        assert.strictEqual(
          faviconCount,
          1,
          'exactly one favicon link is present even without head injection',
        );
        assert.strictEqual(
          appleTouchIconCount,
          1,
          'exactly one apple-touch-icon link is present even without head injection',
        );
        assert.ok(
          response.text.includes('<title>Boxel</title>'),
          'title element is present even for non-public realm',
        );
      });

      test('missing apple-touch-icon is filled with default when only favicon is present in head HTML', async function (assert) {
        // Directly set head_html to contain only a favicon link (no apple-touch-icon).
        // The head-HTML injection reads from prerendered_html.
        let cardURL = `${testRealmURL.href}isolated-test.json`;
        let faviconHead = `'<title>Test</title><link rel="icon" href="https://example.com/custom-icon.png" type="image/png">'`;
        await dbAdapter.execute(
          `UPDATE prerendered_html
           SET head_html = ${faviconHead}
           WHERE url = '${cardURL}'
             AND type = 'instance'
             AND is_deleted IS NOT TRUE`,
        );

        let response = await request
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          headContent.includes(
            '<link rel="icon" href="https://example.com/custom-icon.png"',
          ),
          'custom favicon from head HTML is preserved',
        );
        assert.ok(
          headContent.includes('rel="apple-touch-icon"'),
          'default apple-touch-icon is injected when missing from head HTML',
        );
        assert.ok(
          headContent.includes('boxel-webclip.png'),
          'default apple-touch-icon points to boxel-webclip.png',
        );

        let faviconCount = (response.text.match(/rel="icon"/g) || []).length;
        let appleTouchIconCount = (
          response.text.match(/rel="apple-touch-icon"/g) || []
        ).length;
        assert.strictEqual(
          faviconCount,
          1,
          'exactly one favicon link (no default duplicate)',
        );
        assert.strictEqual(
          appleTouchIconCount,
          1,
          'exactly one apple-touch-icon link',
        );
      });

      test('missing favicon is filled with default when only apple-touch-icon is present in head HTML', async function (assert) {
        // The head-HTML injection reads from prerendered_html.
        let cardURL = `${testRealmURL.href}isolated-test.json`;
        let touchIconHead = `'<title>Test</title><link rel="apple-touch-icon" href="https://example.com/custom-touch.png">'`;
        await dbAdapter.execute(
          `UPDATE prerendered_html
           SET head_html = ${touchIconHead}
           WHERE url = '${cardURL}'
             AND type = 'instance'
             AND is_deleted IS NOT TRUE`,
        );

        let response = await request
          .get('/test/isolated-test')
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          headContent.includes(
            '<link rel="apple-touch-icon" href="https://example.com/custom-touch.png"',
          ),
          'custom apple-touch-icon from head HTML is preserved',
        );
        assert.ok(
          headContent.includes('rel="icon"'),
          'default favicon is injected when missing from head HTML',
        );
        assert.ok(
          headContent.includes('boxel-favicon.png'),
          'default favicon points to boxel-favicon.png',
        );

        let faviconCount = (response.text.match(/rel="icon"/g) || []).length;
        let appleTouchIconCount = (
          response.text.match(/rel="apple-touch-icon"/g) || []
        ).length;
        assert.strictEqual(faviconCount, 1, 'exactly one favicon link');
        assert.strictEqual(
          appleTouchIconCount,
          1,
          'exactly one apple-touch-icon link (no default duplicate)',
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

        let writeResponse = await request
          .post('/test/card-with-theme.json')
          .set('Accept', 'application/vnd.card+source')
          .send(cardWithThemeJSON);

        assert.strictEqual(
          writeResponse.status,
          204,
          'card-with-theme file write was accepted',
        );

        // Wait for the card's rendering to land (head_html populated, even
        // if empty string) — it arrives on the prerendered_html channel via
        // the fire-and-forget prerender_html job.
        await waitUntil(
          async () => {
            let rows = (await dbAdapter.execute(
              `SELECT url, head_html FROM prerendered_html
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

        let response = await request
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

        let faviconCount = (response.text.match(/rel="icon"/g) || []).length;
        let appleTouchIconCount = (
          response.text.match(/rel="apple-touch-icon"/g) || []
        ).length;
        assert.strictEqual(
          faviconCount,
          1,
          'exactly one favicon link in response (no duplicate from defaults)',
        );
        assert.strictEqual(
          appleTouchIconCount,
          1,
          'exactly one apple-touch-icon link in response (no duplicate from defaults)',
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

        let writeResponse = await request
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
            let rows = (await dbAdapter.execute(
              `SELECT url, head_html FROM prerendered_html
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

        let response = await request
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

        let faviconCount = (response.text.match(/rel="icon"/g) || []).length;
        let appleTouchIconCount = (
          response.text.match(/rel="apple-touch-icon"/g) || []
        ).length;
        assert.strictEqual(
          faviconCount,
          1,
          'exactly one favicon link in response (no duplicate from defaults)',
        );
        assert.strictEqual(
          appleTouchIconCount,
          1,
          'exactly one apple-touch-icon link in response (no duplicate from defaults)',
        );
      });

      test('returns 404 for request that has malformed URI', async function (assert) {
        let response = await request.get('/%c0').set('Accept', '*/*');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      });

      test('HEAD / returns 200 for non-host-mode server', async function (assert) {
        let response = await request.head('/');

        assert.strictEqual(
          response.status,
          200,
          'HEAD / returns 200 (serves host app)',
        );
        assert.ok(
          response.headers['content-type']?.includes('text/html'),
          'content type is text/html',
        );
      });

      test('preserves scoped CSS in HTML response after card enters error state', async function (assert) {
        // First verify the card is indexed successfully and scoped CSS is served
        let initialResponse = await request
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

        let writeResponse = await request
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
            let rows = (await dbAdapter.execute(
              `SELECT has_error FROM boxel_index
               WHERE url = '${testRealmURL.href}scoped-css-test.json'
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
        let errorRows = (await dbAdapter.execute(
          `SELECT has_error, last_known_good_deps FROM boxel_index
           WHERE url = '${testRealmURL.href}scoped-css-test.json'
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
        let errorStateResponse = await request
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

      // An <object>/<embed> load advertises text/html in its Accept header
      // (the browser issues it as a frame-style navigation), but it is
      // embedding a document — an app-shell answer would boot the host app
      // recursively inside the preview. The server tells these loads apart
      // from address-bar navigations by Sec-Fetch-Dest (see
      // isDocumentEmbedRequest in handlers/serve-index.ts). Service workers
      // are spec-required to bypass <object>/<embed> loads, so this
      // negotiation is only testable — and only fixable — at the wire.
      module('document embed negotiation', function () {
        // The Accept header a browser attaches both to <object>/<embed>
        // loads and to address-bar navigations — Sec-Fetch-Dest is the only
        // discriminator between them.
        const FRAME_STYLE_ACCEPT =
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';

        test('serves document bytes, not the app shell, when Sec-Fetch-Dest is embed', async function (assert) {
          let response = await request
            .get('/test/report.pdf')
            .set('Accept', FRAME_STYLE_ACCEPT)
            .set('Sec-Fetch-Dest', 'embed');

          assert.strictEqual(response.status, 200, 'serves the file');
          assert.ok(
            response.headers['content-type']?.includes('application/pdf'),
            `content type comes from the file, not the shell (got ${response.headers['content-type']})`,
          );
          assert.notOk(
            (response.text ?? '').includes('<title>'),
            'the app shell is not served to a document embed',
          );
        });

        test('serves document bytes when Sec-Fetch-Dest is object', async function (assert) {
          let response = await request
            .get('/test/report.pdf')
            .set('Accept', FRAME_STYLE_ACCEPT)
            .set('Sec-Fetch-Dest', 'object');

          assert.strictEqual(response.status, 200, 'serves the file');
          assert.ok(
            response.headers['content-type']?.includes('application/pdf'),
            `content type comes from the file, not the shell (got ${response.headers['content-type']})`,
          );
        });

        test('an address-bar navigation to the same file URL still opens the app', async function (assert) {
          let response = await request
            .get('/test/report.pdf')
            .set('Accept', FRAME_STYLE_ACCEPT)
            .set('Sec-Fetch-Dest', 'document');

          assert.strictEqual(response.status, 200, 'serves HTML response');
          assert.ok(
            response.headers['content-type']?.includes('text/html'),
            'content type is text/html',
          );
          assert.ok(
            response.text.includes('<title>'),
            'the app shell is served',
          );
        });

        test('an HTML-accepting request with no Sec-Fetch-Dest still opens the app', async function (assert) {
          let response = await request
            .get('/test/report.pdf')
            .set('Accept', FRAME_STYLE_ACCEPT);

          assert.strictEqual(response.status, 200, 'serves HTML response');
          assert.ok(
            response.headers['content-type']?.includes('text/html'),
            'content type is text/html',
          );
          assert.ok(
            response.text.includes('<title>'),
            'the app shell is served',
          );
        });
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
    let dbAdapter: DBAdapter;

    function onRealmSetup(args: {
      request: SuperTest<Test>;
      testRealm: Realm;
      dbAdapter: DBAdapter;
    }) {
      request = args.request;
      testRealm = args.testRealm;
      dbAdapter = args.dbAdapter;
    }

    setupPermissionedRealmCached(hooks, {
      // Asserts on `data-test-home-card` rendered HTML, which only
      // exists in home.gts of the `realistic` fixture.
      fixture: 'realistic',
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

    test('published realm response includes ETag and Cache-Control headers', async function (assert) {
      let response = await request
        .get('/published/')
        .set('Accept', 'text/html');

      assert.strictEqual(response.status, 200);
      assert.ok(response.headers['etag'], 'ETag header is present');
      assert.strictEqual(
        response.headers['cache-control'],
        'public, max-age=0, must-revalidate',
        'Cache-Control allows caching with revalidation',
      );
      assert.ok(
        response.headers['vary']?.includes('Accept'),
        'Vary header includes Accept',
      );
      assert.ok(
        response.headers['vary']?.includes('Sec-Fetch-Dest'),
        'Vary header includes Sec-Fetch-Dest (the shell is withheld from document embeds, so a cached copy must not satisfy them)',
      );
    });

    test('HEAD request includes ETag and Cache-Control headers', async function (assert) {
      let response = await request
        .head('/published/')
        .set('Accept', 'text/html');

      assert.strictEqual(response.status, 200);
      assert.ok(response.headers['etag'], 'ETag header is present');
      assert.strictEqual(
        response.headers['cache-control'],
        'public, max-age=0, must-revalidate',
        'Cache-Control allows caching with revalidation',
      );
    });

    test('returns 304 Not Modified when If-None-Match matches ETag', async function (assert) {
      // First request to get the ETag
      let firstResponse = await request
        .get('/published/')
        .set('Accept', 'text/html');

      assert.strictEqual(firstResponse.status, 200);
      let etag = firstResponse.headers['etag'];
      assert.ok(etag, 'first response has ETag');

      // Second request with matching If-None-Match
      let secondResponse = await request
        .get('/published/')
        .set('Accept', 'text/html')
        .set('If-None-Match', etag);

      assert.strictEqual(
        secondResponse.status,
        304,
        'returns 304 when ETag matches',
      );
      assert.strictEqual(
        secondResponse.headers['etag'],
        etag,
        '304 response includes the ETag',
      );
      assert.strictEqual(
        secondResponse.headers['cache-control'],
        'public, max-age=0, must-revalidate',
        '304 response includes Cache-Control',
      );
    });

    test('returns 200 when If-None-Match does not match ETag', async function (assert) {
      let response = await request
        .get('/published/')
        .set('Accept', 'text/html')
        .set('If-None-Match', '"stale-etag-value"');

      assert.strictEqual(
        response.status,
        200,
        'returns 200 when ETag does not match',
      );
      assert.ok(response.headers['etag'], 'response includes a fresh ETag');
      assert.notStrictEqual(
        response.headers['etag'],
        '"stale-etag-value"',
        'fresh ETag differs from the stale one',
      );
    });

    test('ETag changes after republishing', async function (assert) {
      let firstResponse = await request
        .get('/published/')
        .set('Accept', 'text/html');

      let firstEtag = firstResponse.headers['etag'];
      assert.ok(firstEtag, 'first response has ETag');

      // Simulate a republish by updating last_published_at on the
      // realm_registry row (the source of truth for reads).
      let newLastPublishedAt = Date.now() + 1000;
      await dbAdapter.execute(
        `UPDATE realm_registry SET last_published_at = ${newLastPublishedAt}, updated_at = now() WHERE url = '${realmURL.href}' AND kind = 'published'`,
      );

      let secondResponse = await request
        .get('/published/')
        .set('Accept', 'text/html');

      assert.strictEqual(secondResponse.status, 200);
      assert.notStrictEqual(
        secondResponse.headers['etag'],
        firstEtag,
        'ETag changes after republish',
      );
    });
  });

  // This module exercises publishing a realm where a card's cardInfo.theme
  // linksTo a BrandGuide that lives in the same realm. The themed-card's
  // attributes must include a cardInfo key (even if empty) so that the
  // cardInfo.theme relationship has a container field to attach to;
  // without it the theme resolves to null and the head template
  // (packages/base/default-templates/head.gts) renders without icon links.
  module(
    'Published realm: theme icon links after _publish-realm',
    function (hooks) {
      let testRealmHttpServer: Server;
      let testRealmServer: Awaited<
        ReturnType<typeof runTestRealmServer>
      >['testRealmServer'];
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;
      let dir: DirResult;
      let sourceRealmUrlString: string;
      let publishedRealmURLString: string;
      let publishedRealmHost: string;
      let publishedRealmPath: string;
      let ownerUserId = '@mango:localhost';

      hooks.beforeEach(function (assert) {
        // QUnit arms one timeout per hook promise, so the whole publish setup
        // below — realm boot, the writes, the from-scratch index, and the
        // render — shares a single window, and the suite-wide
        // `QUnit.config.testTimeout` is too small to hold it. Raise it past
        // the waits inside that hook so their timeout messages, which name the
        // stage that stalled, are what a failure reports rather than QUnit's
        // stageless "test timed out".
        assert.timeout(PUBLISHED_REALM_SETUP_TIMEOUT_MS);
        dir = dirSync();
      });
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, _publisher, _runner) => {
          dbAdapter = _dbAdapter;
          let virtualNetwork = createVirtualNetwork();
          let testRealmDir = join(dir.name, 'realm_server_theme', 'test');
          ensureDirSync(testRealmDir);
          ({ testRealmHttpServer, testRealmServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            fileSystem: {},
            realmsRootPath: join(dir.name, 'realm_server_theme'),
            realmURL: new URL('http://127.0.0.1:4444/test/'),
            dbAdapter: _dbAdapter,
            publisher: _publisher,
            runner: _runner,
            matrixURL,
            permissions: {
              '*': ['read', 'write'],
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            domainsForPublishedRealms: {
              boxelSpace: 'localhost',
              boxelSite: 'localhost:4444',
            },
          }));
          request = supertest(testRealmHttpServer);

          // Create a publishable source realm
          let endpoint = 'theme-source';
          let createResponse = await request
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: { name: 'Theme Source Realm', endpoint },
                },
              }),
            );

          if (createResponse.status !== 202) {
            throw new Error(
              `/_create-realm failed with status ${createResponse.status}: ` +
                (createResponse.text ||
                  (createResponse.body
                    ? JSON.stringify(createResponse.body)
                    : '')),
            );
          }

          sourceRealmUrlString = createResponse.body.data.id;
          let sourceRealmPath = new URL(sourceRealmUrlString).pathname;

          // Make the source realm publicly accessible
          await _dbAdapter.execute(`
            INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
            VALUES ('${sourceRealmUrlString}', '*', true, true, true)
          `);

          // Write a BrandGuide theme card with a custom icon
          let themeResponse = await request
            .post(`${sourceRealmPath}brand-guide-theme.json`)
            .set('Accept', 'application/vnd.card+source')
            .send(
              JSON.stringify({
                data: {
                  type: 'card',
                  id: `${sourceRealmUrlString}brand-guide-theme`,
                  attributes: {
                    markUsage: {
                      socialMediaProfileIcon:
                        'https://example.com/published-theme-icon.png',
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '@cardstack/base/brand-guide',
                      name: 'default',
                    },
                  },
                },
              }),
            );
          if (themeResponse.status !== 204) {
            throw new Error(
              `Failed to write brand-guide-theme: ${themeResponse.status} ${themeResponse.text}`,
            );
          }

          // Write a card that links to the BrandGuide via cardInfo.theme
          let cardResponse = await request
            .post(`${sourceRealmPath}themed-card.json`)
            .set('Accept', 'application/vnd.card+source')
            .send(
              JSON.stringify({
                data: {
                  type: 'card',
                  id: `${sourceRealmUrlString}themed-card`,
                  attributes: { cardInfo: {} },
                  relationships: {
                    'cardInfo.theme': {
                      links: {
                        self: `${sourceRealmUrlString}brand-guide-theme`,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '@cardstack/base/card-api',
                      name: 'CardDef',
                    },
                  },
                },
              }),
            );
          if (cardResponse.status !== 204) {
            throw new Error(
              `Failed to write themed-card: ${cardResponse.status} ${cardResponse.text}`,
            );
          }

          // Publish the source realm — this triggers a full from-scratch reindex
          publishedRealmURLString =
            'http://themetest.localhost:4444/theme-source/';
          publishedRealmHost = new URL(publishedRealmURLString).host;
          publishedRealmPath = new URL(publishedRealmURLString).pathname;

          let publishResponse = await request
            .post('/_publish-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                sourceRealmURL: sourceRealmUrlString,
                publishedRealmURL: publishedRealmURLString,
              }),
            );
          if (publishResponse.status !== 202) {
            throw new Error(
              `Failed to publish realm: ${publishResponse.status} ${publishResponse.text}`,
            );
          }

          // `_publish-realm` returns 202 before indexing finishes. Drive a
          // reconcile pass to mount the published realm, then wait for it to
          // report ready, so the assertions below query indexed, rendered
          // content.
          await testRealmServer.testingOnlyReconcile();
          await waitForPublishedRealmReady(
            request,
            dbAdapter,
            publishedRealmURLString,
            publishedRealmPath,
            publishedRealmHost,
          );
          // Readiness clears once every row's HTML is live for its generation;
          // the job that wrote it finalizes a moment later. Settle the channel
          // so the assertions never race that tail, and so a render that
          // rejected fails here instead of surfacing as a missing-markup
          // assertion.
          await settlePrerenderHtmlJobs(dbAdapter, publishedRealmURLString);
        },
        afterEach: async () => {
          await closeServer(testRealmHttpServer);
        },
      });

      // CS-10228: The themed-card's attributes must include a cardInfo key so
      // that the cardInfo.theme linksTo relationship resolves. Without it the
      // head template renders without icon links and the server falls back to
      // default boxel icons instead of the theme's socialMediaProfileIcon.
      test('themed card in published realm includes theme icon links in head HTML', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}themed-card`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'serves HTML response');

        let headMatch = response.text.match(
          /data-boxel-head-start[^>]*>([\s\S]*?)data-boxel-head-end/,
        );
        let headContent = headMatch?.[1] ?? '';

        assert.ok(
          headContent.includes(
            '<link rel="icon" href="https://example.com/published-theme-icon.png"',
          ),
          `head HTML includes favicon from BrandGuide theme. headContent=${headContent.substring(0, 500)}`,
        );
        assert.ok(
          headContent.includes(
            '<link rel="apple-touch-icon" href="https://example.com/published-theme-icon.png"',
          ),
          `head HTML includes apple-touch-icon from BrandGuide theme`,
        );

        // Verify the pristine_doc preserves the theme relationship
        let rows = (await dbAdapter.execute(
          `SELECT pristine_doc::text FROM boxel_index
           WHERE url LIKE '%themed-card%'
             AND realm_url = '${publishedRealmURLString}'
             AND type = 'instance'
             AND is_deleted IS NOT TRUE
           LIMIT 1`,
        )) as { pristine_doc: string }[];

        assert.ok(rows.length > 0, 'themed-card instance entry exists');

        let pristineDoc = JSON.parse(rows[0].pristine_doc);
        let themeRel =
          pristineDoc?.relationships?.['cardInfo.theme']?.links?.self;
        assert.ok(
          themeRel,
          `pristine_doc preserves the cardInfo.theme relationship URL (got ${themeRel})`,
        );
      });
    },
  );

  // Host routing rules must resolve a bare sub-path (e.g. /pricing) as well
  // as the trailing-slash form, and canonicalize between them. The bug: the
  // bare form 404'd for generic (non-text/html) Accept
  // headers — crawlers, link-unfurlers, curl — because serve-index bailed to
  // the module resolver when the path wasn't itself an indexed card
  // instance, without first consulting the routing map. The trailing-slash
  // form took the directory-index branch and rendered. This module publishes
  // a realm whose routed instance lives in a subdirectory (its id therefore
  // does NOT equal the routed path, so the card-id fallback cannot mask the
  // bug) and asserts both forms plus the 308 canonical redirect.
  module(
    'Published realm: host routing rules + trailing-slash canonicalization',
    function (hooks) {
      let testRealmHttpServer: Server;
      let testRealmServer: Awaited<
        ReturnType<typeof runTestRealmServer>
      >['testRealmServer'];
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;
      let dir: DirResult;
      let sourceRealmUrlString: string;
      let publishedRealmURLString: string;
      let publishedRealmHost: string;
      let publishedRealmPath: string;
      let ownerUserId = '@mango:localhost';

      hooks.beforeEach(function (assert) {
        // Same single-window-per-hook reasoning as the theme module above.
        assert.timeout(PUBLISHED_REALM_SETUP_TIMEOUT_MS);
        dir = dirSync();
      });
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, _publisher, _runner) => {
          dbAdapter = _dbAdapter;
          let virtualNetwork = createVirtualNetwork();
          let testRealmDir = join(dir.name, 'realm_server_routing', 'test');
          ensureDirSync(testRealmDir);
          ({ testRealmHttpServer, testRealmServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            fileSystem: {},
            realmsRootPath: join(dir.name, 'realm_server_routing'),
            realmURL: new URL('http://127.0.0.1:4444/test/'),
            dbAdapter: _dbAdapter,
            publisher: _publisher,
            runner: _runner,
            matrixURL,
            permissions: {
              '*': ['read', 'write'],
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
            domainsForPublishedRealms: {
              boxelSpace: 'localhost',
              boxelSite: 'localhost:4444',
            },
          }));
          request = supertest(testRealmHttpServer);

          // Create a publishable source realm.
          let endpoint = 'routing-source';
          let createResponse = await request
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: { name: 'Routing Source Realm', endpoint },
                },
              }),
            );
          if (createResponse.status !== 202) {
            throw new Error(
              `/_create-realm failed with status ${createResponse.status}: ` +
                (createResponse.text ||
                  (createResponse.body
                    ? JSON.stringify(createResponse.body)
                    : '')),
            );
          }

          sourceRealmUrlString = createResponse.body.data.id;
          let sourceRealmPath = new URL(sourceRealmUrlString).pathname;

          // Make the source realm publicly readable.
          await _dbAdapter.execute(`
            INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
            VALUES ('${sourceRealmUrlString}', '*', true, true, true)
          `);

          // The routed instance lives in a subdirectory. Its id is
          // <realm>/pages/pricing, which is deliberately NOT the routed path
          // (<realm>/pricing) — so a 200 on /pricing can only come from the
          // routing map, never from the card-id fallback.
          let instanceResponse = await request
            .post(`${sourceRealmPath}pages/pricing.json`)
            .set('Accept', 'application/vnd.card+source')
            .send(
              JSON.stringify({
                data: {
                  type: 'card',
                  id: `${sourceRealmUrlString}pages/pricing`,
                  attributes: { cardInfo: { name: 'Pricing' } },
                  meta: {
                    adoptsFrom: {
                      module: '@cardstack/base/card-api',
                      name: 'CardDef',
                    },
                  },
                },
              }),
            );
          if (instanceResponse.status !== 204) {
            throw new Error(
              `Failed to write pages/pricing: ${instanceResponse.status} ${instanceResponse.text}`,
            );
          }

          // Overwrite realm.json with a routing rule mapping the bare
          // sub-path /pricing to the subdirectory instance. Writing realm.json
          // re-indexes the RealmConfig card, so the routing map picks the rule
          // up (and, after publish, the published realm's own index does too).
          let realmConfigResponse = await request
            .post(`${sourceRealmPath}realm.json`)
            .set('Accept', 'application/vnd.card+source')
            .send(
              JSON.stringify({
                data: {
                  type: 'card',
                  attributes: {
                    cardInfo: { name: 'Routing Source Realm' },
                    hostRoutingRules: [
                      { path: '/' },
                      { path: '/pricing' },
                      // Redirect rules: a realm-relative target using
                      // the default status code, and an external
                      // target with an explicit permanent code.
                      { path: '/tos', redirectTo: '/terms' },
                      {
                        path: '/external',
                        redirectTo: 'https://example.com/landing',
                        statusCode: 301,
                      },
                    ],
                  },
                  relationships: {
                    'hostRoutingRules.0.instance': {
                      links: { self: './index' },
                    },
                    'hostRoutingRules.1.instance': {
                      links: { self: './pages/pricing' },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '@cardstack/base/realm-config',
                      name: 'RealmConfig',
                    },
                  },
                },
              }),
            );
          if (realmConfigResponse.status !== 204) {
            throw new Error(
              `Failed to write realm.json: ${realmConfigResponse.status} ${realmConfigResponse.text}`,
            );
          }

          // Publish the source realm — triggers a full from-scratch reindex of
          // the published copy.
          publishedRealmURLString =
            'http://routingtest.localhost:4444/routing-source/';
          publishedRealmHost = new URL(publishedRealmURLString).host;
          publishedRealmPath = new URL(publishedRealmURLString).pathname;

          let publishResponse = await request
            .post('/_publish-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                sourceRealmURL: sourceRealmUrlString,
                publishedRealmURL: publishedRealmURLString,
              }),
            );
          if (publishResponse.status !== 202) {
            throw new Error(
              `Failed to publish realm: ${publishResponse.status} ${publishResponse.text}`,
            );
          }

          await testRealmServer.testingOnlyReconcile();
          await waitForPublishedRealmReady(
            request,
            dbAdapter,
            publishedRealmURLString,
            publishedRealmPath,
            publishedRealmHost,
          );
          // Readiness clears once every row's HTML is live for its generation;
          // the job that wrote it finalizes a moment later. Settle the channel
          // so the assertions never race that tail, and so a render that
          // rejected fails here instead of surfacing as a wrong-status
          // assertion.
          await settlePrerenderHtmlJobs(dbAdapter, publishedRealmURLString);
        },
        afterEach: async () => {
          await closeServer(testRealmHttpServer);
        },
      });

      test('bare routed sub-path serves HTML for a generic Accept header (regression: was 404)', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}pricing`)
          .set('Host', publishedRealmHost)
          .set('Accept', '*/*');

        assert.strictEqual(
          response.status,
          200,
          `bare /pricing serves for */* (was 404 via the module resolver). body=${response.text?.slice(
            0,
            300,
          )}`,
        );
      });

      test('bare routed sub-path serves HTML for text/html', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}pricing`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200, 'bare /pricing serves HTML');
      });

      test('trailing-slash form 308-redirects to the canonical bare form', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}pricing/`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 308, '/pricing/ is redirected');
        let location = response.headers['location'] ?? '';
        assert.true(
          location.endsWith(`${publishedRealmPath}pricing`),
          `redirect strips the trailing slash (location=${location})`,
        );
        assert.false(
          location.endsWith('/pricing/'),
          `redirect target has no trailing slash (location=${location})`,
        );
      });

      test('trailing-slash form is also canonicalized for a generic Accept header', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}pricing/`)
          .set('Host', publishedRealmHost)
          .set('Accept', '*/*');

        assert.strictEqual(
          response.status,
          308,
          '/pricing/ is redirected for */* too',
        );
      });

      test('a redirect rule with a realm-relative target answers the default 302, resolved against the realm mount', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}tos`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(
          response.status,
          302,
          'redirect rule answers its (default) status code',
        );
        assert.strictEqual(
          response.headers['location'],
          `http://${publishedRealmHost}${publishedRealmPath}terms`,
          'relative target resolves against the realm mount pathname',
        );
      });

      test('a redirect rule fires from the trailing-slash form in one hop', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}tos/`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        // The declared redirect wins over trailing-slash canonicalization —
        // a 308 to /tos first would cost the client a second round-trip.
        assert.strictEqual(
          response.status,
          302,
          'trailing-slash form redirects straight to the target, not via a canonicalizing 308',
        );
        assert.strictEqual(
          response.headers['location'],
          `http://${publishedRealmHost}${publishedRealmPath}terms`,
          'same target as the bare form',
        );
      });

      test('a redirect rule carries the request query string over to a target without its own', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}tos?utm_source=newsletter`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 302);
        assert.strictEqual(
          response.headers['location'],
          `http://${publishedRealmHost}${publishedRealmPath}terms?utm_source=newsletter`,
          'query string is preserved on the redirect target',
        );
      });

      test('a redirect rule does not hand the host app’s own query params to its target', async function (assert) {
        // `sid` / `clientSecret` are password-reset tokens, and this
        // target is a third-party site. The SPA drops the same list on
        // its in-app navigation, so both answer the same URL.
        let response = await request
          .get(
            `${publishedRealmPath}external?sid=secret-token&clientSecret=secret-secret&utm_source=newsletter`,
          )
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 301);
        assert.strictEqual(
          response.headers['location'],
          'https://example.com/landing?utm_source=newsletter',
          'only the foreign param rides along',
        );
      });

      test('a redirect rule drops a query string made up entirely of the host app’s params', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}tos?hostModeStack=%5B%5D`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 302);
        assert.strictEqual(
          response.headers['location'],
          `http://${publishedRealmHost}${publishedRealmPath}terms`,
          'no empty ? is appended when nothing survives filtering',
        );
      });

      test('a redirect rule may target an external URL with an explicit status code', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}external`)
          .set('Host', publishedRealmHost)
          .set('Accept', '*/*');

        assert.strictEqual(
          response.status,
          301,
          'the authored status code is used',
        );
        assert.strictEqual(
          response.headers['location'],
          'https://example.com/landing',
          'external target is emitted verbatim',
        );
      });

      test('redirect rules are injected into the host config routing map', async function (assert) {
        let response = await request
          .get(`${publishedRealmPath}pricing`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        assert.strictEqual(response.status, 200);
        // The routing map rides the URL-encoded config meta tag; letters
        // are not percent-encoded, so the discriminant field name is
        // directly visible in the served HTML.
        assert.true(
          response.text.includes('redirectTo'),
          'the injected hostRoutingMap carries the redirect rules',
        );
      });

      test('a non-public realm does not disclose routes via a canonical redirect', async function (assert) {
        // Drop the published realm's permissions so it is no longer publicly
        // readable. `fetchRealmPermissions` reads this table uncached, so the
        // next request sees the change immediately.
        await dbAdapter.execute(
          `DELETE FROM realm_user_permissions WHERE realm_url = '${publishedRealmURLString}'`,
        );

        let response = await request
          .get(`${publishedRealmPath}pricing/`)
          .set('Host', publishedRealmHost)
          .set('Accept', 'text/html');

        // The public-permission gate runs before the routing-map lookup, so a
        // non-public realm falls through to the generic Boxel shell instead of
        // emitting a route-specific 308 that would reveal the private route
        // exists.
        assert.notStrictEqual(
          response.status,
          308,
          'no route-specific redirect is emitted for a non-public realm',
        );
        assert.strictEqual(
          response.status,
          200,
          'serves the generic shell for a non-public realm',
        );
      });

      test('a non-public realm does not disclose bare routes to a generic Accept header', async function (assert) {
        await dbAdapter.execute(
          `DELETE FROM realm_user_permissions WHERE realm_url = '${publishedRealmURLString}'`,
        );

        // The bare-path gate consults the routing map for */* requests; if it
        // did so without checking public read, a real route would answer 200
        // (generic shell) while a non-route 404s — enumerating private routes.
        let routed = await request
          .get(`${publishedRealmPath}pricing`) // a real rule
          .set('Host', publishedRealmHost)
          .set('Accept', '*/*');
        let bogus = await request
          .get(`${publishedRealmPath}not-a-route`) // no rule
          .set('Host', publishedRealmHost)
          .set('Accept', '*/*');

        assert.strictEqual(
          routed.status,
          bogus.status,
          `a routed and a non-routed bare path are indistinguishable on a non-public realm (routed=${routed.status}, bogus=${bogus.status})`,
        );
      });
    },
  );
});
