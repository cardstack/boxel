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

  // Regression test for CS-10498: cards in prefix-mapped realms (like the
  // openrouter realm) threw TypeError: Invalid URL when served.
  //
  // After the import-maps change, unresolveResourceInstanceURLs converts
  // card IDs in the index to prefix form (e.g. "@cardstack/openrouter/...").
  // relativizeResource then used the raw prefix string as a URL base for
  // resolveCardReference, causing new URL() to throw when resolving
  // relative module deps like "../openrouter-model".
  //
  // The fix uses cardIdToURL() in realm-index-query-engine.ts to resolve
  // the prefix to a real URL first, and resolveCardReference also handles
  // prefix-form relativeTo strings internally.
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

    test('resolves linksTo relationship with relative URL and prefix-form resource ID', async function (assert) {
      // This mirrors the real bug: a SkillPlusMarkdown card at
      // @cardstack/skills/Skill/source-code-editing has a linksTo
      // relationship with links.self = "./source-code-editing.md".
      // processRelationships calls resolveCardReference("./source-code-editing.md",
      // "@cardstack/skills/Skill/source-code-editing") which must resolve
      // the prefix-form base before resolving the relative URL.
      let doc: SingleCardDocument = {
        data: {
          id: '@test-rel/realm/Skill/my-skill',
          type: 'card' as const,
          attributes: { name: 'My Skill' },
          relationships: {
            instructionsSource: {
              links: {
                self: './my-skill.md',
              },
            },
          },
          links: { self: 'http://test-host/my-realm/Skill/my-skill' },
          meta: {
            adoptsFrom: {
              module: '../skill',
              name: 'Skill',
            },
          },
        },
      };

      let realmURL = new URL('http://test-host/my-realm/');
      relativizeDocument(doc, realmURL);

      // The relationship link should be relativized correctly
      let rel = doc.data.relationships?.instructionsSource as any;
      assert.ok(rel, 'relationship exists after relativization');
      assert.ok(
        rel.links.self,
        'relationship links.self is preserved (not thrown)',
      );
    });

    test('resolves linksTo relationship with absolute URL and prefix-form resource ID', async function (assert) {
      // This mirrors the bug where a card at @cardstack/skills/Skill/boxel-environment
      // has a relationship pointing to https://cardstack.com/base/Theme/brand-guide.
      // processRelationships calls resolveCardReference(
      //   "https://cardstack.com/base/Theme/brand-guide",
      //   "@cardstack/skills/Skill/boxel-environment"
      // ) which must handle the absolute URL without using the prefix-form base.
      let doc: SingleCardDocument = {
        data: {
          id: '@test-rel/realm/Skill/env',
          type: 'card' as const,
          attributes: { name: 'Environment' },
          relationships: {
            theme: {
              links: {
                self: 'https://cardstack.com/base/Theme/brand-guide',
              },
            },
          },
          links: { self: 'http://test-host/my-realm/Skill/env' },
          meta: {
            adoptsFrom: {
              module: '../skill',
              name: 'Skill',
            },
          },
        },
      };

      let realmURL = new URL('http://test-host/my-realm/');
      relativizeDocument(doc, realmURL);

      let rel = doc.data.relationships?.theme as any;
      assert.ok(rel, 'relationship exists after relativization');
      assert.strictEqual(
        rel.links.self,
        'https://cardstack.com/base/Theme/brand-guide',
        'absolute URL to another realm is preserved as-is',
      );
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
