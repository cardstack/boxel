import { module, test } from 'qunit';

import {
  type LooseCardResource,
  relativeURL,
  visitInstanceURLs,
} from '@cardstack/runtime-common';

module('Unit | url', function () {
  module('relativeURL', function () {
    test('returns undefined for different origins', function (assert) {
      let result = relativeURL(
        new URL('https://other.example.com/a'),
        new URL('https://example.com/a'),
        undefined,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns undefined when realm URL blocks escaping the realm', function (assert) {
      let realm = new URL('https://example.com/realm/');
      let result = relativeURL(
        new URL('https://example.com/outside/card'),
        new URL('https://example.com/realm/card'),
        realm,
      );

      assert.strictEqual(result, undefined);
    });

    test('returns absolute path when first path segment differs and relativeTo is nested', function (assert) {
      let result = relativeURL(
        new URL('https://example.com/d/e'),
        new URL('https://example.com/a/b/c'),
        undefined,
      );

      assert.strictEqual(result, '../../d/e');
    });

    test('creates relative path to upper-level sibling', function (assert) {
      let result = relativeURL(
        new URL('https://example.com/d'),
        new URL('https://example.com/a/b'),
        undefined,
      );

      assert.strictEqual(result, '../d');
    });

    test('creates sibling-relative path', function (assert) {
      let result = relativeURL(
        new URL('https://example.com/a/b/other'),
        new URL('https://example.com/a/b/file'),
        undefined,
      );

      assert.strictEqual(result, './other');
    });

    test('creates parent-relative path', function (assert) {
      let result = relativeURL(
        new URL('https://example.com/a/b/e'),
        new URL('https://example.com/a/b/c/d'),
        undefined,
      );

      assert.strictEqual(result, '../e');
    });

    test('returns ./file when URL matches relativeTo exactly', function (assert) {
      let result = relativeURL(
        new URL('https://example.com/a/b'),
        new URL('https://example.com/a/b'),
        undefined,
      );

      assert.strictEqual(result, './b');
    });

    test('returns ./file when relativeTo is root', function (assert) {
      let result = relativeURL(
        new URL('https://example.com/b'),
        new URL('https://example.com/'),
        undefined,
      );

      assert.strictEqual(result, './b');
    });
  });

  module('Unit | document | visitInstanceURLs', function () {
    test('it visits and updates instance URLs in links', async function (assert) {
      let json: LooseCardResource = {
        meta: {
          adoptsFrom: {
            module: `https://test-realm/foo-bar-def`,
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
            module: `https://test-realm/foo-bar-def`,
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
