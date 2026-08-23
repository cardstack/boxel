import { module, test } from 'qunit';

import {
  isExactRealmView,
  isRealmViewContext,
  REALM_VIEW_CONTEXT_SPEC,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';

import {
  realmEventMatchesSelectedView,
  realmViewHeaders,
} from '@cardstack/host/lib/prerender-fetch-headers';
import {
  clearRealmViewSelection,
  installRealmViewSelection,
} from '@cardstack/host/lib/realm-view-selection';

module('Unit | Realm view context', function (hooks) {
  hooks.afterEach(function () {
    clearRealmViewSelection();
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

  test('an interactive selection supersedes the prerender fallback', function (assert) {
    let prerenderView = 'a'.repeat(64);
    let interactiveView = 'b'.repeat(64);
    (
      globalThis as unknown as {
        __boxelRealmView?: { realmURL: string; view: string };
      }
    ).__boxelRealmView = {
      realmURL: 'https://realms.example/cardstack/base/',
      view: prerenderView,
    };
    installRealmViewSelection('https://realms.example/cardstack/pretui/', {
      context: {
        schema: REALM_VIEW_CONTEXT_SPEC,
        realmRRI: '@cardstack/pretui/',
        branch: 'ana/compact-status',
        repositoryHash: 'c'.repeat(64),
        treeHash: 'd'.repeat(64),
        lockHash: 'e'.repeat(64),
        historyHead: 'jj-step-8',
      },
      indexGenerationHash: interactiveView,
    });

    assert.deepEqual(
      realmViewHeaders('https://realms.example/cardstack/pretui/button.gts'),
      { 'X-Boxel-Realm-View': interactiveView },
    );
    assert.deepEqual(
      realmViewHeaders('https://realms.example/cardstack/base/card-api'),
      {},
      'the imported Realm stays live instead of inheriting either view',
    );
  });

  test('delivers only execution events for the selected view while preserving branch activity', function (assert) {
    let realmURL = 'https://realms.example/cardstack/pretui/';
    let view = 'a'.repeat(64);
    (
      globalThis as unknown as {
        __boxelRealmView?: { realmURL: string; view: string };
      }
    ).__boxelRealmView = { realmURL, view };

    let renderEvent = (realmView?: string) => ({
      eventName: 'prerender_html' as const,
      realmURL,
      ...(realmView ? { realmView } : {}),
      generation: 2,
      invalidations: [`${realmURL}button`],
    });
    assert.true(
      realmEventMatchesSelectedView(renderEvent(view)),
      'the selected exact view refreshes its Host graph',
    );
    assert.false(
      realmEventMatchesSelectedView(renderEvent()),
      'a live render cannot refresh an exact Host graph',
    );
    assert.false(
      realmEventMatchesSelectedView(renderEvent('b'.repeat(64))),
      'a sibling branch cannot refresh the selected Host graph',
    );
    assert.true(
      realmEventMatchesSelectedView({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: 'https://realms.example/cardstack/base/',
        invalidations: ['https://realms.example/cardstack/base/card-api'],
      }),
      'ordinary live dependencies still refresh normally',
    );
    assert.true(
      realmEventMatchesSelectedView({
        eventName: 'branch',
        realmURL,
        branch: 'ana/compact-status',
        previousRealmView: 'b'.repeat(64),
        realmView: view,
        refGeneration: 3,
        repositoryHash: 'c'.repeat(64),
        treeHash: 'd'.repeat(64),
        historyHead: 'jj-step-3',
        message: 'Tighten compact status spacing',
      }),
      'branch movement remains visible as collaboration activity',
    );
  });
});
