import { module, test } from 'qunit';

import {
  isExactRealmView,
  isRealmViewContext,
  REALM_VIEW_CONTEXT_SPEC,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';

module('Unit | Realm view context', function () {
  test('validates one exact immutable view identity', function (assert) {
    let hash = 'a'.repeat(64);
    let context = {
      schema: REALM_VIEW_CONTEXT_SPEC,
      realmRRI: '@cardstack/pretui/',
      branch: 'ana/compact-status',
      repositoryHash: hash,
      treeHash: 'b'.repeat(64),
      lockHash: 'c'.repeat(64),
      historyHead: 'jj-step-7',
    };

    assert.true(isRealmViewContext(context));
    assert.true(
      isExactRealmView({ context, indexGenerationHash: 'd'.repeat(64) }),
    );
    assert.false(isExactRealmView({ context, indexGenerationHash: 'main' }));
  });

  test('gives live and exact views independent indexing lanes', function (assert) {
    let realmURL = 'https://realms.example/cardstack/pretui/';
    let viewA = 'a'.repeat(64);
    let viewB = 'b'.repeat(64);

    assert.notStrictEqual(
      indexingConcurrencyGroup(realmURL),
      indexingConcurrencyGroup(realmURL, viewA),
    );
    assert.notStrictEqual(
      indexingConcurrencyGroup(realmURL, viewA),
      indexingConcurrencyGroup(realmURL, viewB),
    );
    assert.strictEqual(
      indexingConcurrencyGroup(realmURL, viewA),
      indexingConcurrencyGroup(realmURL, viewA),
    );
    assert.notStrictEqual(
      prerenderHtmlConcurrencyGroup(realmURL),
      prerenderHtmlConcurrencyGroup(realmURL, viewA),
    );
    assert.notStrictEqual(
      prerenderHtmlConcurrencyGroup(realmURL, viewA),
      prerenderHtmlConcurrencyGroup(realmURL, viewB),
    );
  });
});
