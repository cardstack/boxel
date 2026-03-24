import type { SharedTests } from '../helpers';
import { registerCardReferencePrefix } from '../card-reference-resolver';
import { relativizeDocument } from '../realm-index-query-engine';
import type { SingleCardDocument } from '../index';

const tests = Object.freeze({
  // Regression test for CS-10498: cards in prefix-mapped realms (like
  // @cardstack/openrouter/) threw TypeError: Invalid URL when served.
  //
  // After the import-maps change, unresolveResourceInstanceURLs converts
  // card IDs in the index to prefix form (e.g. "@cardstack/openrouter/...").
  // relativizeResource then used the raw prefix string as a URL base for
  // resolveCardReference, causing new URL() to throw when resolving
  // relative module deps like "../openrouter-model".
  //
  // The fix uses cardIdToURL() to resolve the prefix to a real URL first.
  'relativizeDocument succeeds when resource ID is a registered prefix': async (
    assert: Assert,
  ) => {
    registerCardReferencePrefix('@test-cs10498/', 'http://test-host/my-realm/');

    // Build a SingleCardDocument that mirrors what the index returns for
    // a card in a prefix-mapped realm:
    // - links.self is a full URL (set by cardDocument)
    // - data.id is in prefix form (set by unresolveResourceInstanceURLs)
    // - meta.adoptsFrom.module is a relative URL (from serialization)
    let doc: SingleCardDocument = {
      data: {
        id: '@test-cs10498/Card/my-instance',
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
  },

  'relativizeDocument succeeds when resource ID is a regular URL': async (
    assert: Assert,
  ) => {
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
  },
} satisfies SharedTests<Record<string, never>>);

export default tests;
