import { module, test } from 'qunit';
import { basename } from 'path';
import type {
  RealmPermissions,
  RealmAdapter,
  RenderResponse,
  ModuleRenderResponse,
  FileExtractResponse,
  RenderRouteOptions,
} from '@cardstack/runtime-common';
import type { Realm as RuntimeRealm } from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/index';
import { PagePool } from '../prerender/page-pool';
import { RenderRunner } from '../prerender/render-runner';
import { BrowserManager } from '../prerender/browser-manager';

import {
  setupPermissionedRealmsCached,
  cleanWhiteSpace,
  testCreatePrerenderAuth,
  getPrerendererForTesting,
} from './helpers';
import { prerenderCard, prerenderFileExtract } from './helpers/prerender';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import {
  baseCardRef,
  trimExecutableExtension,
  rri,
  baseRealm,
  baseRRI,
  executableExtensions,
} from '@cardstack/runtime-common';
import {
  installDelayedRuntimeRealmSearchPatch,
  installFlakyDepFetchPatch,
  installRealmServerAssertOwnRealmServerBypassPatch,
  installSearchRequestObserverPatch,
  installThrottledRAFPatch,
} from './helpers/prerender-page-patches';

class TestSemaphore {
  #available: number;
  #queue: Array<(release: () => void) => void> = [];

  constructor(max: number) {
    this.#available = Math.max(1, max);
  }

  async acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--;
      return this.#release;
    }
    return await new Promise<() => void>((resolve) => {
      this.#queue.push(resolve);
    });
  }

  #release = () => {
    let next = this.#queue.shift();
    if (next) {
      next(this.#release);
      return;
    }
    this.#available++;
  };
}

interface StubPagePoolOptions {
  maxPages: number;
  renderSemaphore?: { acquire(): Promise<() => void> };
  createContextDelay?: (contextNumber: number) => Promise<void>;
  disableStandbyRefill?: boolean;
  standbyTimeoutMs?: number;
  closeContextDelay?: (id: string) => Promise<void>;
  onContextCreated?: (id: string) => void;
  onContextClosed?: (id: string) => void;
  // Default `true` for back-compat with existing tab-routing unit
  // tests that predate the admission feature. Admission-control
  // tests opt in by passing `false`.
  disableFileAdmission?: boolean;
}

const PAGE_POOL_CAPACITY_OVERRIDE_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
  'PRERENDER_HIGH_PRIORITY_THRESHOLD',
  'PRERENDER_POOL_IDLE_CONTRACTION_MS',
] as const;

