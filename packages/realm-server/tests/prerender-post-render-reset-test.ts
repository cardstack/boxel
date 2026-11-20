import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RealmPermissions } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import type { Page } from 'puppeteer';
import type { Prerenderer } from '../prerender/index.ts';
import { PagePool } from '../prerender/page-pool.ts';
import {
  DEFAULT_POST_RENDER_RESET_MS,
  parsePostRenderResetMs,
  resetTabToStandby,
} from '../prerender/tab-reset.ts';
import { prerenderRenderTimeoutMs } from '../prerender/prerender-constants.ts';
import {
  setupPermissionedRealmsCached,
  testCreatePrerenderAuth,
  getPrerendererForTesting,
} from './helpers/index.ts';
import { prerenderCard } from './helpers/prerender.ts';

// A pooled tab outlives the render it served. Before the post-render reset,
// a visit captured its HTML and handed the tab back with the card still
// mounted on the render route, so whatever the card kept scheduling — a
// polling loop, a live search, a message-channel spin — kept running on the
// renderer's main thread while the pool counted the tab as idle, and starved
// the next render routed there. The reset moves the tab to the host's empty
// standby route before the visit releases it, which destroys the card's
// components and what they scheduled. A tab that can't make that transition
// inside the budget is retired instead of reused.

// A puppeteer-shaped page whose `evaluate` stands in for the host: the reset
// script is recognized by the standby marker it waits for.
function makeResetPage(
  behavior: 'lands' | 'hangs' | 'rejects' | 'no-helper' | 'throws',
) {
  let calls = 0;
  let page = {
    async evaluate(fn: unknown) {
      calls++;
      let source = String(fn);
      if (!source.includes('standby-ready')) {
        return undefined;
      }
      switch (behavior) {
        case 'lands':
          return true;
        case 'hangs':
          return new Promise(() => {});
        case 'rejects':
          throw new Error('Target closed');
        case 'no-helper':
          return 'no boxelTransitionTo helper on the page';
        case 'throws':
          return 'transition to standby threw: boom';
      }
    },
  };
  return { page: page as unknown as Page, calls: () => calls };
}

// Stub browser for the pool-level retirement: each tab answers `evaluate`
// in Node and records whether it was closed.
type StubTab = { page: unknown; closed: boolean };
function makeBrowserStub() {
  let tabs: StubTab[] = [];
  let browser = {
    async createBrowserContext() {
      let contextTabs: StubTab[] = [];
      let context: any = {
        async close() {
          for (let tab of contextTabs) {
            tab.closed = true;
          }
        },
        async newPage() {
          let tab: StubTab = { page: undefined, closed: false };
          let page: any = {
            async goto() {
              return undefined;
            },
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              return typeof fn === 'function' ? fn(...args) : undefined;
            },
            async close() {
              tab.closed = true;
            },
            browserContext() {
              return context;
            },
            on() {},
            off() {},
            removeAllListeners() {},
          };
          tab.page = page;
          tabs.push(tab);
          contextTabs.push(tab);
          return page;
        },
      };
      return context;
    },
  };
  return {
    manager: {
      async getBrowser() {
        return browser as any;
      },
      async cleanupUserDataDirs() {},
    },
    tabs,
  };
}

const POOL_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_AFFINITY_TAB_MAX',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
  'PRERENDER_HIGH_PRIORITY_THRESHOLD',
  'PRERENDER_AFFINITY_FILE_CONCURRENCY',
  'PRERENDER_POOL_IDLE_CONTRACTION_MS',
  'PRERENDER_SHARED_CONTEXT_CAP',
  'PRERENDER_TAB_HEALTH_PROBE_MS',
];

