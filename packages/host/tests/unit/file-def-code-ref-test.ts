import { module, test } from 'qunit';

import {
  VirtualNetwork,
  baseRealm,
  baseRRI,
  isFileDefCodeRef,
} from '@cardstack/runtime-common';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

let { resolvedBaseRealmURL } = ENV;

// `isFileDefCodeRef` lets the client-side search filter dispatch its candidate
// pool (cards vs. file-meta) from the query's target type, so a file-meta
// search that is complete with zero server rows still reconciles locally
// hydrated FileDefs — rather than sniffing the kind off the first returned row,
// which is unavailable when the result set is empty.
//
// Refs reach it in prefix form (`@cardstack/base/…`) while the internal subtype
// map is built in full-URL form, so the comparison canonicalizes module
// spellings through the VirtualNetwork. The VN here registers the base realm
// the same way the host boot does — both the `addURLMapping` alias and the
// `@cardstack/base/` prefix mapping — so the two spellings collapse to one key.
module('Unit | isFileDefCodeRef', function (hooks) {
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(function () {
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
  });

  test('recognizes the base FileDef ref', function (assert) {
    assert.true(
      isFileDefCodeRef(
        { module: baseRRI('card-api'), name: 'FileDef' },
        virtualNetwork,
      ),
    );
  });

  test('recognizes a known extension subtype ref', function (assert) {
    assert.true(
      isFileDefCodeRef(
        { module: baseRRI('markdown-file-def'), name: 'MarkdownDef' },
        virtualNetwork,
      ),
      'MarkdownDef',
    );
    assert.true(
      isFileDefCodeRef(
        { module: baseRRI('png-image-def'), name: 'PngDef' },
        virtualNetwork,
      ),
      'PngDef',
    );
  });

  test('rejects a non-FileDef card ref', function (assert) {
    assert.false(
      isFileDefCodeRef(
        { module: baseRRI('card-api'), name: 'CardDef' },
        virtualNetwork,
      ),
    );
    assert.false(
      isFileDefCodeRef(
        {
          module: 'http://test-realm/test/book' as RealmResourceIdentifier,
          name: 'Book',
        },
        virtualNetwork,
      ),
    );
  });

  test('rejects undefined and non-resolved refs', function (assert) {
    assert.false(isFileDefCodeRef(undefined, virtualNetwork));
    assert.false(
      isFileDefCodeRef(
        {
          type: 'ancestorOf',
          card: { module: baseRRI('card-api'), name: 'FileDef' },
        },
        virtualNetwork,
      ),
      'a structured (non-module/name) ref is not treated as a FileDef ref',
    );
  });
});
