import { module, test } from 'qunit';

import { baseRRI, isFileDefCodeRef } from '@cardstack/runtime-common';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common';

// `isFileDefCodeRef` lets the client-side search filter dispatch its candidate
// pool (cards vs. file-meta) from the query's target type, so a file-meta
// search that is complete with zero server rows still reconciles locally
// hydrated FileDefs — rather than sniffing the kind off the first returned row,
// which is unavailable when the result set is empty.
module('Unit | isFileDefCodeRef', function () {
  test('recognizes the base FileDef ref', function (assert) {
    assert.true(
      isFileDefCodeRef({ module: baseRRI('card-api'), name: 'FileDef' }),
    );
  });

  test('recognizes a known extension subtype ref', function (assert) {
    assert.true(
      isFileDefCodeRef({
        module: baseRRI('markdown-file-def'),
        name: 'MarkdownDef',
      }),
      'MarkdownDef',
    );
    assert.true(
      isFileDefCodeRef({ module: baseRRI('png-image-def'), name: 'PngDef' }),
      'PngDef',
    );
  });

  test('rejects a non-FileDef card ref', function (assert) {
    assert.false(
      isFileDefCodeRef({ module: baseRRI('card-api'), name: 'CardDef' }),
    );
    assert.false(
      isFileDefCodeRef({
        module: 'http://test-realm/test/book' as RealmResourceIdentifier,
        name: 'Book',
      }),
    );
  });

  test('rejects undefined and non-resolved refs', function (assert) {
    assert.false(isFileDefCodeRef(undefined));
    assert.false(
      isFileDefCodeRef({
        type: 'ancestorOf',
        card: { module: baseRRI('card-api'), name: 'FileDef' },
      }),
      'a structured (non-module/name) ref is not treated as a FileDef ref',
    );
  });
});
