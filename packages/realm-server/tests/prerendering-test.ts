import { module, test } from 'qunit';
import { basename } from 'path';
import { prerenderCard } from '../prerender';

module.only(basename(__filename), function () {
  module('loader', function () {
    test('it can capture HTML', async function (assert) {
      let result = await prerenderCard(
        // TODO: This is created by hand in my local environment
        'http://localhost:4201/user/a/Cat/95d63274-8052-49c1-bd9a-29cbf0bd1b09',
        'embedded',
      );
      assert.ok(
        /Maple says Meow/.test(result.html),
        `failed to match in ${result.html}`,
      );
    });
  });
});
