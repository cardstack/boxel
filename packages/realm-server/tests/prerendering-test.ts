import { module, test } from 'qunit';
import { basename } from 'path';
import type {
  RealmPermissions,
  Realm,
  RealmAdapter,
  RenderResponse,
} from '@cardstack/runtime-common';
import { Prerenderer } from '../prerender/index';

import {
  setupBaseRealmServer,
  setupPermissionedRealms,
  matrixURL,
  realmSecretSeed,
  cleanWhiteSpace,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import {
  baseCardRef,
  trimExecutableExtension,
} from '@cardstack/runtime-common';

module.only(basename(__filename), function () {
  module('prerender - dynamic tests', function (hooks) {
    let realmURL = 'http://127.0.0.1:4450/';
    let prerenderServerURL = realmURL.endsWith('/')
      ? realmURL.slice(0, -1)
      : realmURL;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;
    let realmAdapter: RealmAdapter;
    let realm: Realm;

    hooks.before(async () => {
      prerenderer = new Prerenderer({
        secretSeed: realmSecretSeed,
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.afterEach(async () => {
      await prerenderer.disposeRealm(realmURL);
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      realms: [
        {
          realmURL,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
              export class Person extends CardDef {
                static displayName = "Person";
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  <template>{{@model.name}}</template>
                }
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Maple',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms: setupRealms }) {
        ({ realm, realmAdapter } = setupRealms[0]);
        permissions = {
          [realmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('reuses pooled page and picks up updated instance', async function (assert) {
      const cardURL = `${realmURL}1`;

      let first = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        userId: testUserId,
        permissions,
      });

      assert.false(first.pool.reused, 'first call not reused');
      assert.false(first.pool.evicted, 'first call not evicted');
      assert.strictEqual(
        first.response.serialized?.data.attributes?.name,
        'Maple',
        'first render sees original value',
      );

      await realmAdapter.write(
        '1.json',
        JSON.stringify(
          {
            data: {
              attributes: {
                name: 'Juniper',
              },
              meta: {
                adoptsFrom: {
                  module: './person',
                  name: 'Person',
                },
              },
            },
          },
          null,
          2,
        ),
      );

      await realm.realmIndexUpdater.fullIndex();
      realm.__testOnlyClearCaches();

      let second = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        userId: testUserId,
        permissions,
      });

      assert.true(second.pool.reused, 'second call reused pooled page');
      assert.false(second.pool.evicted, 'second call not evicted');
      assert.strictEqual(
        second.pool.pageId,
        first.pool.pageId,
        'same page reused',
      );
      assert.strictEqual(
        second.response.serialized?.data.attributes?.name,
        'Juniper',
        'second render picks up updated value',
      );
    });

    test('prerenderModule returns module metadata', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let result = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
      });

      assert.false(result.pool.reused, 'first module render not reused');
      assert.strictEqual(
        result.response.status,
        'ready',
        'module marked ready',
      );
      let key = `${trimExecutableExtension(new URL(moduleURL)).href}/Person`;
      let entry = result.response.definitions[key];
      assert.ok(entry, 'definition captured');
      assert.strictEqual(
        entry?.type,
        'definition',
        'definition entry type correct',
      );
      if (entry?.type === 'definition') {
        assert.ok(entry.definition.displayName, 'display name present');
      } else {
        assert.ok(false, 'module definition should be present');
      }
    });

    test('module prerender reuses pooled page after updates', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let first = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
      });

      assert.false(first.pool.reused, 'first module render not reused');

      await realmAdapter.write(
        'person.gts',
        `
          import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
          export class Person extends CardDef {
            static displayName = "Updated Person";
            @field name = contains(StringField);
            static isolated = class extends Component<typeof this> {
              <template>{{@model.name}}</template>
            }
          }
        `,
      );
      realm.__testOnlyClearCaches(); // out write bypasses the index so we need to manually flush the realm cache

      let second = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
        renderOptions: { clearCache: true },
      });

      assert.true(
        second.pool.reused,
        'second module render reused pooled page',
      );
      assert.strictEqual(
        first.pool.pageId,
        second.pool.pageId,
        'same page reused',
      );
      let key = `${trimExecutableExtension(new URL(moduleURL)).href}/Person`;
      let entry = second.response.definitions[key];
      assert.ok(entry, 'updated module definition entry present');
      assert.strictEqual(
        entry?.type,
        'definition',
        'updated module definition entry correct',
      );
      if (entry?.type === 'definition') {
        assert.strictEqual(
          entry.definition.displayName,
          'Updated Person',
          'updated module definition observed',
        );
      } else {
        assert.ok(false, 'updated module definition entry should be present');
      }
    });

    test('module prerender surfaces syntax errors', async function (assert) {
      const modulePath = 'person.gts';
      const moduleURL = `${realmURL}${modulePath}`;

      await realmAdapter.write(modulePath, 'export const Broken = ;');
      realm.__testOnlyClearCaches();

      let result = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
      });

      assert.strictEqual(
        result.response.status,
        'error',
        'module render errored',
      );
      assert.strictEqual(
        result.response.error?.error.status,
        406,
        'syntax error surfaces as 406',
      );
      assert.false(result.pool.evicted, 'page not evicted for syntax error');
    });

    test('module prerender evicts pooled page on timeout', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let first = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
      });
      assert.false(first.pool.reused, 'initial module render not reused');
      assert.false(first.pool.evicted, 'initial module render not evicted');

      let timedOut = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
        opts: { timeoutMs: 1, simulateTimeoutMs: 25 },
      });

      assert.strictEqual(
        timedOut.response.status,
        'error',
        'timeout returns error response',
      );
      assert.strictEqual(
        timedOut.response.error?.error.title,
        'Render timeout',
        'timeout surfaces render timeout title',
      );
      assert.strictEqual(
        timedOut.response.error?.error.status,
        504,
        'timeout surfaces 504 status',
      );
      assert.true(timedOut.pool.timedOut, 'timeout flagged on pool');
      assert.true(timedOut.pool.evicted, 'pool evicted after timeout');
      assert.notStrictEqual(
        timedOut.pool.pageId,
        'unknown',
        'timeout retains page identifier',
      );

      let afterTimeout = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
      });
      assert.false(
        afterTimeout.pool.reused,
        'timeout eviction prevents reuse on next render',
      );
      assert.false(afterTimeout.pool.evicted, 'no eviction on recovery render');
      assert.false(afterTimeout.pool.timedOut, 'no timeout after recovery');
      assert.strictEqual(
        afterTimeout.response.status,
        'ready',
        'subsequent render succeeds',
      );
    });
  });

  module('prerender - permissioned auth failures', function (hooks) {
    let providerRealmURL = 'http://127.0.0.1:4451/';
    let consumerRealmURL = 'http://127.0.0.1:4452/';
    let prerenderServerURL = consumerRealmURL.endsWith('/')
      ? consumerRealmURL.slice(0, -1)
      : consumerRealmURL;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;

    hooks.before(async () => {
      prerenderer = new Prerenderer({
        secretSeed: realmSecretSeed,
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.afterEach(async () => {
      await Promise.all([
        prerenderer.disposeRealm(providerRealmURL),
        prerenderer.disposeRealm(consumerRealmURL),
      ]);
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      mode: 'before',
      realms: [
        {
          realmURL: providerRealmURL,
          permissions: {
            // consumer's matrix user is not authorized to read
            nobody: ['read', 'write'],
          },
          fileSystem: {
            'article.gts': `
              import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Article extends CardDef {
                @field title = contains(StringField);
              }
            `,
            'secret.json': {
              data: {
                attributes: {
                  title: 'Top Secret',
                },
                meta: {
                  adoptsFrom: {
                    module: './article',
                    name: 'Article',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: consumerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'website.gts': `
              import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
              import { Article } from "${providerRealmURL}article" // importing from another realm;
              export class Website extends CardDef {
                @field linkedArticle = linksTo(Article);
              }
            `,
            'website-1.json': {
              data: {
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: './website',
                    name: 'Website',
                  },
                },
              },
            },
            'auth-proxy.gts': `
              import { contains, field, CardDef, linksTo, Component } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              // define a local stand-in type so the consumer realm doesn't need to import provider modules
              export class RemoteArticle extends CardDef {
                @field title = contains(StringField);
              }
              export class AuthProxy extends CardDef {
                @field linkedArticle = linksTo(RemoteArticle);
                @field articleTitle = contains(StringField, {
                  computeVia(this: AuthProxy) {
                    return this.linkedArticle?.title;
                  },
                });
                static isolated = class extends Component<typeof this> {
                  <template>
                    <@fields.articleTitle />
                  </template>
                }
              }
            `,
            'auth-proxy-1.json': {
              data: {
                attributes: {},
                relationships: {
                  linkedArticle: {
                    links: {
                      self: `${providerRealmURL}secret`,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './auth-proxy',
                    name: 'AuthProxy',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup() {
        permissions = {
          [consumerRealmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('module prerender surfaces auth error without timing out', async function (assert) {
      const moduleURL = `${consumerRealmURL}website.gts`;

      let result = await prerenderer.prerenderModule({
        realm: consumerRealmURL,
        url: moduleURL,
        userId: testUserId,
        permissions,
      });

      assert.ok(
        result.response.error,
        'auth failure returns an error response',
      );
      let status = result.response.error?.error.status;
      assert.strictEqual(status, 401, 'auth error status should be 401');
      assert.notStrictEqual(
        result.response.error?.error.title,
        'Render timeout',
        'auth failure is not reported as a timeout',
      );
      assert.false(
        result.pool.timedOut,
        'auth failure should not mark prerender as timed out',
      );
      assert.false(
        result.pool.evicted,
        'auth failure should not evict prerender page',
      );
    });

    test('card prerender surfaces auth error without timing out', async function (assert) {
      const cardURL = `${consumerRealmURL}auth-proxy-1`;

      let result = await prerenderer.prerenderCard({
        realm: consumerRealmURL,
        url: cardURL,
        userId: testUserId,
        permissions,
      });

      assert.ok(
        result.response.error,
        'auth failure returns an error response',
      );
      let status = result.response.error?.error.status;
      assert.strictEqual(status, 401, 'auth error status should be 401');
      assert.notStrictEqual(
        result.response.error?.error.title,
        'Render timeout',
        'auth failure is not reported as a timeout',
      );
      assert.false(
        result.pool.timedOut,
        'auth failure should not mark prerender as timed out',
      );
      assert.false(
        result.pool.evicted,
        'auth failure should not evict prerender page',
      );
    });

    test('card prerender surfaces auth error from linked fetch', async function (assert) {
      const cardURL = `${consumerRealmURL}auth-proxy-1`;

      let result = await prerenderer.prerenderCard({
        realm: consumerRealmURL,
        url: cardURL,
        userId: testUserId,
        permissions,
      });

      assert.ok(result.response.error, 'auth failure returns an error');
      assert.strictEqual(
        result.response.error?.error.status,
        401,
        'linked fetch auth error surfaces as 401',
      );
      assert.notStrictEqual(
        result.response.error?.error.title,
        'Render timeout',
        'auth failure not misreported as timeout',
      );
      assert.false(result.pool.timedOut, 'prerender did not time out');
    });
  });

  module('prerender - static tests', function (hooks) {
    let realmURL1 = 'http://127.0.0.1:4447/';
    let realmURL2 = 'http://127.0.0.1:4448/';
    let realmURL3 = 'http://127.0.0.1:4449/';
    let prerenderServerURL = realmURL1.endsWith('/')
      ? realmURL1.slice(0, -1)
      : realmURL1;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;
    const disposeAllRealms = async () => {
      await Promise.all([
        prerenderer.disposeRealm(realmURL1),
        prerenderer.disposeRealm(realmURL2),
        prerenderer.disposeRealm(realmURL3),
      ]);
    };

    hooks.before(async () => {
      prerenderer = new Prerenderer({
        secretSeed: realmSecretSeed,
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });
    hooks.after(async () => {
      await prerenderer.stop();
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      mode: 'before',
      realms: [
        {
          realmURL: realmURL1,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class Person extends CardDef {
                static displayName = "Person";
                @field name = contains(StringField);
                static fitted = <template><@fields.name/></template>
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Hassan',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: realmURL2,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'broken-card.gts': `
              import {
            `,
            'broken.json': {
              data: {
                attributes: {
                  name: 'Broken',
                },
                meta: {
                  adoptsFrom: {
                    module: './broken-card',
                    name: 'Broken',
                  },
                },
              },
            },
            'cat.gts': `
              import { CardDef, field, contains, linksTo, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';
              export class Cat extends CardDef {
                @field name = contains(StringField);
                @field owner = linksTo(Person);
                static displayName = "Cat";
                static embedded = <template>{{@fields.name}} says Meow. owned by <@fields.owner /></template>
              }
            `,
            'dog.gts': `
              import { CardDef, field, contains, linksTo, StringField, Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';
              export class Dog extends CardDef {
                static displayName = "Dog";
                @field name = contains(StringField);
                @field owner = linksTo(Person, { isUsed: true });
                static isolated = class extends Component<typeof this> {
                  // owner is intentionally not in isolated template, this is included in search doc via isUsed=true
                  <template>{{@model.name}}</template>
                }
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Maple',
                },
                relationships: {
                  owner: {
                    links: { self: `${realmURL1}1` },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './cat',
                    name: 'Cat',
                  },
                },
              },
            },
            'is-used.json': {
              data: {
                attributes: {
                  name: 'Mango',
                },
                relationships: {
                  owner: {
                    links: { self: `${realmURL1}1` },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './dog',
                    name: 'Dog',
                  },
                },
              },
            },
            'missing-link.json': {
              data: {
                attributes: {
                  name: 'Missing Owner',
                },
                relationships: {
                  owner: {
                    links: { self: `${realmURL1}missing-owner` },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './cat',
                    name: 'Cat',
                  },
                },
              },
            },
            'fetch-failed.json': {
              data: {
                attributes: {
                  name: 'Missing Owner',
                },
                relationships: {
                  owner: {
                    links: {
                      self: 'http://localhost:9000/this-is-a-link-to-nowhere',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './cat',
                    name: 'Cat',
                  },
                },
              },
            },
            'intentional-error.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class IntentionalError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Intentional Error";
                static isolated = class extends Component {
                  get message() {
                    if (this.args.model.name === 'Intentional Error') {
                      throw new Error('intentional failure during render')
                    }
                    return this.args.model.name;
                  }
                  <template>{{this.message}}</template>
                }
              }
            `,
            '2.json': {
              data: {
                attributes: {
                  name: 'Intentional Error',
                },
                meta: {
                  adoptsFrom: {
                    module: './intentional-error',
                    name: 'IntentionalError',
                  },
                },
              },
            },
            // A card that fires the boxel-render-error event (handled by the prerender route)
            // and then blocks the event loop long enough that Ember health probe times out,
            // causing data-prerender-status to be set to 'unusable' by the error handler without
            // transitioning to the render-error route (so nothing overwrites our dataset).
            'unusable-error.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class UnusableError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Unusable Error";
                static isolated = class extends Component {
                  get trigger() {
                    throw new Error('forced unusable for test');
                  }
                  <template>{{this.trigger}}</template>
                }
              }
            `,
            '3.json': {
              data: {
                attributes: {
                  name: 'Force Unusable',
                },
                meta: {
                  adoptsFrom: {
                    module: './unusable-error',
                    name: 'UnusableError',
                  },
                },
              },
            },
            'embedded-error.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              export class EmbeddedError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Embedded Error";
                static isolated = <template>
  <pre data-prerender-error>
  {
    "type": "error",
    "error": {
      "id": "embedded-error",
      "status": 500,
      "title": "Embedded error",
      "message": "error flagged from DOM",
      "additionalErrors": null
    }
  }
  </pre>
</template>
              }
            `,
            '4.json': {
              data: {
                attributes: {
                  name: 'Embedded Error',
                },
                meta: {
                  adoptsFrom: {
                    module: './embedded-error',
                    name: 'EmbeddedError',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: realmURL3,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'dog.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class Dog extends CardDef {
                @field name = contains(StringField);
                static displayName = "Dog";
                static embedded = <template>{{@fields.name}} wags tail</template>
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Taro',
                },
                meta: {
                  adoptsFrom: {
                    module: './dog',
                    name: 'Dog',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup: () => {
        permissions = {
          [realmURL1]: ['read', 'write', 'realm-owner'],
          [realmURL2]: ['read', 'write', 'realm-owner'],
          [realmURL3]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    module('basics', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
      let result: RenderResponse;

      hooks.before(async () => {
        const testCardURL = `${realmURL2}1`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        result = response;
      });

      test('embedded HTML', function (assert) {
        assert.ok(
          /Maple\s+says\s+Meow/.test(
            cleanWhiteSpace(result.embeddedHTML![`${realmURL2}cat/Cat`]),
          ),
          `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
        );
      });

      test('parent embedded HTML', function (assert) {
        assert.ok(
          /data-test-card-thumbnail-placeholder/.test(
            result.embeddedHTML!['https://cardstack.com/base/card-api/CardDef'],
          ),
          `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
        );
      });

      test('isolated HTML', function (assert) {
        assert.ok(
          /data-test-field="cardDescription"/.test(result.isolatedHTML!),
          `failed to match isolated html:${result.isolatedHTML}`,
        );
      });

      test('atom HTML', function (assert) {
        assert.ok(
          /Untitled Cat/.test(result.atomHTML!),
          `failed to match atom html:${result.atomHTML}`,
        );
      });

      test('icon HTML', function (assert) {
        assert.ok(
          result.iconHTML?.startsWith('<svg'),
          `iconHTML: ${result.iconHTML}`,
        );
      });

      test('serialized', function (assert) {
        assert.strictEqual(result.serialized?.data.attributes?.name, 'Maple');
      });

      test('displayNames', function (assert) {
        assert.deepEqual(result.displayNames, ['Cat', 'Card']);
      });

      test('deps', function (assert) {
        // spot check a few deps, as the whole list is overwhelming...
        assert.ok(
          result.deps?.includes(baseCardRef.module),
          `${baseCardRef.module} is a dep`,
        );
        assert.ok(
          result.deps?.includes(`${realmURL1}person`),
          `${realmURL1}person is a dep`,
        );
        assert.ok(
          result.deps?.includes(`${realmURL2}cat`),
          `${realmURL2}cat is a dep`,
        );
        assert.ok(
          result.deps?.find((d) =>
            d.match(
              /^https:\/\/cardstack.com\/base\/card-api\.gts\..*glimmer-scoped\.css$/,
            ),
          ),
          `glimmer scoped css from ${baseCardRef.module} is a dep`,
        );
      });

      test('types', function (assert) {
        assert.deepEqual(result.types, [
          `${realmURL2}cat/Cat`,
          'https://cardstack.com/base/card-api/CardDef',
        ]);
      });

      test('searchDoc', function (assert) {
        assert.strictEqual(result.searchDoc?.name, 'Maple');
        assert.strictEqual(result.searchDoc?._cardType, 'Cat');
        assert.strictEqual(result.searchDoc?.owner.name, 'Hassan');
      });

      test('isUsed field includes a field in search doc that is not rendered in template', async function (assert) {
        const testCardURL = `${realmURL2}is-used`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });

        assert.ok(
          /Mango/.test(response.isolatedHTML!),
          `failed to match isolated html:${response.isolatedHTML}`,
        );
        assert.false(
          /data-test-field="owner"/.test(response.isolatedHTML!),
          `owner field is not rendered in isolated html`,
        );
        assert.strictEqual(
          response.searchDoc?.owner.name,
          'Hassan',
          'linked field is included in search doc via isUsed=true',
        );
      });
    });

    module('errors', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
      test('error during render', async function (assert) {
        const testCardURL = `${realmURL2}2`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        let { error, ...restOfResult } = response;

        assert.strictEqual(error?.error.id, testCardURL);
        assert.strictEqual(
          error?.error.message,
          'intentional failure during render',
        );
        assert.strictEqual(error?.error.status, 500);
        assert.ok(error?.error.stack, 'stack trace exists in error');

        // TODO Perhaps if we add error handlers for the /render/html subroute
        // these all wont be empty, as this is triggering in the /render route
        // error handler and hence stomping over all the subroutes.
        assert.deepEqual(restOfResult, {
          displayNames: null,
          deps: null,
          searchDoc: null,
          serialized: null,
          types: null,
          atomHTML: null,
          embeddedHTML: null,
          fittedHTML: null,
          iconHTML: null,
          isolatedHTML: null,
        });
      });

      test('missing link surfaces 404 without eviction', async function (assert) {
        const testCardURL = `${realmURL2}missing-link`;
        let result = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        let { response } = result;

        assert.ok(response.error, 'error present for missing link');
        assert.strictEqual(
          response.error?.error.message,
          `missing file ${realmURL1}missing-owner.json`,
        );
        assert.strictEqual(response.error?.error.status, 404);
        assert.false(
          result.pool.evicted,
          'missing link does not evict prerender page',
        );
        assert.false(
          result.pool.timedOut,
          'missing link does not mark prerender timeout',
        );
      });

      test('fetch failed surfaces error without eviction', async function (assert) {
        const testCardURL = `${realmURL2}fetch-failed`;
        let result = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        let { response } = result;

        assert.ok(response.error, 'error present for fetch failed');
        assert.strictEqual(
          response.error?.error.message,
          `unable to fetch http://localhost:9000/this-is-a-link-to-nowhere: fetch failed`,
        );
        assert.strictEqual(response.error?.error.status, 500);
        assert.false(
          result.pool.evicted,
          'fetch failed does not evict prerender page',
        );
        assert.false(
          result.pool.timedOut,
          'fetch failed does not mark prerender timeout',
        );
      });

      test('embedded error markup triggers render error', async function (assert) {
        const testCardURL = `${realmURL2}4`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        assert.ok(response.error, 'error captured');
        assert.strictEqual(response.error?.error.id, 'embedded-error');
        assert.strictEqual(
          response.error?.error.message,
          'error flagged from DOM',
        );
        assert.strictEqual(response.error?.error.title, 'Embedded error');
        assert.strictEqual(response.error?.error.status, 500);
      });

      test('does not recover when timeout hits even if DOM is settled', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        let timedOut = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
          opts: { timeoutMs: 1000, simulateTimeoutMs: 2000 },
        });

        assert.ok(
          timedOut.response.error,
          'timeout returns error payload even when DOM is settled',
        );
        assert.strictEqual(
          timedOut.response.error?.error.title,
          'Render timeout',
          'timeout surfaces render timeout',
        );
        assert.true(
          timedOut.pool.timedOut,
          'pool notes timeout when render exceeds limit',
        );
        assert.true(
          timedOut.pool.evicted,
          'realm evicted after timeout even when DOM settled',
        );
        assert.strictEqual(
          timedOut.response.isolatedHTML,
          null,
          'does not return isolated HTML after timeout',
        );

        let next = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: `${realmURL2}1`,
          userId: testUserId,
          permissions,
        });
        assert.false(
          next.pool.reused,
          'subsequent render uses fresh page after timeout eviction',
        );
        assert.strictEqual(
          next.response.error,
          undefined,
          'subsequent render succeeds',
        );
      });

      test('does not recover timeout when DOM reports an error', async function (assert) {
        const errorCardURL = `${realmURL2}4`;
        // warm the realm so loader caches are populated
        await prerenderer.prerenderCard({
          realm: realmURL2,
          url: errorCardURL,
          userId: testUserId,
          permissions,
        });

        let timedOut = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: errorCardURL,
          userId: testUserId,
          permissions,
          opts: { timeoutMs: 500, simulateTimeoutMs: 2000 },
        });

        assert.ok(
          timedOut.response.error,
          'timeout still returns an error payload',
        );
        assert.strictEqual(
          timedOut.response.error?.error.title,
          'Render timeout',
          'reports timeout when DOM contains error markup',
        );
        assert.strictEqual(
          timedOut.response.isolatedHTML,
          null,
          'does not salvage HTML when DOM reports an error',
        );
        assert.true(timedOut.pool.timedOut, 'pool flags timeout');
        assert.true(
          timedOut.pool.evicted,
          'realm evicted after timeout with error',
        );
      });

      test('unusable triggers eviction and short-circuit', async function (assert) {
        // Render the card that forces unusable
        const unusableURL = `${realmURL2}3`;
        let unusable = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: unusableURL,
          userId: testUserId,
          permissions,
        });

        // We should see an error with evict semantics and short-circuited payloads
        assert.ok(unusable.response.error, 'error present for unusable');
        assert.strictEqual(unusable.response.error?.error.id, unusableURL);
        assert.strictEqual(
          unusable.response.error?.error.message,
          'forced unusable for test',
        );
        assert.strictEqual(unusable.response.error?.error.status, 500);
        assert.strictEqual(
          unusable.response.isolatedHTML,
          null,
          'isolatedHTML null when short-circuited',
        );
        assert.strictEqual(
          unusable.response.embeddedHTML,
          null,
          'embeddedHTML null when short-circuited',
        );
        assert.strictEqual(
          unusable.response.atomHTML,
          null,
          'atomHTML null when short-circuited',
        );
        assert.strictEqual(
          unusable.response.iconHTML,
          null,
          'iconHTML null when short-circuited',
        );
        assert.deepEqual(
          {
            serialized: unusable.response.serialized,
            searchDoc: unusable.response.searchDoc,
            displayNames: unusable.response.displayNames,
            types: unusable.response.types,
            deps: unusable.response.deps,
          },
          {
            serialized: null,
            searchDoc: null,
            displayNames: null,
            types: null,
            deps: null,
          },
          'meta fields are null when short-circuited',
        );
        assert.true(unusable.pool.evicted, 'pool notes eviction for unusable');
        assert.false(
          unusable.pool.timedOut,
          'unusable eviction does not mark timeout',
        );
        assert.notStrictEqual(
          unusable.pool.pageId,
          'unknown',
          'evicted unusable run retains page identifier',
        );

        // After unusable, the realm should be evicted; a subsequent render should not reuse
        const healthyURL = `${realmURL2}1`;
        let next = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: healthyURL,
          userId: testUserId,
          permissions,
        });
        assert.false(next.pool.reused, 'did not reuse after unusable eviction');
        assert.false(next.pool.evicted, 'subsequent render not evicted');
      });

      test('prerender surfaces module syntax errors without timing out', async function (assert) {
        const cardURL = `${realmURL2}broken`;
        let broken = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: cardURL,
          userId: testUserId,
          permissions,
        });
        assert.ok(broken.response.error, 'syntax error captured');
        assert.strictEqual(
          broken.response.error?.error.status,
          406,
          'syntax error reported as 406',
        );
        assert.false(broken.pool.timedOut, 'syntax error does not hit timeout');
      });
    });

    module('realm pooling', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
      test('evicts on timeout and does not reuse', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        // First render to initialize pool
        let first = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        assert.false(first.pool.reused, 'first call not reused');

        // Now trigger a timeout; this should evict the realm
        let timeoutRun = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
          opts: { timeoutMs: 1, simulateTimeoutMs: 5 },
        });
        assert.strictEqual(
          timeoutRun.response.error?.error.title,
          'Render timeout',
          'got timeout error',
        );
        assert.true(timeoutRun.pool.evicted, 'timeout eviction reflected');
        assert.true(timeoutRun.pool.timedOut, 'timeout flagged on pool');
        assert.notStrictEqual(
          timeoutRun.pool.pageId,
          'unknown',
          'timeout eviction retains page identifier',
        );

        // A subsequent render should not reuse the previously pooled page
        let afterTimeout = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        assert.false(
          afterTimeout.pool.reused,
          'did not reuse after timeout eviction',
        );
        assert.false(afterTimeout.pool.evicted, 'no eviction on new render');
        assert.false(afterTimeout.pool.timedOut, 'no timeout on new render');
      });

      test('reuses the same page within a realm', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        let first = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        let second = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
        });
        assert.strictEqual(first.pool.realm, realmURL2, 'first realm matches');
        assert.strictEqual(
          second.pool.realm,
          realmURL2,
          'second realm matches',
        );
        assert.strictEqual(
          first.pool.pageId,
          second.pool.pageId,
          'pageId reused',
        );
        assert.false(first.pool.reused, 'first call not reused');
        assert.true(second.pool.reused, 'second call reused');
        assert.false(first.pool.timedOut, 'first call not timed out');
        assert.false(second.pool.timedOut, 'second call not timed out');
      });

      test('does not reuse across different realms', async function (assert) {
        const testCardURL1 = `${realmURL1}1`;
        const testCardURL2 = `${realmURL2}1`;
        let r1 = await prerenderer.prerenderCard({
          realm: realmURL1,
          url: testCardURL1,
          userId: testUserId,
          permissions,
        });
        let r2 = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL2,
          userId: testUserId,
          permissions,
        });
        assert.notStrictEqual(
          r1.pool.pageId,
          r2.pool.pageId,
          'distinct pages per realm',
        );
        assert.false(r1.pool.reused, 'first realm first call not reused');
        assert.false(r2.pool.reused, 'second realm first call not reused');
      });

      test('evicts LRU when capacity reached', async function (assert) {
        const cardA = `${realmURL1}1`;
        const cardB = `${realmURL2}1`;
        const cardC = `${realmURL3}1`;

        let firstA = await prerenderer.prerenderCard({
          realm: realmURL1,
          url: cardA,
          userId: testUserId,
          permissions,
        });
        assert.false(firstA.pool.reused, 'first A not reused');

        let firstB = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: cardB,
          userId: testUserId,
          permissions,
        });
        assert.false(firstB.pool.reused, 'first B not reused');

        // Now adding C should evict the LRU (A), since maxPages=2
        let firstC = await prerenderer.prerenderCard({
          realm: realmURL3,
          url: cardC,
          userId: testUserId,
          permissions,
        });
        assert.false(firstC.pool.reused, 'first C not reused');

        // Returning to A should not reuse because it was evicted
        let secondA = await prerenderer.prerenderCard({
          realm: realmURL1,
          url: cardA,
          userId: testUserId,
          permissions,
        });
        assert.false(secondA.pool.reused, 'A was evicted, so not reused');
        assert.notStrictEqual(
          firstA.pool.pageId,
          secondA.pool.pageId,
          'A got a new page after eviction',
        );
      });
    });
  });
});
