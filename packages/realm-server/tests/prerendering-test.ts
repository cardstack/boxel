import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard } from '../prerender';

module.only(basename(__filename), function () {
  module('loader', function () {
    test('it can capture HTML', async function (assert) {
      let result = await prerenderCard(
        // TODO: This is created by hand in my local environment
        'http://localhost:4201/user/a/Cat/95d63274-8052-49c1-bd9a-29cbf0bd1b09',
      );

      assert.ok(
        /Maple\s+says\s+Meow/.test(result.html.embedded),
        `failed to match embedded html:${result.html.embedded}`,
      );

      assert.ok(
        /data-test-field="description"/.test(result.html.isolated),
        `failed to match isolated html:${result.html.isolated}`,
      );

      assert.ok(
        result.iconHTML.startsWith('<svg'),
        `iconHTML: ${result.iconHTML}`,
      );

      assert.strictEqual(result.json.data.attributes?.name, 'Maple');
    });
  });
});