function withEnvUnset<T>(keys: readonly string[], fn: () => T): T {
  let previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (let key of keys) {
      delete process.env[key];
    }
    return fn();
  } finally {
    for (let [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function makeStubPagePool(opts: StubPagePoolOptions) {
  function makeStorage(): Storage {
    let values: Record<string, string> = {};
    return {
      getItem(key: string) {
        return values[key] ?? null;
      },
      setItem(key: string, value: string) {
        values[key] = value;
      },
      removeItem(key: string) {
        delete values[key];
      },
      clear() {
        values = {};
      },
      key(index: number) {
        return Object.keys(values)[index] ?? null;
      },
      get length() {
        return Object.keys(values).length;
      },
    } as Storage;
  }

  let contextCounter = 0;
  let contextsCreated: string[] = [];
  let contextsClosed: string[] = [];
  let browser = {
    async createBrowserContext() {
      let counter = ++contextCounter;
      if (opts.createContextDelay) {
        await opts.createContextDelay(counter);
      }
      let id = `ctx-${counter}`;
      contextsCreated.push(id);
      opts.onContextCreated?.(id);
      let localStorage = makeStorage();
      let context = {
        async newPage() {
          return {
            async goto(_url: string, _opts?: any) {
              return;
            },
            async waitForFunction(_fn: any) {
              return true;
            },
            async evaluate(fn: (...args: any[]) => any, ...args: any[]) {
              let originalLocalStorage = (globalThis as any).localStorage;
              (globalThis as any).localStorage = localStorage;
              try {
                return await fn(...args);
              } finally {
                (globalThis as any).localStorage = originalLocalStorage;
              }
            },
            async close() {
              // CS-10817 step 3: PagePool closes individual pool pages
              // (without closing the shared context) on entry
              // disposal. Context-level bookkeeping still runs via
              // the context.close() hook above.
              return;
            },
            browserContext() {
              return context;
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
          if (opts.closeContextDelay) {
            await opts.closeContextDelay(id);
          }
          contextsClosed.push(id);
          opts.onContextClosed?.(id);
          return;
        },
      } as any;
      return context;
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
  // These stub tests exercise PagePool behavior via explicit
  // `options.maxPages` and per-test env setup. Shield construction from
  // repo-wide dev defaults in `mise-tasks/lib/env-vars.sh`, which now
  // exports `PRERENDER_PAGE_POOL_MIN/MAX=4` and would otherwise override
  // the caller's `maxPages`. Keep other env knobs available so tests that
  // intentionally set them (for example `PRERENDER_SHARED_CONTEXT_CAP`)
  // still exercise the requested behavior.
  let pool = withEnvUnset(
    PAGE_POOL_CAPACITY_OVERRIDE_ENV_KEYS,
    () =>
      new PagePool({
        maxPages: opts.maxPages,
        serverURL: 'http://localhost',
        browserManager: browserManager as any,
        boxelHostURL: 'http://localhost:4200',
        standbyTimeoutMs: opts.standbyTimeoutMs ?? 500,
        renderSemaphore: opts.renderSemaphore,
        disableStandbyRefill: opts.disableStandbyRefill,
        disableFileAdmission: opts.disableFileAdmission ?? true,
      }),
  );
  return { pool, contextsCreated, contextsClosed };
}

module(basename(__filename), function () {
  module('prerender - mutating tests', function (hooks) {
    let realmURL = 'http://127.0.0.1:4450/test/';
    let prerenderServerURL = new URL(realmURL).origin;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {
      [realmURL]: ['read', 'write', 'realm-owner'],
    };
    let prerenderer: Prerenderer;
    let realmAdapter: RealmAdapter;
    let realm: RuntimeRealm;
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
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.afterEach(async () => {
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
      onRealmSetup({ realms: setupRealms }) {
        ({ realm, realmAdapter } = setupRealms[0]);
        permissions = {
          [realmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('reuses pooled page and picks up updated instance', async function (assert) {
      const cardURL = `${realmURL}1`;

      let first = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
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
                  module: rri('./person'),
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

      let second = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
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

    test('module prerender reuses pooled page after updates', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;

      let first = await prerenderer.prerenderModule({
        affinityType: 'realm',
        affinityValue: realmURL,
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
        affinityType: 'realm',
        affinityValue: realmURL,
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
      let key = `${trimExecutableExtension(rri(moduleURL))}/Person`;
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
        affinityType: 'realm',
        affinityValue: realmURL,
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

    test('file extract surfaces broken FileDef module error without remote prerender timeout', async function (assert) {
      await realmAdapter.write(
        'filedef-mismatch.gts',
        `
          import { FileDef as BaseFileDef } from "https://cardstack.com/base/file-api";
          import { MissingChild } from "./missing-child";

          export class FileDef extends BaseFileDef {
            static missingChild = MissingChild;
          }
        `,
      );
      await realmAdapter.write('broken-file.mismatch', 'broken mismatch file');
      realm.__testOnlyClearCaches();

      let result = await prerenderFileExtract(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}broken-file.mismatch`,
        auth: auth(),
        renderOptions: {
          fileExtract: true,
          fileDefCodeRef: {
            module: rri(`${realmURL}filedef-mismatch`),
            name: 'FileDef',
          },
        },
      });

      assert.strictEqual(
        result.response.status,
        'error',
        'file extract reports error for broken FileDef module',
      );
      assert.ok(result.response.error, 'error payload is present');
      assert.ok(
        result.response.error?.error.message?.includes(
          'Received HTTP 404 from server',
        ),
        `error message should mention module 404, got: ${result.response.error?.error.message}`,
      );
      let messageIncludesTimeoutMarker = Boolean(
        result.response.error?.error.message?.includes('Prerender request to'),
      );
      assert.false(
        messageIncludesTimeoutMarker,
        'error should not be reported as a remote prerender request timeout',
      );
      assert.false(
        result.pool.timedOut,
        'pool should not mark this as a prerender timeout',
      );
    });

    test('transient 502 on dep fetch retries instead of timing out', async function (assert) {
      // While prerendering, the host's render-timer-stub suppresses
      // window.setTimeout. The loader's transient-5xx retry uses setTimeout-
      // based backoff, so a single 502 on a dep fetch used to hang the
      // entire render at `await sleep(delayMs)` for the full 90 s render
      // timeout. The fix routes the loader's retry sleep through
      // scheduleNativeTimeout (see loader-service.ts), bypassing the stub.
      // This test simulates a transient 502 on the card's module fetch and
      // asserts the prerender recovers within the retry budget rather than
      // timing out.
      let modulePath = 'flaky-target.gts';
      let moduleURL = `${realmURL}${modulePath}`;
      let cardPath = 'flaky-1.json';
      let cardURL = `${realmURL}flaky-1`;

      await realmAdapter.write(
        modulePath,
        `
          import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
          export class FlakyTarget extends CardDef {
            static displayName = 'FlakyTarget';
            @field name = contains(StringField);
            static isolated = class extends Component<typeof this> {
              <template><span data-test-name>{{@model.name}}</span></template>
            }
          }
        `,
      );
      await realmAdapter.write(
        cardPath,
        JSON.stringify(
          {
            data: {
              attributes: { name: 'Recovered' },
              meta: {
                adoptsFrom: {
                  module: rri('./flaky-target'),
                  name: 'FlakyTarget',
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

      // Strip executable extensions from both sides so the matcher fires
      // for every fetch shape the loader may issue: `flaky-target.gts`
      // (the source URL), `flaky-target` (extensionless — what the card's
      // adoptsFrom.module resolves to via rri), or the canonicalized form
      // surfaced through X-Boxel-Canonical-Path. Without this, the matcher
      // would miss the actual fetch and the test would silently pass
      // without exercising the retry path.
      let stripExecExt = (u: string) => {
        for (let ext of executableExtensions) {
          if (u.endsWith(ext)) {
            return u.slice(0, -ext.length);
          }
        }
        return u;
      };
      let targetTrimmed = stripExecExt(moduleURL);
      let flakyPatch = installFlakyDepFetchPatch({
        matcher: (url) => stripExecExt(url) === targetTrimmed,
        failuresBeforeSuccess: 1,
      });
      try {
        let started = Date.now();
        // clearCache forces the host's loader to drop its cached fetch +
        // module entries before the render, so the dep fetch the patch
        // is targeting actually goes to the network rather than coming
        // from the in-process loader cache populated by fullIndex above.
        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
          renderOptions: { clearCache: true },
        });
        let elapsedMs = Date.now() - started;

        assert.strictEqual(
          flakyPatch.failuresInjected(),
          1,
          'patch injected exactly one transient 502 for the dep fetch',
        );
        assert.notOk(
          result.response.error,
          `render recovered from transient 502 (error: ${JSON.stringify(
            result.response.error?.error ?? null,
          )})`,
        );
        assert.false(
          result.pool.timedOut,
          'render did not hit the 90s prerender timeout',
        );
        assert.true(
          elapsedMs < 30_000,
          `render completes within retry budget; observed ${elapsedMs}ms (90s would mean retry sleep is hung)`,
        );
        assert.strictEqual(
          result.response.serialized?.data.attributes?.name,
          'Recovered',
          'card data rendered correctly after retry',
        );
      } finally {
        await flakyPatch.restore();
      }
    });
  });

  function defineNonMutatingRunnerTests() {
    module('runner behavior', function (hooks) {
      let realmURL = 'http://127.0.0.1:4455/test/';
      let prerenderServerURL = new URL(realmURL).origin;
      let testUserId = '@user1:localhost';
      let permissions: RealmPermissions = {
        [realmURL]: ['read', 'write', 'realm-owner'],
      };
      let prerenderer: Prerenderer;
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
          maxPages: 2,
          serverURL: prerenderServerURL,
        });
      });

      hooks.after(async () => {
        await prerenderer.stop();
      });

      hooks.beforeEach(async () => {
        await prerenderer.disposeAffinity({
          affinityType: 'realm',
          affinityValue: realmURL,
        });
      });

      setupPermissionedRealmsCached(hooks, {
        mode: 'before',
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
                      module: rri('./no-icon'),
                      name: 'NoIcon',
                    },
                  },
                },
              },
              'bad-icon-import.gts': `
                import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
                export class BadIconImport extends CardDef {
                  static displayName = "Bad Icon Import";
                  static icon = undefined as any;
                  @field name = contains(StringField);
                  static isolated = class extends Component<typeof this> {
                    <template>{{@model.name}}</template>
                  }
                }
              `,
              'bad-icon-import.json': {
                data: {
                  attributes: {
                    name: 'Bad Icon',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./bad-icon-import'),
                      name: 'BadIconImport',
                    },
                  },
                },
              },
              'broken.gts': 'export const Broken = ;',
              'broken.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./broken'),
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
                      module: rri('./rejects'),
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
                      module: rri('./rsvp-rejects'),
                      name: 'RsvpRejects',
                    },
                  },
                },
              },
              // Simulates the runloop-swallowed-exception class of render
              // failure. The template renders fine, but a MutationObserver
              // forces every Glimmer update of [data-prerender-status]
              // back to "loading" — the same end-state produced when the
              // real template throws and the runloop catches the
              // exception without any JS event firing. The desync
              // detector should recognise this as `model.status=ready`
              // vs DOM=loading and write data-prerender-status="unusable"
              // directly via Document API, evicting the page (Glimmer's
              // failure to advance the binding IS the signal that the
              // runloop is dead — half-rendered state can't be reused).
              // The console.error call simulates Chrome's "Uncaught (in
              // promise) ..." log so the captured additionalErrors has
              // a stack-bearing entry the test can assert on.
              'desync-repro.gts': `
              import { registerDestructor } from '@ember/destroyable';
              import { CardDef, Component } from 'https://cardstack.com/base/card-api';
              export class DesyncRepro extends CardDef {
                static isolated = class extends Component<typeof this> {
                  constructor(...args) {
                    super(...args);
                    // Install the observer synchronously: by the time this
                    // child component constructor runs, the parent template
                    // has already rendered the [data-prerender] container
                    // into the DOM, so we don't need to defer the install.
                    // We deliberately avoid setTimeout here because the
                    // prerender timer stub blocks zero-delay callbacks
                    // during prerender, which would skip the install.
                    let container = document.querySelector('[data-prerender]');
                    if (container) {
                      let observer = new MutationObserver(() => {
                        if (container.getAttribute('data-prerender-status') === 'ready') {
                          container.setAttribute('data-prerender-status', 'loading');
                        }
                      });
                      observer.observe(container, {
                        attributes: true,
                        attributeFilter: ['data-prerender-status'],
                      });
                      // Disconnect when this component tears down so the
                      // observer doesn't persist into a subsequent render
                      // if the page were reused (it shouldn't be, since the
                      // detector marks the page 'unusable' and the pool
                      // evicts — but belt and suspenders).
                      registerDestructor(this, () => observer.disconnect());
                    }
                    console.error('desync-repro: simulated runloop-swallowed render exception');
                  }
                  <template>ok</template>
                }
              }
            `,
              'desync-repro.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./desync-repro'),
                      name: 'DesyncRepro',
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
                      module: rri('./throws'),
                      name: 'Throws',
                    },
                  },
                },
              },
              // Module evaluates a top-level throw, mirroring the
              // wrong-subpath import class of bug (CS-11024). The route's
              // model() rejects when the loader imports the module, the
              // route's `error` action fires with the active transition,
              // and #processRenderError lifts data-prerender-status='error'
              // — historically before render.error's <pre> had been
              // populated, so the prerender server captured an empty
              // payload and synthesized "invalid error payload" instead of
              // surfacing the real underlying throw.
              'eval-throw.gts': `
              import { CardDef } from 'https://cardstack.com/base/card-api';
              throw new Error('module-eval-throw');
              export class EvalThrow extends CardDef {
                static displayName = 'Eval Throw';
              }
            `,
              'eval-throw.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./eval-throw'),
                      name: 'EvalThrow',
                    },
                  },
                },
              },
              'console-error.gts': `
              import { CardDef, Component } from 'https://cardstack.com/base/card-api';
              export class ConsoleError extends CardDef {
                static isolated = class extends Component<typeof this> {
                  get explode() {
                    console.error('console boom');
                    throw new Error('boom');
                  }
                  <template>{{this.explode}}</template>
                }
              }
            `,
              'console-error.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./console-error'),
                      name: 'ConsoleError',
                    },
                  },
                },
              },
              'console-no-error.gts': `
              import { CardDef, Component } from 'https://cardstack.com/base/card-api';
              export class ConsoleNoError extends CardDef {
                static isolated = class extends Component<typeof this> {
                  constructor(...args) {
                    super(...args);
                    console.error('console boom');
                  }
                  <template>ok</template>
                }
              }
            `,
              'console-no-error.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./console-no-error'),
                      name: 'ConsoleNoError',
                    },
                  },
                },
              },
              'directory-query.gts': `
              import { CardDef, field, contains, linksTo, linksToMany, StringField, Component, queryableValue } from 'https://cardstack.com/base/card-api';

              export class Person extends CardDef {
                static displayName = 'Person';
                @field name = contains(StringField);
                @field team = contains(StringField);
                @field managerName = contains(StringField);
                @field manager = linksTo(() => Person);
                @field reports = linksToMany(() => Person, {
                  query: {
                    filter: {
                      eq: {
                        managerName: '$this.name',
                      },
                    },
                    page: {
                      size: 10,
                      number: 0,
                    },
                  },
                });

                // Keep person-instance indexing deterministic for this test:
                // this avoids firing query fields when Person cards are
                // prerendered in isolation during indexing.
                static isolated = class extends Component<typeof this> {
                  <template>
                    <span data-test-person-name>{{@model.name}}</span>
                    <span data-test-person-team>{{@model.team}}</span>
                  </template>
                };
              }

              export class Directory extends CardDef {
                static displayName = 'Directory';
                @field teamFilter = contains(StringField);
                @field staff = linksToMany(() => Person, {
                  query: {
                    filter: {
                      eq: {
                        team: '$this.teamFilter',
                      },
                    },
                    page: {
                      size: 10,
                      number: 0,
                    },
                  },
                });

                static [queryableValue](value: Directory | null) {
                  if (!value) {
                    return null;
                  }
                  return {
                    teamFilter: value.teamFilter,
                    staff: (value.staff ?? []).map((person) => ({
                      name: person.name,
                      manager: person.manager
                        ? {
                            name: person.manager.name,
                          }
                        : null,
                      reports: (person.reports ?? []).map((report) => ({
                        name: report.name,
                        manager: report.manager
                          ? {
                              name: report.manager.name,
                            }
                          : null,
                      })),
                    })),
                  };
                }

                static isolated = class extends Component<typeof this> {
                  <template>
                    <div data-test-directory-team>{{@model.teamFilter}}</div>
                    <div id="heroGridPlane" data-test-hero-grid-plane>
                      {{#each @model.staff as |person|}}
                        <div class="hero-mini-card" data-test-hero-mini-card>
                          <div data-test-staff-name>{{person.name}}</div>
                          <div data-test-staff-manager>
                            {{#if person.manager}}
                              {{person.manager.name}}
                            {{/if}}
                          </div>
                          <ul data-test-staff-reports>
                            {{#each person.reports as |report|}}
                              <li class="hero-mini-card" data-test-staff-report data-test-hero-mini-card>
                                {{report.name}}
                                <span data-test-staff-report-manager>
                                  {{#if report.manager}}
                                    {{report.manager.name}}
                                  {{/if}}
                                </span>
                              </li>
                            {{/each}}
                          </ul>
                        </div>
                      {{/each}}
                    </div>
                  </template>
                };
              }
            `,
              'directory-ops.json': {
                data: {
                  attributes: {
                    teamFilter: 'Ops',
                  },
                  relationships: {
                    staff: {
                      links: { self: null },
                      data: [],
                      meta: {
                        errors: [
                          {
                            realm: 'https://unreachable-realm.example.com/',
                            type: 'fetch-error',
                            message: 'Could not reach remote realm',
                            status: 502,
                          },
                        ],
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./directory-query'),
                      name: 'Directory',
                    },
                  },
                },
              },
              'person-alice.json': {
                data: {
                  attributes: {
                    name: 'Alice',
                    team: 'Leadership',
                    managerName: '',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./directory-query'),
                      name: 'Person',
                    },
                  },
                },
              },
              'person-bob.json': {
                data: {
                  attributes: {
                    name: 'Bob',
                    team: 'Ops',
                    managerName: 'Alice',
                  },
                  relationships: {
                    manager: {
                      links: {
                        self: './person-alice',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./directory-query'),
                      name: 'Person',
                    },
                  },
                },
              },
              'person-carol.json': {
                data: {
                  attributes: {
                    name: 'Carol',
                    team: 'Ops',
                    managerName: 'Alice',
                  },
                  relationships: {
                    manager: {
                      links: {
                        self: './person-alice',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./directory-query'),
                      name: 'Person',
                    },
                  },
                },
              },
              'person-dave.json': {
                data: {
                  attributes: {
                    name: 'Dave',
                    team: 'Ops',
                    managerName: 'Bob',
                  },
                  relationships: {
                    manager: {
                      links: {
                        self: './person-bob',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./directory-query'),
                      name: 'Person',
                    },
                  },
                },
              },
              'person-eve.json': {
                data: {
                  attributes: {
                    name: 'Eve',
                    team: 'Sales',
                    managerName: 'Bob',
                  },
                  relationships: {
                    manager: {
                      links: {
                        self: './person-bob',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./directory-query'),
                      name: 'Person',
                    },
                  },
                },
              },
              'notes.txt': 'Hello from file extract',
            },
          },
        ],
        onRealmSetup() {
          permissions = {
            [realmURL]: ['read', 'write', 'realm-owner'],
          };
        },
      });

      test('prerenderModule returns module metadata', async function (assert) {
        const moduleURL = `${realmURL}person.gts`;

        let result = await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: realmURL,
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
        let key = `${trimExecutableExtension(rri(moduleURL))}/Person`;
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

      test('card prerender hoists module transpile errors', async function (assert) {
        let brokenCard = `${realmURL}broken.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
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
        let additionalErrors = result.response.error?.error.additionalErrors;
        if (additionalErrors !== null) {
          assert.ok(
            Array.isArray(additionalErrors),
            'additionalErrors is an array when present',
          );
          assert.ok(
            additionalErrors?.every(
              (entry) =>
                entry?.title === 'Console error' ||
                entry?.title === 'Console assert',
            ),
            'additionalErrors only include console entries',
          );
        }
        let deps = result.response.error?.error.deps ?? [];
        assert.ok(
          deps.some((dep) => dep.includes(`${realmURL}broken`)),
          'deps include failing module',
        );
      });

      test('card prerender surfaces actionable error for bad icon import', async function (assert) {
        let cardURL = `${realmURL}bad-icon-import.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
        });

        assert.ok(result.response.error, 'prerender reports error');
        assert.strictEqual(
          result.response.error?.error.status,
          500,
          'bad icon import error surfaces as 500',
        );
        assert.ok(
          result.response.error?.error.message?.includes(
            'static icon of BadIconImport is undefined',
          ),
          `error message describes the bad icon import, got: ${result.response.error?.error.message}`,
        );
      });

      test('card prerender surfaces empty render container', async function (assert) {
        let cardURL = `${realmURL}no-icon.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
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
        let errorDeps = result.response.error?.error.deps;
        assert.notStrictEqual(
          errorDeps,
          null,
          'short-circuit invalid render response includes non-null deps',
        );
        let deps = errorDeps ?? [];
        assert.true(
          Array.isArray(deps),
          'short-circuit invalid render response deps are an array',
        );
        assert.true(
          [`${realmURL}no-icon`, `${realmURL}no-icon.json`].some((dep) =>
            deps.includes(dep),
          ),
          `synthesized invalid render error includes fallback dep context (deps: ${JSON.stringify(deps)})`,
        );
      });

      test('card prerender surfaces runtime render errors without timing out', async function (assert) {
        let cardURL = `${realmURL}throws.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
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

      test('card prerender includes console errors when render fails', async function (assert) {
        let cardURL = `${realmURL}console-error.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
        });

        assert.ok(result.response.error, 'prerender reports error');
        let additionalErrors = result.response.error?.error.additionalErrors;
        assert.ok(
          Array.isArray(additionalErrors),
          'additionalErrors includes console errors',
        );
        let consoleEntry = additionalErrors?.find(
          (error: any) =>
            typeof error?.message === 'string' &&
            error.message.includes('console boom'),
        ) as { message?: string; stack?: string } | undefined;
        assert.ok(
          consoleEntry,
          `console error message is captured, got: ${JSON.stringify(additionalErrors)}`,
        );
        // Puppeteer's CDP stackTrace() doesn't fire for every
        // console.error call site (it depends on the originating runtime
        // task), and when it does fire the frames point at the bundled
        // chunk.js URLs (no source maps at capture time). What matters
        // is that the captured frame list round-trips into the error
        // doc as a non-empty stack string when present — that's the
        // only lead a debugger has when the desync detector fires with
        // no other signal.
        if (typeof consoleEntry?.stack === 'string') {
          assert.ok(
            consoleEntry.stack.length > 0,
            `captured console error stack is non-empty when present, got: ${consoleEntry.stack}`,
          );
        }
      });

      test('card prerender ignores console errors on success', async function (assert) {
        let cardURL = `${realmURL}console-no-error.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
        });

        assert.notOk(result.response.error, 'prerender succeeds');
      });

      // Pins down the bucket-to-additionalErrors merge for
      // `source: 'exception'` entries on the timeout error-doc path.
      // We can't synthesize a fixture that produces real CDP
      // `Runtime.exceptionThrown` events (Ember's runloop catches
      // synthetic throws before V8 classifies them as uncaught), so
      // we use the `__test_seedRevokedException` seam to mimic the
      // end state of a real CDP throw+revoke pair on the actual
      // page being rendered. The render itself is healthy — the
      // `simulateTimeoutMs` / tight `timeoutMs` combo forces a
      // server-side "Render timeout" doc, and we verify the seeded
      // entry rides along on `additionalErrors` with the
      // revoked-by-late-catch title from render-runner's serializer.
      test('CDP-trapped revoked exception lands in timeout error-doc additionalErrors', async function (assert) {
        let cardURL = `${realmURL}1.json`;
        let result = await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
          renderOptions: { cardRender: true },
          // tight timeout + simulated delay → server-side withTimeout
          // wins and we surface a Render timeout doc.
          opts: { timeoutMs: 1, simulateTimeoutMs: 200 },
          // Seed runs AFTER `resetConsoleErrors` (render-runner moved
          // the onTabAcquired callback to that point), so the seed
          // survives into the bucket the merge later drains.
          onTabAcquired: ({ pageId }) => {
            prerenderer.__test_seedRevokedException(
              pageId,
              {
                type: 'error',
                text: 'TypeError: simulated whitepaper-class bug',
                source: 'exception',
                stackFrames: [
                  {
                    url: 'http://localhost:4200/host.js',
                    lineNumber: 42,
                    columnNumber: 7,
                  },
                ],
              },
              424241,
            );
          },
        });

        let timeoutError =
          (result.response.card?.error as any) ??
          (result.response.pageUnusableError as any);
        assert.ok(timeoutError, 'render times out');
        assert.strictEqual(
          timeoutError?.error?.title,
          'Render timeout',
          'timeout doc title',
        );

        let additionalErrors: any[] =
          timeoutError?.error?.additionalErrors ?? [];
        let revokedEntry = additionalErrors.find(
          (e) => e?.title === 'Uncaught exception (revoked by late .catch)',
        );
        assert.ok(
          revokedEntry,
          `seeded revoked exception surfaces on the timeout doc; ` +
            `additionalErrors titles: ${JSON.stringify(
              additionalErrors.map((e) => e?.title),
            )}`,
        );
        assert.ok(
          revokedEntry?.message?.includes('whitepaper-class bug'),
          `revoked entry preserves the actionable exception message; got: ${revokedEntry?.message}`,
        );
        let revokedStack: unknown = revokedEntry?.stack;
        assert.ok(
          typeof revokedStack === 'string'
            ? revokedStack.includes('UncaughtExceptionRevoked')
            : false,
          `revoked entry stack uses the UncaughtExceptionRevoked header; got: ${revokedStack}`,
        );
      });

      test('card prerender surfaces unhandled promise rejection without timing out', async function (assert) {
        let cardURL = `${realmURL}rejects.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
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

      test('card prerender detects DOM desync when Glimmer binding never flips to ready', async function (assert) {
        // The desync-repro fixture renders successfully but forces the
        // [data-prerender-status] attribute back to "loading" every time
        // Glimmer tries to flip it — the same end-state produced in
        // production when a template throws and the runloop swallows the
        // exception with no JS event firing. The desync detector should
        // spot model.status=ready vs DOM=loading after Backburner's
        // flush window and write the terminal state directly. The
        // fixture also calls console.error; puppeteer's CDP capture
        // preserves a stack trace on that console message so the error
        // doc lands with a lead back at the offending module.
        let cardURL = `${realmURL}desync-repro.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
        });

        assert.ok(
          result.response.error,
          'desync detector produces an error doc',
        );
        assert.strictEqual(
          result.response.error?.error.title,
          'Render binding desync',
          'error title names the desync class',
        );
        assert.strictEqual(
          result.response.error?.error.status,
          500,
          'desync surfaces as 500',
        );
        assert.ok(
          result.response.error?.error.message
            ?.toLowerCase()
            .includes('ember rendering error'),
          `desync message names the failure class (Ember rendering error), got: ${result.response.error?.error.message}`,
        );
        assert.ok(
          result.response.error?.error.message
            ?.toLowerCase()
            .includes('additional errors'),
          `desync message points users at the Additional Errors section, got: ${result.response.error?.error.message}`,
        );
        // Desync IS the signal that the runloop stopped advancing this
        // card's render — Glimmer's binding never landed. The page is
        // carrying a half-finished render tree, so the pool must evict
        // it; reusing would bleed the broken state into the next render.
        assert.true(
          result.pool.evicted,
          'desync signals a dead runloop — page is evicted',
        );
        assert.false(
          result.pool.timedOut,
          'desync detector fires well before cardRenderTimeout',
        );

        // The desync detector carries very little context on its own —
        // the real lead is the console.error(s) the page logged while
        // the render was in-flight, which the render-runner appends to
        // additionalErrors with their CDP-reported stack frames.
        let additionalErrors =
          result.response.error?.error.additionalErrors ?? [];
        let consoleEntry = additionalErrors.find(
          (error: any) =>
            typeof error?.message === 'string' &&
            error.message.includes('desync-repro'),
        ) as { message?: string; stack?: string } | undefined;
        assert.ok(
          consoleEntry,
          `console error message is captured in additionalErrors, got: ${JSON.stringify(additionalErrors)}`,
        );
        // Stack is best-effort: puppeteer's CDP stackTrace() doesn't
        // fire reliably for every console.error site, and when it does
        // the frames point at bundled chunk.js URLs (no source maps at
        // capture time). Verify only that a non-empty stack round-trips
        // into the error doc when one was attached.
        if (typeof consoleEntry?.stack === 'string') {
          assert.ok(
            consoleEntry.stack.length > 0,
            `captured console error stack is non-empty when present, got: ${consoleEntry.stack}`,
          );
        }
      });

      test('card prerender surfaces RSVP rejection without timing out', async function (assert) {
        let cardURL = `${realmURL}rsvp-rejects.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
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
                    // Vite builds the host as pure ESM with no AMD registry;
                    // reach the render route class via the Ember
                    // ApplicationInstance exposed by the
                    // export-application-global instance-initializer.
                    let appInstance = (window as any)['@cardstack/host'];
                    let RenderRouteClass =
                      appInstance?.factoryFor?.('route:render')?.class;
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

          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL,
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
          let errorDeps = result.response.error?.error.deps;
          assert.notStrictEqual(
            errorDeps,
            null,
            'pre-model short-circuit error includes non-null deps',
          );
          let deps = errorDeps ?? [];
          assert.true(
            Array.isArray(deps),
            'pre-model short-circuit deps are an array',
          );
          assert.true(
            [`${realmURL}1.json`, `${realmURL}1`].some((dep) =>
              deps.includes(dep),
            ),
            `pre-model fallback error includes dep context from transition params (deps: ${JSON.stringify(deps)})`,
          );
        } finally {
          PagePool.prototype.getPage = originalGetPage;
        }
      });

      // CS-11024: a card whose module throws synchronously during
      // evaluation drives the route-error path. data-prerender-status='error'
      // used to be lifted before the render.error template populated the
      // <pre data-prerender-error>, letting the prerender server capture an
      // empty payload and synthesize "invalid error payload". The fix
      // defers the status flip to afterRender so the captured error is the
      // actual underlying throw.
      test('card prerender surfaces module-evaluation throw via the error route', async function (assert) {
        let cardURL = `${realmURL}eval-throw.json`;

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: cardURL,
          auth: auth(),
        });

        assert.ok(result.response.error, 'prerender reports error');
        let message = result.response.error?.error.message ?? '';
        assert.true(
          message.includes('module-eval-throw'),
          `error surfaces actual underlying throw, got: ${message}`,
        );
        assert.false(
          /returned an invalid error payload/.test(message),
          `error is not the synthesized "invalid error payload" fallback (got: ${message})`,
        );
        assert.false(
          result.pool.timedOut,
          'module-evaluation throw is not treated as timeout',
        );
      });

      test('card prerender waits for query fallback search and nested relationship loads', async function (assert) {
        const cardURL = `${realmURL}directory-ops`;
        let realmServerPatch =
          installRealmServerAssertOwnRealmServerBypassPatch();
        let delayedSearchPatch = installDelayedRuntimeRealmSearchPatch(150);
        try {
          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL,
            realm: realmURL,
            url: cardURL,
            auth: auth(),
          });

          assert.notOk(result.response.error, 'prerender succeeds');
          assert.true(
            delayedSearchPatch.getRequestCount() > 0,
            'fallback _search requests occurred and were delayed',
          );

          let isolatedHTML = cleanWhiteSpace(
            result.response.isolatedHTML ?? '',
          );
          assert.ok(
            /data-test-staff-name[^>]*>\s*Bob\s*</.test(isolatedHTML),
            `isolated html includes query results: ${isolatedHTML}`,
          );
          assert.ok(
            /data-test-staff-manager[^>]*>\s*Alice\s*</.test(isolatedHTML),
            `isolated html includes lazy relationship from query result: ${isolatedHTML}`,
          );
          assert.ok(
            /data-test-staff-report[^>]*>\s*Eve/.test(isolatedHTML),
            `isolated html includes nested query results: ${isolatedHTML}`,
          );
          assert.ok(
            /data-test-staff-report-manager[^>]*>\s*Bob\s*</.test(isolatedHTML),
            `isolated html includes nested relationship loads: ${isolatedHTML}`,
          );
          assert.ok(
            /id="heroGridPlane"/.test(isolatedHTML),
            `isolated html includes hero grid container: ${isolatedHTML}`,
          );
          let heroMiniCards =
            isolatedHTML.match(/class="hero-mini-card"/g) ?? [];
          assert.ok(
            heroMiniCards.length >= 3,
            `isolated html includes hero mini cards from query and nested query loads: ${isolatedHTML}`,
          );

          let staff = result.response.searchDoc?.staff as
            | Array<Record<string, any>>
            | undefined;
          assert.ok(
            Array.isArray(staff),
            'searchDoc includes query field results',
          );

          let bob = staff?.find((entry) => entry?.name === 'Bob');
          assert.ok(bob, 'searchDoc includes Bob from query results');
          assert.strictEqual(
            bob?.manager?.name,
            'Alice',
            'searchDoc includes loaded manager relationship',
          );

          let bobReports = bob?.reports as
            | Array<Record<string, any>>
            | undefined;
          assert.ok(
            Array.isArray(bobReports),
            'searchDoc includes nested query results',
          );
          let hasEveWithManager = bobReports?.some(
            (report) =>
              report?.name === 'Eve' && report?.manager?.name === 'Bob',
          );
          assert.true(
            Boolean(hasEveWithManager),
            'searchDoc includes nested loaded relationships',
          );
        } finally {
          await realmServerPatch.restore();
          delayedSearchPatch.restore();
        }
      });

      test('module prerender evicts pooled page on timeout', async function (assert) {
        const moduleURL = `${realmURL}person.gts`;

        let first = await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: moduleURL,
          auth: auth(),
        });
        assert.false(first.pool.reused, 'initial module render not reused');
        assert.false(first.pool.evicted, 'initial module render not evicted');

        let timedOut = await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: realmURL,
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

        // The timeout error must carry the structured diagnostics
        // block so operators can classify the stall. Diagnostics
        // live on `response.meta.diagnostics` (the consolidated
        // channel — the indexer reads from there and persists into
        // `boxel_index.timing_diagnostics`, mirroring to
        // `error_doc.diagnostics` at write time for UI compat).
        let diagnostics = (timedOut.response as any)?.meta?.diagnostics;
        assert.strictEqual(
          typeof diagnostics,
          'object',
          'timeout error includes diagnostics object',
        );
        assert.notStrictEqual(diagnostics, null, 'diagnostics is not null');
        assert.strictEqual(
          typeof diagnostics?.launchMs,
          'number',
          'diagnostics.launchMs is populated by server-side enrichment',
        );
        let waitsShape =
          typeof diagnostics?.waits?.semaphoreMs === 'number' &&
          typeof diagnostics?.waits?.admissionMs === 'number' &&
          typeof diagnostics?.waits?.tabQueueMs === 'number' &&
          typeof diagnostics?.waits?.tabStartupMs === 'number';
        assert.true(
          waitsShape,
          'diagnostics.waits carries per-stage breakdown',
        );
        assert.strictEqual(
          typeof diagnostics?.renderElapsedMs,
          'number',
          'diagnostics.renderElapsedMs is populated',
        );
        assert.strictEqual(
          typeof diagnostics?.totalElapsedMs,
          'number',
          'diagnostics.totalElapsedMs is populated',
        );
        // Note: diagnostics.requestId is only populated on the HTTP
        // path (prerender-app stamps it from x-boxel-prerender-request-id).
        // The in-process Prerenderer call used by this test doesn't
        // have one, so we don't assert it here. See the separate
        // prerender-server-test for the HTTP-path requestId coverage.
        // Host-side fields (recentModuleEvaluations / cardDocsInFlight
        // / queryLoadsInFlight) are also best-effort: the withTimeout
        // capture at `timeoutMs:1` races the page teardown, so the
        // page may already be closed by the time we attempt the
        // diagnostic page.evaluate(). When present, their shape must
        // be { url, ms } — when absent, the server-side timings
        // above are sufficient to classify the stall as a timeout.
        let moduleEvals = diagnostics?.recentModuleEvaluations;
        if (Array.isArray(moduleEvals) && moduleEvals.length > 0) {
          let allShaped = moduleEvals.every(
            (e: any) => typeof e?.url === 'string' && typeof e?.ms === 'number',
          );
          assert.true(
            allShaped,
            `diagnostics.recentModuleEvaluations entries carry { url, ms }`,
          );
        }

        let afterTimeout = await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: moduleURL,
          auth: auth(),
        });
        assert.false(
          afterTimeout.pool.reused,
          'timeout eviction prevents reuse on next render',
        );
        assert.false(
          afterTimeout.pool.evicted,
          'no eviction on recovery render',
        );
        assert.false(afterTimeout.pool.timedOut, 'no timeout after recovery');
        assert.strictEqual(
          afterTimeout.response.status,
          'ready',
          'subsequent render succeeds',
        );
      });

      test('card prerender timeout surfaces query-field and linked-field load timings in diagnostics', async function (assert) {
        // CS-10872: exercise a card render that depends on a
        // `linksToMany` query field (which itself fans out into
        // per-row `linksTo` loads). We slow the server-side search
        // enough that a tight render timeout catches the render with
        // a pending query-field load and/or its linked-field loads.
        // The assertions below require the diagnostics to name the
        // individual query and linked-field URLs, not just a count.
        const cardURL = `${realmURL}directory-ops`;
        let realmServerPatch =
          installRealmServerAssertOwnRealmServerBypassPatch();
        let delayedSearchPatch = installDelayedRuntimeRealmSearchPatch(8_000);
        try {
          let result = await prerenderer.prerenderVisit({
            affinityType: 'realm',
            affinityValue: realmURL,
            realm: realmURL,
            url: cardURL,
            auth: auth(),
            renderOptions: { cardRender: true },
            opts: { timeoutMs: 2_000 },
          });

          let timeoutError =
            (result.response.card?.error as any) ??
            (result.response.pageUnusableError as any);
          assert.ok(
            timeoutError,
            'timed-out card render surfaces a RenderError',
          );
          assert.strictEqual(
            timeoutError?.error?.title,
            'Render timeout',
            'error title is "Render timeout"',
          );

          // Diagnostics live on `response.meta.diagnostics` — the
          // consolidated channel the indexer reads from and persists
          // onto `boxel_index.timing_diagnostics` (mirrored to
          // `error_doc.diagnostics` for UI compat).
          let diagnostics = (result.response as any)?.meta?.diagnostics;
          assert.strictEqual(
            typeof diagnostics,
            'object',
            'timeout error carries diagnostics block',
          );
          assert.notStrictEqual(diagnostics, null, 'diagnostics is not null');

          // Server-side launch / render breakdown must always be present.
          assert.strictEqual(
            typeof diagnostics?.launchMs,
            'number',
            'diagnostics.launchMs populated',
          );
          let waitsShape =
            typeof diagnostics?.waits?.semaphoreMs === 'number' &&
            typeof diagnostics?.waits?.admissionMs === 'number' &&
            typeof diagnostics?.waits?.tabQueueMs === 'number' &&
            typeof diagnostics?.waits?.tabStartupMs === 'number';
          assert.true(waitsShape, 'diagnostics.waits breakdown populated');
          assert.strictEqual(
            typeof diagnostics?.renderElapsedMs,
            'number',
            'diagnostics.renderElapsedMs populated',
          );

          // Render-stage breadcrumb: we got past route setup, so the
          // stage should name *something* from buildModel:* or later.
          assert.strictEqual(
            typeof diagnostics?.renderStage,
            'string',
            `diagnostics.renderStage populated (got ${JSON.stringify(
              diagnostics?.renderStage,
            )})`,
          );

          // The core assertion: the in-flight OR recent query-load
          // list must name at least one entry. Whether it's still
          // pending or just completed depends on exact timing of the
          // delayed search vs. the 2s timeout, so we accept either.
          let queryLoads: Array<Record<string, unknown>> = [
            ...(Array.isArray(diagnostics?.queryLoadsInFlight)
              ? diagnostics.queryLoadsInFlight
              : []),
            ...(Array.isArray(diagnostics?.recentQueryLoads)
              ? diagnostics.recentQueryLoads
              : []),
          ];
          assert.true(
            queryLoads.length > 0,
            `diagnostics surface at least one query load (in-flight or recent): ${JSON.stringify(
              diagnostics,
            )}`,
          );
          // Every tracked query load should be tagged with a source
          // string (SearchResource annotates seed/search/live-refresh).
          let allTagged = queryLoads.every((entry) => {
            let meta = (entry as any)?.meta ?? entry;
            return typeof meta?.source === 'string';
          });
          assert.true(
            allTagged,
            'each query load entry is tagged with a `source` identifier',
          );

          // Loader must have recorded at least one module evaluation
          // for the directory-query module (or its dependencies). The
          // history is bounded and captures Glimmer-compile cost.
          let moduleEvals = diagnostics?.recentModuleEvaluations;
          let moduleEvalsShape =
            Array.isArray(moduleEvals) &&
            moduleEvals.length > 0 &&
            moduleEvals.every(
              (e: any) =>
                typeof e?.url === 'string' && typeof e?.ms === 'number',
            );
          assert.true(
            moduleEvalsShape,
            'diagnostics.recentModuleEvaluations names compiled modules with ms timings',
          );
        } finally {
          await realmServerPatch.restore();
          delayedSearchPatch.restore();
        }
      });

      test('file prerender returns extracted metadata', async function (assert) {
        const fileURL = `${realmURL}notes.txt`;

        let result = await prerenderFileExtract(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: fileURL,
          auth: auth(),
          renderOptions: { fileExtract: true },
        });

        assert.strictEqual(
          result.response.status,
          'ready',
          'file extract reports ready',
        );
        assert.strictEqual(
          result.response.searchDoc?.name,
          'notes.txt',
          'search doc includes name',
        );
        assert.ok(
          result.response.deps.includes(`${baseRealm.url}card-api`),
          'deps include base card-api module (where FileDef is defined)',
        );
        assert.notOk(
          result.response.deps.includes(fileURL),
          'deps exclude the file url itself',
        );
      });
    });
  }

  function defineRuntimeDepsResetTests() {
    module('runtime deps reset', function (hooks) {
      let realmURL = 'http://127.0.0.1:4457/test/';
      let prerenderServerURL = new URL(realmURL).origin;
      let testUserId = '@user1:localhost';
      let permissions: RealmPermissions = {
        [realmURL]: ['read', 'write', 'realm-owner'],
      };
      let prerenderer: Prerenderer;
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
          maxPages: 2,
          serverURL: prerenderServerURL,
        });
      });

      hooks.after(async () => {
        await prerenderer.stop();
      });

      hooks.beforeEach(async () => {
        await prerenderer.disposeAffinity({
          affinityType: 'realm',
          affinityValue: realmURL,
        });
      });

      setupPermissionedRealmsCached(hooks, {
        mode: 'before',
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
              'dep-reset-consumer.gts': `
                import { CardDef, field, linksTo, Component } from 'https://cardstack.com/base/card-api';
                import { Person } from './person';
                export class DepResetConsumer extends CardDef {
                  static displayName = 'Dep Reset Consumer';
                  @field friend = linksTo(() => Person);
                  static isolated = class extends Component<typeof this> {
                    <template><@fields.friend/></template>
                  }
                }
              `,
              'dep-reset-consumer-a.json': {
                data: {
                  relationships: {
                    friend: {
                      links: {
                        self: './dep-reset-friend-a',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./dep-reset-consumer'),
                      name: 'DepResetConsumer',
                    },
                  },
                },
              },
              'dep-reset-consumer-b.json': {
                data: {
                  relationships: {
                    friend: {
                      links: {
                        self: './dep-reset-friend-b',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./dep-reset-consumer'),
                      name: 'DepResetConsumer',
                    },
                  },
                },
              },
              'dep-reset-friend-a.json': {
                data: {
                  attributes: {
                    name: 'Friend A',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./person'),
                      name: 'Person',
                    },
                  },
                },
              },
              'dep-reset-friend-b.json': {
                data: {
                  attributes: {
                    name: 'Friend B',
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
        onRealmSetup() {
          permissions = {
            [realmURL]: ['read', 'write', 'realm-owner'],
          };
        },
      });

      test('resets runtime deps between consecutive prerenders', async function (assert) {
        let first = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: `${realmURL}dep-reset-consumer-a`,
          auth: auth(),
        });
        let firstDeps = first.response.deps ?? [];
        assert.true(
          firstDeps.includes(`${realmURL}dep-reset-friend-a.json`),
          'first prerender includes first relationship target',
        );

        let second = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: realmURL,
          realm: realmURL,
          url: `${realmURL}dep-reset-consumer-b`,
          auth: auth(),
        });
        let secondDeps = second.response.deps ?? [];
        assert.true(
          secondDeps.includes(`${realmURL}dep-reset-friend-b.json`),
          'second prerender includes second relationship target',
        );
        assert.false(
          secondDeps.includes(`${realmURL}dep-reset-friend-a.json`),
          'second prerender deps do not leak first prerender relationship target',
        );
      });
    });
  }

  function defineLivePrerenderedSearchFallbackTests() {
    module('live prerendered search fallback', function (hooks) {
      let realmURL = 'http://127.0.0.1:4456/test/';
      let prerenderServerURL = new URL(realmURL).origin;
      let testUserId = '@user1:localhost';
      let permissions: RealmPermissions = {
        [realmURL]: ['read', 'write', 'realm-owner'],
      };
      let prerenderer: Prerenderer;
      let dbAdapter: any;
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
          maxPages: 2,
          serverURL: prerenderServerURL,
        });
      });

      hooks.after(async () => {
        await prerenderer.stop();
      });

      hooks.beforeEach(async () => {
        await prerenderer.disposeAffinity({
          affinityType: 'realm',
          affinityValue: realmURL,
        });
      });

      async function overrideIndexedIsolatedHTML(url: string, html: string) {
        let alternate = url.endsWith('.json')
          ? url.replace(/\.json$/, '')
          : `${url}.json`;
        await dbAdapter.execute(
          `UPDATE boxel_index SET isolated_html = $1 WHERE url = $2 OR url = $3`,
          { bind: [html, url, alternate] },
        );
      }

      setupPermissionedRealmsCached(hooks, {
        mode: 'before',
        realms: [
          {
            realmURL,
            permissions: {
              '*': ['read'],
              [testUserId]: ['read', 'write', 'realm-owner'],
            },
            fileSystem: {
              'prerendered-search-live.gts': `
              import { CardDef, Component, field, contains, StringField, linksTo } from 'https://cardstack.com/base/card-api';

              export class LiveSearchResult extends CardDef {
                static displayName = 'Live Search Result';
                @field cardTitle = contains(StringField);

                static fitted = class extends Component<typeof this> {
                  <template>
                    <div class="live-search-css-sentinel" data-test-live-card-value>{{@model.cardTitle}}</div>
                    <style scoped>
                      .live-search-css-sentinel {
                        border-top: 4px solid rgb(1, 2, 3);
                      }
                    </style>
                  </template>
                };

                static embedded = this.fitted;
                static isolated = this.fitted;
              }

              export class LiveSearchInner extends CardDef {
                static displayName = 'Live Search Inner';
                static isolated = class extends Component<typeof this> {
                  get realmHref() {
                    let id = this.args.model?.id;
                    if (!id) {
                      return '';
                    }
                    return new URL('.', id).href;
                  }

                  get query() {
                    return {
                      filter: {
                        type: {
                          module: new URL('./prerendered-search-live', import.meta.url).href,
                          name: 'LiveSearchResult',
                        },
                      },
                      page: {
                        size: 10,
                        number: 0,
                      },
                    };
                  }

                  get realms() {
                    return [new URL('./', import.meta.url).href];
                  }

                  <template>
                    <div data-test-live-search-host-ran>Host ran</div>
                    <div data-test-live-search-realm>{{this.realmHref}}</div>
                    {{#if @context.prerenderedCardSearchComponent}}
                      <@context.prerenderedCardSearchComponent
                        @query={{this.query}}
                        @format='fitted'
                        @realms={{this.realms}}
                        @isLive={{true}}
                      >
                        <:loading>
                          <div data-test-live-search-loading>Loading...</div>
                        </:loading>
                        <:response as |cards|>
                          {{#each cards as |card|}}
                            <div data-test-live-search-card={{card.url}}>
                              <card.component />
                            </div>
                          {{/each}}
                        </:response>
                        <:meta as |meta|>
                          <div data-test-live-search-total>{{meta.page.total}}</div>
                        </:meta>
                      </@context.prerenderedCardSearchComponent>
                    {{else}}
                      <div data-test-live-search-component-missing>missing</div>
                    {{/if}}
                  </template>
                };
              }

              export class LiveSearchHost extends CardDef {
                static displayName = 'Live Search Host';
                @field child = linksTo(() => LiveSearchInner);

                static isolated = class extends Component<typeof this> {
                  <template>
                    <@fields.child @format='isolated' />
                  </template>
                };

                static embedded = this.isolated;
              }
            `,
              'live-search-host.json': {
                data: {
                  relationships: {
                    child: {
                      links: {
                        self: './live-search-inner',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./prerendered-search-live'),
                      name: 'LiveSearchHost',
                    },
                  },
                },
              },
              'live-search-inner.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./prerendered-search-live'),
                      name: 'LiveSearchInner',
                    },
                  },
                },
              },
              'live-search-result-1.json': {
                data: {
                  attributes: {
                    cardTitle: 'LIVE_RESULT_VALUE',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./prerendered-search-live'),
                      name: 'LiveSearchResult',
                    },
                  },
                },
              },
              'live-file-search-card.gts': `
              import { CardDef, Component, field, contains, StringField, linksTo } from 'https://cardstack.com/base/card-api';
              import { rri } from '@cardstack/runtime-common';

              export class LiveFileSearchInner extends CardDef {
                static displayName = 'Live File Search Inner';
                static isolated = class extends Component<typeof this> {
                  get realmHref() {
                    let id = this.args.model?.id;
                    if (!id) {
                      return '';
                    }
                    return new URL('.', id).href;
                  }

                  get query() {
                    return {
                      filter: {
                        on: {
                          module: rri('https://cardstack.com/base/card-api'),
                          name: 'FileDef',
                        },
                        eq: {
                          url: \`\${this.realmHref}live-file.live\`,
                        },
                      },
                      page: {
                        size: 10,
                        number: 0,
                      },
                    };
                  }

                  get realms() {
                    return [new URL('./', import.meta.url).href];
                  }

                  <template>
                    <div data-test-live-file-search-host-ran>File Host ran</div>
                    {{#if @context.prerenderedCardSearchComponent}}
                      <@context.prerenderedCardSearchComponent
                        @query={{this.query}}
                        @format='embedded'
                        @realms={{this.realms}}
                        @isLive={{true}}
                      >
                        <:response as |cards|>
                          {{#each cards as |card|}}
                            <div data-test-live-file-search-card={{card.url}}>
                              <card.component />
                            </div>
                          {{/each}}
                        </:response>
                      </@context.prerenderedCardSearchComponent>
                    {{else}}
                      <div data-test-live-file-search-component-missing>missing</div>
                    {{/if}}
                  </template>
                };
              }

              export class LiveFileSearchHost extends CardDef {
                static displayName = 'Live File Search Host';
                @field cardTitle = contains(StringField);
                @field child = linksTo(() => LiveFileSearchInner);

                static isolated = class extends Component<typeof this> {
                  <template>
                    <@fields.child @format='isolated' />
                  </template>
                };

                static embedded = this.isolated;
              }
            `,
              'live-file-search-host.json': {
                data: {
                  attributes: {
                    cardTitle: 'Live File Search Host',
                  },
                  relationships: {
                    child: {
                      links: {
                        self: './live-file-search-inner',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./live-file-search-card'),
                      name: 'LiveFileSearchHost',
                    },
                  },
                },
              },
              'live-file-search-inner.json': {
                data: {
                  meta: {
                    adoptsFrom: {
                      module: rri('./live-file-search-card'),
                      name: 'LiveFileSearchInner',
                    },
                  },
                },
              },
              'live-file.live': 'LIVE_FILE_VALUE',
            },
          },
        ],
        onRealmSetup({ dbAdapter: setupDbAdapter }) {
          dbAdapter = setupDbAdapter;
          permissions = {
            [realmURL]: ['read', 'write', 'realm-owner'],
          };
        },
      });

      test('card prerendered search uses live rendered CardDef HTML and keeps unique CSS', async function (assert) {
        const cardURL = `${realmURL}live-search-host`;
        const sentinel = 'SENTINEL_STALE_CARD_HTML';
        let realmServerPatch =
          installRealmServerAssertOwnRealmServerBypassPatch();
        let searchRequestObserverPatch = installSearchRequestObserverPatch();

        try {
          let indexedRows = await dbAdapter.execute(
            `SELECT url FROM boxel_index WHERE url LIKE $1 ORDER BY url`,
            { bind: [`${realmURL}%live-search%`] },
          );
          assert.ok(
            indexedRows.length > 0,
            `expected indexed rows for live-search fixtures, got: ${JSON.stringify(indexedRows)}`,
          );

          await overrideIndexedIsolatedHTML(
            `${realmURL}live-search-result-1`,
            `<div data-test-stale-card-html>${sentinel}</div>`,
          );

          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL,
            realm: realmURL,
            url: cardURL,
            auth: auth(),
          });

          assert.notOk(result.response.error, 'prerender succeeds');
          let isolatedHTML = cleanWhiteSpace(
            result.response.isolatedHTML ?? '',
          );
          let searchRequests = searchRequestObserverPatch.getRequests();
          assert.ok(
            searchRequests.length > 0,
            `observed federated search requests: ${JSON.stringify(searchRequests)}`,
          );

          assert.ok(
            isolatedHTML.includes('LIVE_RESULT_VALUE'),
            `isolated html includes live card value: ${isolatedHTML}`,
          );
          assert.notOk(
            isolatedHTML.includes(sentinel),
            `isolated html does not include stale indexed sentinel: ${isolatedHTML}`,
          );
          assert.ok(
            isolatedHTML.includes('live-search-css-sentinel'),
            `isolated html includes unique live card css class: ${isolatedHTML}`,
          );
          assert.ok(
            /live-search-css-sentinel[^>]*data-scopedcss-[a-f0-9]{10}-[a-f0-9]{10}/.test(
              isolatedHTML,
            ),
            `isolated html keeps scoped css marker on live result: ${isolatedHTML}`,
          );
        } finally {
          searchRequestObserverPatch.restore();
          await realmServerPatch.restore();
        }
      });

      test('card prerendered search uses live rendered FileDef HTML', async function (assert) {
        const cardURL = `${realmURL}live-file-search-host`;
        const sentinel = 'SENTINEL_STALE_FILE_HTML';
        let realmServerPatch =
          installRealmServerAssertOwnRealmServerBypassPatch();

        try {
          await overrideIndexedIsolatedHTML(
            `${realmURL}live-file.live`,
            `<article data-test-stale-file-html>${sentinel}</article>`,
          );

          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL,
            realm: realmURL,
            url: cardURL,
            auth: auth(),
          });

          assert.notOk(result.response.error, 'prerender succeeds');
          let isolatedHTML = cleanWhiteSpace(
            result.response.isolatedHTML ?? '',
          );

          assert.ok(
            isolatedHTML.includes('live-file.live'),
            `isolated html includes live FileDef fallback value: ${isolatedHTML}`,
          );
          assert.notOk(
            isolatedHTML.includes(sentinel),
            `isolated html does not include stale file sentinel: ${isolatedHTML}`,
          );
          assert.ok(
            isolatedHTML.includes('data-test-live-file-search-card'),
            `isolated html includes live FileDef search result wrapper: ${isolatedHTML}`,
          );
        } finally {
          await realmServerPatch.restore();
        }
      });
    });
  }

  module('prerender - non-mutating tests', function () {
    defineNonMutatingRunnerTests();
    defineRuntimeDepsResetTests();
    defineLivePrerenderedSearchFallbackTests();
    defineNonMutatingStaticTests();
  });

  module('prerender - permissioned auth failures', function (hooks) {
    let providerRealmURL = 'http://127.0.0.1:4451/test/';
    let consumerRealmURL = 'http://127.0.0.1:4452/test/';
    let prerenderServerURL = new URL(consumerRealmURL).origin;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let indexingReady: Promise<void> = Promise.resolve();
    let prerenderer: Prerenderer;
    let auth = () => testCreatePrerenderAuth(testUserId, permissions);

    hooks.before(async () => {
      prerenderer = getPrerendererForTesting({
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.beforeEach(async function () {
      await indexingReady;
      permissions = {
        [consumerRealmURL]: ['read', 'write', 'realm-owner'],
      };
    });

    hooks.afterEach(async () => {
      await Promise.all([
        prerenderer.disposeAffinity({
          affinityType: 'realm',
          affinityValue: providerRealmURL,
        }),
        prerenderer.disposeAffinity({
          affinityType: 'realm',
          affinityValue: consumerRealmURL,
        }),
      ]);
    });

    setupPermissionedRealmsCached(hooks, {
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
                  cardTitle: 'Top Secret',
                },
                meta: {
                  adoptsFrom: {
                    module: rri('./article'),
                    name: 'Article',
                  },
                },
              },
            },
            'secret.txt': 'Top Secret file',
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
                    module: rri('./website'),
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
                    module: rri('./auth-proxy'),
                    name: 'AuthProxy',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms }) {
        indexingReady = Promise.all(
          realms.map(({ realm }) => realm.indexing()),
        ).then(() => undefined);
        permissions = {
          [consumerRealmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('module prerender surfaces auth error without timing out', async function (assert) {
      const moduleURL = `${consumerRealmURL}website.gts`;

      let result = await prerenderer.prerenderModule({
        affinityType: 'realm',
        affinityValue: consumerRealmURL,
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

    test('file prerender surfaces auth error without timing out', async function (assert) {
      const fileURL = `${providerRealmURL}secret.txt`;

      let result = await prerenderFileExtract(prerenderer, {
        affinityType: 'realm',
        affinityValue: providerRealmURL,
        realm: providerRealmURL,
        url: fileURL,
        auth: auth(),
        renderOptions: { fileExtract: true },
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

      let result = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: consumerRealmURL,
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

      let result = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: consumerRealmURL,
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

  module('prerender - public query fallback', function (hooks) {
    let publicRealmURL = 'http://127.0.0.1:4454/test/';
    let prerenderServerURL = new URL(publicRealmURL).origin;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {};
    let prerenderer: Prerenderer;
    let auth = () => testCreatePrerenderAuth(testUserId, permissions);

    hooks.before(async () => {
      prerenderer = getPrerendererForTesting({
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.beforeEach(function () {
      permissions = {
        [publicRealmURL]: ['read', 'write', 'realm-owner'],
      };
    });

    hooks.afterEach(async () => {
      await prerenderer.disposeAffinity({
        affinityType: 'realm',
        affinityValue: publicRealmURL,
      });
    });

    let makeQueryDirectoryFileSystem = () => ({
      'person.gts': `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class Person extends CardDef {
          @field name = contains(StringField);
        }
      `,
      'person-1.json': {
        data: {
          attributes: {
            name: 'Alpha',
          },
          meta: {
            adoptsFrom: {
              module: rri('./person'),
              name: 'Person',
            },
          },
        },
      },
      'person-2.json': {
        data: {
          attributes: {
            name: 'Beta',
          },
          meta: {
            adoptsFrom: {
              module: rri('./person'),
              name: 'Person',
            },
          },
        },
      },
      'query-directory.gts': `
        import { field, CardDef, Component, linksToMany } from "https://cardstack.com/base/card-api";
        import { Person } from "./person";

        export class QueryDirectory extends CardDef {
          @field people = linksToMany(() => Person, {
            query: {
              filter: {
                eq: {
                  name: "Beta",
                },
              },
            },
          });

          static isolated = class extends Component<typeof this> {
            <template>
              <ul data-test-directory-people>
                {{#each @model.people as |person|}}
                  <li data-test-directory-person-name>{{person.name}}</li>
                {{/each}}
              </ul>
            </template>
          };
        }
      `,
      'query-directory-1.json': {
        data: {
          attributes: {},
          meta: {
            adoptsFrom: {
              module: rri('./query-directory'),
              name: 'QueryDirectory',
            },
          },
        },
      },
      'query-directory-proxy.gts': `
        import { field, CardDef, Component, linksTo } from "https://cardstack.com/base/card-api";
        import { QueryDirectory } from "./query-directory";

        export class QueryDirectoryProxy extends CardDef {
          @field directory = linksTo(() => QueryDirectory);

          static isolated = class extends Component<typeof this> {
            <template>
              <@fields.directory @format="isolated" />
            </template>
          };
        }
      `,
      'query-directory-proxy-1.json': {
        data: {
          attributes: {},
          relationships: {
            directory: {
              links: {
                self: './query-directory-1',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('./query-directory-proxy'),
              name: 'QueryDirectoryProxy',
            },
          },
        },
      },
    });

    setupPermissionedRealmsCached(hooks, {
      mode: 'before',
      realms: [
        {
          realmURL: publicRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            ...makeQueryDirectoryFileSystem(),
          },
        },
      ],
      onRealmSetup() {
        permissions = {
          [publicRealmURL]: ['read', 'write', 'realm-owner'],
        };
      },
    });

    test('card prerender in a public realm authorizes query fallback search for source-loaded linked cards', async function (assert) {
      const cardURL = `${publicRealmURL}query-directory-proxy-1.json`;
      let realmServerPatch =
        installRealmServerAssertOwnRealmServerBypassPatch();
      let delayedSearchPatch = installDelayedRuntimeRealmSearchPatch(150);
      try {
        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: publicRealmURL,
          realm: publicRealmURL,
          url: cardURL,
          auth: auth(),
        });

        assert.notOk(
          result.response.error,
          'prerender succeeds for linked query-backed card in public realm',
        );
        assert.true(
          delayedSearchPatch.getRequestCount() > 0,
          'fallback search requests occurred',
        );

        let isolatedHTML = cleanWhiteSpace(result.response.isolatedHTML ?? '');
        assert.ok(
          /data-test-directory-person-name[^>]*>\s*Beta\s*</.test(isolatedHTML),
          `isolated html includes query result Beta: ${isolatedHTML}`,
        );
      } finally {
        await realmServerPatch.restore();
        delayedSearchPatch.restore();
      }
    });
  });

  module(
    'prerender - permissioned auth failures (private query fallback)',
    function (hooks) {
      let privateRealmURL = 'http://127.0.0.1:4453/test/';
      let prerenderServerURL = new URL(privateRealmURL).origin;
      let testUserId = '@user1:localhost';
      let permissions: RealmPermissions = {};
      let prerenderer: Prerenderer;
      let auth = () => testCreatePrerenderAuth(testUserId, permissions);

      hooks.before(async () => {
        prerenderer = getPrerendererForTesting({
          maxPages: 2,
          serverURL: prerenderServerURL,
        });
      });

      hooks.after(async () => {
        await prerenderer.stop();
      });

      hooks.beforeEach(function () {
        permissions = {
          [privateRealmURL]: ['read', 'write', 'realm-owner'],
        };
      });

      hooks.afterEach(async () => {
        await prerenderer.disposeAffinity({
          affinityType: 'realm',
          affinityValue: privateRealmURL,
        });
      });

      let makeQueryDirectoryFileSystem = () => ({
        'person.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field name = contains(StringField);
          }
        `,
        'person-1.json': {
          data: {
            attributes: {
              name: 'Alpha',
            },
            meta: {
              adoptsFrom: {
                module: rri('./person'),
                name: 'Person',
              },
            },
          },
        },
        'person-2.json': {
          data: {
            attributes: {
              name: 'Beta',
            },
            meta: {
              adoptsFrom: {
                module: rri('./person'),
                name: 'Person',
              },
            },
          },
        },
        'query-directory.gts': `
          import { field, CardDef, Component, linksToMany } from "https://cardstack.com/base/card-api";
          import { Person } from "./person";

          export class QueryDirectory extends CardDef {
            @field people = linksToMany(() => Person, {
              query: {
                filter: {
                  eq: {
                    name: "Beta",
                  },
                },
              },
            });

            static isolated = class extends Component<typeof this> {
              <template>
                <ul data-test-directory-people>
                  {{#each @model.people as |person|}}
                    <li data-test-directory-person-name>{{person.name}}</li>
                  {{/each}}
                </ul>
              </template>
            };
          }
        `,
        'query-directory-1.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: rri('./query-directory'),
                name: 'QueryDirectory',
              },
            },
          },
        },
        'query-directory-proxy.gts': `
          import { field, CardDef, Component, linksTo } from "https://cardstack.com/base/card-api";
          import { QueryDirectory } from "./query-directory";

          export class QueryDirectoryProxy extends CardDef {
            @field directory = linksTo(() => QueryDirectory);

            static isolated = class extends Component<typeof this> {
              <template>
                <@fields.directory @format="isolated" />
              </template>
            };
          }
        `,
        'query-directory-proxy-1.json': {
          data: {
            attributes: {},
            relationships: {
              directory: {
                links: {
                  self: './query-directory-1',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: rri('./query-directory-proxy'),
                name: 'QueryDirectoryProxy',
              },
            },
          },
        },
      });

      setupPermissionedRealmsCached(hooks, {
        mode: 'before',
        realms: [
          {
            realmURL: privateRealmURL,
            permissions: {
              [testUserId]: ['read', 'write', 'realm-owner'],
            },
            fileSystem: {
              ...makeQueryDirectoryFileSystem(),
            },
          },
        ],
        onRealmSetup() {
          permissions = {
            [privateRealmURL]: ['read', 'write', 'realm-owner'],
          };
        },
      });

      test('card prerender in a private realm sends auth header on query fallback federated search', async function (assert) {
        const cardURL = `${privateRealmURL}query-directory-proxy-1.json`;
        let realmServerPatch =
          installRealmServerAssertOwnRealmServerBypassPatch();
        let searchRequestObserverPatch = installSearchRequestObserverPatch();
        let delayedSearchPatch = installDelayedRuntimeRealmSearchPatch(150);
        try {
          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: privateRealmURL,
            realm: privateRealmURL,
            url: cardURL,
            auth: auth(),
          });

          assert.notOk(
            result.response.error,
            'prerender succeeds for linked query-backed card in private realm',
          );
          assert.true(
            delayedSearchPatch.getRequestCount() > 0,
            'fallback search requests occurred',
          );

          let isolatedHTML = cleanWhiteSpace(
            result.response.isolatedHTML ?? '',
          );
          assert.ok(
            /data-test-directory-person-name[^>]*>\s*Beta\s*</.test(
              isolatedHTML,
            ),
            `isolated html includes query result Beta: ${isolatedHTML}`,
          );

          let searchRequests = searchRequestObserverPatch.getRequests();
          assert.true(
            searchRequests.length > 0,
            'federated search request was observed at browser layer',
          );
          let querySearchRequests = searchRequests.filter(
            (request) => request.method === 'QUERY',
          );
          assert.true(
            querySearchRequests.length > 0,
            'federated search QUERY request was observed',
          );
          assert.true(
            querySearchRequests.every((request) => request.hasAuthorization),
            `all federated search QUERY requests include Authorization header: ${JSON.stringify(searchRequests)}`,
          );
        } finally {
          delayedSearchPatch.restore();
          searchRequestObserverPatch.restore();
          await realmServerPatch.restore();
        }
      });
    },
  );

  function defineNonMutatingStaticTests() {
    module('formats and pooling', function (hooks) {
      let realmURL1 = 'http://127.0.0.1:4447/test/';
      let realmURL2 = 'http://127.0.0.1:4448/test/';
      let realmURL3 = 'http://127.0.0.1:4449/test/';
      let prerenderServerURL = new URL(realmURL1).origin;
      let testUserId = '@user1:localhost';
      let permissions: RealmPermissions = {};
      let prerenderer: Prerenderer;
      let auth = () => testCreatePrerenderAuth(testUserId, permissions);
      const disposeAllRealms = async () => {
        await Promise.all([
          prerenderer.disposeAffinity({
            affinityType: 'realm',
            affinityValue: realmURL1,
          }),
          prerenderer.disposeAffinity({
            affinityType: 'realm',
            affinityValue: realmURL2,
          }),
          prerenderer.disposeAffinity({
            affinityType: 'realm',
            affinityValue: realmURL3,
          }),
        ]);
        // `disposeAffinity` only KICKS standby refill — it doesn't await
        // it. If the next test claims a tab before that kick produces a
        // standby AND `#ensureStandbyPool`'s awaited retry also can't
        // produce one, `#selectEntryForAffinity` falls through to the
        // cross-affinity-steal escape hatch and reassigns an idle tab
        // from another realm — keeping the donor's `pageId`. The
        // "distinct pages per realm" test then sees `r1.pool.pageId ===
        // r2.pool.pageId` and fails. Waiting here makes the next
        // affinity-pooling test deterministic on the standby path.
        await prerenderer.warmStandbys();
      };

      hooks.before(async function () {
        prerenderer = getPrerendererForTesting({
          maxPages: 2,
          serverURL: prerenderServerURL,
        });
      });

      hooks.after(async function () {
        await prerenderer.stop();
      });

      setupPermissionedRealmsCached(hooks, {
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
                      module: rri('./person'),
                      name: 'Person',
                    },
                  },
                },
              },
              '2.json': {
                data: {
                  attributes: {
                    name: 'Mango',
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
                      module: rri('./broken-card'),
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
              'dog-many.gts': `
              import { CardDef, field, contains, linksToMany, StringField, Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';
              export class DogMany extends CardDef {
                static displayName = "Dog Many";
                @field name = contains(StringField);
                @field owners = linksToMany(Person, { isUsed: true });
                static isolated = class extends Component<typeof this> {
                  // owners is intentionally not in isolated template, this is included in search doc via isUsed=true
                  <template>{{@model.name}}</template>
                }
              }
            `,
              'dog-profile.gts': `
              import { CardDef, FieldDef, field, contains, linksTo, linksToMany, StringField, Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';

              class DogProfileField extends FieldDef {
                @field primaryOwner = linksTo(Person, { isUsed: true });
                @field caretakers = linksToMany(Person, { isUsed: true });
              }

              export class DogProfile extends CardDef {
                static displayName = "Dog Profile";
                @field name = contains(StringField);
                @field profile = contains(DogProfileField);
                static isolated = class extends Component<typeof this> {
                  // profile is intentionally not in isolated template, this is included in search doc via isUsed=true
                  <template>{{@model.name}}</template>
                }
              }
            `,
              'non-isolated-links-card.gts': `
              import { CardDef, FieldDef, field, contains, linksTo, linksToMany, StringField, Component } from 'https://cardstack.com/base/card-api';
              import { Person } from '${realmURL1}person';

              class RelationshipField extends FieldDef {
                @field lead = linksTo(Person);
                @field members = linksToMany(Person);
              }

              export class NonIsolatedLinks extends CardDef {
                static displayName = 'Non Isolated Links';
                @field name = contains(StringField);
                @field owner = linksTo(Person);
                @field owners = linksToMany(Person);
                @field profile = contains(RelationshipField);

                static isolated = class extends Component<typeof this> {
                  <template><div data-test-isolated-name>{{@model.name}}</div></template>
                };

                static embedded = class extends Component<typeof this> {
                  <template>
                    <div data-test-embedded-owner>
                      <span data-test-embedded-owner>{{@model.owner.name}}</span>
                    </div>
                    <div data-test-embedded-owners>
                      {{#each @model.owners as |owner|}}
                        <span data-test-embedded-owner-name>{{owner.name}}</span>
                      {{/each}}
                    </div>
                    <div data-test-embedded-profile-lead>
                      <span data-test-embedded-profile-lead-name>{{@model.profile.lead.name}}</span>
                    </div>
                    <div data-test-embedded-profile-members>
                      {{#each @model.profile.members as |member|}}
                        <span data-test-embedded-profile-member-name>{{member.name}}</span>
                      {{/each}}
                    </div>
                  </template>
                };
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
                      module: rri('./cat'),
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
                      module: rri('./dog'),
                      name: 'Dog',
                    },
                  },
                },
              },
              'is-used-many.json': {
                data: {
                  attributes: {
                    name: 'Mango Many',
                  },
                  relationships: {
                    'owners.0': {
                      links: { self: `${realmURL1}1` },
                    },
                    'owners.1': {
                      links: { self: `${realmURL1}2` },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./dog-many'),
                      name: 'DogMany',
                    },
                  },
                },
              },
              'is-used-field-def.json': {
                data: {
                  attributes: {
                    name: 'Mango Profile',
                    profile: {},
                  },
                  relationships: {
                    'profile.primaryOwner': {
                      links: { self: `${realmURL1}1` },
                    },
                    'profile.caretakers.0': {
                      links: { self: `${realmURL1}1` },
                    },
                    'profile.caretakers.1': {
                      links: { self: `${realmURL1}2` },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./dog-profile'),
                      name: 'DogProfile',
                    },
                  },
                },
              },
              'non-isolated-links.json': {
                data: {
                  attributes: {
                    name: 'Mango Non Isolated',
                    profile: {},
                    cardInfo: {
                      name: null,
                      summary: null,
                      cardThumbnailURL: null,
                      notes: null,
                    },
                  },
                  relationships: {
                    'cardInfo.theme': {
                      links: { self: `${realmURL2}non-isolated-theme` },
                    },
                    owner: {
                      links: { self: `${realmURL1}1` },
                    },
                    'owners.0': {
                      links: { self: `${realmURL1}1` },
                    },
                    'owners.1': {
                      links: { self: `${realmURL1}2` },
                    },
                    'profile.lead': {
                      links: { self: `${realmURL1}1` },
                    },
                    'profile.members.0': {
                      links: { self: `${realmURL1}1` },
                    },
                    'profile.members.1': {
                      links: { self: `${realmURL1}2` },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./non-isolated-links-card'),
                      name: 'NonIsolatedLinks',
                    },
                  },
                },
              },
              'non-isolated-theme.json': {
                data: {
                  type: 'card',
                  attributes: {
                    markUsage: {
                      socialMediaProfileIcon:
                        'https://example.com/non-isolated-social-icon.png',
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('https://cardstack.com/base/brand-guide'),
                      name: 'default',
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
                      module: rri('./cat'),
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
                      module: rri('./cat'),
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
                      module: rri('./intentional-error'),
                      name: 'IntentionalError',
                    },
                  },
                },
              },
              'timer-error-card.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              export class TimerError extends CardDef {
                @field name = contains(StringField);
                static displayName = "Timer Error";
                static isolated = class extends Component {
                  get message() {
                    setTimeout(() => {}, 0);
                    setInterval(() => {}, 5);
                    throw new Error('timer error during render');
                  }
                  <template>{{this.message}}</template>
                }
              }
            `,
              'timer-error.json': {
                data: {
                  attributes: {
                    name: 'Timer Error',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./timer-error-card'),
                      name: 'TimerError',
                    },
                  },
                },
              },
              'timer-timeout-card.gts': `
              import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
              import { Component } from 'https://cardstack.com/base/card-api';
              setTimeout(() => {}, 0);
              setInterval(() => {}, 5);
              export class TimerTimeout extends CardDef {
                @field name = contains(StringField);
                static displayName = "Timer Timeout";
                static isolated = class extends Component {
                  get message() {
                    setTimeout(() => {}, 0);
                    setInterval(() => {}, 5);
                    return this.args.model.name;
                  }
                  <template>{{this.message}}</template>
                }
              }
            `,
              'timer-timeout.json': {
                data: {
                  attributes: {
                    name: 'Timer Timeout',
                  },
                  meta: {
                    adoptsFrom: {
                      module: rri('./timer-timeout-card'),
                      name: 'TimerTimeout',
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
                      module: rri('./unusable-error'),
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
                      module: rri('./embedded-error'),
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
                      module: rri('./dog'),
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
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
              result.embeddedHTML![
                'https://cardstack.com/base/card-api/CardDef'
              ],
            ),
            `failed to match embedded html:${JSON.stringify(result.embeddedHTML)}`,
          );
        });

        test('isolated HTML', function (assert) {
          assert.ok(
            /data-test-field="cardInfo-summary"/.test(result.isolatedHTML!),
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

          assert.ok(
            cleanedHead.includes(
              '<title data-test-card-head-title>Untitled Cat</title>',
            ),
            `failed to find title in head html:${cleanedHead}`,
          );
          assert.ok(
            cleanedHead.includes('property="og:title" content="Untitled Cat"'),
            `failed to find og:title in head html:${cleanedHead}`,
          );
          assert.ok(
            cleanedHead.includes(`property="og:url" content="${realmURL2}1"`),
            `failed to find og:url in head html:${cleanedHead}`,
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
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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

        test('isUsed linksToMany field includes links in search doc that are not rendered in template', async function (assert) {
          const testCardURL = `${realmURL2}is-used-many`;
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });

          assert.ok(
            /Mango Many/.test(response.isolatedHTML!),
            `failed to match isolated html:${response.isolatedHTML}`,
          );
          assert.false(
            /data-test-field="owners"/.test(response.isolatedHTML!),
            `owners field is not rendered in isolated html`,
          );
          assert.strictEqual(
            response.searchDoc?.owners?.[0]?.name,
            'Hassan',
            'first linked record is included in search doc via isUsed=true',
          );
          assert.strictEqual(
            response.searchDoc?.owners?.[1]?.name,
            'Mango',
            'second linked record is included in search doc via isUsed=true',
          );
        });

        test('isUsed compound field includes nested linksTo relationship in search doc', async function (assert) {
          const testCardURL = `${realmURL2}is-used-field-def`;
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });

          assert.ok(
            /Mango Profile/.test(response.isolatedHTML!),
            `failed to match isolated html:${response.isolatedHTML}`,
          );
          assert.false(
            /data-test-field="profile"/.test(response.isolatedHTML!),
            `profile field is not rendered in isolated html`,
          );
          assert.strictEqual(
            response.searchDoc?.profile?.primaryOwner?.name,
            'Hassan',
            'nested linksTo relationship is included in search doc via isUsed=true on the relationship field',
          );
        });

        test('isUsed compound field includes nested linksToMany relationships in search doc', async function (assert) {
          const testCardURL = `${realmURL2}is-used-field-def`;
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });

          assert.ok(
            /Mango Profile/.test(response.isolatedHTML!),
            `failed to match isolated html:${response.isolatedHTML}`,
          );
          assert.false(
            /data-test-field="profile"/.test(response.isolatedHTML!),
            `profile field is not rendered in isolated html`,
          );
          assert.strictEqual(
            response.searchDoc?.profile?.caretakers?.[0]?.name,
            'Hassan',
            'first nested linksToMany relationship is included in search doc via isUsed=true on the relationship field',
          );
          assert.strictEqual(
            response.searchDoc?.profile?.caretakers?.[1]?.name,
            'Mango',
            'second nested linksToMany relationship is included in search doc via isUsed=true on the relationship field',
          );
        });

        test('non-isolated formats render linked fields and those links appear in search doc', async function (assert) {
          const testCardURL = `${realmURL2}non-isolated-links`;
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });

          let headHTML = cleanWhiteSpace(response.headHTML ?? '');
          assert.ok(
            /<link rel="icon" href="https:\/\/example\.com\/non-isolated-social-icon\.png"/.test(
              headHTML,
            ),
            `head html includes favicon from cardInfo.theme: ${headHTML}`,
          );
          assert.ok(
            /<link rel="apple-touch-icon" href="https:\/\/example\.com\/non-isolated-social-icon\.png"/.test(
              headHTML,
            ),
            `head html includes apple-touch-icon from cardInfo.theme: ${headHTML}`,
          );

          let embedded =
            response.embeddedHTML?.[
              `${realmURL2}non-isolated-links-card/NonIsolatedLinks`
            ] ?? '';
          let cleanedEmbedded = cleanWhiteSpace(embedded);
          assert.ok(
            /data-test-embedded-owner[^>]*>\s*Hassan\s*</.test(cleanedEmbedded),
            `embedded html includes direct linksTo value Hassan: ${cleanedEmbedded}`,
          );
          assert.ok(
            /data-test-embedded-owner-name[^>]*>\s*Hassan\s*</.test(
              cleanedEmbedded,
            ),
            `embedded html includes direct linksToMany value Hassan: ${cleanedEmbedded}`,
          );
          assert.ok(
            /data-test-embedded-owner-name[^>]*>\s*Mango\s*</.test(
              cleanedEmbedded,
            ),
            `embedded html includes direct linksToMany value Mango: ${cleanedEmbedded}`,
          );
          assert.ok(
            /data-test-embedded-profile-lead-name[^>]*>\s*Hassan\s*</.test(
              cleanedEmbedded,
            ),
            `embedded html includes nested FieldDef linksTo value Hassan: ${cleanedEmbedded}`,
          );
          assert.ok(
            /data-test-embedded-profile-member-name[^>]*>\s*Hassan\s*</.test(
              cleanedEmbedded,
            ),
            `embedded html includes nested FieldDef linksToMany value Hassan: ${cleanedEmbedded}`,
          );
          assert.ok(
            /data-test-embedded-profile-member-name[^>]*>\s*Mango\s*</.test(
              cleanedEmbedded,
            ),
            `embedded html includes nested FieldDef linksToMany value Mango: ${cleanedEmbedded}`,
          );

          assert.strictEqual(
            response.searchDoc?.owner?.name,
            'Hassan',
            'searchDoc includes direct linksTo data from non-isolated render',
          );
          assert.strictEqual(
            response.searchDoc?.owners?.[0]?.name,
            'Hassan',
            'searchDoc includes direct linksToMany first value from non-isolated render',
          );
          assert.strictEqual(
            response.searchDoc?.owners?.[1]?.name,
            'Mango',
            'searchDoc includes direct linksToMany second value from non-isolated render',
          );
          assert.strictEqual(
            response.searchDoc?.profile?.lead?.name,
            'Hassan',
            'searchDoc includes nested FieldDef linksTo data from non-isolated render',
          );
          assert.strictEqual(
            response.searchDoc?.profile?.members?.[0]?.name,
            'Hassan',
            'searchDoc includes nested FieldDef linksToMany first value from non-isolated render',
          );
          assert.strictEqual(
            response.searchDoc?.profile?.members?.[1]?.name,
            'Mango',
            'searchDoc includes nested FieldDef linksToMany second value from non-isolated render',
          );
        });
      });

      module('errors', function (hooks) {
        hooks.beforeEach(disposeAllRealms);
        test('error during render', async function (assert) {
          const testCardURL = `${realmURL2}2`;
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
            markdown: null,
          });
        });

        test('error includes blocked timer summary when timers fire', async function (assert) {
          const testCardURL = `${realmURL2}timer-error`;
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });

          assert.ok(response.error, 'error present for timer error');
          let message = response.error?.error.message ?? '';
          assert.ok(
            message.includes('timer error during render'),
            `error message includes original error text, got: ${message}`,
          );
          let stack = response.error?.error.stack ?? '';
          assert.ok(
            stack.includes('Timers blocked during prerender'),
            'timer summary appended to stack',
          );
          let timeoutMatch = stack.match(/setTimeout:\s+(\d+)/);
          assert.ok(timeoutMatch, 'setTimeout count included');
          assert.ok(
            Number(timeoutMatch?.[1]) >= 1,
            `expected at least one setTimeout, got: ${timeoutMatch?.[1]}`,
          );
          let intervalMatch = stack.match(/setInterval:\s+(\d+)/);
          assert.ok(intervalMatch, 'setInterval count included');
          assert.ok(
            Number(intervalMatch?.[1]) >= 1,
            `expected at least one setInterval, got: ${intervalMatch?.[1]}`,
          );
          assert.ok(
            stack.includes('at get message'),
            'timer summary includes a call stack',
          );
        });

        test('timeout includes blocked timer summary in stack', async function (assert) {
          const testCardURL = `${realmURL2}timer-timeout`;
          await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
            opts: { timeoutMs: 1000, simulateTimeoutMs: 2000 },
          });

          assert.strictEqual(
            response.error?.error.title,
            'Render timeout',
            'timeout surfaced',
          );
          let stack = response.error?.error.stack ?? '';
          assert.ok(
            stack.includes('Timers blocked during prerender'),
            'timer summary appended to timeout stack',
          );
          assert.ok(
            /setTimeout:\s+\d+/.test(stack),
            'timeout stack includes setTimeout count',
          );
          assert.ok(
            /setInterval:\s+\d+/.test(stack),
            'timeout stack includes setInterval count',
          );
        });

        test('missing link surfaces 404 without eviction', async function (assert) {
          const testCardURL = `${realmURL2}missing-link`;
          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          let { response } = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          let unusable = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          assert.true(
            unusable.pool.evicted,
            'pool notes eviction for unusable',
          );
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
          let next = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: healthyURL,
            auth: auth(),
          });
          assert.false(
            next.pool.reused,
            'did not reuse after unusable eviction',
          );
          assert.false(next.pool.evicted, 'subsequent render not evicted');
        });

        test('prerender surfaces module syntax errors without timing out', async function (assert) {
          const cardURL = `${realmURL2}broken`;
          let broken = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          assert.false(
            broken.pool.timedOut,
            'syntax error does not hit timeout',
          );
        });
      });

      module('affinity pooling', function (hooks) {
        hooks.beforeEach(disposeAllRealms);
        test('evicts on timeout and does not reuse', async function (assert) {
          const testCardURL = `${realmURL2}1`;
          // First render to initialize pool
          let first = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          assert.false(first.pool.reused, 'first call not reused');

          // Now trigger a timeout; this should evict the realm
          let timeoutRun = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          let afterTimeout = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          let first = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          let second = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          assert.strictEqual(
            first.pool.affinityValue,
            realmURL2,
            'first realm matches',
          );
          assert.strictEqual(
            second.pool.affinityValue,
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

        test('reuses the same page within a user affinity', async function (assert) {
          const testCardURL = `${realmURL2}1`;
          const userAffinityValue = testUserId;
          let first = await prerenderCard(prerenderer, {
            affinityType: 'user',
            affinityValue: userAffinityValue,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          let second = await prerenderCard(prerenderer, {
            affinityType: 'user',
            affinityValue: userAffinityValue,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          assert.strictEqual(
            first.pool.affinityValue,
            userAffinityValue,
            'first user affinity matches',
          );
          assert.strictEqual(
            second.pool.affinityValue,
            userAffinityValue,
            'second user affinity matches',
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

        test('does not reuse across affinity types when affinity values match', async function (assert) {
          const testCardURL = `${realmURL2}1`;
          const sharedAffinityValue = 'shared-affinity-value';

          let firstRealm = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: sharedAffinityValue,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          let firstUser = await prerenderCard(prerenderer, {
            affinityType: 'user',
            affinityValue: sharedAffinityValue,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });
          let secondRealm = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: sharedAffinityValue,
            realm: realmURL2,
            url: testCardURL,
            auth: auth(),
          });

          assert.notStrictEqual(
            firstRealm.pool.pageId,
            firstUser.pool.pageId,
            'realm and user affinities do not share tabs',
          );
          assert.false(
            firstUser.pool.reused,
            'first user-affinity call is fresh',
          );
          assert.strictEqual(
            secondRealm.pool.pageId,
            firstRealm.pool.pageId,
            'realm affinity continues to reuse realm tab',
          );
          assert.true(
            secondRealm.pool.reused,
            'realm tab reuse remains intact',
          );
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

          let first = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL,
            auth: authA,
          });
          let second = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
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
          let r1 = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL1,
            realm: realmURL1,
            url: testCardURL1,
            auth: auth(),
          });
          let r2 = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: testCardURL2,
            auth: auth(),
          });
          // When this fails it's almost always the cross-affinity-steal
          // fallback in `#selectEntryForAffinity` — `pageId` is equal
          // because realm2's `getPage` repurposed realm1's idle tab
          // when `#ensureStandbyPool` couldn't conjure a standby. Dump
          // both call's `tabStartupMs` / `tabQueueMs` (a steal returns
          // `tabStartupMs=0`, the standby path is non-zero) and the
          // live queue snapshot so the CI log shows where the standby
          // pool was when the race fired.
          let queueSnapshot = prerenderer.getQueueDepthSnapshot();
          assert.notStrictEqual(
            r1.pool.pageId,
            r2.pool.pageId,
            `distinct pages per realm — ` +
              `r1.pageId=${r1.pool.pageId} ` +
              `r2.pageId=${r2.pool.pageId} ` +
              `r1.waits=${JSON.stringify(r1.timings.waits)} ` +
              `r2.waits=${JSON.stringify(r2.timings.waits)} ` +
              `queueSnapshot=${JSON.stringify(queueSnapshot)}`,
          );
          assert.false(r1.pool.reused, 'first realm first call not reused');
          assert.false(r2.pool.reused, 'second realm first call not reused');
        });

        test('evicts LRU when capacity reached', async function (assert) {
          const cardA = `${realmURL1}1`;
          const cardB = `${realmURL2}1`;
          const cardC = `${realmURL3}1`;

          // `desiredStandbyCount` caps at 1 once any tab is active, so a
          // fire-and-forget refill kicked off by the previous acquisition
          // may not have produced a real standby by the time the next
          // sequential acquisition runs. With `queue='file'` (the path
          // every `prerenderCard` takes) the entryList-empty branch in
          // `#selectEntryForAffinity` skips its `ensureStandbyPool` await
          // whenever a refill is in flight (`creatingStandbys` already
          // counts toward `currentStandbyCount`), and the caller falls
          // through to cross-affinity-steal. That steal repurposes a
          // donor tab and KEEPS the donor's `pageId` — see the warning
          // log around `#selectEntryForAffinity`'s reassign path. A
          // chain of steals (A→B, B→C, C→A) makes `firstA.pageId ===
          // secondA.pageId` and trips the eviction assertion below.
          // Awaiting `warmStandbys` between phases blocks until any
          // in-flight standby creation AND any LRU eviction kicked by
          // the post-acquire refill have settled, so the next call
          // commandeers a fresh standby instead of stealing.
          let firstA = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL1,
            realm: realmURL1,
            url: cardA,
            auth: auth(),
          });
          await prerenderer.warmStandbys();
          let firstAWaits = firstA.timings.waits;

          let firstB = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL2,
            realm: realmURL2,
            url: cardB,
            auth: auth(),
          });
          await prerenderer.warmStandbys();
          let firstBWaits = firstB.timings.waits;

          // Now adding C should evict the LRU (A), since maxPages=2
          let firstC = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL3,
            realm: realmURL3,
            url: cardC,
            auth: auth(),
          });
          await prerenderer.warmStandbys();
          let firstCWaits = firstC.timings.waits;

          // Returning to A should not reuse because it was evicted
          let secondA = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: realmURL1,
            realm: realmURL1,
            url: cardA,
            auth: auth(),
          });
          let secondAWaits = secondA.timings.waits;
          // Snapshot the live pool state at the assertion site so that
          // if the flake recurs the YAML failure block names the donor
          // affinity, the in-flight standby count, and per-call wait
          // shape (`tabStartupMs=0` signals a steal; non-zero signals
          // the standby path). Without this the only hint a reviewer
          // gets is two identical UUIDs and no provenance.
          let queueSnapshot = prerenderer.getQueueDepthSnapshot();
          let diagnostics =
            `firstA.pageId=${firstA.pool.pageId} ` +
            `firstB.pageId=${firstB.pool.pageId} ` +
            `firstC.pageId=${firstC.pool.pageId} ` +
            `secondA.pageId=${secondA.pool.pageId} ` +
            `firstA.reused=${firstA.pool.reused} ` +
            `firstB.reused=${firstB.pool.reused} ` +
            `firstC.reused=${firstC.pool.reused} ` +
            `secondA.reused=${secondA.pool.reused} ` +
            `firstA.waits=${JSON.stringify(firstAWaits)} ` +
            `firstB.waits=${JSON.stringify(firstBWaits)} ` +
            `firstC.waits=${JSON.stringify(firstCWaits)} ` +
            `secondA.waits=${JSON.stringify(secondAWaits)} ` +
            `queueSnapshot=${JSON.stringify(queueSnapshot)}`;
          assert.false(
            firstA.pool.reused,
            `first A not reused — ${diagnostics}`,
          );
          assert.false(
            firstB.pool.reused,
            `first B not reused — ${diagnostics}`,
          );
          assert.false(
            firstC.pool.reused,
            `first C not reused — ${diagnostics}`,
          );
          assert.false(
            secondA.pool.reused,
            `A was evicted, so not reused — ${diagnostics}`,
          );
          assert.notStrictEqual(
            firstA.pool.pageId,
            secondA.pool.pageId,
            `A got a new page after eviction — ${diagnostics}`,
          );
        });

        test('serializes prerenders when only one tab is available', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let semaphore = new TestSemaphore(1);
          let active = 0;
          let maxActive = 0;
          let pool: PagePool | undefined;

          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
            ({ pool } = makeStubPagePool({
              maxPages: 1,
              renderSemaphore: semaphore,
            }));
            await pool.warmStandbys();

            let run = async (realm: string) => {
              let lease = await pool!.getPage(realm);
              active++;
              maxActive = Math.max(maxActive, active);
              await new Promise((resolve) => setTimeout(resolve, 25));
              active--;
              lease.release();
            };

            await Promise.all([run('realm-a'), run('realm-b')]);

            assert.strictEqual(
              maxActive,
              1,
              'renders serialize when only one tab is allowed',
            );
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('runs prerenders in parallel when multiple tabs are available', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let semaphore = new TestSemaphore(2);
          let active = 0;
          let maxActive = 0;
          let pool: PagePool | undefined;

          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              renderSemaphore: semaphore,
            }));
            await pool.warmStandbys();

            let run = async (realm: string) => {
              let lease = await pool!.getPage(realm);
              active++;
              maxActive = Math.max(maxActive, active);
              await new Promise((resolve) => setTimeout(resolve, 25));
              active--;
              lease.release();
            };

            await Promise.all([run('realm-a'), run('realm-a')]);

            assert.strictEqual(
              maxActive,
              2,
              'renders run in parallel on separate tabs',
            );
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('file-queue admission holds the last tab for module calls', async function (assert) {
          // Invariant: `fileTabsBusy ≤ N − 1`. With tab-max=2, at most
          // one file render can be admitted at a time, reserving the
          // other tab for module calls. This prevents the self-
          // referential prerender deadlock (a file render blocked on a
          // module extraction that's queued behind it).
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let semaphore = new TestSemaphore(2);
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              renderSemaphore: semaphore,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            let firstFile = await pool.getPage('realm-a', 'file');
            let secondFileAdmitted = false;
            let secondFilePromise = pool
              .getPage('realm-a', 'file')
              .then((lease) => {
                secondFileAdmitted = true;
                return lease;
              });
            await new Promise((r) => setTimeout(r, 10));
            assert.false(
              secondFileAdmitted,
              'second file call waits behind admission control',
            );

            let moduleLease = await pool.getPage('realm-a', 'module');
            assert.ok(
              moduleLease.page,
              'module call bypasses admission and lands on a tab',
            );
            moduleLease.release();

            firstFile.release();
            let secondFile = await secondFilePromise;
            assert.true(
              secondFileAdmitted,
              'releasing the first file frees the admission slot',
            );
            secondFile.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('cancelling while waiting for file admission releases cleanly', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let semaphore = new TestSemaphore(2);
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              renderSemaphore: semaphore,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            let firstFile = await pool.getPage('realm-a', 'file');
            let controller = new AbortController();
            let cancelled = pool.getPage('realm-a', 'file', {
              signal: controller.signal,
            });
            controller.abort();
            await assert.rejects(
              cancelled,
              'aborted while queued on admission',
            );

            // Subsequent module call still goes through.
            let moduleLease = await pool.getPage('realm-a', 'module');
            assert.ok(moduleLease.page);
            moduleLease.release();

            firstFile.release();
            // And after releasing, a new file admission succeeds.
            let thirdFile = await pool.getPage('realm-a', 'file');
            thirdFile.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('waits.admissionMs reports time spent in the file-admission queue', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            let first = await pool.getPage('realm-a', 'file');
            // Semantic check: the first call did not queue, so the
            // file-admission semaphore has no pending waiters. We use
            // the queue-depth snapshot rather than asserting against
            // first.waits.admissionMs — the latter is wall-clock and
            // can register as 1–2ms on slow CI from microtask
            // round-trip alone, even when the semaphore had a slot
            // immediately available. The intent of the test is "didn't
            // queue", which `admission.pending` answers directly.
            let snapAfterFirst = pool
              .getQueueDepthSnapshot()
              .affinities.find((a) => a.affinityKey === 'realm-a');
            let pendingAfterFirst = snapAfterFirst
              ? snapAfterFirst.admission.pending
              : 0;
            assert.strictEqual(
              pendingAfterFirst,
              0,
              'first file call did not queue (no admission waiters)',
            );

            // Second file call blocks on the admission semaphore (cap=1
            // at tabMax=2). Release the first after a short hold; the
            // second's admissionMs should reflect that hold.
            let holdMs = 20;
            let secondPromise = pool.getPage('realm-a', 'file');
            // Yield once so the second call's `acquire` lands in the
            // queue, then verify it's actually queued. Microtask flush
            // is enough — `acquire` queues synchronously after the
            // initial `await throwIfAborted` boundary.
            await new Promise((r) => setImmediate(r));
            let snapWhileQueued = pool
              .getQueueDepthSnapshot()
              .affinities.find((a) => a.affinityKey === 'realm-a');
            let pendingWhileQueued = snapWhileQueued
              ? snapWhileQueued.admission.pending
              : 0;
            assert.strictEqual(
              pendingWhileQueued,
              1,
              'second file call is queued behind admission',
            );

            setTimeout(() => first.release(), holdMs);
            let second = await secondPromise;
            assert.ok(
              second.waits.admissionMs >= holdMs - 5,
              `second file call reports admissionMs ≥ ${holdMs}ms (actual: ${second.waits.admissionMs})`,
            );
            second.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('module / command calls bypass admission, waits.admissionMs is zero', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            // Hold the only admission slot with a file call.
            let fileLease = await pool.getPage('realm-a', 'file');

            // Module / command calls bypass admission and land immediately.
            let moduleLease = await pool.getPage('realm-a', 'module');
            assert.strictEqual(
              moduleLease.waits.admissionMs,
              0,
              'module call skips admission entirely',
            );
            moduleLease.release();

            let commandLease = await pool.getPage('realm-a', 'command');
            assert.strictEqual(
              commandLease.waits.admissionMs,
              0,
              'command call skips admission entirely',
            );
            commandLease.release();

            fileLease.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('getQueueDepthSnapshot reports per-affinity admission pending/cap', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            // Before any file call has hit this affinity, admission
            // semaphore hasn't been lazily created. Snapshot reports
            // cap=0, pending=0 so operators can distinguish "admission
            // not configured for this affinity yet" from "cap is 0".
            let first = await pool.getPage('realm-a', 'file');
            let snap1 = pool.getQueueDepthSnapshot();
            let a1 = snap1.affinities.find((a) => a.affinityKey === 'realm-a');
            assert.ok(a1, 'realm-a shows up in snapshot');
            assert.strictEqual(
              a1!.admission.cap,
              1,
              'admission cap = affinityTabMax − 1',
            );
            assert.strictEqual(
              a1!.admission.pending,
              0,
              'no admission waiters when only caller holds the slot',
            );

            // Second file call blocks on admission. Snapshot should
            // report one pending waiter.
            let secondPromise = pool.getPage('realm-a', 'file');
            await new Promise((r) => setTimeout(r, 10));
            let snap2 = pool.getQueueDepthSnapshot();
            let a2 = snap2.affinities.find((a) => a.affinityKey === 'realm-a');
            assert.strictEqual(
              a2!.admission.pending,
              1,
              'one waiter queued behind the exhausted admission semaphore',
            );

            first.release();
            let second = await secondPromise;
            second.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('idle file-admission semaphore is dropped so the map does not grow unbounded', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            // While a file call holds admission, the semaphore is
            // present in the snapshot with a non-zero cap.
            let lease = await pool.getPage('realm-a', 'file');
            let busySnap = pool.getQueueDepthSnapshot();
            let busyAffinity = busySnap.affinities.find(
              (a) => a.affinityKey === 'realm-a',
            );
            assert.strictEqual(
              busyAffinity!.admission.cap,
              1,
              'semaphore is present while a file call holds admission',
            );

            // After release and with no waiters, the semaphore is
            // idle. It should be dropped so the map stays bounded by
            // affinities currently serving a file call, not by total
            // affinities ever seen.
            lease.release();
            let idleSnap = pool.getQueueDepthSnapshot();
            let idleAffinity = idleSnap.affinities.find(
              (a) => a.affinityKey === 'realm-a',
            );
            assert.strictEqual(
              idleAffinity!.admission.cap,
              0,
              'semaphore is dropped once in-use and pending both return to 0',
            );
            assert.strictEqual(
              idleAffinity!.admission.pending,
              0,
              'no waiters on the dropped semaphore',
            );

            // A fresh file call on the same affinity lazy-creates a
            // new semaphore — cheap, and the admission cap is
            // recomputed from the current affinityTabMax.
            let next = await pool.getPage('realm-a', 'file');
            let reusedSnap = pool.getQueueDepthSnapshot();
            let reusedAffinity = reusedSnap.affinities.find(
              (a) => a.affinityKey === 'realm-a',
            );
            assert.strictEqual(
              reusedAffinity!.admission.cap,
              1,
              'subsequent file call lazy-creates a fresh semaphore',
            );
            next.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('PRERENDER_AFFINITY_FILE_CONCURRENCY unset: cap equals the deadlock-safety ceiling (no behavior change)', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let prevFileConcurrency =
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '5';
            delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
            ({ pool } = makeStubPagePool({
              maxPages: 5,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();
            let lease = await pool.getPage('realm-a', 'file');
            let snap = pool.getQueueDepthSnapshot();
            let affinity = snap.affinities.find(
              (a) => a.affinityKey === 'realm-a',
            );
            assert.strictEqual(
              affinity!.admission.cap,
              4,
              'default cap equals ceiling (affinityTabMax=5 → 4)',
            );
            lease.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
            if (prevFileConcurrency === undefined) {
              delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
            } else {
              process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY =
                prevFileConcurrency;
            }
          }
        });

        test('PRERENDER_AFFINITY_FILE_CONCURRENCY lowers the cap below the ceiling', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let prevFileConcurrency =
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '5';
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY = '1';
            ({ pool } = makeStubPagePool({
              maxPages: 5,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            let first = await pool.getPage('realm-a', 'file');
            let snap1 = pool.getQueueDepthSnapshot();
            let affinity1 = snap1.affinities.find(
              (a) => a.affinityKey === 'realm-a',
            );
            assert.strictEqual(
              affinity1!.admission.cap,
              1,
              'cap lowered to env override when override < ceiling',
            );

            // Second file call blocks on admission because cap=1.
            let holdMs = 20;
            let secondPromise = pool.getPage('realm-a', 'file');
            setTimeout(() => first.release(), holdMs);
            let second = await secondPromise;
            assert.ok(
              second.waits.admissionMs >= holdMs - 5,
              `second file call waited for admission (${second.waits.admissionMs}ms)`,
            );
            second.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
            if (prevFileConcurrency === undefined) {
              delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
            } else {
              process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY =
                prevFileConcurrency;
            }
          }
        });

        test('PRERENDER_AFFINITY_FILE_CONCURRENCY above ceiling is clamped to the ceiling', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let prevFileConcurrency =
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '3';
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY = '99';
            ({ pool } = makeStubPagePool({
              maxPages: 3,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();
            let lease = await pool.getPage('realm-a', 'file');
            let snap = pool.getQueueDepthSnapshot();
            let affinity = snap.affinities.find(
              (a) => a.affinityKey === 'realm-a',
            );
            assert.strictEqual(
              affinity!.admission.cap,
              2,
              'cap clamped to deadlock-safety ceiling (tabMax=3 → 2) even when env asks for 99',
            );
            lease.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
            if (prevFileConcurrency === undefined) {
              delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
            } else {
              process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY =
                prevFileConcurrency;
            }
          }
        });

        test('invalid PRERENDER_AFFINITY_FILE_CONCURRENCY falls back to the ceiling', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let prevFileConcurrency =
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '5';
            // Includes the empty-string case: it fails the
            // `raw !== ''` guard in the constructor and is treated
            // like unset — no warning, falls through to the ceiling.
            for (let badValue of ['0', '-1', '3.5', 'abc', 'NaN', '']) {
              process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY = badValue;
              let { pool } = makeStubPagePool({
                maxPages: 5,
                disableFileAdmission: false,
              });
              try {
                await pool.warmStandbys();
                let lease = await pool.getPage('realm-a', 'file');
                let snap = pool.getQueueDepthSnapshot();
                let affinity = snap.affinities.find(
                  (a) => a.affinityKey === 'realm-a',
                );
                assert.strictEqual(
                  affinity!.admission.cap,
                  4,
                  `invalid env value ${JSON.stringify(badValue)} falls back to ceiling (4)`,
                );
                lease.release();
              } finally {
                await pool.closeAll();
              }
            }
          } finally {
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
            if (prevFileConcurrency === undefined) {
              delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
            } else {
              process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY =
                prevFileConcurrency;
            }
          }
        });

        test('module / command calls still bypass admission when PRERENDER_AFFINITY_FILE_CONCURRENCY=1', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let prevFileConcurrency =
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
          let pool: PagePool | undefined;
          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '3';
            process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY = '1';
            ({ pool } = makeStubPagePool({
              maxPages: 3,
              disableFileAdmission: false,
            }));
            await pool.warmStandbys();

            // A file call holds the only admission slot.
            let fileLease = await pool.getPage('realm-a', 'file');

            // Module and command calls skip admission entirely — they
            // don't queue behind the file slot. Both should land
            // immediately on a fresh tab.
            let moduleLease = await pool.getPage('realm-a', 'module');
            assert.strictEqual(
              moduleLease.waits.admissionMs,
              0,
              'module call bypasses admission even with cap exhausted',
            );
            moduleLease.release();

            let commandLease = await pool.getPage('realm-a', 'command');
            assert.strictEqual(
              commandLease.waits.admissionMs,
              0,
              'command call bypasses admission even with cap exhausted',
            );
            commandLease.release();

            fileLease.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
            if (prevFileConcurrency === undefined) {
              delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;
            } else {
              process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY =
                prevFileConcurrency;
            }
          }
        });

        test('prefers idle tab aligned to realm over standby tabs', async function (assert) {
          let { pool } = makeStubPagePool({ maxPages: 2 });
          await pool.warmStandbys();

          let first = await pool.getPage('realm-a');
          first.release();
          await pool.warmStandbys();

          let second = await pool.getPage('realm-a');
          assert.strictEqual(
            second.pageId,
            first.pageId,
            'idle aligned tab reused when available',
          );
          assert.true(second.reused, 'reuse flagged for aligned idle tab');

          second.release();
          await pool.closeAll();
        });

        test('prefers standby over idle tabs from other realms', async function (assert) {
          let originalNow = Date.now;
          let now = 1000;
          (Date as any).now = () => now;
          let { pool } = makeStubPagePool({ maxPages: 1 });

          try {
            await pool.warmStandbys(); // standby at t=1000
            now = 1100;
            let realmALease = await pool.getPage('realm-a');
            realmALease.release();

            now = 2000;
            await pool.warmStandbys(); // standby created after idle realm tab
            let realmBLease = await pool.getPage('realm-b');
            assert.notStrictEqual(
              realmBLease.pageId,
              realmALease.pageId,
              'standby chosen instead of commandeering an idle realm tab',
            );
            assert.false(
              realmBLease.reused,
              'standby assignment marked as not reused',
            );
            realmBLease.release();
          } finally {
            await pool.closeAll();
            (Date as any).now = originalNow;
          }
        });

        test('enforces per-realm tab cap by queueing on an existing tab', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          let resolved = false;

          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
            ({ pool } = makeStubPagePool({ maxPages: 2 }));
            await pool.warmStandbys();

            let first = await pool.getPage('realm-a');
            let secondPromise = pool.getPage('realm-a').then((lease) => {
              resolved = true;
              return lease;
            });

            await new Promise((resolve) => setTimeout(resolve, 5));
            assert.false(resolved, 'second request waits when tab cap reached');

            first.release();
            let second = await secondPromise;
            assert.strictEqual(
              second.pageId,
              first.pageId,
              'queued request reuses the existing tab',
            );
            assert.true(second.reused, 'reuse flagged for queued request');
            second.release();
          } finally {
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('queues on the least-pending tab when the realm cap is met', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          let originalNow = Date.now;
          let now = 1000;
          (Date as any).now = () => now;
          let thirdResolved = false;
          let fourthResolved = false;

          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({ maxPages: 2 }));
            await pool.warmStandbys();

            let first = await pool.getPage('realm-a');
            now = 1100;
            let second = await pool.getPage('realm-a');

            let thirdPromise = pool.getPage('realm-a').then((lease) => {
              thirdResolved = true;
              return lease;
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            let fourthPromise = pool.getPage('realm-a').then((lease) => {
              fourthResolved = true;
              return lease;
            });

            second.release();
            await new Promise((resolve) => setTimeout(resolve, 5));
            assert.true(
              fourthResolved,
              'request queued on least-pending tab unblocks first',
            );
            assert.false(
              thirdResolved,
              'request queued on busier tab still waits',
            );

            let fourth = await fourthPromise;
            assert.strictEqual(
              fourth.pageId,
              second.pageId,
              'fourth request queued on least-pending tab',
            );

            first.release();
            let third = await thirdPromise;
            assert.strictEqual(
              third.pageId,
              first.pageId,
              'third request queued on the LRU tab when pending counts tied',
            );
            fourth.release();
            third.release();
          } finally {
            (Date as any).now = originalNow;
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('queued cross-realm requests realign the tab per request', async function (assert) {
          let { pool } = makeStubPagePool({ maxPages: 1 });
          await pool.warmStandbys();

          let first = await pool.getPage('realm-a');
          await pool.warmStandbys();
          let blocker = await pool.getPage('realm-c');

          let order: string[] = [];
          let secondPromise = pool.getPage('realm-a').then((lease) => {
            order.push('a');
            return lease;
          });
          let thirdPromise = pool.getPage('realm-b').then((lease) => {
            order.push('b');
            return lease;
          });

          first.release();

          let second = await secondPromise;
          assert.deepEqual(order, ['a'], 'queued realm-a request runs first');
          assert.true(
            pool.getWarmAffinities().includes('realm-a'),
            'tab aligned to realm-a while queued work runs',
          );
          second.release();
          blocker.release();

          let third = await thirdPromise;
          assert.deepEqual(
            order,
            ['a', 'b'],
            'queued realm-b request runs after',
          );
          assert.true(
            pool.getWarmAffinities().includes('realm-b'),
            'tab realigned to realm-b when queued request starts',
          );
          third.release();

          await pool.closeAll();
        });

        test('does not reassign a busy tab with queued work across realms', async function (assert) {
          let { pool } = makeStubPagePool({
            maxPages: 1,
            disableStandbyRefill: true,
          });

          try {
            await pool.warmStandbys();

            let first = await pool.getPage('realm-a');

            let secondPromise = pool.getPage('realm-a');
            let thirdPromise = pool.getPage('realm-b');

            await assert.rejects(
              thirdPromise,
              /No standby page available for prerender/,
              'cross-realm request rejects when only busy tab has queued work',
            );

            first.release();
            let second = await secondPromise;
            assert.strictEqual(
              second.pageId,
              first.pageId,
              'queued same-realm request keeps the original tab',
            );
            second.release();

            assert.false(
              pool.getWarmAffinities().includes('realm-b'),
              'cross-realm request does not reassign the tab',
            );
          } finally {
            await pool.closeAll();
          }
        });

        test('queues same-realm request when tab is transitioning', async function (assert) {
          let { pool } = makeStubPagePool({
            maxPages: 1,
            disableStandbyRefill: true,
          });

          try {
            await pool.warmStandbys();

            let first = await pool.getPage('realm-a');

            let crossResolved = false;
            let sameResolved = false;
            let crossPromise = pool.getPage('realm-b').then((lease) => {
              crossResolved = true;
              return lease;
            });
            let samePromise = pool.getPage('realm-a').then((lease) => {
              sameResolved = true;
              return lease;
            });

            await new Promise((resolve) => setTimeout(resolve, 5));
            assert.false(
              crossResolved,
              'cross-realm request waits for the busy tab',
            );
            assert.false(
              sameResolved,
              'same-realm request queues even while transitioning',
            );

            first.release();

            let cross = await crossPromise;
            assert.strictEqual(
              cross.pageId,
              first.pageId,
              'cross-realm request uses the existing tab',
            );
            cross.release();

            let same = await samePromise;
            assert.strictEqual(
              same.pageId,
              first.pageId,
              'same-realm request uses the same tab',
            );
            assert.false(
              pool.getWarmAffinities().includes('realm-b'),
              'tab realigned back to realm-a after same-realm request',
            );
            same.release();
          } finally {
            await pool.closeAll();
          }
        });

        test('does not oversubscribe contexts during async eviction', async function (assert) {
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          let pool: PagePool | undefined;
          let active = 0;
          let peak = 0;
          let resolveClose!: () => void;
          let closeGate = new Promise<void>((resolve) => {
            resolveClose = resolve;
          });

          try {
            process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
            ({ pool } = makeStubPagePool({
              maxPages: 2,
              closeContextDelay: async () => closeGate,
              onContextCreated() {
                active++;
                peak = Math.max(peak, active);
              },
              onContextClosed() {
                active--;
              },
            }));

            await pool.warmStandbys();

            let first = await pool.getPage('realm-a');
            let second = await pool.getPage('realm-a');

            await pool.disposeAffinity('realm-a', { awaitIdle: false });
            await pool.warmStandbys();

            assert.ok(
              peak <= 3,
              'context count stays within maxPages+1 during async eviction',
            );

            first.release();
            second.release();
            resolveClose();
          } finally {
            if (resolveClose) {
              resolveClose();
            }
            await pool?.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });

        test('creates spare standby when pool is at capacity', async function (assert) {
          let { pool, contextsCreated } = makeStubPagePool({ maxPages: 1 });
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
          first.release();
          await pool.closeAll();
        });

        test('standby pages bind to the first realm they serve', async function (assert) {
          let { pool } = makeStubPagePool({ maxPages: 2 });
          await pool.warmStandbys(); // fill initial standbys

          let realmAFirst = await pool.getPage('realm-a');
          let realmAFirstId = realmAFirst.pageId;
          realmAFirst.release();
          await pool.warmStandbys(); // replenish after consuming standby
          let realmBFirst = await pool.getPage('realm-b');
          let realmBFirstId = realmBFirst.pageId;
          realmBFirst.release();
          await pool.warmStandbys(); // replenish again to keep standbys warm

          let realmASecond = await pool.getPage('realm-a');
          let realmBSecond = await pool.getPage('realm-b');

          assert.false(realmAFirst.reused, 'first realm A call not reused');
          assert.false(realmBFirst.reused, 'first realm B call not reused');
          assert.true(realmASecond.reused, 'realm A reuses its page');
          assert.true(realmBSecond.reused, 'realm B reuses its page');
          assert.strictEqual(
            realmASecond.pageId,
            realmAFirstId,
            'realm A keeps the same page',
          );
          assert.strictEqual(
            realmBSecond.pageId,
            realmBFirstId,
            'realm B keeps the same page',
          );
          assert.notStrictEqual(
            realmAFirstId,
            realmBFirstId,
            'distinct pages per realm from standbys',
          );
          realmASecond.release();
          realmBSecond.release();
          await pool.closeAll();
        });

        test('each tab uses a separate browser context', async function (assert) {
          let { pool } = makeStubPagePool({ maxPages: 2 });
          await pool.warmStandbys();

          let first = await pool.getPage('realm-a');
          let second = await pool.getPage('realm-b');

          assert.notStrictEqual(
            first.page.browserContext(),
            second.page.browserContext(),
            'pages from different tabs are isolated by browser context',
          );
          await first.page.evaluate(
            (key: string, value: string) => localStorage.setItem(key, value),
            'boxel-test-local-storage-key',
            'realm-a-value',
          );
          let firstValue = await first.page.evaluate(
            (key: string) => localStorage.getItem(key),
            'boxel-test-local-storage-key',
          );
          let secondValue = await second.page.evaluate(
            (key: string) => localStorage.getItem(key),
            'boxel-test-local-storage-key',
          );
          assert.strictEqual(
            firstValue,
            'realm-a-value',
            'localStorage value is readable in the context that set it',
          );
          assert.strictEqual(
            secondValue,
            null,
            'localStorage value is not visible across browser contexts',
          );

          first.release();
          second.release();
          await pool.closeAll();
        });

        test('evicts idle realms without touching standbys', async function (assert) {
          let { pool, contextsCreated, contextsClosed } = makeStubPagePool({
            maxPages: 2,
          });
          await pool.warmStandbys();

          assert.strictEqual(
            contextsCreated.length,
            2,
            'initial standbys created up to maxPages',
          );

          let realmLease = await pool.getPage('realm-a');
          await pool.warmStandbys(); // ensure standby pool replenishment settles before idle sweep
          realmLease.release();

          let originalNow = Date.now;
          try {
            let now = Date.now();
            (Date as any).now = () => now + 13 * 60 * 60 * 1000; // 13 hours later

            let evicted = await pool.evictIdleAffinities(12 * 60 * 60 * 1000);

            assert.deepEqual(evicted, ['realm-a'], 'idle affinity evicted');
            assert.deepEqual(
              pool.getWarmAffinities(),
              [],
              'affinity entry removed from warm set',
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
          let { pool, contextsCreated, contextsClosed } = makeStubPagePool({
            maxPages: 1,
          });
          await pool.warmStandbys();

          let createdBeforeSweep = contextsCreated.length;
          let evicted = await pool.evictIdleAffinities(1);
          let closedAfterSweep = contextsClosed.length;

          assert.deepEqual(evicted, [], 'no idle affinities to evict');
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

      module('shared BrowserContext (CS-10817)', function () {
        test('disposeAffinity with retainSharedContext keeps an orphan for re-warm', async function (assert) {
          let { pool } = makeStubPagePool({ maxPages: 2 });
          await pool.warmStandbys();

          let first = await pool.getPage('realm-a');
          let firstContext = first.page.browserContext();
          first.release();
          // Simulates the eviction path in render-runner.ts (unusable
          // / retry) — the page is dead but the realm's warm cache
          // in the BrowserContext is still valid.
          await pool.disposeAffinity('realm-a', {
            awaitIdle: true,
            retainSharedContext: true,
          });

          let snapshot = pool.getSharedContextSnapshot();
          let orphan = snapshot.entries.find(
            (e) => e.affinityKey === 'realm-a',
          );
          assert.ok(orphan, 'shared context row kept for realm-a');
          assert.strictEqual(
            orphan?.pageCount,
            0,
            'pageCount is zero (orphan)',
          );
          assert.false(
            orphan?.closing,
            'orphan is not marked closing until cap evicts or explicit close',
          );
          // Subsequent getPage for the same affinity must reuse the
          // orphan context, not spawn a fresh one.
          let second = await pool.getPage('realm-a');
          assert.strictEqual(
            second.page.browserContext(),
            firstContext,
            're-warm spawns the new page in the orphan BrowserContext',
          );
          second.release();
          await pool.closeAll();
        });

        test('disposeAffinity without retainSharedContext closes the context', async function (assert) {
          let { pool } = makeStubPagePool({ maxPages: 2 });
          await pool.warmStandbys();

          let first = await pool.getPage('realm-a');
          let firstContext = first.page.browserContext();
          first.release();
          await pool.disposeAffinity('realm-a');

          assert.strictEqual(
            pool
              .getSharedContextSnapshot()
              .entries.find((e) => e.affinityKey === 'realm-a'),
            undefined,
            'dispose without retain tears the shared-context row down',
          );

          let second = await pool.getPage('realm-a');
          assert.notStrictEqual(
            second.page.browserContext(),
            firstContext,
            'post-dispose visit gets a fresh BrowserContext',
          );
          second.release();
          await pool.closeAll();
        });

        test('LRU evicts the oldest orphan when #sharedContextCap is exceeded', async function (assert) {
          let originalNow = Date.now;
          let now = 1000;
          (Date as any).now = () => now;
          let previousCap = process.env.PRERENDER_SHARED_CONTEXT_CAP;
          process.env.PRERENDER_SHARED_CONTEXT_CAP = '2';
          let { pool, contextsClosed } = makeStubPagePool({
            maxPages: 3,
            disableStandbyRefill: true,
          });
          let orphanFor = async (affinityKey: string) => {
            let lease = await pool.getPage(affinityKey);
            lease.release();
            await pool.disposeAffinity(affinityKey, {
              awaitIdle: true,
              retainSharedContext: true,
            });
            now += 10;
          };
          try {
            await pool.warmStandbys();

            await orphanFor('realm-a'); // t=1000
            await orphanFor('realm-b'); // t=1010
            // size = 2 so far; still within cap=2.
            assert.strictEqual(
              pool.getSharedContextSnapshot().entries.length,
              2,
              'two orphans retained under the cap',
            );

            // Creating a third orphan pushes total to 3 > cap=2 —
            // oldest orphan (realm-a) evicted.
            await orphanFor('realm-c');
            let snapshot = pool.getSharedContextSnapshot();
            assert.false(
              snapshot.entries.some((e) => e.affinityKey === 'realm-a'),
              'oldest orphan evicted by LRU when cap exceeded',
            );
            assert.true(
              snapshot.entries.some((e) => e.affinityKey === 'realm-b'),
              'newer orphan retained',
            );
            assert.true(
              snapshot.entries.some((e) => e.affinityKey === 'realm-c'),
              'most-recent orphan retained',
            );
            assert.ok(
              contextsClosed.length >= 1,
              'evicted orphan context was closed by LRU sweep',
            );
          } finally {
            await pool.closeAll();
            (Date as any).now = originalNow;
            if (previousCap === undefined) {
              delete process.env.PRERENDER_SHARED_CONTEXT_CAP;
            } else {
              process.env.PRERENDER_SHARED_CONTEXT_CAP = previousCap;
            }
          }
        });

        test('LRU does not evict active (in-use) shared contexts', async function (assert) {
          let previousCap = process.env.PRERENDER_SHARED_CONTEXT_CAP;
          process.env.PRERENDER_SHARED_CONTEXT_CAP = '1';
          let { pool } = makeStubPagePool({
            maxPages: 3,
            disableStandbyRefill: true,
          });
          try {
            await pool.warmStandbys();

            // realm-a is held — active (pageCount=1). Exceeding cap
            // must NOT evict it.
            let first = await pool.getPage('realm-a');

            // Orphan realm-b.
            let second = await pool.getPage('realm-b');
            second.release();
            await pool.disposeAffinity('realm-b', {
              awaitIdle: true,
              retainSharedContext: true,
            });

            // Claim realm-c — two shared contexts exist (realm-a
            // active, realm-b orphan). Claiming realm-c pushes total
            // to 3 > cap=1; sweep should close realm-b, leave realm-a.
            let third = await pool.getPage('realm-c');

            let snapshot = pool.getSharedContextSnapshot();
            assert.true(
              snapshot.entries.some((e) => e.affinityKey === 'realm-a'),
              'active realm-a context survives LRU sweep',
            );
            assert.false(
              snapshot.entries.some((e) => e.affinityKey === 'realm-b'),
              'orphan realm-b evicted to make room under cap',
            );

            first.release();
            third.release();
          } finally {
            await pool.closeAll();
            if (previousCap === undefined) {
              delete process.env.PRERENDER_SHARED_CONTEXT_CAP;
            } else {
              process.env.PRERENDER_SHARED_CONTEXT_CAP = previousCap;
            }
          }
        });

        test('additional tabs at tabMax > 1 do not leak their BrowserContext on close', async function (assert) {
          // Regression guard: when a second/third getPage takes
          // another standby, that standby's BrowserContext is
          // different from the one recorded in `#sharedContexts` for
          // the affinity. `#closeEntry` has to notice the mismatch
          // and close the entry's own context — otherwise the
          // shared-context bookkeeping would only tear down the
          // first-registered context and leak the rest.
          let prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
          process.env.PRERENDER_AFFINITY_TAB_MAX = '3';
          let { pool, contextsCreated, contextsClosed } = makeStubPagePool({
            maxPages: 3,
          });
          try {
            await pool.warmStandbys();

            let createdBefore = contextsCreated.length;
            let first = await pool.getPage('realm-a');
            let second = await pool.getPage('realm-a');
            let third = await pool.getPage('realm-a');

            // First page adopts a standby's context; subsequent tabs
            // take another standby, so the contexts differ —
            // #closeEntry's mismatch branch is what guarantees no
            // leak.
            assert.notStrictEqual(
              first.page.browserContext(),
              second.page.browserContext(),
              'second tab uses the next standby BrowserContext',
            );
            assert.strictEqual(
              pool.getSharedContextSnapshot().entries.length,
              1,
              'sharedContexts tracks exactly one context for the affinity',
            );

            let closedBefore = contextsClosed.length;
            first.release();
            second.release();
            third.release();
            await pool.disposeAffinity('realm-a');

            let netCreated = contextsCreated.length - createdBefore;
            let netClosed = contextsClosed.length - closedBefore;
            assert.strictEqual(
              netClosed,
              netCreated,
              'every BrowserContext opened during the test was closed — no leak',
            );
          } finally {
            await pool.closeAll();
            if (prevTabMax === undefined) {
              delete process.env.PRERENDER_AFFINITY_TAB_MAX;
            } else {
              process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
            }
          }
        });
      });
    });
  }

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
          let { affinityType, affinityValue, url, renderOptions } = args;
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
                    type: 'module-error',
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
            timings: {
              launchMs: 0,
              renderMs: 1,
              waits: {
                semaphoreMs: 0,
                admissionMs: 0,
                tabQueueMs: 0,
                tabStartupMs: 0,
              },
            },
            pool: {
              pageId: `page-${attemptCount}`,
              affinityType,
              affinityValue,
              reused: attemptCount > 1,
              evicted: false,
              timedOut: false,
            },
          };
        };

        prerenderer = getPrerendererForTesting({
          maxPages: 1,
          serverURL: 'http://127.0.0.1:4225',
        });

        let result = await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: retryRealm,
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

  module('prerender - file retries', function () {
    test('file prerender retries with clear cache on retry signature', async function (assert) {
      let originalAttempt = RenderRunner.prototype.prerenderVisitAttempt;
      let prerenderer: Prerenderer | undefined;
      let attempts: Array<RenderRouteOptions | undefined> = [];
      let retryRealm = 'https://file-retry.example/';
      let fileURL = `${retryRealm}notes.txt`;

      try {
        let attemptCount = 0;
        RenderRunner.prototype.prerenderVisitAttempt = async function (
          args: Parameters<RenderRunner['prerenderVisitAttempt']>[0],
        ) {
          let { affinityType, affinityValue, url, renderOptions } = args;
          attempts.push(renderOptions);
          attemptCount++;
          let fileExtract: FileExtractResponse =
            attemptCount === 1
              ? {
                  id: url,
                  nonce: `nonce-${attemptCount}`,
                  status: 'error',
                  searchDoc: null,
                  deps: [],
                  error: {
                    type: 'file-error',
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
                  id: url,
                  nonce: `nonce-${attemptCount}`,
                  status: 'ready',
                  searchDoc: { name: 'notes.txt' },
                  deps: [],
                };

          return {
            response: { fileExtract },
            timings: {
              launchMs: 0,
              renderMs: 1,
              waits: {
                semaphoreMs: 0,
                admissionMs: 0,
                tabQueueMs: 0,
                tabStartupMs: 0,
              },
            },
            pool: {
              pageId: `page-${attemptCount}`,
              affinityType,
              affinityValue,
              reused: attemptCount > 1,
              evicted: false,
              timedOut: false,
            },
          };
        };

        prerenderer = getPrerendererForTesting({
          maxPages: 1,
          serverURL: 'http://127.0.0.1:4225',
        });

        let result = await prerenderFileExtract(prerenderer, {
          affinityType: 'realm',
          affinityValue: retryRealm,
          realm: retryRealm,
          url: fileURL,
          auth: 'test-auth',
        });

        assert.strictEqual(
          attempts.length,
          2,
          'prerender retries once with clearCache',
        );
        assert.deepEqual(
          attempts[0],
          { fileExtract: true },
          'first attempt uses provided render options',
        );
        assert.deepEqual(
          attempts[1],
          { fileExtract: true, clearCache: true },
          'second attempt enables clearCache',
        );
        assert.strictEqual(
          result.response.status,
          'ready',
          'successful response returned after retry',
        );
      } finally {
        RenderRunner.prototype.prerenderVisitAttempt = originalAttempt;
        await prerenderer?.stop();
      }
    });
  });

  module('prerender - card retries', function () {
    test('card prerender retries with clear cache on retry signature', async function (assert) {
      let originalAttempt = RenderRunner.prototype.prerenderVisitAttempt;
      let prerenderer: Prerenderer | undefined;
      let attempts: Array<RenderRouteOptions | undefined> = [];
      let retryRealm = 'https://card-retry.example/';
      let cardURL = `${retryRealm}card`;

      try {
        let attemptCount = 0;
        RenderRunner.prototype.prerenderVisitAttempt = async function (
          args: Parameters<RenderRunner['prerenderVisitAttempt']>[0],
        ) {
          let {
            affinityType,
            affinityValue,
            url: attemptUrl,
            renderOptions,
          } = args;
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
            markdown: null,
          };
          let card: RenderResponse =
            attemptCount === 1
              ? {
                  ...baseResponse,
                  error: {
                    type: 'instance-error',
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
            response: { card },
            timings: {
              launchMs: 0,
              renderMs: 1,
              waits: {
                semaphoreMs: 0,
                admissionMs: 0,
                tabQueueMs: 0,
                tabStartupMs: 0,
              },
            },
            pool: {
              pageId: `page-${attemptCount}`,
              affinityType,
              affinityValue,
              reused: attemptCount > 1,
              evicted: false,
              timedOut: false,
            },
          };
        };

        prerenderer = getPrerendererForTesting({
          maxPages: 1,
          serverURL: 'http://127.0.0.1:4225',
        });

        let result = await prerenderCard(prerenderer, {
          affinityType: 'realm',
          affinityValue: retryRealm,
          realm: retryRealm,
          url: cardURL,
          auth: 'test-auth',
        });

        assert.strictEqual(
          attempts.length,
          2,
          'prerender retries once with clearCache',
        );
        assert.deepEqual(
          attempts[0],
          { cardRender: true },
          'first attempt uses cardRender pass flag',
        );
        assert.deepEqual(
          attempts[1],
          { cardRender: true, clearCache: true },
          'second attempt enables clearCache',
        );
        assert.notOk(result.response.error, 'successful response returned');
        assert.strictEqual(
          result.response.isolatedHTML,
          `${cardURL}-render-2`,
          'final response came from retry attempt',
        );
      } finally {
        RenderRunner.prototype.prerenderVisitAttempt = originalAttempt;
        await prerenderer?.stop();
      }
    });
  });

  module('prerender - concurrent restart coalescing', function () {
    test('concurrent failures trigger a single browser restart', async function (assert) {
      // Regression guard for the race where two visits failing in the same
      // tick each called #restartBrowser, both closeAll'd the pool
      // concurrently, and the second caller hit "Failed to find context with
      // id <X>" as its BrowserContext.close() landed after the first already
      // disposed the context.
      let originalAttempt = RenderRunner.prototype.prerenderVisitAttempt;
      let originalRestart = BrowserManager.prototype.restartBrowser;
      let prerenderer: Prerenderer | undefined;
      let restartCount = 0;
      let retryRealm = 'https://concurrent-restart.example/';
      let cardURL = `${retryRealm}card`;

      try {
        // Force every visit attempt to throw an unrecoverable error so the
        // prerenderer catch block calls #restartBrowser for each caller.
        RenderRunner.prototype.prerenderVisitAttempt = async function () {
          throw new Error('simulated unrecoverable prerender failure');
        };
        // Introduce a small delay inside restartBrowser so concurrent
        // callers actually overlap in time — without this the fast
        // synchronous-ish no-op restart would serialize naturally.
        BrowserManager.prototype.restartBrowser = async function (
          this: BrowserManager,
        ) {
          restartCount++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return await originalRestart.call(this);
        };

        prerenderer = getPrerendererForTesting({
          maxPages: 2,
          serverURL: 'http://127.0.0.1:4225',
        });

        // Fire three visits concurrently. Each will fail on its first
        // attempt, trigger #restartBrowser, and then retry once more (per
        // the prerenderVisit wrapper in prerenderer.ts). With the mutex
        // in place, all three callers coalesce onto a single in-flight
        // restart.
        let results = await Promise.allSettled([
          prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: retryRealm,
            realm: retryRealm,
            url: cardURL,
            auth: 'test-auth',
          }),
          prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: retryRealm,
            realm: retryRealm,
            url: `${cardURL}-2`,
            auth: 'test-auth',
          }),
          prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: retryRealm,
            realm: retryRealm,
            url: `${cardURL}-3`,
            auth: 'test-auth',
          }),
        ]);

        assert.strictEqual(
          results.filter((r) => r.status === 'rejected').length,
          3,
          'all three visits fail (no working render path available)',
        );
        assert.strictEqual(
          restartCount,
          1,
          'three concurrent failing visits coalesce into a single browser restart',
        );
      } finally {
        RenderRunner.prototype.prerenderVisitAttempt = originalAttempt;
        BrowserManager.prototype.restartBrowser = originalRestart;
        await prerenderer?.stop();
      }
    });
  });

  module(
    'prerender - card with many nested linksTo renders promptly',
    function (hooks) {
      let parentRealmURL = 'http://127.0.0.1:4470/test/';
      let childRealmURL = 'http://127.0.0.1:4471/test/';
      let prerenderServerURL = new URL(parentRealmURL).origin;
      let testUserId = '@user1:localhost';
      let permissions: RealmPermissions = {};
      let prerenderer: Prerenderer;
      let auth = () => testCreatePrerenderAuth(testUserId, permissions);

      hooks.before(async () => {
        prerenderer = getPrerendererForTesting({
          maxPages: 2,
          serverURL: prerenderServerURL,
        });
      });

      hooks.after(async () => {
        await prerenderer.stop();
      });

      hooks.afterEach(async () => {
        await Promise.all([
          prerenderer.disposeAffinity({
            affinityType: 'realm',
            affinityValue: parentRealmURL,
          }),
          prerenderer.disposeAffinity({
            affinityType: 'realm',
            affinityValue: childRealmURL,
          }),
        ]);
      });

      // Build a file system that mirrors the SystemCard scenario:
      // ParentCard --linksToMany--> ChildConfig --linksTo--> GrandchildDetail
      // where there are many ChildConfig instances each linking to a different
      // GrandchildDetail in a separate realm.
      let childCount = 10;

      let childRealmFileSystem: Record<string, any> = {
        'detail.gts': `
          import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';
          export class Detail extends CardDef {
            static displayName = 'Detail';
            @field info = contains(StringField);
            static isolated = class extends Component<typeof this> {
              <template><span data-test-detail>{{@model.info}}</span></template>
            };
            static fitted = class extends Component<typeof this> {
              <template><span data-test-detail-fitted>{{@model.info}}</span></template>
            };
          }
        `,
      };

      for (let i = 0; i < childCount; i++) {
        childRealmFileSystem[`Detail/detail-${i}.json`] = {
          data: {
            attributes: { info: `Detail ${i}` },
            meta: {
              adoptsFrom: {
                module: rri('../detail'),
                name: 'Detail',
              },
            },
          },
        };
      }

      let parentRealmFileSystem: Record<string, any> = {
        'child-config.gts': `
          import { CardDef, field, contains, linksTo, Component } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';
          import { Detail } from '${childRealmURL}detail';
          export class ChildConfig extends CardDef {
            static displayName = 'Child Config';
            @field detail = linksTo(Detail);
            @field derivedInfo = contains(StringField, {
              computeVia: function () {
                try { return this.detail?.info ?? null; } catch(e) { return null; }
              },
            });
            static isolated = class extends Component<typeof this> {
              <template><div data-test-child><@fields.detail /><span>{{@model.derivedInfo}}</span></div></template>
            };
            static fitted = class extends Component<typeof this> {
              <template><span data-test-child-fitted>{{@model.derivedInfo}}</span></template>
            };
          }
        `,
        'parent-card.gts': `
          import { CardDef, field, linksToMany, Component } from 'https://cardstack.com/base/card-api';
          import { ChildConfig } from './child-config';
          export class ParentCard extends CardDef {
            static displayName = 'Parent Card';
            @field children = linksToMany(ChildConfig);
            static isolated = class extends Component<typeof this> {
              <template>
                <div data-test-parent>
                  <@fields.children />
                </div>
              </template>
            };
          }
        `,
      };

      // Create ChildConfig instances that each link to a Detail in the child realm
      for (let i = 0; i < childCount; i++) {
        parentRealmFileSystem[`ChildConfig/child-${i}.json`] = {
          data: {
            relationships: {
              detail: {
                links: { self: `${childRealmURL}Detail/detail-${i}` },
              },
            },
            meta: {
              adoptsFrom: {
                module: rri('../child-config'),
                name: 'ChildConfig',
              },
            },
          },
        };
      }

      // Create the parent card that links to all children
      let childRelationships: Record<string, any> = {};
      for (let i = 0; i < childCount; i++) {
        childRelationships[`children.${i}`] = {
          links: { self: `./ChildConfig/child-${i}` },
        };
      }
      parentRealmFileSystem['parent.json'] = {
        data: {
          relationships: childRelationships,
          meta: {
            adoptsFrom: {
              module: rri('./parent-card'),
              name: 'ParentCard',
            },
          },
        },
      };

      setupPermissionedRealmsCached(hooks, {
        mode: 'before',
        realms: [
          {
            realmURL: childRealmURL,
            permissions: {
              '*': ['read'],
              [testUserId]: ['read', 'write', 'realm-owner'],
            },
            fileSystem: childRealmFileSystem,
          },
          {
            realmURL: parentRealmURL,
            permissions: {
              '*': ['read'],
              [testUserId]: ['read', 'write', 'realm-owner'],
            },
            fileSystem: parentRealmFileSystem,
          },
        ],
        onRealmSetup() {
          permissions = {
            [parentRealmURL]: ['read', 'write', 'realm-owner'],
            [childRealmURL]: ['read', 'write', 'realm-owner'],
          };
        },
      });

      test(`card with ${childCount} linksToMany each with linksTo in another realm prerenders without timeout`, async function (assert) {
        // Throttle RAF by 1.5s per frame to simulate background-tab behavior.
        // Without the fix the 20-pass stability loop would need 20 × 1.5 = 30s
        // just for the loop, pushing the total well past the 30s assertion
        // threshold below. With the fix the loop bypasses RAF entirely so
        // total time stays low.
        let rafPatch = installThrottledRAFPatch(1_500);
        try {
          let cardURL = `${parentRealmURL}parent`;

          let startMs = Date.now();
          let result = await prerenderCard(prerenderer, {
            affinityType: 'realm',
            affinityValue: parentRealmURL,
            realm: parentRealmURL,
            url: cardURL,
            auth: auth(),
            opts: { timeoutMs: 45_000 },
          });
          let elapsedMs = Date.now() - startMs;

          assert.false(result.pool.timedOut, 'prerender did not time out');
          assert.notOk(
            result.response.error,
            `prerender did not produce an error${result.response.error ? ': ' + JSON.stringify(result.response.error.error?.message ?? result.response.error) : ''}`,
          );

          // With 1.5s RAF throttle the unpatched stability loop alone
          // would need ≥30s. Completing under 30s proves RAF was bypassed.
          assert.true(
            elapsedMs < 30_000,
            `prerender completed in ${elapsedMs}ms (expected < 30s with RAF bypassed)`,
          );

          // Verify the rendered HTML includes content from the nested linked cards
          let html = result.response.isolatedHTML ?? '';
          assert.ok(
            html.includes('data-test-parent'),
            'rendered HTML contains the parent card',
          );
        } finally {
          rafPatch.restore();
        }
      });
    },
  );

  // Composite "visit" prerender — fuses the three passes into one call.
  module('prerenderVisit - composite pass orchestration', function (hooks) {
    let realmURL = 'http://127.0.0.1:4458/test/';
    let prerenderServerURL = new URL(realmURL).origin;
    let testUserId = '@user1:localhost';
    let permissions: RealmPermissions = {
      [realmURL]: ['read', 'write', 'realm-owner'],
    };
    let prerenderer: Prerenderer;
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
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      await prerenderer.stop();
    });

    hooks.afterEach(async () => {
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
            'maple.json': {
              data: {
                attributes: { name: 'Maple' },
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
    });

    test('all three passes populate all sub-fields', async function (assert) {
      const cardFileURL = `${realmURL}maple.json`;
      let result = await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: cardFileURL,
        auth: auth(),
        renderOptions: {
          cardRender: true,
          fileExtract: true,
          fileRender: true,
        },
      });

      assert.ok(result.response.card, 'card sub-response populated');
      assert.ok(
        result.response.fileExtract,
        'fileExtract sub-response populated',
      );
      assert.ok(
        result.response.fileRender,
        'fileRender sub-response populated',
      );
      assert.notOk(result.response.pageUnusableError, 'no page-unusable error');
      assert.ok(
        result.response.card?.isolatedHTML?.includes('Maple'),
        'card isolated HTML rendered',
      );
      assert.strictEqual(
        result.response.fileExtract?.status,
        'ready',
        'file extract reports ready',
      );
    });

    test('cardRender-only visit leaves file sub-fields unset', async function (assert) {
      const cardFileURL = `${realmURL}maple.json`;
      let result = await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: cardFileURL,
        auth: auth(),
        renderOptions: { cardRender: true },
      });

      assert.ok(result.response.card, 'card sub-response populated');
      assert.notOk(result.response.fileExtract, 'fileExtract skipped');
      assert.notOk(result.response.fileRender, 'fileRender skipped');
    });

    test('fileExtract-only visit returns only the extract', async function (assert) {
      const moduleURL = `${realmURL}person.gts`;
      let result = await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: moduleURL,
        auth: auth(),
        renderOptions: { fileExtract: true },
      });

      assert.ok(result.response.fileExtract, 'fileExtract populated');
      assert.notOk(result.response.card, 'card skipped');
      assert.notOk(result.response.fileRender, 'fileRender skipped');
      assert.strictEqual(
        result.response.fileExtract?.status,
        'ready',
        'file extract reports ready',
      );
    });

    test('fileExtract + fileRender chains resource automatically', async function (assert) {
      const cardFileURL = `${realmURL}maple.json`;
      // Caller does NOT supply fileData; it should be derived from the extract
      // pass's resource within the composite. The caller does supply
      // fileDefCodeRef (like the indexer does) — that's the one piece the
      // composite can't infer on its own since it depends on file extension
      // and the caller's file-def resolution rules.
      let result = await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: cardFileURL,
        auth: auth(),
        renderOptions: {
          fileExtract: true,
          fileRender: true,
          fileDefCodeRef: {
            module: baseRRI('json-file-def'),
            name: 'JsonFileDef',
          },
        },
      });

      assert.ok(result.response.fileExtract, 'fileExtract populated');
      assert.ok(
        result.response.fileRender,
        'fileRender populated via chained resource',
      );
      assert.notOk(
        result.response.fileRender?.error,
        `fileRender completed without error: ${JSON.stringify(result.response.fileRender?.error)}`,
      );
    });

    test('reuses a single pooled page for all three passes', async function (assert) {
      const cardFileURL = `${realmURL}maple.json`;
      // Warm the pool
      await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: cardFileURL,
        auth: auth(),
        renderOptions: {
          cardRender: true,
          fileExtract: true,
          fileRender: true,
        },
      });
      // Second call should reuse the warm page
      let result = await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: cardFileURL,
        auth: auth(),
        renderOptions: {
          cardRender: true,
          fileExtract: true,
          fileRender: true,
        },
      });
      assert.true(result.pool.reused, 'second visit reused the pooled page');
    });
  });
});
