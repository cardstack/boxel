import { module, test } from 'qunit';

import type { IndexedInstance, Realm } from '@cardstack/runtime-common';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm, setupWorkspaceCard } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// The Workspace card is a realm's default index card, so its isolated shell is
// rendered by the indexer/prerender. This suite locks in the defensive patterns
// that keep that render cheap and crash-free: the Activity feed must stay lazy,
// and `linksToMany` entry points must not have `.constructor` called on them
// before they resolve.
//
// The Workspace is authored at a NON-index path (`ws.json`, not `index.json`) on
// purpose. The in-browser indexer substitutes boilerplate HTML for a realm's
// default index card (routes/render/html.ts `#isDefaultRealmIndexCard`), which
// would skip the Glimmer render entirely. Rendering it off the index path forces
// the real isolated render through the indexer so we actually exercise the
// component's constructor, modifiers, and template — the same path the
// production puppeteer prerender takes for the index card itself.
module(`Integration | Workspace indexing/prerender safety`, function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  async function getInstance(
    realm: Realm,
    url: URL,
  ): Promise<IndexedInstance | undefined> {
    let maybeInstance = await realm.realmIndexQueryEngine.instance(url);
    if (maybeInstance?.type === 'instance-error') {
      return undefined;
    }
    return maybeInstance as IndexedInstance | undefined;
  }

  function countOccurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  test('indexing a Workspace renders its isolated shell and resolves pinned entry points without eagerly loading the Activity feed', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        // Two plain cards pinned as entry points (a `linksToMany(CardDef)`).
        'pinned-a.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'pinned-b.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        // A Workspace pinning both cards. Off the index path so the real
        // isolated render runs (see the module comment).
        'ws.json': {
          data: {
            relationships: {
              'entryPoints.0': { links: { self: './pinned-a' } },
              'entryPoints.1': { links: { self: './pinned-b' } },
            },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/workspace',
                name: 'Workspace',
              },
            },
          },
        },
      },
    });

    let instance = await getInstance(realm, new URL(`${testRealmURL}ws`));
    assert.ok(
      instance,
      'the Workspace indexed cleanly (no render error on entry-point resolution)',
    );

    let isolatedHtml = instance?.isolatedHtml ?? '';
    assert.ok(
      isolatedHtml.includes('data-test-workspace-index'),
      'the Workspace isolated shell rendered (not boilerplate, no crash)',
    );
    assert.ok(
      isolatedHtml.includes('data-test-workspace-tab="home"'),
      'the Home tab is present',
    );
    assert.ok(
      isolatedHtml.includes('data-test-workspace-tab="activity"'),
      'the Activity tab is present',
    );

    // Home is the default segment: its Pinned zone only renders under the Home
    // segment, while the Library and Activity panes render only under their own
    // segments. Home content present + the other panes absent confirms the
    // prerender opened Home and nothing else.
    assert.ok(
      isolatedHtml.includes('Pinned'),
      'the Home segment rendered (the Pinned zone is present)',
    );

    // Entry points resolved and rendered as doors — the lazy `.constructor`
    // access (doorKind / entryPointsFilter getter) survived prerender.
    assert.strictEqual(
      countOccurrences(isolatedHtml, 'class="door"'),
      2,
      'both pinned entry points rendered as doors',
    );

    // The Activity feed must NOT hydrate at index time: its pane and rows only
    // render under the Activity segment, which prerender never opens.
    assert.notOk(
      isolatedHtml.includes('activity-pane'),
      'the Activity pane did not render at index time',
    );
    assert.notOk(
      isolatedHtml.includes('feed-row'),
      'no Activity feed rows were eagerly loaded during indexing',
    );
  });

  test('indexing a Workspace with no entry points still renders its shell cleanly', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'ws.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/workspace',
                name: 'Workspace',
              },
            },
          },
        },
      },
    });

    let instance = await getInstance(realm, new URL(`${testRealmURL}ws`));
    let isolatedHtml = instance?.isolatedHtml ?? '';
    assert.ok(
      isolatedHtml.includes('data-test-workspace-index'),
      'the empty Workspace isolated shell rendered without error',
    );
    assert.strictEqual(
      countOccurrences(isolatedHtml, 'class="door"'),
      0,
      'no doors render when there are no entry points',
    );
    assert.notOk(
      isolatedHtml.includes('feed-row'),
      'no Activity feed rows were eagerly loaded during indexing',
    );
  });
});
