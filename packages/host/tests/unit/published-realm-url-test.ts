import { module, test } from 'qunit';

import {
  deriveRealmName,
  resolvePublishedRealmUrl,
} from '@cardstack/host/lib/published-realm-url';

module('Unit | published-realm-url', function () {
  module('deriveRealmName', function () {
    test('returns the last path segment, lowercased', function (assert) {
      assert.strictEqual(
        deriveRealmName('https://realms.example/mike/Game-Mechanics/'),
        'game-mechanics',
      );
    });

    test('ignores a missing trailing slash', function (assert) {
      assert.strictEqual(
        deriveRealmName('https://realms.example/mike/notes'),
        'notes',
      );
    });

    test('throws when there is no path segment', function (assert) {
      assert.throws(
        () => deriveRealmName('https://realms.example/'),
        /Could not extract realm name/,
      );
    });

    test('throws on an unparseable URL', function (assert) {
      assert.throws(() => deriveRealmName('not a url'), /Failed to parse/);
    });
  });

  module('resolvePublishedRealmUrl — subdirectory', function () {
    test('builds a Boxel Space URL from username, domain, and name', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'game-mechanics' },
          { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
        ),
        'https://mike.boxel.space/game-mechanics/',
      );
    });

    test('lowercases the provided name', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'Game-Mechanics' },
          { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
        ),
        'https://mike.boxel.space/game-mechanics/',
      );
    });

    test('derives the name from sourceRealmURL when blank', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory' },
          {
            matrixUsername: 'mike',
            spaceDomain: 'boxel.space',
            sourceRealmURL: 'https://realms.example/mike/Notes/',
          },
        ),
        'https://mike.boxel.space/notes/',
      );
    });

    test('honors a custom protocol', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'notes' },
          {
            matrixUsername: 'mike',
            spaceDomain: 'boxel.space',
            protocol: 'http',
          },
        ),
        'http://mike.boxel.space/notes/',
      );
    });

    test('throws when name is blank and no sourceRealmURL is given', function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory' },
            { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
          ),
        /requires either `name` or a `sourceRealmURL`/,
      );
    });

    test('throws when matrixUsername is missing', function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory', name: 'notes' },
            { spaceDomain: 'boxel.space' },
          ),
        /requires `matrixUsername`/,
      );
    });

    test('throws when spaceDomain is missing', function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory', name: 'notes' },
            { matrixUsername: 'mike' },
          ),
        /requires `spaceDomain`/,
      );
    });
  });

  module('resolvePublishedRealmUrl — custom', function () {
    test('builds a URL from a bare hostname', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl({ type: 'custom', name: 'mysite.boxel.site' }),
        'https://mysite.boxel.site/',
      );
    });

    test('preserves a port in the hostname', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'mysite.localhost:4201',
        }),
        'https://mysite.localhost:4201/',
      );
    });

    test('strips a leading protocol and trailing slash', function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'https://mysite.boxel.site/',
        }),
        'https://mysite.boxel.site/',
      );
    });

    test('throws when the hostname is blank', function (assert) {
      assert.throws(
        () => resolvePublishedRealmUrl({ type: 'custom', name: '' }),
        /requires a hostname/,
      );
    });
  });

  test('throws on an unknown target type', function (assert) {
    assert.throws(
      () =>
        resolvePublishedRealmUrl({
          // @ts-expect-error intentionally invalid type
          type: 'bogus',
          name: 'x',
        }),
      /Unknown publish target type/,
    );
  });
});
