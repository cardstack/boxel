import { module, test } from 'qunit';

import {
  isExactRealmView,
  isRealmViewContext,
  REALM_VIEW_CONTEXT_SPEC,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';

import { realmViewHeaders } from '@cardstack/host/lib/prerender-fetch-headers';

module('Unit | Realm view context', function (hooks) {
  hooks.afterEach(function () {
    delete (
      globalThis as unknown as {
        __boxelRealmView?: { realmURL: string; view: string };
      }
    ).__boxelRealmView;
  });

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

  test('stamps only requests for the selected Realm', function (assert) {
    let view = 'a'.repeat(64);
    (
      globalThis as unknown as {
        __boxelRealmView?: { realmURL: string; view: string };
      }
    ).__boxelRealmView = {
      realmURL: 'https://realms.example/cardstack/pretui/',
      view,
    };

    assert.deepEqual(
      realmViewHeaders('https://realms.example/cardstack/pretui/button.gts'),
      { 'X-Boxel-Realm-View': view },
      'an exact Realm resource carries the selected view',
    );
    assert.deepEqual(
      realmViewHeaders([
        'https://realms.example/cardstack/base/',
        'https://realms.example/cardstack/pretui/',
      ]),
      { 'X-Boxel-Realm-View': view },
      'a federated search including the exact Realm carries the view',
    );
    assert.deepEqual(
      realmViewHeaders('https://realms.example/cardstack/base/card-api'),
      {},
      "an imported Realm never receives another Realm's view hash",
    );
  });
});
