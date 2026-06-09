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

    test('a module error on a reused page recycles the affinity and recovers on a fresh page', async function (assert) {
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

      // The revalidation lands on the pinned (now stale) page. Rather than
      // caching its error, the prerenderer recycles the page and retries on
      // a fresh one, so the call recovers instead of reproducing the error.
      let second = await renderModule();
      assert.strictEqual(
        second.response.status,
        'ready',
        'the revalidation recovers instead of reproducing the stale-page error',
      );
      assert.notStrictEqual(
        second.pool.pageId,
        poisonedPageId,
        'recovery is served by a fresh page, not the pinned stale one',
      );
    });

    // The realm should not stay stuck on a stale page when a healthy one is
    // available: a revalidation escapes the pin (the stale page is recycled
    // and the retry lands on a fresh page) and recovers on its own.
    test('revalidation recovers while a healthy page is available', async function (assert) {
      let first = await renderModule();
      let poisonedPageId = first.pool.pageId;
      prerenderer.__test_poisonPage(poisonedPageId, moduleURL);

      let statuses: string[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        let result = await renderModule();
        statuses.push(result.response.status);
        if (result.response.status === 'ready') {
          break;
        }
      }

      assert.ok(
        statuses.includes('ready'),
        `a revalidation should recover without manual intervention; got statuses: ${statuses.join(
          ', ',
        )}`,
      );
    });
  });
});
