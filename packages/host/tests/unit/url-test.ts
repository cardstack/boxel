import { module, test } from 'qunit';

import {
  type LooseCardResource,
  type RealmResourceIdentifier,
  maybeRelativeReference,
  relativeReference,
  resolveRRIReference,
  ri,
  rri,
  visitInstanceURLs,
} from '@cardstack/runtime-common';

module('Unit | url', function () {
  module('relativeReference', function () {
    test('returns undefined for different origins', function (assert) {
      let result = relativeReference(
        new URL('https://other.example.com/a'),
        new URL('https://example.com/a'),
        undefined,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns undefined when realm URL blocks escaping the realm', function (assert) {
      let realm = new URL('https://example.com/realm/');
      let result = relativeReference(
        new URL('https://example.com/outside/card'),
        new URL('https://example.com/realm/card'),
        realm,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns absolute path when first path segment differs and relativeTo is nested', function (assert) {
      let result = relativeReference(
        new URL('https://example.com/d/e'),
        new URL('https://example.com/a/b/c'),
        undefined,
      );

      assert.strictEqual(result, '../../d/e');
    });

    test('creates relative path to upper-level sibling', function (assert) {
      let result = relativeReference(
        new URL('https://example.com/d'),
        new URL('https://example.com/a/b'),
        undefined,
      );

      assert.strictEqual(result, '../d');
    });

    test('creates sibling-relative path', function (assert) {
      let result = relativeReference(
        new URL('https://example.com/a/b/other'),
        new URL('https://example.com/a/b/file'),
        undefined,
      );

      assert.strictEqual(result, './other');
    });

    test('creates parent-relative path', function (assert) {
      let result = relativeReference(
        new URL('https://example.com/a/b/e'),
        new URL('https://example.com/a/b/c/d'),
        undefined,
      );

      assert.strictEqual(result, '../e');
    });

    test('returns ./file when URL matches relativeTo exactly', function (assert) {
      let result = relativeReference(
        new URL('https://example.com/a/b'),
        new URL('https://example.com/a/b'),
        undefined,
      );

      assert.strictEqual(result, './b');
    });

    test('returns ./file when relativeTo is root', function (assert) {
      let result = relativeReference(
        new URL('https://example.com/b'),
        new URL('https://example.com/'),
        undefined,
      );

      assert.strictEqual(result, './b');
    });

    test('creates sibling-relative path between two prefix-form RRIs in the same scope', function (assert) {
      let result = relativeReference(
        rri('@cardstack/base/foo'),
        rri('@cardstack/base/bar'),
        undefined,
      );

      assert.strictEqual(result, './foo');
    });

    test('returns undefined for prefix-form RRIs in different scopes', function (assert) {
      let result = relativeReference(
        rri('@cardstack/base/foo'),
        rri('@cardstack/catalog/bar'),
        undefined,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns undefined for mixed URL + prefix-form RRI inputs', function (assert) {
      let result = relativeReference(
        rri('@cardstack/base/foo'),
        new URL('https://my-realm.com/bar'),
        undefined,
      );

      assert.strictEqual(result, undefined);
    });

    test('produces a relative path within a prefix-form realm', function (assert) {
      let result = relativeReference(
        rri('@cardstack/base/foo'),
        rri('@cardstack/base/sub/bar'),
        ri('@cardstack/base/'),
      );

      assert.strictEqual(result, '../foo');
    });

    test('returns undefined when a prefix-form realm blocks escaping', function (assert) {
      let result = relativeReference(
        rri('@cardstack/base/outside'),
        rri('@cardstack/base/sub/inside'),
        ri('@cardstack/base/sub/'),
      );

      assert.strictEqual(result, undefined);
    });
  });

  module('maybeRelativeReference', function () {
    test('falls back to absolute href for un-relativizable URL inputs', function (assert) {
      let result = maybeRelativeReference(
        new URL('https://a.com/foo'),
        new URL('https://b.com/bar'),
        undefined,
      );

      assert.strictEqual(result, 'https://a.com/foo');
    });

    test('falls back to the prefix-form RRI as-is for un-relativizable RRI inputs', function (assert) {
      let result = maybeRelativeReference(
        rri('@cardstack/base/foo'),
        new URL('https://my-realm.com/bar'),
        undefined,
      );

      assert.strictEqual(result, '@cardstack/base/foo');
    });
  });

  module('resolveRRIReference', function () {
    test('returns absolute references (URL- and prefix-form) unchanged', function (assert) {
      assert.strictEqual(
        resolveRRIReference('https://a.com/foo', rri('@cardstack/base/bar')),
        'https://a.com/foo',
      );
      assert.strictEqual(
        resolveRRIReference('@cardstack/base/foo', rri('@cardstack/base/bar')),
        '@cardstack/base/foo',
      );
    });

    test('joins a relative reference against a URL-form base', function (assert) {
      assert.strictEqual(
        resolveRRIReference(
          './person',
          new URL('https://my-realm.com/Listing/author'),
        ),
        'https://my-realm.com/Listing/person',
      );
    });

    test('joins a relative reference against a prefix-form base', function (assert) {
      assert.strictEqual(
        resolveRRIReference(
          './person',
          rri('@cardstack/catalog/Listing/author'),
        ),
        '@cardstack/catalog/Listing/person',
      );
    });

    test('resolves a `$REALM/` reference against the realm root of a prefix-form base', function (assert) {
      assert.strictEqual(
        resolveRRIReference(
          '$REALM/string',
          rri('@cardstack/base/fields/number'),
        ),
        '@cardstack/base/string',
      );
    });

    test('returns other absolute-URL schemes unchanged (not rewritten into prefix form)', function (assert) {
      // Any `<scheme>:` URL is absolute; against a prefix-form base it must be
      // returned as-is, not joined into the `@scope/name` namespace.
      for (let ref of [
        'data:image/png;base64,AAAA',
        'blob:https://a.com/abc-123',
        'mailto:someone@example.com',
      ]) {
        assert.strictEqual(
          resolveRRIReference(ref, rri('@cardstack/base/fields/number')),
          ref,
          `${ref} is returned unchanged`,
        );
      }
    });

    test('leaves a reference unchanged when there is no base', function (assert) {
      assert.strictEqual(
        resolveRRIReference('./person', undefined),
        './person',
      );
    });
  });

  module('Unit | document | visitInstanceURLs', function () {
    test('it visits and updates instance URLs in links', async function (assert) {
      let json: LooseCardResource = {
        meta: {
          adoptsFrom: {
            module: `https://test-realm/foo-bar-def` as RealmResourceIdentifier,
            name: 'TestCard',
          },
        },
        links: {
          self: `https://test-realm/foo-bar-1`,
        },
        relationships: {
          friend: {
            links: {
              self: `./foo-bar-2`,
            },
          },
          'friends.0': {
            links: {
              self: `../foo-bar-3`,
            },
          },
        },
      };
      visitInstanceURLs(json, (instanceURL, setInstanceURL) => {
        setInstanceURL(instanceURL.replace('foo-bar', 'baz-bay'));
      });
      assert.deepEqual(json, {
        meta: {
          adoptsFrom: {
            module: `https://test-realm/foo-bar-def` as RealmResourceIdentifier,
            name: 'TestCard',
          },
        },
        links: {
          self: `https://test-realm/baz-bay-1`,
        },
        relationships: {
          friend: {
            links: {
              self: `./baz-bay-2`,
            },
          },
          'friends.0': {
            links: {
              self: `../baz-bay-3`,
            },
          },
        },
      });
    });
  });
});
