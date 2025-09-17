import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard, type RenderResponse } from '../prerender';
import { execSync } from 'child_process';

import {
  setupBaseRealmServer,
  setupPermissionedRealms,
  matrixURL,
  realmSecretSeed,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { DBAdapter } from '@cardstack/runtime-common';

module(basename(__filename), function () {
  module('prerender', function (hooks) {
    let realmURL1 = 'http://127.0.0.1:4447/';
    let realmURL2 = 'http://127.0.0.1:4448/';
    let dbAdapter: DBAdapter;
    const testUserId = '@user1:localhost';

    hooks.before(() => {
      execSync('pnpm puppeteer browsers install chrome');
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
      ],
      onRealmSetup: ({ dbAdapter: _dbAdapter }) => {
        dbAdapter = _dbAdapter;
      },
    });

    module('basics', function (hooks) {
      let result: RenderResponse;

      hooks.before(async () => {
        const testCardURL = `${realmURL2}1`;
        result = await prerenderCard({
          url: testCardURL,
          userId: testUserId,
          secretSeed: realmSecretSeed,
          dbAdapter,
        });
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
        assert.strictEqual(result.searchDoc?.owner.name, 'Hassan');
      });
    });

    module('errors', function () {
      test('error during render', async function (assert) {
        const testCardURL = `${realmURL2}2`;
        let result = await prerenderCard({
          url: testCardURL,
          userId: testUserId,
          secretSeed: realmSecretSeed,
          dbAdapter,
        });
        let { error, ...restOfResult } = result;

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
        let result = await prerenderCard({
          url: testCardURL,
          userId: testUserId,
          secretSeed: realmSecretSeed,
          dbAdapter,
          opts: { timeoutMs: 4000, simulateTimeoutMs: 5000 },
        });
        let { error } = result;
        assert.strictEqual(error?.id, testCardURL);
        assert.strictEqual(error?.message, 'Render timed-out after 4000 ms');
        assert.strictEqual(error?.status, 504);
      });
    });
  });
});
