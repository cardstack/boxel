import { module, test } from 'qunit';
import { basename } from 'path';
import {
  registerCardReferencePrefix,
  unregisterCardReferencePrefix,
  resolveCardReference,
  resolveRRI,
  RealmPaths,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { ri, rri } from '@cardstack/runtime-common';
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
      // Build a SingleCardDocument that mirrors what the index returns for
      // a card in a prefix-mapped realm:
      // - links.self is a full URL (set by cardDocument)
      // - data.id is in prefix form (set by unresolveResourceInstanceURLs)
      // - meta.adoptsFrom.module is a relative URL (from serialization)
      let doc: SingleCardDocument = {
        data: {
          id: rri('@test-rel/realm/Card/my-instance'),
          type: 'card' as const,
          attributes: { name: 'Test' },
          relationships: {},
          links: { self: 'http://test-host/my-realm/Card/my-instance' },
          meta: {
            adoptsFrom: {
              module: rri('../card-def'),
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
          id: rri('@test-rel/realm/Skill/my-skill'),
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
              module: rri('../skill'),
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
          id: rri('@test-rel/realm/Skill/env'),
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
              module: rri('../skill'),
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
          id: rri('http://test-host/my-realm/Card/my-instance'),
          type: 'card' as const,
          attributes: { name: 'Test' },
          relationships: {},
          links: { self: 'http://test-host/my-realm/Card/my-instance' },
          meta: {
            adoptsFrom: {
              module: rri('../card-def'),
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
    let basePrefix = rri('@cardstack/base/');
    let catalogPrefix = rri('@cardstack/catalog/');

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
      let result = resolveRRI('@cardstack/base/string');
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('absolute scoped identifier with relativeTo is returned as-is', function (assert) {
      let result = resolveRRI('@cardstack/base/string', catalogPrefix);
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('absolute HTTP URL without relativeTo', function (assert) {
      let result = resolveRRI('http://localhost:4201/realm/card');
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('absolute HTTP URL with relativeTo is returned as-is', function (assert) {
      let result = resolveRRI('http://localhost:4201/realm/card', basePrefix);
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('absolute HTTPS URL is returned as-is', function (assert) {
      let result = resolveRRI('https://example.com/card/123');
      assert.strictEqual(result, 'https://example.com/card/123');
    });

    // --- Relative resolution against scoped base ---

    test('dot-slash relative against scoped base', function (assert) {
      let result = resolveRRI('./string', rri('@cardstack/base/'));
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('bare name against scoped base', function (assert) {
      let result = resolveRRI('card', rri('@cardstack/base/'));
      assert.strictEqual(result, '@cardstack/base/card');
    });

    test('dot-dot-slash against scoped base with subdirectory', function (assert) {
      let result = resolveRRI('../card', rri('@cardstack/base/fields/'));
      assert.strictEqual(result, '@cardstack/base/card');
    });

    test('dot-slash against scoped base without trailing slash', function (assert) {
      let result = resolveRRI('./string', rri('@cardstack/base/card-api'));
      assert.strictEqual(result, '@cardstack/base/string');
    });

    // --- Relative resolution against URL base ---

    test('dot-slash relative against URL base', function (assert) {
      let result = resolveRRI('./card', rri('http://localhost:4201/realm/'));
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('dot-dot-slash against URL base with subdirectory', function (assert) {
      let result = resolveRRI(
        '../card',
        rri('http://localhost:4201/realm/directory/'),
      );
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    test('bare name against URL base', function (assert) {
      let result = resolveRRI('card', rri('http://localhost:4201/realm/'));
      assert.strictEqual(result, 'http://localhost:4201/realm/card');
    });

    // --- $REALM resolution ---

    test('$REALM against scoped base', function (assert) {
      let result = resolveRRI(
        '$REALM/string',
        rri('@cardstack/base/fields/number'),
      );
      assert.strictEqual(result, '@cardstack/base/string');
    });

    test('$REALM against URL base', function (assert) {
      registerCardReferencePrefix(
        '@test/contact/',
        'https://home.boxel.ai/contact/',
      );
      try {
        let result = resolveRRI(
          '$REALM/card',
          rri('https://home.boxel.ai/contact/users/'),
        );
        assert.strictEqual(result, 'https://home.boxel.ai/contact/card');
      } finally {
        unregisterCardReferencePrefix('@test/contact/');
      }
    });

    // --- Invalid references ---

    test('throws for absolute path prefix', function (assert) {
      assert.throws(
        () => resolveRRI('/string', basePrefix),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws for tilde-slash prefix', function (assert) {
      assert.throws(
        () => resolveRRI('~/card', basePrefix),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws for absolute path against URL base', function (assert) {
      assert.throws(
        () =>
          resolveRRI('/card', rri('http://localhost:4201/realm/directory/')),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws for tilde-slash against URL base', function (assert) {
      assert.throws(
        () =>
          resolveRRI(
            rri('~/card'),
            rri('http://localhost:4201/realm/directory/'),
          ),
        /"\/" and "~\/" prefixes are not supported/,
      );
    });

    test('throws when relativeTo is missing for relative reference', function (assert) {
      assert.throws(
        () => resolveRRI('./foo'),
        /Cannot resolve "\.\/foo" without a relativeTo/,
      );
    });

    test('throws when relativeTo is missing for bare name', function (assert) {
      assert.throws(
        () => resolveRRI('card'),
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

      test('inRealm with RRI matches resource in realm', function (assert) {
        assert.true(paths.inRealm(rri('http://localhost:4201/base/card-api')));
      });

      test('inRealm with RRI matches realm root without trailing slash', function (assert) {
        assert.true(paths.inRealm(rri('http://localhost:4201/base')));
      });

      test('inRealm with RRI rejects resource outside realm', function (assert) {
        assert.false(paths.inRealm(rri('http://localhost:4201/other/card')));
      });

      test('local from RRI strips realm prefix', function (assert) {
        assert.strictEqual(
          paths.local(rri('http://localhost:4201/base/Card/my-instance')),
          'Card/my-instance',
        );
      });

      test('local from RRI strips trailing slashes', function (assert) {
        assert.strictEqual(
          paths.local(rri('http://localhost:4201/base/directory/')),
          'directory',
        );
      });

      test('local from RRI returns empty string for realm root', function (assert) {
        assert.strictEqual(paths.local(rri('http://localhost:4201/base/')), '');
      });

      test('local from RRI throws for resource outside realm', function (assert) {
        assert.throws(
          () => paths.local(rri('http://localhost:4201/other/card')),
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
      let paths = new RealmPaths(ri('@cardstack/base/'));

      test('realmId returns the scoped identifier', function (assert) {
        assert.strictEqual(paths.realmId, '@cardstack/base/');
      });

      test('url stores the scoped identifier', function (assert) {
        assert.strictEqual(paths.url, '@cardstack/base/');
      });

      test('inRealm with RRI matches scoped resource', function (assert) {
        assert.true(paths.inRealm(rri('@cardstack/base/card-api')));
      });

      test('inRealm with RRI matches realm root without trailing slash', function (assert) {
        assert.true(paths.inRealm(rri('@cardstack/base')));
      });

      test('inRealm with RRI rejects resource in different scope', function (assert) {
        assert.false(paths.inRealm(rri('@cardstack/catalog/card')));
      });

      test('local from RRI strips scoped prefix', function (assert) {
        assert.strictEqual(
          paths.local(rri('@cardstack/base/Card/my-instance')),
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

      test('fileURL throws for scoped RealmIdentifier', function (assert) {
        assert.throws(
          () => paths.fileURL('card-api'),
          /fileURL\(\) requires a URL-based RealmPaths/,
        );
      });

      test('directoryURL throws for scoped RealmIdentifier', function (assert) {
        assert.throws(
          () => paths.directoryURL('fields'),
          /directoryURL\(\) requires a URL-based RealmPaths/,
        );
      });

      test('inRealm with URL-form RRI returns false for scoped RealmIdentifier', function (assert) {
        // A URL-form RRI cannot match a scoped (prefix) realm via string prefix.
        assert.false(paths.inRealm(rri('http://example.com/foo')));
      });

      test('local throws for scoped RealmIdentifier', function (assert) {
        assert.throws(
          () => paths.local(new URL('http://example.com/foo')),
          /local\(\) requires a URL-based RealmPaths/,
        );
      });
    });
  });

  module('VirtualNetwork.addRealmMapping', function (hooks) {
    let vn: VirtualNetwork;
    let prefix = '@test/realm/';
    let target = 'http://localhost:9000/realm/';

    hooks.beforeEach(function () {
      vn = new VirtualNetwork();
      vn.addRealmMapping(prefix, target);
    });

    hooks.afterEach(function () {
      unregisterCardReferencePrefix(prefix);
    });

    test('populates importMap so resolveImport works', function (assert) {
      let result = vn.resolveImport('@test/realm/card-api');
      assert.strictEqual(result, 'http://localhost:9000/realm/card-api');
    });

    test('populates global prefixMappings so resolveCardReference works', function (assert) {
      let result = resolveCardReference('@test/realm/Foo', undefined);
      assert.strictEqual(result, 'http://localhost:9000/realm/Foo');
    });

    test('normalizes trailing slashes', function (assert) {
      unregisterCardReferencePrefix(prefix);
      let vn2 = new VirtualNetwork();
      // No trailing slashes
      vn2.addRealmMapping('@test/other', 'http://localhost:9000/other');
      let result = vn2.resolveImport('@test/other/card');
      assert.strictEqual(result, 'http://localhost:9000/other/card');
      unregisterCardReferencePrefix('@test/other/');
    });

    test('overwrites cleanly when called twice with same prefix', function (assert) {
      let newTarget = 'http://localhost:8000/realm/';
      vn.addRealmMapping(prefix, newTarget);
      let result = vn.resolveImport('@test/realm/card-api');
      assert.strictEqual(result, 'http://localhost:8000/realm/card-api');
    });

    test('knownRealms returns registered realm identifiers', function (assert) {
      let realms = vn.knownRealms();
      assert.true(
        realms.includes(ri('@test/realm/')),
        'contains the registered realm',
      );
    });

    test('knownRealms reflects multiple registrations', function (assert) {
      vn.addRealmMapping('@test/other/', 'http://localhost:9000/other/');
      let realms = vn.knownRealms();
      assert.strictEqual(realms.length, 2);
      assert.true(realms.includes(ri('@test/realm/')));
      assert.true(realms.includes(ri('@test/other/')));
      unregisterCardReferencePrefix('@test/other/');
    });
  });

  // VN-method coverage for the resolver. Each test owns a local VN, so
  // they don't interact with the global `prefixMappings` registry that
  // the modules above (testing the deprecated standalone functions)
  // rely on. CS-10752 plumbs the resolver state onto VN; the standalone
  // forms above will be removed once their call sites migrate.
  module('VirtualNetwork resolver methods', function () {
    function makeVN() {
      let vn = new VirtualNetwork();
      vn.addRealmMapping('@cardstack/base/', 'http://localhost:4201/base/');
      vn.addRealmMapping(
        '@cardstack/catalog/',
        'http://localhost:4201/catalog/',
      );
      return vn;
    }

    module('isRegisteredPrefix', function () {
      test('returns true for a registered prefix-form reference', function (assert) {
        let vn = makeVN();
        assert.true(vn.isRegisteredPrefix('@cardstack/base/card-api'));
      });

      test('returns false for an unregistered prefix', function (assert) {
        let vn = makeVN();
        assert.false(vn.isRegisteredPrefix('@cardstack/openrouter/foo'));
      });

      test('returns false for a URL-form reference', function (assert) {
        let vn = makeVN();
        assert.false(vn.isRegisteredPrefix('http://example.com/foo'));
      });

      test('uses only this VN’s mappings — not a sibling VN', function (assert) {
        let vn = makeVN();
        let other = new VirtualNetwork();
        other.addRealmMapping('@other/realm/', 'http://other.example.com/');
        assert.false(vn.isRegisteredPrefix('@other/realm/foo'));
        assert.true(other.isRegisteredPrefix('@other/realm/foo'));
      });
    });

    module('unresolveURL', function () {
      test('converts a URL matching a registered target to prefix form', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.unresolveURL('http://localhost:4201/base/card-api'),
          '@cardstack/base/card-api',
        );
      });

      test('returns the URL as-is when no target matches', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.unresolveURL('http://other.example.com/foo'),
          'http://other.example.com/foo',
        );
      });
    });

    module('toURL', function () {
      test('resolves a prefix-form RRI to its URL', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.toURL('@cardstack/base/card-api').href,
          'http://localhost:4201/base/card-api',
        );
      });

      test('passes a URL-form RRI through to new URL()', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.toURL('http://example.com/card/123').href,
          'http://example.com/card/123',
        );
      });

      test('throws on a bare local identifier that resolves to neither', function (assert) {
        let vn = makeVN();
        assert.throws(() => vn.toURL('welcome-to-boxel-sample'), /Invalid URL/);
      });
    });

    module('resolveRRI', function () {
      test('returns prefix-form references as-is', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.resolveRRI('@cardstack/base/string'),
          '@cardstack/base/string',
        );
      });

      test('returns URL-form references as-is', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.resolveRRI('http://example.com/card'),
          'http://example.com/card',
        );
      });

      test('resolves a relative reference against a prefix-form base', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.resolveRRI('./string', rri('@cardstack/base/card-api')),
          '@cardstack/base/string',
        );
      });

      test('resolves a relative reference against a URL-form base', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.resolveRRI('./card', rri('http://localhost:4201/realm/')),
          'http://localhost:4201/realm/card',
        );
      });

      test('resolves $REALM/ against a prefix-form base', function (assert) {
        let vn = makeVN();
        assert.strictEqual(
          vn.resolveRRI('$REALM/string', rri('@cardstack/base/fields/number')),
          '@cardstack/base/string',
        );
      });

      test('throws for "/" prefix', function (assert) {
        let vn = makeVN();
        assert.throws(
          () => vn.resolveRRI('/string', rri('@cardstack/base/')),
          /"\/" and "~\/" prefixes are not supported/,
        );
      });

      test('uses only this VN’s mappings', function (assert) {
        let vn = makeVN();
        let other = new VirtualNetwork();
        other.addRealmMapping('@other/realm/', 'http://other.example.com/');
        // The other VN's prefix isn't registered here, so the resolver
        // treats `@other/realm/foo` as a non-resolvable bare reference.
        assert.throws(
          () => vn.resolveRRI('./bar', rri('@other/realm/foo')),
          /no matching prefix mapping/,
        );
      });
    });
  });

  module('VirtualNetwork.fetch with RRI', function (hooks) {
    let vn: VirtualNetwork;
    let prefix = '@test/fetch-realm/';
    let target = 'http://localhost:9000/fetch-realm/';

    hooks.beforeEach(function () {
      vn = new VirtualNetwork();
      vn.addRealmMapping(prefix, target);
    });

    hooks.afterEach(function () {
      unregisterCardReferencePrefix(prefix);
    });

    test('resolves scoped RRI to real URL and fetches', async function (assert) {
      let interceptedUrl: string | undefined;
      vn.mount(async (req: Request) => {
        interceptedUrl = req.url;
        return new Response('ok', { status: 200 });
      });

      let response = await vn.fetch('@test/fetch-realm/card-api');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        interceptedUrl,
        'http://localhost:9000/fetch-realm/card-api',
      );
    });

    test('passes through normal URLs unchanged', async function (assert) {
      let interceptedUrl: string | undefined;
      vn.mount(async (req: Request) => {
        interceptedUrl = req.url;
        return new Response('ok', { status: 200 });
      });

      await vn.fetch('http://localhost:9000/fetch-realm/card-api');
      assert.strictEqual(
        interceptedUrl,
        'http://localhost:9000/fetch-realm/card-api',
      );
    });

    test('passes RequestInit through when fetching with RRI', async function (assert) {
      let interceptedMethod: string | undefined;
      vn.mount(async (req: Request) => {
        interceptedMethod = req.method;
        return new Response('ok', { status: 200 });
      });

      await vn.fetch('@test/fetch-realm/card-api', { method: 'POST' });
      assert.strictEqual(interceptedMethod, 'POST');
    });

    test('@cardstack/base/card-api resolves through full fetch chain', async function (assert) {
      let baseVN = new VirtualNetwork();
      baseVN.addRealmMapping('@cardstack/base/', 'http://localhost:4201/base/');
      let interceptedUrl: string | undefined;
      baseVN.mount(async (req: Request) => {
        interceptedUrl = req.url;
        return new Response('ok', { status: 200 });
      });

      let response = await baseVN.fetch('@cardstack/base/card-api');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(interceptedUrl, 'http://localhost:4201/base/card-api');
      unregisterCardReferencePrefix('@cardstack/base/');
    });
  });
});
