import { module, test } from 'qunit';
import supertest from 'supertest';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  rri,
  type ModulePrerenderArgs,
  type ModuleRenderResponse,
  type Prerenderer,
  type PrerenderVisitArgs,
  type RunCommandArgs,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmsCached,
  getTestPrerenderer,
  withRealmPath,
  type RealmRequest,
} from './helpers';

// Reproduces a prerender page serving stale module code: the page's host
// bundle predates an export that a freshly-deployed module imports, so
// every module render on that page fails with "has no exported member".
// Because the realm is publicly readable, the resulting module error is
// persisted to the `modules` table under cache_scope='public', and every
// anonymous card GET that needs that definition 500s. The error-cache TTL
// does trigger revalidation renders, but affinity routing pins each retry
// to the same stale page, which reproduces the error and re-poisons the
// cache — the realm cannot recover until a render lands on a fresh page.
//
// The stale page is simulated by a Prerenderer wrapper: while "pinned" it
// answers module renders for the target module with the same error shape
// the render-runner produces for an in-page module failure; all other
// traffic (and the "fresh page" recovery phase) delegates to the real
// test prerender server.
module(basename(__filename), function () {
  module('stale prerender page poisons public modules cache', function (hooks) {
    const realmURL = 'http://127.0.0.1:5523/test/';
    const personModuleHref = `${realmURL}person.gts`;

    let request: RealmRequest;
    let dbAdapter: PgAdapter;

    // While true, module renders for person.gts behave like a render on a
    // pool page whose host bundle is stale. The render count lets tests
    // distinguish "served from the cached error row" from "revalidation
    // triggered a fresh render".
    let stalePagePinned = false;
    let stalePageRenderCount = 0;

    function stalePageModuleError(url: string): ModuleRenderResponse {
      // Mirrors the error response the render-runner assembles when the
      // in-page module evaluation fails (see prerenderModuleAttempt).
      return {
        id: url,
        status: 'error',
        nonce: 'stale-page-nonce',
        isShimmed: false,
        lastModified: 0,
        createdAt: 0,
        deps: [],
        definitions: {},
        error: {
          type: 'module-error',
          error: {
            message: `Module '@cardstack/runtime-common' has no exported member 'buildWaiter'.`,
            status: 500,
            title: 'Module Error',
            additionalErrors: null,
          },
        },
      };
    }

    function isTargetModule(url: string): boolean {
      return (
        url.replace(/\.gts$/, '') === personModuleHref.replace(/\.gts$/, '')
      );
    }

    const stalePagePrerenderer: Prerenderer = {
      async prerenderModule(
        args: ModulePrerenderArgs,
      ): Promise<ModuleRenderResponse> {
        if (stalePagePinned && isTargetModule(args.url)) {
          stalePageRenderCount++;
          return stalePageModuleError(args.url);
        }
        return (await getTestPrerenderer()).prerenderModule(args);
      },
      async prerenderVisit(args: PrerenderVisitArgs) {
        return (await getTestPrerenderer()).prerenderVisit(args);
      },
      async runCommand(args: RunCommandArgs) {
        return (await getTestPrerenderer()).runCommand(args);
      },
    };

    hooks.beforeEach(function () {
      stalePagePinned = false;
      stalePageRenderCount = 0;
    });

    setupPermissionedRealmsCached(hooks, {
      prerenderer: stalePagePrerenderer,
      realms: [
        {
          realmURL,
          permissions: {
            '*': ['read'],
            '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
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
            '1.json': {
              data: {
                attributes: {
                  name: 'Maple',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./person'),
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ dbAdapter: pgAdapter, realms }) {
        dbAdapter = pgAdapter;
        request = withRealmPath(
          supertest(realms[realms.length - 1].realmHttpServer),
          new URL(realmURL),
        );
      },
    });

    async function personModulesRows(): Promise<
      { url: string; cache_scope: string; error_doc: unknown }[]
    > {
      return (await dbAdapter.execute(
        `SELECT url, cache_scope, error_doc FROM modules WHERE url LIKE $1`,
        { bind: [`${realmURL}person%`] },
      )) as { url: string; cache_scope: string; error_doc: unknown }[];
    }

    async function backdateCachedError() {
      await dbAdapter.execute(
        `UPDATE modules SET created_at = $1 WHERE url LIKE $2`,
        { bind: [Date.now() - 60_000, `${realmURL}person%`] },
      );
    }

    test('a stale page render poisons the public cache and pinned revalidation cannot recover', async function (assert) {
      // Baseline: the fixture's boot indexing populated the modules cache
      // from a healthy render, so an anonymous read works.
      let response = await request
        .get('/1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(response.status, 200, 'baseline anonymous GET is 200');

      // A deploy ships a new module version: the old cache entry is gone
      // and the next definition lookup must re-render the module — which
      // lands on a pool page still running the previous host bundle.
      await dbAdapter.execute(`DELETE FROM modules WHERE url LIKE $1`, {
        bind: [`${realmURL}person%`],
      });
      stalePagePinned = true;

      response = await request
        .get('/1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(
        response.status,
        500,
        'anonymous GET 500s once the stale page poisons the module cache',
      );
      assert.ok(
        stalePageRenderCount >= 1,
        'the stale page rendered the module',
      );

      let rows = await personModulesRows();
      assert.ok(rows.length > 0, 'a modules row was written for the module');
      for (let row of rows) {
        assert.strictEqual(
          row.cache_scope,
          'public',
          'the poisoned row is cached under the public scope',
        );
        assert.ok(
          JSON.stringify(row.error_doc).includes('has no exported member'),
          'the poisoned row carries the module error',
        );
      }

      // Within the error-cache TTL the poisoned row is served as-is: no
      // new render, still a 500 for every anonymous reader.
      let rendersAfterPoison = stalePageRenderCount;
      response = await request
        .get('/1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(
        response.status,
        500,
        'within the TTL the cached error is served without a new render',
      );
      assert.strictEqual(
        stalePageRenderCount,
        rendersAfterPoison,
        'no revalidation render happened inside the TTL',
      );

      // Once the TTL lapses, revalidation does fire — but affinity routing
      // pins the retry to the same stale page, which reproduces the error
      // and re-poisons the cache. The realm never recovers on its own.
      await backdateCachedError();
      response = await request
        .get('/1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(
        response.status,
        500,
        'revalidation pinned to the stale page reproduces the 500',
      );
      assert.ok(
        stalePageRenderCount > rendersAfterPoison,
        'the expired error triggered a revalidation render',
      );
      rows = await personModulesRows();
      for (let row of rows) {
        assert.ok(
          JSON.stringify(row.error_doc).includes('has no exported member'),
          'the revalidation render re-poisoned the cache',
        );
      }

      // Recovery: a revalidation render finally lands on a page running
      // the current host bundle.
      stalePagePinned = false;
      await backdateCachedError();
      response = await request
        .get('/1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(
        response.status,
        200,
        'a render on a fresh page recovers the realm',
      );
      rows = await personModulesRows();
      assert.ok(rows.length > 0, 'the healthy render rewrote the cache');
      for (let row of rows) {
        assert.notOk(
          row.error_doc,
          'the healthy render cleared the error from the cache',
        );
      }
    });
  });
});
