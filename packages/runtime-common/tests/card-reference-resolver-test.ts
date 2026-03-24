import type { SharedTests } from '../helpers';
import {
  registerCardReferencePrefix,
  resolveCardReference,
  cardIdToURL,
  isRegisteredPrefix,
} from '../card-reference-resolver';

const tests = Object.freeze({
  'resolveCardReference resolves relative URL against prefix-form ID via cardIdToURL':
    async (assert: Assert) => {
      // Regression test for CS-10498: a card in a prefix-mapped realm (e.g.
      // @cardstack/openrouter/) has its ID stored in prefix form after
      // unresolveResourceInstanceURLs runs during indexing. When
      // relativizeResource later tries to resolve a relative module URL
      // (like "../openrouter-model") against that prefix-form ID, passing
      // the raw prefix string as a URL base to new URL() throws
      // TypeError: Invalid URL.
      //
      // The fix resolves the prefix-form ID to a real URL first via
      // cardIdToURL() before using it as a relativeTo base.
      registerCardReferencePrefix(
        '@test-cs10498/',
        'http://test-host/my-realm/',
      );

      let prefixId = '@test-cs10498/SomeType/my-card';

      // Verify the ID is recognized as a registered prefix
      assert.true(
        isRegisteredPrefix(prefixId),
        'prefix-form ID is recognized as registered prefix',
      );

      // Verify cardIdToURL resolves the prefix to a real URL
      let resolvedURL = cardIdToURL(prefixId);
      assert.strictEqual(
        resolvedURL.href,
        'http://test-host/my-realm/SomeType/my-card',
        'cardIdToURL resolves prefix to full URL',
      );

      // Verify that resolving a relative module URL against the resolved
      // URL works — this is the code path after the fix
      let moduleURL = resolveCardReference(
        '../some-module',
        cardIdToURL(prefixId),
      );
      assert.strictEqual(
        moduleURL,
        'http://test-host/my-realm/some-module',
        'relative module URL resolves correctly against cardIdToURL result',
      );

      // Verify that resolving a relative module URL against the raw prefix
      // string throws — this is the original bug
      assert.throws(
        () => {
          resolveCardReference('../some-module', prefixId);
        },
        /Invalid URL/,
        'resolving relative URL against raw prefix string throws Invalid URL',
      );
    },

  'cardIdToURL works for both prefix-form and regular URL IDs':
    async (assert: Assert) => {
      registerCardReferencePrefix(
        '@test-cs10498-b/',
        'http://test-host/realm-b/',
      );

      // Prefix-form ID
      let prefixURL = cardIdToURL('@test-cs10498-b/Card/123');
      assert.strictEqual(
        prefixURL.href,
        'http://test-host/realm-b/Card/123',
        'prefix-form ID resolves to full URL',
      );

      // Regular URL ID
      let regularURL = cardIdToURL('http://example.com/realm/Card/456');
      assert.strictEqual(
        regularURL.href,
        'http://example.com/realm/Card/456',
        'regular URL ID passes through unchanged',
      );
    },
} satisfies SharedTests<Record<string, never>>);

export default tests;
