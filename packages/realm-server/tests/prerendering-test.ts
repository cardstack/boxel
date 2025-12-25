import { module, test } from 'qunit';
import { basename } from 'path';
import type {
  RealmPermissions,
  Realm,
  RealmAdapter,
  RenderResponse,
  ModuleRenderResponse,
  RenderRouteOptions,
} from '@cardstack/runtime-common';
import { Prerenderer } from '../prerender/index';
import { PagePool } from '../prerender/page-pool';
import { RenderRunner } from '../prerender/render-runner';

import {
  setupBaseRealmServer,
  setupPermissionedRealms,
  matrixURL,
  cleanWhiteSpace,
  testCreatePrerenderAuth,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import {
  baseCardRef,
  trimExecutableExtension,
} from '@cardstack/runtime-common';

function makeStubPagePool(maxPages: number) {
  let contextCounter = 0;
  let contextsCreated: string[] = [];
  let contextsClosed: string[] = [];
  let browser = {
    async createBrowserContext() {
      let id = `ctx-${++contextCounter}`;
      contextsCreated.push(id);
      return {
        async newPage() {
          return {
            async goto(_url: string, _opts?: any) {
              return;
            },
            async waitForFunction(_fn: any) {
              return true;
            },
            removeAllListeners() {
              return;
            },
            on() {
              return;
            },
          } as any;
        },
        async close() {
          contextsClosed.push(id);
          return;
        },
      } as any;
    },
  };
  let browserManager = {
    async getBrowser() {
      return browser as any;
    },
    async cleanupUserDataDirs() {
      return;
    },
  };
  let pool = new PagePool({
    maxPages,
    serverURL: 'http://localhost',
    browserManager: browserManager as any,
    boxelHostURL: 'http://localhost:4200',
    standbyTimeoutMs: 500,
  });
  return { pool, contextsCreated, contextsClosed };
}

module(basename(__filename), function () {
  module('prerender - dynamic tests', function (hooks) {
    let realmURL = 'http://127.0.0.1:4450/';
    let prerenderServerURL = realmURL.endsWith('/')
      ? realmURL.slice(0, -1)
      : realmURL;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;
    let realmAdapter: RealmAdapter;
    let realm: Realm;
    let auth = () => testCreatePrerenderAuth(testUserId, permissions);

    hooks.before(async () => {
      prerenderer = new Prerenderer({
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.afterEach(async () => {
      await prerenderer.disposeRealm(realmURL);
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      realms: [
        {
          realmURL,
          permissions: {
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
            '1.json': {
              data: {
                attributes: {
                  name: 'Maple',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
            'no-icon.gts': `
              import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
              export class NoIcon extends CardDef {
                static displayName = "No Icon";
                static icon = class extends Component<typeof this> {
                  <template></template>
                }
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  <template>{{@model.name}}</template>
                }
              }
            `,
            'no-icon.json': {
              data: {
                attributes: {
                  name: 'Missing Icon',
                },
                meta: {
                  adoptsFrom: {
                    module: './no-icon',
                    name: 'NoIcon',
                  },
                },
              },
            },
            'broken.gts': 'export const Broken = ;',
            'broken.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: './broken',
                    name: 'Broken',
                  },
                },
              },
            },
            'rejects.gts': `
              import { CardDef, Component } from 'https://cardstack.com/base/card-api';
              export class Rejects extends CardDef {
                static isolated = class extends Component<typeof this> {
                  constructor(...args) {
                    super(...args);
                    Promise.reject(new Error('reject boom'));
                  }
                  <template>oops</template>
                }
              }
            `,
            'rejects.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: './rejects',
                    name: 'Rejects',
                  },
                },
              },
            },
            'rsvp-rejects.gts': `
              import { CardDef, Component } from 'https://cardstack.com/base/card-api';
              import * as RSVP from 'rsvp';
              export class RsvpRejects extends CardDef {
                static isolated = class extends Component<typeof this> {
                  constructor(...args) {
                    super(...args);
                    RSVP.reject(new Error('rsvp boom'));
                  }
                  <template>oops</template>
                }
              }
            `,
            'rsvp-rejects.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: './rsvp-rejects',
                    name: 'RsvpRejects',
                  },
                },
              },
            },
            'throws.gts': `
              import { CardDef, Component } from 'https://cardstack.com/base/card-api';
              export class Throws extends CardDef {
                static isolated = class extends Component<typeof this> {
                  get explode() {
                    throw new Error('boom');
                  }
                  <template>{{this.explode}}</template>
                }
              }
            `,
            'throws.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: './throws',
                    name: 'Throws',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms: setupRealms }) {
        ({ realm, realmAdapter } = setupRealms[0]);
        permissions = {
          [realmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('reuses pooled page and picks up updated instance', async function (assert) {
      const cardURL = `${realmURL}1`;

      let first = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.false(first.pool.reused, 'first call not reused');
      assert.false(first.pool.evicted, 'first call not evicted');
      assert.strictEqual(
        first.response.serialized?.data.attributes?.name,
        'Maple',
        'first render sees original value',
      );

      await realmAdapter.write(
        '1.json',
        JSON.stringify(
          {
            data: {
              attributes: {
                name: 'Juniper',
              },
              meta: {
                adoptsFrom: {
                  module: './person',
                  name: 'Person',
                },
              },
            },
          },
          null,
          2,
        ),
      );

      await realm.realmIndexUpdater.fullIndex();
      realm.__testOnlyClearCaches();

      let second = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.true(second.pool.reused, 'second call reused pooled page');
      assert.false(second.pool.evicted, 'second call not evicted');
      assert.strictEqual(
        second.pool.pageId,
        first.pool.pageId,
        'same page reused',
      );
      assert.strictEqual(
        second.response.serialized?.data.attributes?.name,
        'Juniper',
        'second render picks up updated value',
      );
    });

    test('prerenderModule returns module metadata', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let result = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
      });

      assert.false(result.pool.reused, 'first module render not reused');
      assert.strictEqual(
        result.response.status,
        'ready',
        'module marked ready',
      );
      let key = `${trimExecutableExtension(new URL(moduleURL)).href}/Person`;
      let entry = result.response.definitions[key];
      assert.ok(entry, 'definition captured');
      assert.strictEqual(
        entry?.type,
        'definition',
        'definition entry type correct',
      );
      if (entry?.type === 'definition') {
        assert.ok(entry.definition.displayName, 'display name present');
      } else {
        assert.ok(false, 'module definition should be present');
      }
    });

    test('module prerender reuses pooled page after updates', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let first = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
      });

      assert.false(first.pool.reused, 'first module render not reused');

      await realmAdapter.write(
        'person.gts',
        `
          import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
          export class Person extends CardDef {
            static displayName = "Updated Person";
            @field name = contains(StringField);
            static isolated = class extends Component<typeof this> {
              <template>{{@model.name}}</template>
            }
          }
        `,
      );
      realm.__testOnlyClearCaches(); // out write bypasses the index so we need to manually flush the realm cache

      let second = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
        renderOptions: { clearCache: true },
      });

      assert.true(
        second.pool.reused,
        'second module render reused pooled page',
      );
      assert.strictEqual(
        first.pool.pageId,
        second.pool.pageId,
        'same page reused',
      );
      let key = `${trimExecutableExtension(new URL(moduleURL)).href}/Person`;
      let entry = second.response.definitions[key];
      assert.ok(entry, 'updated module definition entry present');
      assert.strictEqual(
        entry?.type,
        'definition',
        'updated module definition entry correct',
      );
      if (entry?.type === 'definition') {
        assert.strictEqual(
          entry.definition.displayName,
          'Updated Person',
          'updated module definition observed',
        );
      } else {
        assert.ok(false, 'updated module definition entry should be present');
      }
    });

    test('module prerender surfaces syntax errors', async function (assert) {
      const modulePath = 'person.gts';
      const moduleURL = `${realmURL}${modulePath}`;

      await realmAdapter.write(modulePath, 'export const Broken = ;');
      realm.__testOnlyClearCaches();

      let result = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
      });

      assert.strictEqual(
        result.response.status,
        'error',
        'module render errored',
      );
      assert.strictEqual(
        result.response.error?.error.status,
        406,
        'syntax error surfaces as 406',
      );
      assert.false(result.pool.evicted, 'page not evicted for syntax error');
    });

    test('card prerender hoists module transpile errors', async function (assert) {
      let brokenCard = `${realmURL}broken.json`;

      let result = await prerenderer.prerenderCard({
        realm: realmURL,
        url: brokenCard,
        auth: auth(),
      });

      assert.ok(result.response.error, 'prerender reports error');
      assert.strictEqual(
        result.response.error?.error.status,
        406,
        'status is 406',
      );
      assert.strictEqual(
        result.response.error?.error.message,
        `Parse Error at broken.gts:1:23: 1:24 (${realmURL}broken)`,
        'message includes enough information for AI to fix the problem',
      );
      assert.ok(
        result.response.error?.error.stack?.includes('at transpileJS'),
        `stack should include "at transpileJS" but was ${result.response.error?.error.stack}`,
      );
      assert.strictEqual(
        result.response.error?.error.additionalErrors,
        null,
        'error is primary and not nested in additionalErrors',
      );
      let deps = result.response.error?.error.deps ?? [];
      assert.ok(
        deps.some((dep) => dep.includes(`${realmURL}broken`)),
        'deps include failing module',
      );
    });

    test('card prerender surfaces empty render container', async function (assert) {
      let cardURL = `${realmURL}no-icon.json`;

      let result = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.ok(result.response.error, 'prerender reports error');
      assert.strictEqual(
        result.response.error?.error.title,
        'Invalid render response',
        'error title indicates invalid render payload',
      );
      assert.ok(
        result.response.error?.error.message?.includes(
          '[data-prerender] has no child element to capture',
        ),
        `error message mentions empty prerender container, got: ${result.response.error?.error.message}`,
      );
    });

    test('card prerender surfaces runtime render errors without timing out', async function (assert) {
      let cardURL = `${realmURL}throws.json`;

      let result = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.ok(result.response.error, 'prerender reports error');
      assert.strictEqual(
        result.response.error?.error.status,
        500,
        'runtime error surfaces as 500',
      );
      assert.ok(
        result.response.error?.error.message?.includes('boom'),
        `runtime error message includes thrown message, got: ${result.response.error?.error.message}`,
      );
      assert.false(
        result.pool.timedOut,
        'runtime error should not be mistaken for timeout',
      );
      assert.true(
        result.pool.evicted,
        'runtime error evicts prerender page to recover clean state',
      );
    });

    test('card prerender surfaces unhandled promise rejection without timing out', async function (assert) {
      let cardURL = `${realmURL}rejects.json`;

      let result = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.ok(result.response.error, 'prerender reports error');
      assert.strictEqual(
        result.response.error?.error.status,
        500,
        'unhandled rejection surfaces as 500',
      );
      assert.ok(
        result.response.error?.error.message?.includes('reject boom'),
        `unhandled rejection message includes thrown message, got: ${result.response.error?.error.message}`,
      );
      assert.false(
        result.pool.timedOut,
        'unhandled rejection should not be mistaken for timeout',
      );
      assert.true(
        result.pool.evicted,
        'unhandled rejection evicts prerender page to recover clean state',
      );
    });

    test('card prerender surfaces RSVP rejection without timing out', async function (assert) {
      let cardURL = `${realmURL}rsvp-rejects.json`;

      let result = await prerenderer.prerenderCard({
        realm: realmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.ok(result.response.error, 'prerender reports RSVP rejection');
      assert.strictEqual(
        result.response.error?.error.status,
        500,
        'RSVP rejection surfaces as 500',
      );
      assert.ok(
        result.response.error?.error.message?.includes('rsvp boom'),
        `RSVP rejection message includes thrown message, got: ${result.response.error?.error.message}`,
      );
      assert.false(
        result.pool.timedOut,
        'RSVP rejection should not be mistaken for timeout',
      );
      assert.true(
        result.pool.evicted,
        'RSVP rejection evicts prerender page to recover clean state',
      );
    });

    test('card prerender surfaces errors thrown before the render model hook', async function (assert) {
      let originalGetPage = PagePool.prototype.getPage;
      try {
        PagePool.prototype.getPage = async function (
          this: PagePool,
          realm: string,
        ) {
          let pageInfo = await originalGetPage.call(this, realm);
          let page = pageInfo.page as any;
          let originalEvaluate = page?.evaluate?.bind(page);
          if (originalEvaluate) {
            let injected = false;
            page.evaluate = async (...args: any[]) => {
              if (!injected) {
                injected = true;
                await originalEvaluate(() => {
                  let entries =
                    (window as any).requirejs?.entries ??
                    (window as any).require?.entries ??
                    (window as any)._eak_seen;
                  let renderModuleName =
                    entries &&
                    Object.keys(entries).find((name) =>
                      name.endsWith('/routes/render'),
                    );
                  if (!renderModuleName) {
                    throw new Error(
                      'render route module not found for injection',
                    );
                  }
                  let renderRouteModule = (window as any).require(
                    renderModuleName,
                  );
                  let RenderRouteClass = renderRouteModule?.default;
                  if (!RenderRouteClass?.prototype) {
                    throw new Error(
                      'render route class not found for injection',
                    );
                  }
                  let originalBeforeModel =
                    RenderRouteClass.prototype.beforeModel;
                  RenderRouteClass.prototype.beforeModel = async function (
                    ...bmArgs: any[]
                  ) {
                    if (originalBeforeModel) {
                      await originalBeforeModel.apply(this, bmArgs as any);
                    }
                    RenderRouteClass.prototype.beforeModel =
                      originalBeforeModel;
                    throw new Error('boom before model');
                  };
                });
              }
              return originalEvaluate(...args);
            };
          }
          return { ...pageInfo, page };
        };

        let result = await prerenderer.prerenderCard({
          realm: realmURL,
          url: `${realmURL}1.json`,
          auth: auth(),
        });

        assert.ok(result.response.error, 'prerender reports error');
        assert.ok(
          result.response.error?.error.message?.includes('boom before model'),
          'captures error thrown before model hook',
        );
        assert.true(
          result.pool.evicted,
          'pre-model error evicts prerender page for clean state',
        );
        assert.true(
          (result.response.error as any)?.evict,
          'error payload flags eviction',
        );
        assert.false(result.pool.timedOut, 'error is not treated as timeout');
      } finally {
        PagePool.prototype.getPage = originalGetPage;
      }
    });

    test('module prerender evicts pooled page on timeout', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let first = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
      });
      assert.false(first.pool.reused, 'initial module render not reused');
      assert.false(first.pool.evicted, 'initial module render not evicted');

      let timedOut = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
        opts: { timeoutMs: 1, simulateTimeoutMs: 25 },
      });

      assert.strictEqual(
        timedOut.response.status,
        'error',
        'timeout returns error response',
      );
      assert.strictEqual(
        timedOut.response.error?.error.title,
        'Render timeout',
        'timeout surfaces render timeout title',
      );
      assert.strictEqual(
        timedOut.response.error?.error.status,
        504,
        'timeout surfaces 504 status',
      );
      assert.true(timedOut.pool.timedOut, 'timeout flagged on pool');
      assert.true(timedOut.pool.evicted, 'pool evicted after timeout');
      assert.notStrictEqual(
        timedOut.pool.pageId,
        'unknown',
        'timeout retains page identifier',
      );

      let afterTimeout = await prerenderer.prerenderModule({
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
      });
      assert.false(
        afterTimeout.pool.reused,
        'timeout eviction prevents reuse on next render',
      );
      assert.false(afterTimeout.pool.evicted, 'no eviction on recovery render');
      assert.false(afterTimeout.pool.timedOut, 'no timeout after recovery');
      assert.strictEqual(
        afterTimeout.response.status,
        'ready',
        'subsequent render succeeds',
      );
    });
  });

  module('prerender - permissioned auth failures', function (hooks) {
    let providerRealmURL = 'http://127.0.0.1:4451/';
    let consumerRealmURL = 'http://127.0.0.1:4452/';
    let prerenderServerURL = consumerRealmURL.endsWith('/')
      ? consumerRealmURL.slice(0, -1)
      : consumerRealmURL;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;
    let auth = () => testCreatePrerenderAuth(testUserId, permissions);

    hooks.before(async () => {
      prerenderer = new Prerenderer({
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.beforeEach(function () {
      permissions = {
        [consumerRealmURL]: ['read', 'write', 'realm-owner'],
      };
    });

    hooks.afterEach(async () => {
      await Promise.all([
        prerenderer.disposeRealm(providerRealmURL),
        prerenderer.disposeRealm(consumerRealmURL),
      ]);
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      mode: 'before',
      realms: [
        {
          realmURL: providerRealmURL,
          permissions: {
            // consumer's matrix user is not authorized to read
            nobody: ['read', 'write'],
          },
          fileSystem: {
            'article.gts': `
              import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Article extends CardDef {
                @field title = contains(StringField);
              }
            `,
            'secret.json': {
              data: {
                attributes: {
                  title: 'Top Secret',
                },
                meta: {
                  adoptsFrom: {
                    module: './article',
                    name: 'Article',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: consumerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'website.gts': `
              import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
              import { Article } from "${providerRealmURL}article" // importing from another realm;
              export class Website extends CardDef {
                @field linkedArticle = linksTo(Article);
              }
            `,
            'website-1.json': {
              data: {
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: './website',
                    name: 'Website',
                  },
                },
              },
            },
            'auth-proxy.gts': `
              import { contains, field, CardDef, linksTo, Component } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              // define a local stand-in type so the consumer realm doesn't need to import provider modules
              export class RemoteArticle extends CardDef {
                @field title = contains(StringField);
              }
              export class AuthProxy extends CardDef {
                @field linkedArticle = linksTo(RemoteArticle);
                @field articleTitle = contains(StringField, {
                  computeVia(this: AuthProxy) {
                    return this.linkedArticle?.title;
                  },
                });
                static isolated = class extends Component<typeof this> {
                  <template>
                    <@fields.articleTitle />
                  </template>
                }
              }
            `,
            'auth-proxy-1.json': {
              data: {
                attributes: {},
                relationships: {
                  linkedArticle: {
                    links: {
                      self: `${providerRealmURL}secret`,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './auth-proxy',
                    name: 'AuthProxy',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup() {
        permissions = {
          [consumerRealmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('module prerender surfaces auth error without timing out', async function (assert) {
      const moduleURL = `${consumerRealmURL}website.gts`;

      let result = await prerenderer.prerenderModule({
        realm: consumerRealmURL,
        url: moduleURL,
        auth: auth(),
      });

      assert.ok(
        result.response.error,
        'auth failure returns an error response',
      );
      let status = result.response.error?.error.status;
      assert.strictEqual(status, 401, 'auth error status should be 401');
      assert.notStrictEqual(
        result.response.error?.error.title,
        'Render timeout',
        'auth failure is not reported as a timeout',
      );
      assert.false(
        result.pool.timedOut,
        'auth failure should not mark prerender as timed out',
      );
      assert.false(
        result.pool.evicted,
        'auth failure should not evict prerender page',
      );
    });

    test('card prerender surfaces auth error without timing out', async function (assert) {
      const cardURL = `${consumerRealmURL}auth-proxy-1`;

      let result = await prerenderer.prerenderCard({
        realm: consumerRealmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.ok(
        result.response.error,
        'auth failure returns an error response',
      );
      let status = result.response.error?.error.status;
      assert.strictEqual(status, 401, 'auth error status should be 401');
      assert.notStrictEqual(
        result.response.error?.error.title,
        'Render timeout',
        'auth failure is not reported as a timeout',
      );
      assert.false(
        result.pool.timedOut,
        'auth failure should not mark prerender as timed out',
      );
      assert.false(
        result.pool.evicted,
        'auth failure should not evict prerender page',
      );
    });

    test('card prerender surfaces auth error from linked fetch', async function (assert) {
      const cardURL = `${consumerRealmURL}auth-proxy-1`;

      let result = await prerenderer.prerenderCard({
        realm: consumerRealmURL,
        url: cardURL,
        auth: auth(),
      });

      assert.ok(result.response.error, 'auth failure returns an error');
      assert.strictEqual(
        result.response.error?.error.status,
        401,
        'linked fetch auth error surfaces as 401',
      );
      assert.notStrictEqual(
        result.response.error?.error.title,
        'Render timeout',
        'auth failure not misreported as timeout',
      );
      assert.false(result.pool.timedOut, 'prerender did not time out');
    });
  });

  module('prerender - static tests', function (hooks) {
    let realmURL1 = 'http://127.0.0.1:4447/';
    let realmURL2 = 'http://127.0.0.1:4448/';
    let realmURL3 = 'http://127.0.0.1:4449/';
    let prerenderServerURL = realmURL1.endsWith('/')
      ? realmURL1.slice(0, -1)
      : realmURL1;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;
    let auth = () => testCreatePrerenderAuth(testUserId, permissions);
    const disposeAllRealms = async () => {
      await Promise.all([
        prerenderer.disposeRealm(realmURL1),
        prerenderer.disposeRealm(realmURL2),
        prerenderer.disposeRealm(realmURL3),
      ]);
    };

    hooks.before(async function () {
      prerenderer = new Prerenderer({
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async function () {
      await prerenderer.stop();
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      mode: 'before',
      realms: [
        {
          realmURL: realmURL1,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class Person extends CardDef {
                static displayName = "Person";
                @field name = contains(StringField);
                static fitted = <template><@fields.name/></template>
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Hassan',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: realmURL2,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'broken-card.gts': `
              import {
            `,
            'broken.json': {
              data: {
                attributes: {
                  name: 'Broken',
                },
                meta: {
                  adoptsFrom: {
                    module: './broken-card',
                    name: 'Broken',
                  },
                },
              },
            },
            'cat.gts': `
              import { CardDef, field, contains, linksTo, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';
              export class Cat extends CardDef {
                @field name = contains(StringField);
                @field owner = linksTo(Person);
                static displayName = "Cat";
                static embedded = <template>{{@fields.name}} says Meow. owned by <@fields.owner /></template>
              }
            `,
            'dog.gts': `
              import { CardDef, field, contains, linksTo, StringField, Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';
              export class Dog extends CardDef {
                static displayName = "Dog";
                @field name = contains(StringField);
                @field owner = linksTo(Person, { isUsed: true });
                static isolated = class extends Component<typeof this> {
                  // owner is intentionally not in isolated template, this is included in search doc via isUsed=true
                  <template>{{@model.name}}</template>
                }
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Maple',
                },
                relationships: {
                  owner: {
                    links: { self: `${realmURL1}1` },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './cat',
                    name: 'Cat',
                  },
                },
              },
            },
            'is-used.json': {
              data: {
                attributes: {
                  name: 'Mango',
                },
                relationships: {
                  owner: {
                    links: { self: `${realmURL1}1` },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './dog',
                    name: 'Dog',
                  },
                },
              },
            },
            'missing-link.json': {
              data: {
                attributes: {
                  name: 'Missing Owner',
                },
                relationships: {
                  owner: {
                    links: { self: `${realmURL1}missing-owner` },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './cat',
                    name: 'Cat',
                  },
                },
              },
            },
            'fetch-failed.json': {
              data: {
                attributes: {
                  name: 'Missing Owner',
                },
                relationships: {
                  owner: {
                    links: {
                      self: 'http://localhost:9000/this-is-a-link-to-nowhere',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './cat',
                    name: 'Cat',
                  },
                },
              },
            },
            'intentional-error.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class IntentionalError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Intentional Error";
                static isolated = class extends Component {
                  get message() {
                    if (this.args.model.name === 'Intentional Error') {
                      throw new Error('intentional failure during render')
                    }
                    return this.args.model.name;
                  }
                  <template>{{this.message}}</template>
                }
              }
            `,
            '2.json': {
              data: {
                attributes: {
                  name: 'Intentional Error',
                },
                meta: {
                  adoptsFrom: {
                    module: './intentional-error',
                    name: 'IntentionalError',
                  },
                },
              },
            },
            // A card that fires the boxel-render-error event (handled by the prerender route)
            // and then blocks the event loop long enough that Ember health probe times out,
            // causing data-prerender-status to be set to 'unusable' by the error handler without
            // transitioning to the render-error route (so nothing overwrites our dataset).
            'unusable-error.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class UnusableError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Unusable Error";
                static isolated = class extends Component {
                  get trigger() {
                    throw new Error('forced unusable for test');
                  }
                  <template>{{this.trigger}}</template>
                }
              }
            `,
            '3.json': {
              data: {
                attributes: {
                  name: 'Force Unusable',
                },
                meta: {
                  adoptsFrom: {
                    module: './unusable-error',
                    name: 'UnusableError',
                  },
                },
              },
            },
            'embedded-error.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              export class EmbeddedError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Embedded Error";
                static isolated = <template>
  <pre data-prerender-error>
  {
    "type": "error",
    "error": {
      "id": "embedded-error",
      "status": 500,
      "title": "Embedded error",
      "message": "error flagged from DOM",
      "additionalErrors": null
    }
  }
  </pre>
</template>
              }
            `,
            '4.json': {
              data: {
                attributes: {
                  name: 'Embedded Error',
                },
                meta: {
                  adoptsFrom: {
                    module: './embedded-error',
                    name: 'EmbeddedError',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: realmURL3,
          permissions: {
            [testUserId]: ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'dog.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class Dog extends CardDef {
                @field name = contains(StringField);
                static displayName = "Dog";
                static embedded = <template>{{@fields.name}} wags tail</template>
              }
            `,
            '1.json': {
              data: {
                attributes: {
                  name: 'Taro',
                },
                meta: {
                  adoptsFrom: {
                    module: './dog',
                    name: 'Dog',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup: () => {
        permissions = {
          [realmURL1]: ['read', 'write', 'realm-owner'],
          [realmURL2]: ['read', 'write', 'realm-owner'],
          [realmURL3]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    module('basics', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
      let result: RenderResponse;

      hooks.before(async () => {
        const testCardURL = `${realmURL2}1`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        result = response;
      });

      test('embedded HTML', function (assert) {
        assert.ok(
          /Maple\s+says\s+Meow/.test(
            cleanWhiteSpace(result.embeddedHTML![`${realmURL2}cat/Cat`]),
          ),
          `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
        );
      });

      test('parent embedded HTML', function (assert) {
        assert.ok(
          /data-test-card-thumbnail-placeholder/.test(
            result.embeddedHTML!['https://cardstack.com/base/card-api/CardDef'],
          ),
          `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
        );
      });

      test('isolated HTML', function (assert) {
        assert.ok(
          /data-test-field="cardDescription"/.test(result.isolatedHTML!),
          `failed to match isolated html:${result.isolatedHTML}`,
        );
      });

      test('atom HTML', function (assert) {
        assert.ok(
          /Untitled Cat/.test(result.atomHTML!),
          `failed to match atom html:${result.atomHTML}`,
        );
      });

      test('icon HTML', function (assert) {
        assert.ok(
          result.iconHTML?.startsWith('<svg'),
          `iconHTML: ${result.iconHTML}`,
        );
      });

      test('head HTML', function (assert) {
        assert.ok(result.headHTML, 'headHTML should be present');
        let cleanedHead = cleanWhiteSpace(result.headHTML!);

        // TODO: restore in CS-9807
        // assert.ok(
        //   cleanedHead.includes(
        //     '<title data-test-card-head-title>Untitled Cat</title>',
        //   ),
        //   `failed to find title in head html:${cleanedHead}`,
        // );
        assert.ok(
          cleanedHead.includes('property="og:title" content="Untitled Cat"'),
          `failed to find og:title in head html:${cleanedHead}`,
        );
        assert.ok(
          cleanedHead.includes('name="twitter:card" content="summary"'),
          `failed to find twitter:card in head html:${cleanedHead}`,
        );
      });

      test('serialized', function (assert) {
        assert.strictEqual(result.serialized?.data.attributes?.name, 'Maple');
      });

      test('displayNames', function (assert) {
        assert.deepEqual(result.displayNames, ['Cat', 'Card']);
      });

      test('deps', function (assert) {
        // spot check a few deps, as the whole list is overwhelming...
        assert.ok(
          result.deps?.includes(baseCardRef.module),
          `${baseCardRef.module} is a dep`,
        );
        assert.ok(
          result.deps?.includes(`${realmURL1}person`),
          `${realmURL1}person is a dep`,
        );
        assert.ok(
          result.deps?.includes(`${realmURL2}cat`),
          `${realmURL2}cat is a dep`,
        );
        assert.ok(
          result.deps?.find((d) =>
            d.match(
              /^https:\/\/cardstack.com\/base\/card-api\.gts\..*glimmer-scoped\.css$/,
            ),
          ),
          `glimmer scoped css from ${baseCardRef.module} is a dep`,
        );
      });

      test('types', function (assert) {
        assert.deepEqual(result.types, [
          `${realmURL2}cat/Cat`,
          'https://cardstack.com/base/card-api/CardDef',
        ]);
      });

      test('searchDoc', function (assert) {
        assert.strictEqual(result.searchDoc?.name, 'Maple');
        assert.strictEqual(result.searchDoc?._cardType, 'Cat');
        assert.strictEqual(result.searchDoc?.owner.name, 'Hassan');
      });

      test('isUsed field includes a field in search doc that is not rendered in template', async function (assert) {
        const testCardURL = `${realmURL2}is-used`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });

        assert.ok(
          /Mango/.test(response.isolatedHTML!),
          `failed to match isolated html:${response.isolatedHTML}`,
        );
        assert.false(
          /data-test-field="owner"/.test(response.isolatedHTML!),
          `owner field is not rendered in isolated html`,
        );
        assert.strictEqual(
          response.searchDoc?.owner.name,
          'Hassan',
          'linked field is included in search doc via isUsed=true',
        );
      });
    });

    module('errors', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
      test('error during render', async function (assert) {
        const testCardURL = `${realmURL2}2`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        let { error, ...restOfResult } = response;

        assert.strictEqual(error?.error.id, testCardURL);
        assert.strictEqual(
          error?.error.message,
          'intentional failure during render',
        );
        assert.strictEqual(error?.error.status, 500);
        assert.ok(error?.error.stack, 'stack trace exists in error');

        // TODO Perhaps if we add error handlers for the /render/html subroute
        // these all wont be empty, as this is triggering in the /render route
        // error handler and hence stomping over all the subroutes.
        assert.deepEqual(restOfResult, {
          displayNames: null,
          deps: null,
          searchDoc: null,
          serialized: null,
          types: null,
          atomHTML: null,
          embeddedHTML: null,
          fittedHTML: null,
          headHTML: null,
          iconHTML: null,
          isolatedHTML: null,
        });
      });

      test('missing link surfaces 404 without eviction', async function (assert) {
        const testCardURL = `${realmURL2}missing-link`;
        let result = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        let { response } = result;

        assert.ok(response.error, 'error present for missing link');
        assert.strictEqual(
          response.error?.error.message,
          `missing file ${realmURL1}missing-owner.json`,
        );
        assert.strictEqual(response.error?.error.status, 404);
        assert.false(
          result.pool.evicted,
          'missing link does not evict prerender page',
        );
        assert.false(
          result.pool.timedOut,
          'missing link does not mark prerender timeout',
        );
      });

      test('fetch failed surfaces error without eviction', async function (assert) {
        const testCardURL = `${realmURL2}fetch-failed`;
        let result = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        let { response } = result;

        assert.ok(response.error, 'error present for fetch failed');
        assert.strictEqual(
          response.error?.error.message,
          `unable to fetch http://localhost:9000/this-is-a-link-to-nowhere: fetch failed`,
        );
        assert.strictEqual(response.error?.error.status, 500);
        assert.false(
          result.pool.evicted,
          'fetch failed does not evict prerender page',
        );
        assert.false(
          result.pool.timedOut,
          'fetch failed does not mark prerender timeout',
        );
      });

      test('embedded error markup triggers render error', async function (assert) {
        const testCardURL = `${realmURL2}4`;
        let { response } = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        assert.ok(response.error, 'error captured');
        assert.strictEqual(response.error?.error.id, 'embedded-error');
        assert.strictEqual(
          response.error?.error.message,
          'error flagged from DOM',
        );
        assert.strictEqual(response.error?.error.title, 'Embedded error');
        assert.strictEqual(response.error?.error.status, 500);
      });

      test('unusable triggers eviction and short-circuit', async function (assert) {
        // Render the card that forces unusable
        const unusableURL = `${realmURL2}3`;
        let unusable = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: unusableURL,
          auth: auth(),
        });

        // We should see an error with evict semantics and short-circuited payloads
        assert.ok(unusable.response.error, 'error present for unusable');
        assert.strictEqual(unusable.response.error?.error.id, unusableURL);
        assert.strictEqual(
          unusable.response.error?.error.message,
          'forced unusable for test',
        );
        assert.strictEqual(unusable.response.error?.error.status, 500);
        assert.strictEqual(
          unusable.response.isolatedHTML,
          null,
          'isolatedHTML null when short-circuited',
        );
        assert.strictEqual(
          unusable.response.embeddedHTML,
          null,
          'embeddedHTML null when short-circuited',
        );
        assert.strictEqual(
          unusable.response.atomHTML,
          null,
          'atomHTML null when short-circuited',
        );
        assert.strictEqual(
          unusable.response.iconHTML,
          null,
          'iconHTML null when short-circuited',
        );
        assert.deepEqual(
          {
            serialized: unusable.response.serialized,
            searchDoc: unusable.response.searchDoc,
            displayNames: unusable.response.displayNames,
            types: unusable.response.types,
            deps: unusable.response.deps,
          },
          {
            serialized: null,
            searchDoc: null,
            displayNames: null,
            types: null,
            deps: null,
          },
          'meta fields are null when short-circuited',
        );
        assert.true(unusable.pool.evicted, 'pool notes eviction for unusable');
        assert.false(
          unusable.pool.timedOut,
          'unusable eviction does not mark timeout',
        );
        assert.notStrictEqual(
          unusable.pool.pageId,
          'unknown',
          'evicted unusable run retains page identifier',
        );

        // After unusable, the realm should be evicted; a subsequent render should not reuse
        const healthyURL = `${realmURL2}1`;
        let next = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: healthyURL,
          auth: auth(),
        });
        assert.false(next.pool.reused, 'did not reuse after unusable eviction');
        assert.false(next.pool.evicted, 'subsequent render not evicted');
      });

      test('prerender surfaces module syntax errors without timing out', async function (assert) {
        const cardURL = `${realmURL2}broken`;
        let broken = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: cardURL,
          auth: auth(),
        });
        assert.ok(broken.response.error, 'syntax error captured');
        assert.strictEqual(
          broken.response.error?.error.status,
          406,
          'syntax error reported as 406',
        );
        assert.false(broken.pool.timedOut, 'syntax error does not hit timeout');
      });
    });

    module('realm pooling', function (hooks) {
      hooks.beforeEach(disposeAllRealms);
      test('evicts on timeout and does not reuse', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        // First render to initialize pool
        let first = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        assert.false(first.pool.reused, 'first call not reused');

        // Now trigger a timeout; this should evict the realm
        let timeoutRun = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
          opts: { timeoutMs: 1, simulateTimeoutMs: 5 },
        });
        assert.strictEqual(
          timeoutRun.response.error?.error.title,
          'Render timeout',
          'got timeout error',
        );
        assert.true(timeoutRun.pool.evicted, 'timeout eviction reflected');
        assert.true(timeoutRun.pool.timedOut, 'timeout flagged on pool');
        assert.notStrictEqual(
          timeoutRun.pool.pageId,
          'unknown',
          'timeout eviction retains page identifier',
        );

        // A subsequent render should not reuse the previously pooled page
        let afterTimeout = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        assert.false(
          afterTimeout.pool.reused,
          'did not reuse after timeout eviction',
        );
        assert.false(afterTimeout.pool.evicted, 'no eviction on new render');
        assert.false(afterTimeout.pool.timedOut, 'no timeout on new render');
      });

      test('reuses the same page within a realm', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        let first = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        let second = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: auth(),
        });
        assert.strictEqual(first.pool.realm, realmURL2, 'first realm matches');
        assert.strictEqual(
          second.pool.realm,
          realmURL2,
          'second realm matches',
        );
        assert.strictEqual(
          first.pool.pageId,
          second.pool.pageId,
          'pageId reused',
        );
        assert.false(first.pool.reused, 'first call not reused');
        assert.true(second.pool.reused, 'second call reused');
        assert.false(first.pool.timedOut, 'first call not timed out');
        assert.false(second.pool.timedOut, 'second call not timed out');
      });

      test('refreshes prerender session when auth changes for the same realm', async function (assert) {
        const testCardURL = `${realmURL2}1`;
        let authA = testCreatePrerenderAuth(testUserId, {
          [realmURL2]: ['read', 'write', 'realm-owner'],
        });
        let authB = testCreatePrerenderAuth(testUserId, {
          [realmURL2]: ['read', 'write', 'realm-owner'],
          [realmURL1]: ['read', 'write', 'realm-owner'], // introduce a different token set
        });

        let first = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: authA,
        });
        let second = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL,
          auth: authB,
        });

        assert.false(first.pool.reused, 'first call not reused');
        assert.false(
          second.pool.reused,
          'auth change forces a fresh prerender page',
        );
        assert.notStrictEqual(
          first.pool.pageId,
          second.pool.pageId,
          'new page allocated when auth differs',
        );
        assert.strictEqual(
          second.response.serialized?.data.attributes?.name,
          'Maple',
          'second render still succeeds with new session',
        );
      });

      test('does not reuse across different realms', async function (assert) {
        const testCardURL1 = `${realmURL1}1`;
        const testCardURL2 = `${realmURL2}1`;
        let r1 = await prerenderer.prerenderCard({
          realm: realmURL1,
          url: testCardURL1,
          auth: auth(),
        });
        let r2 = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: testCardURL2,
          auth: auth(),
        });
        assert.notStrictEqual(
          r1.pool.pageId,
          r2.pool.pageId,
          'distinct pages per realm',
        );
        assert.false(r1.pool.reused, 'first realm first call not reused');
        assert.false(r2.pool.reused, 'second realm first call not reused');
      });

      test('evicts LRU when capacity reached', async function (assert) {
        const cardA = `${realmURL1}1`;
        const cardB = `${realmURL2}1`;
        const cardC = `${realmURL3}1`;

        let firstA = await prerenderer.prerenderCard({
          realm: realmURL1,
          url: cardA,
          auth: auth(),
        });
        assert.false(firstA.pool.reused, 'first A not reused');

        let firstB = await prerenderer.prerenderCard({
          realm: realmURL2,
          url: cardB,
          auth: auth(),
        });
        assert.false(firstB.pool.reused, 'first B not reused');

        // Now adding C should evict the LRU (A), since maxPages=2
        let firstC = await prerenderer.prerenderCard({
          realm: realmURL3,
          url: cardC,
          auth: auth(),
        });
        assert.false(firstC.pool.reused, 'first C not reused');

        // Returning to A should not reuse because it was evicted
        let secondA = await prerenderer.prerenderCard({
          realm: realmURL1,
          url: cardA,
          auth: auth(),
        });
        assert.false(secondA.pool.reused, 'A was evicted, so not reused');
        assert.notStrictEqual(
          firstA.pool.pageId,
          secondA.pool.pageId,
          'A got a new page after eviction',
        );
      });

      test('serializes cross-realm prerenders when no more capacity', async function (assert) {
        let prevPoolSize = process.env.PRERENDER_PAGE_POOL_SIZE;
        let originalGetPage = PagePool.prototype.getPage;
        let originalCloseAll = PagePool.prototype.closeAll;
        let originalPrerenderAttempt =
          RenderRunner.prototype.prerenderCardAttempt;
        let originalRetrySignature =
          RenderRunner.prototype.shouldRetryWithClearCache;
        let localPrerenderer: Prerenderer | undefined;

        let active = 0;
        let maxActive = 0;

        try {
          process.env.PRERENDER_PAGE_POOL_SIZE = '1';
          PagePool.prototype.getPage = async function (realm: string) {
            return {
              page: {} as any,
              reused: false,
              launchMs: 0,
              pageId: `fake-${realm}`,
            };
          };
          PagePool.prototype.closeAll = async function () {};
          RenderRunner.prototype.shouldRetryWithClearCache = () => undefined;
          RenderRunner.prototype.prerenderCardAttempt = async function ({
            realm,
            url,
          }: {
            realm: string;
            url: string;
          }) {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 25));
            active--;
            return {
              response: {
                serialized: null,
                searchDoc: null,
                displayNames: null,
                deps: null,
                types: null,
                iconHTML: null,
                isolatedHTML: url,
                headHTML: null,
                atomHTML: null,
                embeddedHTML: null,
                fittedHTML: null,
              },
              timings: { launchMs: 0, renderMs: 5 },
              pool: {
                pageId: `fake-${realm}`,
                realm,
                reused: false,
                evicted: false,
                timedOut: false,
              },
            };
          };

          localPrerenderer = new Prerenderer({
            maxPages: 1,
            serverURL: 'http://127.0.0.1:4225',
          });

          let realmA = 'https://realm-a.example/';
          let realmB = 'https://realm-b.example/';
          let authA = testCreatePrerenderAuth(testUserId, {
            [realmA]: ['read'],
          });
          let authB = testCreatePrerenderAuth(testUserId, {
            [realmB]: ['read'],
          });

          let [resA, resB] = await Promise.all([
            localPrerenderer.prerenderCard({
              realm: realmA,
              url: `${realmA}card`,
              auth: authA,
            }),
            localPrerenderer.prerenderCard({
              realm: realmB,
              url: `${realmB}card`,
              auth: authB,
            }),
          ]);

          assert.strictEqual(
            maxActive,
            1,
            'global prerender semaphore serializes cross-realm work when pool is full',
          );
          assert.deepEqual(
            [resA.response.isolatedHTML, resB.response.isolatedHTML].sort(),
            [`${realmA}card`, `${realmB}card`].sort(),
            'responses come from stubbed render attempts',
          );
        } finally {
          if (prevPoolSize === undefined) {
            delete process.env.PRERENDER_PAGE_POOL_SIZE;
          } else {
            process.env.PRERENDER_PAGE_POOL_SIZE = prevPoolSize;
          }
          PagePool.prototype.getPage = originalGetPage;
          PagePool.prototype.closeAll = originalCloseAll;
          RenderRunner.prototype.prerenderCardAttempt =
            originalPrerenderAttempt;
          RenderRunner.prototype.shouldRetryWithClearCache =
            originalRetrySignature;
          await localPrerenderer?.stop();
        }
      });

      test('creates spare standby when pool is at capacity', async function (assert) {
        let { pool, contextsCreated } = makeStubPagePool(1);
        await pool.warmStandbys();
        assert.strictEqual(
          contextsCreated.length,
          1,
          'initial standby created up to maxPages',
        );

        let first = await pool.getPage('realm-standby');
        assert.false(first.reused, 'first checkout uses standby page');

        await pool.warmStandbys();
        assert.strictEqual(
          contextsCreated.length,
          2,
          'spare standby created once the only slot is occupied',
        );
        await pool.closeAll();
      });

      test('standby pages bind to the first realm they serve', async function (assert) {
        let { pool } = makeStubPagePool(2);
        await pool.warmStandbys(); // fill initial standbys

        let realmAFirst = await pool.getPage('realm-a');
        await pool.warmStandbys(); // replenish after consuming standby
        let realmBFirst = await pool.getPage('realm-b');
        await pool.warmStandbys(); // replenish again to keep standbys warm

        let realmASecond = await pool.getPage('realm-a');
        let realmBSecond = await pool.getPage('realm-b');

        assert.false(realmAFirst.reused, 'first realm A call not reused');
        assert.false(realmBFirst.reused, 'first realm B call not reused');
        assert.true(realmASecond.reused, 'realm A reuses its page');
        assert.true(realmBSecond.reused, 'realm B reuses its page');
        assert.strictEqual(
          realmASecond.pageId,
          realmAFirst.pageId,
          'realm A keeps the same page',
        );
        assert.strictEqual(
          realmBSecond.pageId,
          realmBFirst.pageId,
          'realm B keeps the same page',
        );
        assert.notStrictEqual(
          realmAFirst.pageId,
          realmBFirst.pageId,
          'distinct pages per realm from standbys',
        );
        await pool.closeAll();
      });

      test('evicts idle realms without touching standbys', async function (assert) {
        let { pool, contextsCreated, contextsClosed } = makeStubPagePool(2);
        await pool.warmStandbys();

        assert.strictEqual(
          contextsCreated.length,
          2,
          'initial standbys created up to maxPages',
        );

        await pool.getPage('realm-a');
        await pool.warmStandbys(); // ensure standby pool replenishment settles before idle sweep

        let originalNow = Date.now;
        try {
          let now = Date.now();
          (Date as any).now = () => now + 13 * 60 * 60 * 1000; // 13 hours later

          let evicted = await pool.evictIdleRealms(12 * 60 * 60 * 1000);

          assert.deepEqual(evicted, ['realm-a'], 'idle realm evicted');
          assert.deepEqual(
            pool.getWarmRealms(),
            [],
            'realm entry removed from warm set',
          );
          let closedAtEviction = [...contextsClosed];
          assert.deepEqual(
            closedAtEviction,
            [contextsCreated[0]],
            'only the realm-bound page closed during idle eviction',
          );
          assert.true(
            contextsCreated.length > closedAtEviction.length,
            'standby pages remain available after idle eviction',
          );
        } finally {
          (Date as any).now = originalNow;
          await pool.closeAll();
        }
      });

      test('idle eviction skips unassigned standbys', async function (assert) {
        let { pool, contextsCreated, contextsClosed } = makeStubPagePool(1);
        await pool.warmStandbys();

        let createdBeforeSweep = contextsCreated.length;
        let evicted = await pool.evictIdleRealms(1);
        let closedAfterSweep = contextsClosed.length;

        assert.deepEqual(evicted, [], 'no idle realms to evict');
        assert.strictEqual(
          contextsCreated.length,
          createdBeforeSweep,
          'standby pool untouched by idle eviction',
        );
        assert.strictEqual(
          closedAfterSweep,
          0,
          'no contexts closed when only standbys are present',
        );
        await pool.closeAll();
      });
    });
  });

  module('prerender - module retries', function () {
    test('module prerender retries with clear cache on retry signature', async function (assert) {
      let originalAttempt = RenderRunner.prototype.prerenderModuleAttempt;
      let prerenderer: Prerenderer | undefined;
      let attempts: Array<RenderRouteOptions | undefined> = [];
      let retryRealm = 'https://retry.example/';
      let moduleURL = `${retryRealm}module.gts`;

      try {
        let attemptCount = 0;
        RenderRunner.prototype.prerenderModuleAttempt = async function (
          args: Parameters<RenderRunner['prerenderModuleAttempt']>[0],
        ) {
          let { realm: attemptRealm, url, renderOptions } = args;
          attempts.push(renderOptions);
          attemptCount++;
          let baseResponse = {
            id: url,
            nonce: `nonce-${attemptCount}`,
            isShimmed: false,
            lastModified: 0,
            createdAt: 0,
            deps: [],
            definitions: {},
          };
          let response: ModuleRenderResponse =
            attemptCount === 1
              ? {
                  ...baseResponse,
                  status: 'error',
                  error: {
                    type: 'error',
                    error: {
                      message: `Failed to execute 'removeChild' on 'Node': NotFoundError`,
                      status: 500,
                      title: 'boom',
                      additionalErrors: null,
                      stack: `Failed to execute 'removeChild' on 'Node': NotFoundError`,
                    },
                  },
                }
              : {
                  ...baseResponse,
                  status: 'ready',
                };

          return {
            response,
            timings: { launchMs: 0, renderMs: 1 },
            pool: {
              pageId: `page-${attemptCount}`,
              realm: attemptRealm,
              reused: attemptCount > 1,
              evicted: false,
              timedOut: false,
            },
          };
        };

        prerenderer = new Prerenderer({
          maxPages: 1,
          serverURL: 'http://127.0.0.1:4225',
        });

        let result = await prerenderer.prerenderModule({
          realm: retryRealm,
          url: moduleURL,
          auth: 'test-auth',
        });

        assert.strictEqual(
          attempts.length,
          2,
          'prerender retries once with clearCache',
        );
        assert.strictEqual(
          attempts[0],
          undefined,
          'first attempt uses provided render options',
        );
        assert.deepEqual(
          attempts[1],
          { clearCache: true },
          'second attempt enables clearCache',
        );
        assert.strictEqual(
          result.response.status,
          'ready',
          'successful response returned after retry',
        );
      } finally {
        RenderRunner.prototype.prerenderModuleAttempt = originalAttempt;
        await prerenderer?.stop();
      }
    });
  });

  module('prerender - card retries', function () {
    test('card prerender retries with clear cache on retry signature', async function (assert) {
      let originalAttempt = RenderRunner.prototype.prerenderCardAttempt;
      let prerenderer: Prerenderer | undefined;
      let attempts: Array<RenderRouteOptions | undefined> = [];
      let retryRealm = 'https://card-retry.example/';
      let cardURL = `${retryRealm}card`;

      try {
        let attemptCount = 0;
        RenderRunner.prototype.prerenderCardAttempt = async function (
          args: Parameters<RenderRunner['prerenderCardAttempt']>[0],
        ) {
          let { realm: attemptRealm, url: attemptUrl, renderOptions } = args;
          attempts.push(renderOptions);
          attemptCount++;
          let baseResponse: RenderResponse = {
            serialized: null,
            searchDoc: null,
            displayNames: null,
            deps: null,
            types: null,
            iconHTML: null,
            isolatedHTML: `${attemptUrl}-render-${attemptCount}`,
            headHTML: null,
            atomHTML: null,
            embeddedHTML: null,
            fittedHTML: null,
          };
          let response: RenderResponse =
            attemptCount === 1
              ? {
                  ...baseResponse,
                  error: {
                    type: 'error',
                    error: {
                      message: `Failed to execute 'removeChild' on 'Node': NotFoundError`,
                      status: 500,
                      title: 'boom',
                      additionalErrors: null,
                      stack: `Failed to execute 'removeChild' on 'Node': NotFoundError`,
                    },
                  },
                }
              : baseResponse;

          return {
            response,
            timings: { launchMs: 0, renderMs: 1 },
            pool: {
              pageId: `page-${attemptCount}`,
              realm: attemptRealm,
              reused: attemptCount > 1,
              evicted: false,
              timedOut: false,
            },
          };
        };

        prerenderer = new Prerenderer({
          maxPages: 1,
          serverURL: 'http://127.0.0.1:4225',
        });

        let result = await prerenderer.prerenderCard({
          realm: retryRealm,
          url: cardURL,
          auth: 'test-auth',
        });

        assert.strictEqual(
          attempts.length,
          2,
          'prerender retries once with clearCache',
        );
        assert.strictEqual(
          attempts[0],
          undefined,
          'first attempt uses provided render options',
        );
        assert.deepEqual(
          attempts[1],
          { clearCache: true },
          'second attempt enables clearCache',
        );
        assert.notOk(result.response.error, 'successful response returned');
        assert.strictEqual(
          result.response.isolatedHTML,
          `${cardURL}-render-2`,
          'final response came from retry attempt',
        );
      } finally {
        RenderRunner.prototype.prerenderCardAttempt = originalAttempt;
        await prerenderer?.stop();
      }
    });
  });
});
