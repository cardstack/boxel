import { module, test } from 'qunit';
import { basename } from 'path';
import {
  registerCardReferencePrefix,
  unregisterCardReferencePrefix,
  resolveCardReference,
  resolveRRI,
  RealmPaths,
} from '@cardstack/runtime-common';
import type {
  SingleCardDocument,
  RealmResourceIdentifier,
  RealmIdentifier,
} from '@cardstack/runtime-common';
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
      // Build a SingleCardDocument that mirrors what the index returns for
      // a card in a prefix-mapped realm:
      // - links.self is a full URL (set by cardDocument)
      // - data.id is in prefix form (set by unresolveResourceInstanceURLs)
      // - meta.adoptsFrom.module is a relative URL (from serialization)
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

      // This is the exact call that getCard → cardDocument makes.
      // Without the fix, it throws TypeError: Invalid URL because
      // relativizeResource passes the prefix-form data.id directly
      // as a URL base to resolveCardReference.
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
      // relativizeDocument (via resolveCardReference) must resolve the
      // prefix-form base before resolving the relative URL.
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

      let rel = doc.data.relationships?.instructionsSource as any;
      assert.ok(rel, 'relationship exists after relativization');
      assert.strictEqual(
        rel.links.self,
        './my-skill.md',
        'relationship links.self is relativized relative to realm root',
      );
    });

    test('resolves linksTo relationship with absolute URL and prefix-form resource ID', async function (assert) {
      // This mirrors the bug where a card at @cardstack/skills/Skill/boxel-environment
      // has a relationship pointing to https://cardstack.com/base/Theme/brand-guide.
      // relativizeDocument (via resolveCardReference) must handle the absolute
      // URL without using the prefix-form base.
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

  module('resolveRRI', function (hooks) {
    let basePrefix = '@cardstack/base/' as RealmResourceIdentifier;
    let catalogPrefix = '@cardstack/catalog/' as RealmResourceIdentifier;

    hooks.beforeEach(function () {
      registerCardReferencePrefix(
        '@cardstack/base/',
        'http://localhost:4201/base/',
      );
      registerCardReferencePrefix(
        '@cardstack/catalog/',
        'http://localhost:4201/catalog/',
      );
    });

    hooks.afterEach(function () {
      unregisterCardReferencePrefix('@cardstack/base/');
      unregisterCardReferencePrefix('@cardstack/catalog/');
    });

    // --- Absolute references (return as-is) ---

    test('absolute scoped identifier without relativeTo', function (assert) {
      let result = resolveRRI(
        '@cardstack/base/string' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('absolute scoped identifier with relativeTo is returned as-is', function (assert) {
      let result = resolveRRI(
        '@cardstack/base/string' as RealmResourceIdentifier,
        catalogPrefix,
      );
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('absolute HTTP URL without relativeTo', function (assert) {
      let result = resolveRRI(
        'http://localhost:4201/realm/card' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('absolute HTTP URL with relativeTo is returned as-is', function (assert) {
      let result = resolveRRI(
        'http://localhost:4201/realm/card' as RealmResourceIdentifier,
        basePrefix,
      );
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('absolute HTTPS URL is returned as-is', function (assert) {
      let result = resolveRRI(
        'https://example.com/card/123' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, 'https://example.com/card/123');
    });

    // --- Relative resolution against scoped base ---

    test('dot-slash relative against scoped base', function (assert) {
      let result = resolveRRI(
        './string' as RealmResourceIdentifier,
        '@cardstack/base/' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('bare name against scoped base', function (assert) {
      let result = resolveRRI(
        'card' as RealmResourceIdentifier,
        '@cardstack/base/' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, '@cardstack/base/card');
    });

    test('dot-dot-slash against scoped base with subdirectory', function (assert) {
      let result = resolveRRI(
        '../card' as RealmResourceIdentifier,
        '@cardstack/base/fields/' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, '@cardstack/base/card');
    });

    test('dot-slash against scoped base without trailing slash', function (assert) {
      let result = resolveRRI(
        './string' as RealmResourceIdentifier,
        '@cardstack/base/card-api' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, '@cardstack/base/string');
    });

    // --- Relative resolution against URL base ---

    test('dot-slash relative against URL base', function (assert) {
      let result = resolveRRI(
        './card' as RealmResourceIdentifier,
        'http://localhost:4201/realm/' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('dot-dot-slash against URL base with subdirectory', function (assert) {
      let result = resolveRRI(
        '../card' as RealmResourceIdentifier,
        'http://localhost:4201/realm/directory/' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('bare name against URL base', function (assert) {
      let result = resolveRRI(
        'card' as RealmResourceIdentifier,
        'http://localhost:4201/realm/' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    // --- $thisRealm resolution ---

    test('$thisRealm against scoped base', function (assert) {
      let result = resolveRRI(
        '$thisRealm/string' as RealmResourceIdentifier,
        '@cardstack/base/fields/number' as RealmResourceIdentifier,
      );
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('$thisRealm against URL base', function (assert) {
      registerCardReferencePrefix(
        '@test/contact/',
        'https://home.boxel.ai/contact/',
      );
      try {
        let result = resolveRRI(
          '$thisRealm/card' as RealmResourceIdentifier,
          'https://home.boxel.ai/contact/users/' as RealmResourceIdentifier,
        );
        assert.strictEqual(result, 'https://home.boxel.ai/contact/card');
      } finally {
        unregisterCardReferencePrefix('@test/contact/');
      }
    });

    // --- Invalid references ---

    test('throws for absolute path prefix', function (assert) {
      assert.throws(
        () => resolveRRI('/string' as RealmResourceIdentifier, basePrefix),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws for tilde-slash prefix', function (assert) {
      assert.throws(
        () => resolveRRI('~/card' as RealmResourceIdentifier, basePrefix),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws for absolute path against URL base', function (assert) {
      assert.throws(
        () =>
          resolveRRI(
            '/card' as RealmResourceIdentifier,
            'http://localhost:4201/realm/directory/' as RealmResourceIdentifier,
          ),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws for tilde-slash against URL base', function (assert) {
      assert.throws(
        () =>
          resolveRRI(
            '~/card' as RealmResourceIdentifier,
            'http://localhost:4201/realm/directory/' as RealmResourceIdentifier,
          ),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws when relativeTo is missing for relative reference', function (assert) {
      assert.throws(
        () => resolveRRI('./foo' as RealmResourceIdentifier),
        /Cannot resolve "\.\/foo" without a relativeTo/,
      );
    });

    test('throws when relativeTo is missing for bare name', function (assert) {
      assert.throws(
        () => resolveRRI('card' as RealmResourceIdentifier),
        /Cannot resolve "card" without a relativeTo/,
      );
    });
  });

  module('RealmPaths RRI methods', function () {
    module('constructed from URL', function () {
      let paths = new RealmPaths(new URL('http://localhost:4201/base/'));

      test('realmId returns RealmIdentifier', function (assert) {
        assert.strictEqual(paths.realmId, 'http://localhost:4201/base/');
      });

      test('inRealmRRI matches resource in realm', function (assert) {
        assert.true(
          paths.inRealmRRI(
            'http://localhost:4201/base/card-api' as RealmResourceIdentifier,
          ),
        );
      });

      test('inRealmRRI matches realm root without trailing slash', function (assert) {
        assert.true(
          paths.inRealmRRI(
            'http://localhost:4201/base' as RealmResourceIdentifier,
          ),
        );
      });

      test('inRealmRRI rejects resource outside realm', function (assert) {
        assert.false(
          paths.inRealmRRI(
            'http://localhost:4201/other/card' as RealmResourceIdentifier,
          ),
        );
      });

      test('localFromRRI strips realm prefix', function (assert) {
        assert.strictEqual(
          paths.localFromRRI(
            'http://localhost:4201/base/Card/my-instance' as RealmResourceIdentifier,
          ),
          'Card/my-instance',
        );
      });

      test('localFromRRI strips trailing slashes', function (assert) {
        assert.strictEqual(
          paths.localFromRRI(
            'http://localhost:4201/base/directory/' as RealmResourceIdentifier,
          ),
          'directory',
        );
      });

      test('localFromRRI returns empty string for realm root', function (assert) {
        assert.strictEqual(
          paths.localFromRRI(
            'http://localhost:4201/base/' as RealmResourceIdentifier,
          ),
          '',
        );
      });

      test('localFromRRI throws for resource outside realm', function (assert) {
        assert.throws(
          () =>
            paths.localFromRRI(
              'http://localhost:4201/other/card' as RealmResourceIdentifier,
            ),
          /does not contain/,
        );
      });

      test('fileRRI joins realm prefix and local path', function (assert) {
        assert.strictEqual(
          paths.fileRRI('Card/my-instance'),
          'http://localhost:4201/base/Card/my-instance',
        );
      });

      test('directoryRRI joins realm prefix, local path, and trailing slash', function (assert) {
        assert.strictEqual(
          paths.directoryRRI('Card'),
          'http://localhost:4201/base/Card/',
        );
      });

      test('directoryRRI returns realm root for empty path', function (assert) {
        assert.strictEqual(
          paths.directoryRRI(''),
          'http://localhost:4201/base/',
        );
      });
    });

    module('constructed from RealmIdentifier', function () {
      let paths = new RealmPaths('@cardstack/base/' as RealmIdentifier);

      test('realmId returns the scoped identifier', function (assert) {
        assert.strictEqual(paths.realmId, '@cardstack/base/');
      });

      test('url stores the scoped identifier', function (assert) {
        assert.strictEqual(paths.url, '@cardstack/base/');
      });

      test('inRealmRRI matches scoped resource', function (assert) {
        assert.true(
          paths.inRealmRRI(
            '@cardstack/base/card-api' as RealmResourceIdentifier,
          ),
        );
      });

      test('inRealmRRI matches realm root without trailing slash', function (assert) {
        assert.true(
          paths.inRealmRRI('@cardstack/base' as RealmResourceIdentifier),
        );
      });

      test('inRealmRRI rejects resource in different scope', function (assert) {
        assert.false(
          paths.inRealmRRI(
            '@cardstack/catalog/card' as RealmResourceIdentifier,
          ),
        );
      });

      test('localFromRRI strips scoped prefix', function (assert) {
        assert.strictEqual(
          paths.localFromRRI(
            '@cardstack/base/Card/my-instance' as RealmResourceIdentifier,
          ),
          'Card/my-instance',
        );
      });

      test('fileRRI joins scoped prefix and local path', function (assert) {
        assert.strictEqual(
          paths.fileRRI('card-api'),
          '@cardstack/base/card-api',
        );
      });

      test('directoryRRI joins scoped prefix, local path, and trailing slash', function (assert) {
        assert.strictEqual(
          paths.directoryRRI('fields'),
          '@cardstack/base/fields/',
        );
      });
    });
  });
});