async function waitFor(condition: () => boolean, label: string) {
  let deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for: ${label}`);
    }
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}

module(basename(import.meta.filename), function () {
  module('resetTabToStandby', function () {
    test('reports a reset once the page reaches the standby route', async function (assert) {
      let { page } = makeResetPage('lands');
      let outcome = await resetTabToStandby(page, 500);
      assert.strictEqual(outcome.status, 'reset');
    });

    test('a page that never reaches the standby route times out on the budget', async function (assert) {
      let { page } = makeResetPage('hangs');
      let startedAt = Date.now();
      let outcome = await resetTabToStandby(page, 100);
      assert.strictEqual(outcome.status, 'timed-out');
      assert.true(
        Date.now() - startedAt < 1000,
        'the budget, not the page, ends the wait',
      );
    });

    test('a transition the host cannot make is a failure, not a reset', async function (assert) {
      for (let behavior of ['rejects', 'no-helper', 'throws'] as const) {
        let { page } = makeResetPage(behavior);
        let outcome = await resetTabToStandby(page, 500);
        assert.strictEqual(outcome.status, 'failed', behavior);
        assert.ok(
          (outcome as { error?: unknown }).error,
          `${behavior} carries its reason`,
        );
      }
    });
  });

  module('parsePostRenderResetMs', function (hooks) {
    let saved: string | undefined;
    hooks.beforeEach(() => {
      saved = process.env.PRERENDER_POST_RENDER_RESET_MS;
    });
    hooks.afterEach(() => {
      if (saved === undefined) {
        delete process.env.PRERENDER_POST_RENDER_RESET_MS;
      } else {
        process.env.PRERENDER_POST_RENDER_RESET_MS = saved;
      }
    });

    let parse = (raw: string | undefined) => {
      if (raw === undefined) {
        delete process.env.PRERENDER_POST_RENDER_RESET_MS;
      } else {
        process.env.PRERENDER_POST_RENDER_RESET_MS = raw;
      }
      return parsePostRenderResetMs();
    };

    test('an unset or blank budget takes the default', async function (assert) {
      assert.strictEqual(parse(undefined), DEFAULT_POST_RENDER_RESET_MS);
      assert.strictEqual(parse(''), DEFAULT_POST_RENDER_RESET_MS);
      assert.strictEqual(parse('  '), DEFAULT_POST_RENDER_RESET_MS);
    });

    test('0 turns the reset off, and an in-range budget is honoured', async function (assert) {
      assert.strictEqual(parse('0'), 0);
      assert.strictEqual(parse('250'), 250);
      assert.strictEqual(parse('2000'), 2000);
    });

    test('a budget no reset could meet, or one past the render timeout, takes the default', async function (assert) {
      for (let raw of [
        '1',
        '249',
        String(prerenderRenderTimeoutMs),
        '-5',
        '1.5',
        'soon',
      ]) {
        assert.strictEqual(parse(raw), DEFAULT_POST_RENDER_RESET_MS, raw);
      }
    });
  });

  module('PagePool.retireUnresettableTab', function (hooks) {
    let pools: PagePool[] = [];
    let savedEnv: Record<string, string | undefined> = {};

    hooks.beforeEach(() => {
      for (let key of POOL_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      process.env.PRERENDER_PAGE_POOL_MIN = '1';
      process.env.PRERENDER_PAGE_POOL_MAX = '2';
      process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
    });

    hooks.afterEach(async () => {
      for (let pool of pools.splice(0)) {
        try {
          await pool.closeAll();
        } catch {
          // best-effort
        }
      }
      for (let key of POOL_ENV_KEYS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
      savedEnv = {};
    });

    function makePool() {
      let { manager, tabs } = makeBrowserStub();
      let pool = new PagePool({
        maxPages: 2,
        serverURL: 'http://localhost',
        browserManager: manager as any,
        boxelHostURL: 'http://localhost:4200',
        standbyTimeoutMs: 500,
        disableFileAdmission: true,
        tabHealthProbeMs: 50,
      });
      pools.push(pool);
      return { pool, tabs };
    }

    test('the retired tab closes once its lease is released and the next render gets a fresh one', async function (assert) {
      let { pool, tabs } = makePool();
      await pool.warmStandbys();
      let lease = await pool.getPage('A');
      let tab = tabs.find((t) => t.page === lease.page)!;

      assert.true(
        await pool.retireUnresettableTab('A', lease.pageId),
        'the leased tab was found and retired',
      );
      lease.release();
      await waitFor(() => tab.closed, 'the retired tab to close');
      assert.true(tab.closed, 'the retired tab closed');

      let next = await pool.getPage('A');
      assert.notStrictEqual(
        next.pageId,
        lease.pageId,
        'the affinity renders next on a different tab',
      );
      next.release();
      assert.deepEqual(pool.getUnresettableTabRetirements(), { A: 1 });
    });

    test('a page id the affinity does not hold retires nothing', async function (assert) {
      let { pool } = makePool();
      await pool.warmStandbys();
      let lease = await pool.getPage('A');
      assert.false(await pool.retireUnresettableTab('A', 'no-such-page'));
      assert.false(await pool.retireUnresettableTab('B', lease.pageId));
      lease.release();
      let again = await pool.getPage('A');
      assert.strictEqual(again.pageId, lease.pageId, 'the warm tab survives');
      again.release();
      assert.deepEqual(pool.getUnresettableTabRetirements(), {});
    });
  });

  module('post-render reset in a real browser', function (hooks) {
    let realmURL = 'http://127.0.0.1:4467/test/';
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

    // The pages the pool hands out, by page id, so a test can look into a
    // tab after its render released it.
    let pagesById = new Map<string, Page>();
    let originalGetPage = PagePool.prototype.getPage;
    // The tabs the runner retires, by page id.
    let retired: string[] = [];
    let originalRetire = PagePool.prototype.retireUnresettableTab;

    hooks.before(async () => {
      PagePool.prototype.getPage = async function (
        this: PagePool,
        ...args: Parameters<PagePool['getPage']>
      ) {
        let pageInfo = await originalGetPage.apply(this, args);
        pagesById.set(pageInfo.pageId, pageInfo.page);
        return pageInfo;
      };
      PagePool.prototype.retireUnresettableTab = async function (
        this: PagePool,
        ...args: Parameters<PagePool['retireUnresettableTab']>
      ) {
        retired.push(args[1]);
        return await originalRetire.apply(this, args);
      };
      prerenderer = getPrerendererForTesting({
        maxPages: 2,
        serverURL: prerenderServerURL,
      });
    });

    hooks.after(async () => {
      PagePool.prototype.getPage = originalGetPage;
      PagePool.prototype.retireUnresettableTab = originalRetire;
      await prerenderer.stop();
    });

    hooks.beforeEach(() => {
      retired = [];
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
            // Spins a message-channel loop for as long as its isolated
            // component is mounted, counting ticks on the page. A message
            // channel is outside both the render route's timer stub and the
            // run loop, so nothing but the component's own destructor stops
            // it — the shape of a card that keeps its tab's main thread busy
            // after its render.
            'ticker.gts': `
              import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
              import { registerDestructor } from '@ember/destroyable';
              export class Ticker extends CardDef {
                static displayName = "Ticker";
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  constructor(owner, args) {
                    super(owner, args);
                    let stopped = false;
                    let channel = new MessageChannel();
                    channel.port1.onmessage = () => {
                      if (stopped) {
                        return;
                      }
                      globalThis.__tickerTicks = (globalThis.__tickerTicks ?? 0) + 1;
                      channel.port2.postMessage(null);
                    };
                    channel.port2.postMessage(null);
                    registerDestructor(this, () => {
                      stopped = true;
                      channel.port1.close();
                    });
                  }
                  <template><p class="ticker">{{@model.name}}</p></template>
                }
              }
            `,
            'ticker-card.json': {
              data: {
                attributes: { name: 'Tick' },
                meta: {
                  adoptsFrom: { module: rri('./ticker'), name: 'Ticker' },
                },
              },
            },
            // Holds its tab's main thread for longer than the reset's budget
            // as its component is torn down, so the reset can't land: the
            // shape of a card whose teardown, or whatever it left running,
            // keeps the tab busy after its render.
            'stall.gts': `
              import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
              import { registerDestructor } from '@ember/destroyable';
              export class Stall extends CardDef {
                static displayName = "Stall";
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  constructor(owner, args) {
                    super(owner, args);
                    registerDestructor(this, () => {
                      let until = Date.now() + ${DEFAULT_POST_RENDER_RESET_MS * 3};
                      while (Date.now() < until) {
                        // spin
                      }
                    });
                  }
                  <template>{{@model.name}}</template>
                }
              }
            `,
            'stall-card.json': {
              data: {
                attributes: { name: 'Stall' },
                meta: {
                  adoptsFrom: { module: rri('./stall'), name: 'Stall' },
                },
              },
            },
            // Throws from its isolated template, so its render ends in a
            // render error rather than a captured card.
            'broken.gts': `
              import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
              export class Broken extends CardDef {
                static displayName = "Broken";
                @field name = contains(StringField);
                static isolated = class extends Component<typeof this> {
                  get boom() {
                    throw new Error('the broken card cannot render');
                  }
                  <template>{{this.boom}}</template>
                }
              }
            `,
            'broken-card.json': {
              data: {
                attributes: { name: 'Broken' },
                meta: {
                  adoptsFrom: { module: rri('./broken'), name: 'Broken' },
                },
              },
            },
            'person.gts': `
              import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
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
                attributes: { name: 'Maple' },
                meta: {
                  adoptsFrom: { module: rri('./person'), name: 'Person' },
                },
              },
            },
            '2.json': {
              data: {
                attributes: { name: 'Juniper' },
                meta: {
                  adoptsFrom: { module: rri('./person'), name: 'Person' },
                },
              },
            },
          },
        },
      ],
    });

    async function ticksOn(page: Page): Promise<number> {
      return await page.evaluate(
        () => ((globalThis as any).__tickerTicks as number | undefined) ?? 0,
      );
    }

    async function pause(ms: number) {
      await new Promise<void>((r) => setTimeout(r, ms));
    }

    test("a captured card's loop stops before its tab goes back to the pool", async function (assert) {
      let { response, pool, timings } = await prerenderer.prerenderCapture({
        realm: realmURL,
        url: `${realmURL}ticker-card`,
        auth: auth(),
        format: 'isolated',
      });
      assert.strictEqual(response.status, 'ready', 'the capture succeeded');
      assert.strictEqual(
        typeof timings.resetMs,
        'number',
        'the capture reports the reset it waited out',
      );
      assert.strictEqual(
        response.meta?.diagnostics?.postRenderResetMs,
        timings.resetMs,
        "the reset's time rides on the response's diagnostics",
      );
      let page = pagesById.get(pool.pageId);
      assert.ok(page, 'the capture tab was recorded');

      let atRelease = await ticksOn(page!);
      assert.true(atRelease > 0, `the card's loop ran while it rendered`);
      // A destructor may land a moment after the route change, so measure
      // from a settled point.
      await pause(200);
      let settled = await ticksOn(page!);
      await pause(500);
      let later = await ticksOn(page!);
      assert.strictEqual(
        later,
        settled,
        `the loop does not run after the render (${settled} → ${later} ticks)`,
      );
      assert.true(
        new URL(page!.url()).pathname.endsWith('/_standby'),
        `the tab is parked on the standby route (${page!.url()})`,
      );
    });

    test("a visited card's loop stops before its tab goes back to the pool", async function (assert) {
      let { response, pool, timings } = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}ticker-card`,
        auth: auth(),
      });
      assert.notOk(response.error, 'the visit rendered the card');
      assert.strictEqual(
        typeof timings.resetMs,
        'number',
        'the visit reports the reset it waited out',
      );
      let page = pagesById.get(pool.pageId);
      assert.ok(page, 'the visit tab was recorded');

      assert.true(
        (await ticksOn(page!)) > 0,
        `the card's loop ran while it rendered`,
      );
      await pause(200);
      let settled = await ticksOn(page!);
      await pause(500);
      let later = await ticksOn(page!);
      assert.strictEqual(
        later,
        settled,
        `the loop does not run after the visit (${settled} → ${later} ticks)`,
      );
      assert.true(
        new URL(page!.url()).pathname.endsWith('/_standby'),
        `the tab is parked on the standby route (${page!.url()})`,
      );
      assert.deepEqual(retired, [], 'the reset tab was not retired');
    });

    test('a tab whose reset runs out its budget is retired, and the next render gets another', async function (assert) {
      let first = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}stall-card`,
        auth: auth(),
      });
      assert.notOk(first.response.error, 'the card itself rendered');
      assert.false(first.pool.evicted, 'the render did not evict its tab');
      assert.true(
        (first.timings.resetMs ?? 0) >= DEFAULT_POST_RENDER_RESET_MS,
        `the visit waited out the whole budget (${first.timings.resetMs}ms)`,
      );
      assert.deepEqual(
        retired,
        [first.pool.pageId],
        'the runner retired the tab it could not reset',
      );

      let second = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}1`,
        auth: auth(),
      });
      assert.notStrictEqual(
        second.pool.pageId,
        first.pool.pageId,
        'the next render ran on a different tab',
      );
      assert.strictEqual(
        second.response.serialized?.data.attributes?.name,
        'Maple',
        'and rendered its card',
      );
    });

    test('a render that ends in an error still resets its tab', async function (assert) {
      let { response, pool, timings } = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}broken-card`,
        auth: auth(),
      });
      assert.ok(response.error, 'the render ended in an error');
      assert.false(pool.evicted, 'the error did not evict the tab');
      assert.strictEqual(
        typeof timings.resetMs,
        'number',
        'the errored visit reports its reset',
      );
      let page = pagesById.get(pool.pageId);
      assert.true(
        new URL(page!.url()).pathname.endsWith('/_standby'),
        `the tab is parked on the standby route (${page!.url()})`,
      );
      assert.deepEqual(retired, [], 'the reset tab was not retired');
    });

    test('a warm tab is still reused, and renders the next card, after its reset', async function (assert) {
      let first = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}1`,
        auth: auth(),
      });
      assert.strictEqual(
        first.response.serialized?.data.attributes?.name,
        'Maple',
      );
      let resetMs = first.timings.resetMs;
      assert.strictEqual(
        typeof resetMs,
        'number',
        'the visit reports the reset it waited out',
      );
      assert.true(
        resetMs! < DEFAULT_POST_RENDER_RESET_MS,
        `the reset landed inside its budget (${resetMs}ms)`,
      );
      let page = pagesById.get(first.pool.pageId);
      assert.true(
        new URL(page!.url()).pathname.endsWith('/_standby'),
        'the visit left its tab on the standby route',
      );

      let second = await prerenderCard(prerenderer, {
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: `${realmURL}2`,
        auth: auth(),
      });
      assert.true(second.pool.reused, 'the second visit reused the warm tab');
      assert.false(second.pool.evicted, 'the second visit was not evicted');
      assert.strictEqual(
        second.pool.pageId,
        first.pool.pageId,
        'same page reused',
      );
      assert.strictEqual(
        second.response.serialized?.data.attributes?.name,
        'Juniper',
        'the reused tab renders the next card',
      );
      assert.ok(
        second.response.isolatedHTML?.includes('Juniper'),
        'the reused tab captures the next card’s HTML',
      );

      let capture = await prerenderer.prerenderCapture({
        realm: realmURL,
        url: `${realmURL}1`,
        auth: auth(),
        format: 'isolated',
      });
      assert.strictEqual(
        capture.response.status,
        'ready',
        'a capture on the reset tab succeeds',
      );
    });
  });
});
