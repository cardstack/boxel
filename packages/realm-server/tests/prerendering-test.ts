import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard, RenderResponse } from '../prerender';

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
          /Maple\s+says\s+Meow/.test(result.html.embedded),
          `failed to match embedded html:${result.html.embedded}`,
        );
      });

      test('isolated HTML', function (assert) {
        assert.ok(
          /data-test-field="description"/.test(result.html.isolated),
          `failed to match isolated html:${result.html.isolated}`,
        );
      });

      test('icon HTML', function (assert) {
        assert.ok(
          result.iconHTML.startsWith('<svg'),
          `iconHTML: ${result.iconHTML}`,
        );
      });

      test('json', function (assert) {
        assert.strictEqual(result.json.data.attributes?.name, 'Maple');
      });
    });
  });
});
