import { module, test } from 'qunit';
import { basename } from 'path';
import {
  Prerenderer,
  type RenderResponse,
  type PermissionsMap,
} from '../prerender/index';

import {
  setupBaseRealmServer,
  setupPermissionedRealms,
  matrixURL,
  realmSecretSeed,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(basename(__filename), function () {
  module('prerender', function (hooks) {
    let realmURL1 = 'http://127.0.0.1:4447/';
    let realmURL2 = 'http://127.0.0.1:4448/';
    let realmURL3 = 'http://127.0.0.1:4449/';
    let testUserId = '@user1:localhost';
    let permissions: PermissionsMap = {};
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
            'cat.gts': `
              import { CardDef, field, contains, linksTo, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';
              export class Cat extends CardDef {
                @field name = contains(StringField);
                @field owner = linksTo(Person);
                static displayName = "Cat";
                static embedded = <template>{{@fields.name}} says Meow</template>
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
            result.embeddedHTML![`${realmURL2}cat/Cat`],
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

      test('displayName', function (assert) {
        assert.strictEqual(result.displayName, 'Cat');
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
        // This assertion seems flaky in CI is there some kind of race condition
        // here?. we do have coverage for this in host tests, but it would be
        // nice to see this in server tests too...

        // assert.strictEqual(result.searchDoc?.owner.name, 'Hassan');
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

        assert.strictEqual(error?.id, testCardURL);
        assert.strictEqual(error?.message, 'intentional failure during render');
        assert.strictEqual(error?.status, 500);
        assert.ok(error?.meta.stack, 'stack trace exists in error');

        // TODO Perhaps if we add error handlers for the /render/html subroute
        // these all wont be empty, as this is triggering in the /render route
        // error handler and hence stomping over all the subroutes.
        assert.deepEqual(restOfResult, {
          displayName: null,
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

      test('render timeout', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        let result = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          userId: testUserId,
          permissions,
          opts: { timeoutMs: 4000, simulateTimeoutMs: 5000 },
        });
        let {
          response: { error },
        } = result;
        assert.strictEqual(error?.id, testCardURL);
        assert.strictEqual(error?.message, 'Render timed-out after 4000 ms');
        assert.strictEqual(error?.status, 504);
      });
    });

    module('realm pooling', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
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
