import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard, type RenderResponse } from '../prerender';

module.only(basename(__filename), function () {
  module('prerender', function () {
    module('basics', function (hooks) {
      let result: RenderResponse;

      hooks.before(async () => {
        // TODO: This is created by hand in my local environment
        const testCardURL =
          'http://localhost:4201/user/a/Cat/95d63274-8052-49c1-bd9a-29cbf0bd1b09';
        result = await prerenderCard(testCardURL);
      });

      test('embedded HTML', function (assert) {
        assert.ok(
          /Maple\s+says\s+Meow/.test(
            result.embeddedHTML['http://localhost:4201/user/a/cat/Cat'],
          ),
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
          'http://localhost:4201/user/a/cat/Cat',
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
