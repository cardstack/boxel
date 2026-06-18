import { module, test } from 'qunit';
import { basename } from 'path';
import {
  deriveRealmName,
  generateObscureSlug,
  OBSCURE_SLUG_LENGTH,
  resolvePublishedRealmUrl,
} from '@cardstack/runtime-common';

module(basename(__filename), function () {
  module('resolve-published-realm-url', function () {
    // deriveRealmName
    test('deriveRealmName returns the last path segment, lowercased', async function (assert) {
      assert.strictEqual(
        deriveRealmName('https://realms.example/mike/Game-Mechanics/'),
        'game-mechanics',
      );
    });

    test('deriveRealmName ignores a missing trailing slash', async function (assert) {
      assert.strictEqual(
        deriveRealmName('https://realms.example/mike/notes'),
        'notes',
      );
    });

    test('deriveRealmName throws when there is no path segment', async function (assert) {
      assert.throws(
        () => deriveRealmName('https://realms.example/'),
        /Could not extract realm name/,
      );
    });

    test('deriveRealmName throws on an unparseable URL', async function (assert) {
      assert.throws(() => deriveRealmName('not a url'), /Failed to parse/);
    });

    // resolvePublishedRealmUrl — subdirectory
    test('subdirectory builds a Boxel Space URL from username, domain, and name', async function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'game-mechanics' },
          { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
        ),
        'https://mike.boxel.space/game-mechanics/',
      );
    });

    test('subdirectory lowercases the provided name', async function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'Game-Mechanics' },
          { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
        ),
        'https://mike.boxel.space/game-mechanics/',
      );
    });

    test('subdirectory derives the name from sourceRealmURL when blank', async function (assert) {
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

    test('subdirectory honors a custom protocol', async function (assert) {
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

    test('subdirectory throws when name is blank and no sourceRealmURL is given', async function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory' },
            { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
          ),
        /requires either `name` or a `sourceRealmURL`/,
      );
    });

    test('subdirectory throws when matrixUsername is missing', async function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory', name: 'notes' },
            { spaceDomain: 'boxel.space' },
          ),
        /requires `matrixUsername`/,
      );
    });

    test('subdirectory throws when spaceDomain is missing', async function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory', name: 'notes' },
            { matrixUsername: 'mike' },
          ),
        /requires `spaceDomain`/,
      );
    });

    // resolvePublishedRealmUrl — custom
    test('custom builds a URL from a bare hostname', async function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl({ type: 'custom', name: 'mysite.boxel.site' }),
        'https://mysite.boxel.site/',
      );
    });

    test('custom preserves a port in the hostname', async function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'mysite.localhost:4201',
        }),
        'https://mysite.localhost:4201/',
      );
    });

    test('custom strips a leading protocol and trailing slash', async function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'https://mysite.boxel.site/',
        }),
        'https://mysite.boxel.site/',
      );
    });

    test('custom throws when the hostname is blank', async function (assert) {
      assert.throws(
        () => resolvePublishedRealmUrl({ type: 'custom', name: '' }),
        /requires a hostname/,
      );
    });

    test('custom rejects a hostname that includes a path', async function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl({
            type: 'custom',
            name: 'mysite.boxel.site/foo',
          }),
        /path, query, or fragment/,
      );
    });

    test('custom rejects a hostname that includes credentials', async function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl({
            type: 'custom',
            name: 'user:pass@mysite.boxel.site',
          }),
        /must not include credentials/,
      );
    });

    test('custom rejects a hostname that includes a query or fragment', async function (assert) {
      assert.throws(
        () =>
          resolvePublishedRealmUrl({
            type: 'custom',
            name: 'mysite.boxel.site?a=1',
          }),
        /path, query, or fragment/,
      );
      assert.throws(
        () =>
          resolvePublishedRealmUrl({
            type: 'custom',
            name: 'mysite.boxel.site#frag',
          }),
        /path, query, or fragment/,
      );
    });

    test('custom normalizes an accidental protocol passed in ctx', async function (assert) {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'custom', name: 'mysite.boxel.site' },
          { protocol: 'https://' },
        ),
        'https://mysite.boxel.site/',
      );
    });

    test('throws on an unknown target type', async function (assert) {
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

    // generateObscureSlug
    test('generateObscureSlug produces a fixed-length URL-path-safe string', async function (assert) {
      for (let i = 0; i < 50; i++) {
        let slug = generateObscureSlug();
        assert.strictEqual(
          slug.length,
          OBSCURE_SLUG_LENGTH,
          'has the expected length',
        );
        assert.ok(
          /^[a-z0-9]+$/.test(slug),
          `"${slug}" is lowercase alphanumeric (safe as a URL path segment)`,
        );
      }
    });

    test('generateObscureSlug is not deterministic', async function (assert) {
      let values = new Set(
        Array.from({ length: 20 }, () => generateObscureSlug()),
      );
      assert.strictEqual(values.size, 20, 'all generated values are distinct');
    });
  });
});
