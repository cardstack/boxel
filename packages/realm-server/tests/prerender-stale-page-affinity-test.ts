import { module, test } from 'qunit';
import { basename } from 'path';
import type { RealmPermissions } from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/index';
import {
  setupPermissionedRealmsCached,
  testCreatePrerenderAuth,
  getPrerendererForTesting,
} from './helpers';

// Exercises how affinity routing behaves when one pool page can no longer
// render a module — the shape of the staging incident where a prerender
// page running an outdated host bundle failed every module render routed
// to it. A real stale page differs from its peers only by the bytes
// already loaded into its browser context, which a test can't reproduce
// without shipping two host builds, so `__test_poisonPage` injects that
// per-page failure by pageId. Everything else is the real pool: real
// Chrome, real affinity selection, real reuse.
module(basename(__filename), function () {
  module('prerender - stale page affinity routing', function (hooks) {
    let realmURL = 'http://127.0.0.1:4459/test/';
    let prerenderServerURL = new URL(realmURL).origin;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {
      [realmURL]: ['read', 'write', 'realm-owner'],
    };
    let prerenderer: Prerenderer;
    let moduleURL = `${realmURL}person.gts`;
    let auth = () => {
      let sessions = JSON.parse(
        testCreatePrerenderAuth(testUserId, permissions),
      ) as Record<string, string>;
      let token = sessions[realmURL];
      if (token) {
        sessions[new URL(realmURL).origin + '/'] = token;
      }
      return JSON.stringify(sessions);
    };

    hooks.before(async () => {
      prerenderer = getPrerendererForTesting({
        // Two pages so a healthy standby is available alongside the page
        // that gets poisoned — the latent capacity the incident write-up
        // notes was never used because every retry pinned to the bad page.
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.afterEach(async () => {
      prerenderer.__test_clearPoisonedPages();
      await prerenderer.disposeAffinity({
        affinityType: 'realm',
        affinityValue: realmURL,
      });
    });

    setupPermissionedRealmsCached(hooks, {
      realms: [
        {
          realmURL,
          permissions: {
            '*': ['read'],
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
              export class Person extends CardDef {
                static displayName = "Person";
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  <template>{{@model.name}}</template>
                }
              }
            `,
          },
        },
      ],
    });

    function renderModule() {
      return prerenderer.prerenderModule({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
        renderOptions: { clearCache: true },
      });
    }

    test('a stale pool page keeps the realm affinity pinned to its failures', async function (assert) {
      let first = await renderModule();
      assert.strictEqual(
        first.response.status,
        'ready',
        'the initial module render succeeds on a healthy page',
      );
      let poisonedPageId = first.pool.pageId;

      // The page's host bundle goes stale: this page can no longer render
      // the module, every other page still can.
      prerenderer.__test_poisonPage(poisonedPageId, moduleURL);

      let second = await renderModule();
      assert.true(
        second.pool.reused,
        'the revalidation reuses the affinity-pinned page',
      );
      assert.strictEqual(
        second.pool.pageId,
        poisonedPageId,
        'the revalidation routes back to the same (stale) page',
      );
      assert.strictEqual(
        second.response.status,
        'error',
        'the stale page reproduces the failure',
      );
      assert.ok(
        JSON.stringify(second.response.error ?? {}).includes(
          'has no exported member',
        ),
        'the failure is the stale-bundle module error',
      );

      // Once the page is no longer stale, the same pinned page recovers —
      // the page itself was never broken, only its loaded bundle.
      prerenderer.__test_clearPoisonedPages();
      let third = await renderModule();
      assert.strictEqual(
        third.pool.pageId,
        poisonedPageId,
        'recovery happens on the same pinned page',
      );
      assert.strictEqual(
        third.response.status,
        'ready',
        'a fresh bundle on the pinned page renders cleanly again',
      );
    });

    // Desired behavior once revalidation is allowed to escape affinity
    // pinning (recycle the stale page, or route the retry to a healthy
    // one). Today every same-affinity render reuses the stale page, so no
    // amount of revalidation recovers while a healthy page sits idle —
    // this is expected to fail until that fix lands, at which point QUnit
    // flags it for promotion to a normal test.
    test.todo(
      'revalidation recovers via a healthy page while one page is stale',
      async function (assert) {
        let first = await renderModule();
        let poisonedPageId = first.pool.pageId;
        prerenderer.__test_poisonPage(poisonedPageId, moduleURL);

        let recovered = false;
        let recoveredPageId: string | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          let result = await renderModule();
          if (result.response.status === 'ready') {
            recovered = true;
            recoveredPageId = result.pool.pageId;
            break;
          }
        }

        assert.true(
          recovered,
          'a revalidation eventually renders cleanly without manual intervention',
        );
        assert.notStrictEqual(
          recoveredPageId,
          poisonedPageId,
          'recovery is served by a different page than the stale one',
        );
      },
    );
  });
});
