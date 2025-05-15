import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard, type RenderResponse } from '../prerender';

import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  createVirtualNetworkAndLoader,
  matrixURL,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module.only(basename(__filename), function () {
  module('prerender', function (hooks) {
    let { virtualNetwork } = createVirtualNetworkAndLoader();
    let realmURL: string;

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    setupPermissionedRealm(hooks, {
      mode: 'before',
      onRealmSetup: ({ testRealm }) => {
        realmURL = testRealm.url;
      },
      permissions: {
        '*': ['read'],
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
      },
    });

    module('basics', function (hooks) {
      let result: RenderResponse;

      hooks.before(async () => {
        const testCardURL = `${realmURL}1`;
        result = await prerenderCard(testCardURL);
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
  });
});
