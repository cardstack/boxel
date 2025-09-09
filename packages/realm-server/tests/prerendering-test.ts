import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard, type RenderResponse } from '../prerender';
import { execSync } from 'child_process';

import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  realmSecretSeed,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { DBAdapter } from '@cardstack/runtime-common';

module(basename(__filename), function () {
  module('prerender', function (hooks) {
    let realmURL: string;
    let dbAdapter: DBAdapter;
    const testUserId = '@user1:localhost';

    hooks.before(() => {
      execSync('pnpm puppeteer browsers install chrome');
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealm(hooks, {
      mode: 'before',
      onRealmSetup: ({ testRealm, dbAdapter: _dbAdapter }) => {
        realmURL = testRealm.url;
        dbAdapter = _dbAdapter;
      },
      permissions: {
        [testUserId]: ['read', 'write', 'realm-owner'],
      },
      subscribeToRealmEvents: true,
      fileSystem: {
        'cat.gts': `
          import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
          import { Component } from 'https://cardstack.com/base/card-api';
          export class Cat extends CardDef {
            @field name = contains(StringField);
            static displayName = "Cat";
            static embedded = <template>{{@fields.name}} says Meow</template>
          }
        `,
        '1.json': {
          data: {
            attributes: {
              name: 'Maple',
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
    });

    module('basics', function (hooks) {
      let result: RenderResponse;

      hooks.before(async () => {
        const testCardURL = `${realmURL}1`;
        result = await prerenderCard({
          url: testCardURL,
          realm: realmURL,
          userId: testUserId,
          secretSeed: realmSecretSeed,
          dbAdapter,
        });
      });

      test('embedded HTML', function (assert) {
        assert.ok(
          /Maple\s+says\s+Meow/.test(result.embeddedHTML[`${realmURL}cat/Cat`]),
          `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
        );
      });

      test('parent embedded HTML', function (assert) {
        assert.ok(
          /data-test-card-thumbnail-placeholder/.test(
            result.embeddedHTML['https://cardstack.com/base/card-api/CardDef'],
          ),
          `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
        );
      });

      test('isolated HTML', function (assert) {
        assert.ok(
          /data-test-field="description"/.test(result.isolatedHTML),
          `failed to match isolated html:${result.isolatedHTML}`,
        );
      });

      test('icon HTML', function (assert) {
        assert.ok(
          result.iconHTML.startsWith('<svg'),
          `iconHTML: ${result.iconHTML}`,
        );
      });

      test('serialized', function (assert) {
        assert.strictEqual(result.serialized.data.attributes?.name, 'Maple');
      });

      test('displayName', function (assert) {
        assert.strictEqual(result.displayName, 'Cat');
      });

      test('types', function (assert) {
        assert.deepEqual(result.types, [
          `${realmURL}cat/Cat`,
          'https://cardstack.com/base/card-api/CardDef',
        ]);
      });

      test('searchDoc', function (assert) {
        assert.strictEqual(result.searchDoc.name, 'Maple');
        assert.strictEqual(result.searchDoc._cardType, 'Cat');
      });
    });

    module('errors', function () {
      test('error during render', async function (assert) {
        const testCardURL = `${realmURL}2`;
        assert.rejects(
          (async () => {
            await prerenderCard({
              url: testCardURL,
              realm: realmURL,
              userId: testUserId,
              secretSeed: realmSecretSeed,
              dbAdapter,
            });
          })(),
          /todo: error doc/,
        );
      });
    });
  });
});
