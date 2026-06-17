import { module, test } from 'qunit';
import { basename } from 'path';
import { resolveFullIndexOnStartup } from '../lib/full-index-on-startup.ts';

module(basename(import.meta.filename), function () {
  module('default behavior (env var unset)', function () {
    test('bootstrap realms full-index on startup', function (assert) {
      assert.true(resolveFullIndexOnStartup('bootstrap', undefined));
    });

    test('source (user/private) realms do not full-index on startup', function (assert) {
      assert.false(resolveFullIndexOnStartup('source', undefined));
    });

    test('published realms do not full-index on startup', function (assert) {
      assert.false(resolveFullIndexOnStartup('published', undefined));
    });
  });

  module("explicit 'true' override forces all kinds on", function () {
    test('bootstrap', function (assert) {
      assert.true(resolveFullIndexOnStartup('bootstrap', 'true'));
    });

    test('source', function (assert) {
      assert.true(resolveFullIndexOnStartup('source', 'true'));
    });

    test('published', function (assert) {
      assert.true(resolveFullIndexOnStartup('published', 'true'));
    });
  });

  module(
    "explicit 'false' override forces all kinds off (cached-index flow)",
    function () {
      test('bootstrap', function (assert) {
        assert.false(resolveFullIndexOnStartup('bootstrap', 'false'));
      });

      test('source', function (assert) {
        assert.false(resolveFullIndexOnStartup('source', 'false'));
      });

      test('published', function (assert) {
        assert.false(resolveFullIndexOnStartup('published', 'false'));
      });
    },
  );

  module('non-boolean env values fall through to default', function () {
    test("empty string behaves like 'unset'", function (assert) {
      assert.true(resolveFullIndexOnStartup('bootstrap', ''));
      assert.false(resolveFullIndexOnStartup('source', ''));
    });

    test("'1' behaves like 'unset' (does not match 'true')", function (assert) {
      assert.true(resolveFullIndexOnStartup('bootstrap', '1'));
      assert.false(resolveFullIndexOnStartup('source', '1'));
    });

    test("'TRUE' (uppercase) behaves like 'unset' (case-sensitive match)", function (assert) {
      assert.true(resolveFullIndexOnStartup('bootstrap', 'TRUE'));
      assert.false(resolveFullIndexOnStartup('source', 'TRUE'));
    });
  });
});
