import QUnit from 'qunit';
import { workerIsDeployed } from '../lib/worker-deployment.ts';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  resolveFullIndexOnStartup,
  resolveSkipBootIndex,
} from '../lib/full-index-on-startup.ts';

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

module(
  `${basename(import.meta.filename)} | bootstrap-only indexing skip`,
  function () {
    for (let kind of ['bootstrap', 'source', 'published'] as const) {
      test(`${kind} preserves global skip and isolates bootstrap skip`, function (assert) {
        assert.true(resolveSkipBootIndex(kind, true, false));
        assert.true(resolveSkipBootIndex(kind, true, true));
        assert.false(resolveSkipBootIndex(kind, false, false));
        assert.strictEqual(
          resolveSkipBootIndex(kind, false, true),
          kind === 'bootstrap',
        );
      });
    }
  },
);

module(
  `${basename(import.meta.filename)} | native worker identity with remote reference realms`,
  function () {
    let mappings: [URL | string, URL][] = [
      [
        new URL('http://realm.default.boxel.localhost:4242/base/'),
        new URL('http://127.0.0.1:1234/base/'),
      ],
      ['@cardstack/catalog/', new URL('https://app.boxel.ai/catalog/')],
    ];
    test('remote reference mappings retain the deployed default', function (assert) {
      assert.true(workerIsDeployed(mappings, undefined));
    });
    test('native identity names an actually served local realm', function (assert) {
      assert.false(
        workerIsDeployed(
          mappings,
          'http://realm.default.boxel.localhost:4242/',
        ),
      );
      assert.throws(() => workerIsDeployed(mappings, 'https://app.boxel.ai/'));
      assert.throws(() =>
        workerIsDeployed(mappings, 'http://other.localhost:4242/'),
      );
      assert.throws(() =>
        workerIsDeployed(
          mappings,
          'http://user:password@realm.default.boxel.localhost:4242/',
        ),
      );
    });
  },
);
