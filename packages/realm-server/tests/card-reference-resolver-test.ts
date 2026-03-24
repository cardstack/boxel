import { module, test } from 'qunit';
import { basename } from 'path';
import {
  registerCardReferencePrefix,
  unregisterCardReferencePrefix,
  resolveCardReference,
} from '@cardstack/runtime-common';
import type { SingleCardDocument } from '@cardstack/runtime-common';
import { relativizeDocument } from '@cardstack/runtime-common/realm-index-query-engine';

module(basename(__filename), function () {
  module('resolveCardReference', function (hooks) {
    let prefix1 = '@test-ref/skills/';
    let prefix2 = '@test-ref/catalog/';

    hooks.beforeEach(function () {
      registerCardReferencePrefix(prefix1, 'http://localhost:9000/skills/');
      registerCardReferencePrefix(prefix2, 'http://localhost:9000/catalog/');
    });

    hooks.afterEach(function () {
      unregisterCardReferencePrefix(prefix1);
      unregisterCardReferencePrefix(prefix2);
    });

    test('resolves a prefix-mapped reference', async function (assert) {
      assert.strictEqual(
        resolveCardReference('@test-ref/skills/Skill/foo', undefined),
        'http://localhost:9000/skills/Skill/foo',
      );
    });

    test('resolves a relative URL with a normal URL base', async function (assert) {
      assert.strictEqual(
        resolveCardReference(
          './foo.md',
          'http://localhost:9000/skills/Skill/bar',
        ),
        'http://localhost:9000/skills/Skill/foo.md',
      );
    });

    test('resolves an absolute https URL when relativeTo is a prefix-form ID', async function (assert) {
      assert.strictEqual(
        resolveCardReference(
          'https://example.com/card/123',
          '@test-ref/skills/Skill/foo',
        ),
        'https://example.com/card/123',
      );
    });

    test('resolves a relative URL when relativeTo is a prefix-form ID', async function (assert) {
      assert.strictEqual(
        resolveCardReference('./foo.md', '@test-ref/skills/Skill/bar'),
        'http://localhost:9000/skills/Skill/foo.md',
      );
    });

    test('resolves a relative URL when relativeTo is a different prefix-form ID', async function (assert) {
      assert.strictEqual(
        resolveCardReference(
          './Component',
          '@test-ref/catalog/components/Card',
        ),
        'http://localhost:9000/catalog/components/Component',
      );
    });

    test('throws for an unregistered bare specifier', async function (assert) {
      assert.throws(
        () => resolveCardReference('unknown-pkg/foo', undefined),
        /Cannot resolve bare package specifier "unknown-pkg\/foo"/,
      );
    });
  });

  module('relativizeDocument with prefix-form IDs', function (hooks) {
    let prefix = '@test-rel/realm/';

    hooks.beforeEach(function () {
      registerCardReferencePrefix(prefix, 'http://test-host/my-realm/');
    });

    hooks.afterEach(function () {
      unregisterCardReferencePrefix(prefix);
    });

    test('succeeds when resource ID is a registered prefix', async function (assert) {
      let doc: SingleCardDocument = {
        data: {
          id: '@test-rel/realm/Card/my-instance',
          type: 'card' as const,
          attributes: { name: 'Test' },
          relationships: {},
          links: { self: 'http://test-host/my-realm/Card/my-instance' },
          meta: {
            adoptsFrom: {
              module: '../card-def',
              name: 'MyCard',
            },
          },
        },
      };

      let realmURL = new URL('http://test-host/my-realm/');

      try {
        relativizeDocument(doc, realmURL);
        assert.ok(
          true,
          'relativizeDocument handles prefix-form resource ID without throwing',
        );
      } catch (err) {
        assert.ok(
          false,
          `relativizeDocument threw for prefix-form resource ID: ${err}`,
        );
      }
    });

    test('succeeds when resource ID is a regular URL', async function (assert) {
      let doc: SingleCardDocument = {
        data: {
          id: 'http://test-host/my-realm/Card/my-instance',
          type: 'card' as const,
          attributes: { name: 'Test' },
          relationships: {},
          links: { self: 'http://test-host/my-realm/Card/my-instance' },
          meta: {
            adoptsFrom: {
              module: '../card-def',
              name: 'MyCard',
            },
          },
        },
      };

      let realmURL = new URL('http://test-host/my-realm/');

      try {
        relativizeDocument(doc, realmURL);
        assert.ok(true, 'relativizeDocument handles regular URL resource ID');
      } catch (err) {
        assert.ok(
          false,
          `relativizeDocument threw for regular URL resource ID: ${err}`,
        );
      }
    });
  });
});
