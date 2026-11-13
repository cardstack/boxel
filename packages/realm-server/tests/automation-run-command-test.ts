import QUnit from 'qunit';
import type { Readable } from 'stream';
import type { Page } from 'puppeteer';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createAutomationRun,
  getAutomationRun,
  ri,
  rri,
  type AutomationRun,
  type QueuePublisher,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { enqueueAutomationRunJob } from '@cardstack/runtime-common/jobs/run-command';
import { inMemorySessionsGlobal } from '@cardstack/runtime-common/in-memory-sessions';
import { PagePool } from '../prerender/page-pool.ts';
import { isRunAffinityKey } from '../prerender/affinity.ts';
import {
  automationFixture,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { nodeStreamToBuffer } from '../stream.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// An automation run end to end: its job is claimed by a worker, which sends
// the script to a real prerender tab on the run's own affinity. There the
// automation command runs it on Realm Runner's automation surface with the
// run's token, the worker commits what it staged, and the run row says how it
// ended.

const realmURL = new URL('http://127.0.0.1:4444/automation-run-command-test/');
const OWNER = '@run-command-owner:localhost';
const REALM_USER = '@node-test_realm:localhost';
const SOURCE = 'application/vnd.card+source';

// Keeps every tab the pool hands an automation run, so a test can read what
// the tab holds once the run has answered. Answers the tabs and how to stop.
function keepRunTabs(): { tabs: Set<Page>; restore: () => void } {
  let originalGetPage = PagePool.prototype.getPage;
  let tabs = new Set<Page>();
  PagePool.prototype.getPage = async function (
    this: PagePool,
    ...args: Parameters<PagePool['getPage']>
  ) {
    let pageInfo = await originalGetPage.apply(this, args);
    if (isRunAffinityKey(args[0])) {
      tabs.add(pageInfo.page);
    }
    return pageInfo;
  } as PagePool['getPage'];
  return {
    tabs,
    restore: () => {
      PagePool.prototype.getPage = originalGetPage;
    },
  };
}

// The claims of every JWT in `text`.
function jwtClaimsIn(text: string): Record<string, unknown>[] {
  let claims: Record<string, unknown>[] = [];
  for (let [token] of text.matchAll(
    /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
  )) {
    try {
      claims.push(
        JSON.parse(
          Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
        ),
      );
    } catch {
      // not a JWT after all
    }
  }
  return claims;
}

const WRITES = 'automation/writes';
const THROWS = 'automation/throws';
const SLOW = 'automation/slow';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let virtualNetwork: VirtualNetwork;

  setupCatalogTestSubset(hooks);
  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      // The realm's own user, which indexes it.
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      ...automationFixture({ operations: [], path: WRITES }),
      [`${WRITES}-script.js`]: [
        `let kind = realm.current.automation.trigger.kind;`,
        `await realm.fs.writeText('out/from-run.txt', 'written by a ' + kind + ' run');`,
        `return 'ok';`,
      ].join('\n'),
      ...automationFixture({ operations: [], path: THROWS }),
      [`${THROWS}-script.js`]: [
        `await realm.fs.writeText('out/before-throw.txt', 'staged, never lands');`,
        `throw new Error('upstream said no');`,
      ].join('\n'),
      ...automationFixture({
        operations: [],
        path: SLOW,
        caps: { seconds: 3 },
      }),
      [`${SLOW}-script.js`]: [
        `await realm.fs.writeText('out/before-loop.txt', 'staged, never lands');`,
        `while (true) {}`,
      ].join('\n'),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      publisher = args.publisher;
      virtualNetwork = args.virtualNetwork;
    },
  });

  async function runAutomation(
    path: string,
    secondsCap: number,
  ): Promise<AutomationRun> {
    let run = await createAutomationRun(dbAdapter, {
      automationId: rri(`${realm.url}${path}`),
      realm: ri(realm.url),
      trigger: 'manual',
      slot: randomUUID(),
      actsAs: OWNER,
    });
    let job = await enqueueAutomationRunJob(publisher, {
      automationId: run.automationId,
      realmURL: realm.url,
      actsAs: OWNER,
      trigger: run.trigger,
      slot: run.slot,
      secondsCap,
      input: {
        runId: run.id,
        scheduledAt: new Date().toISOString(),
        dryRun: false,
        triggerKind: 'manual',
      },
    });
    await job.done;
    return (await getAutomationRun(dbAdapter, run.id))!;
  }

  async function readFile(path: string): Promise<string | undefined> {
    let sessions = JSON.parse(
      testCreatePrerenderAuth(OWNER, { [realm.url]: ['read', 'write'] }),
    ) as Record<string, string>;
    let response = await virtualNetwork.fetch(`${realm.url}${path}`, {
      headers: {
        Accept: SOURCE,
        Authorization: `Bearer ${sessions[realm.url]}`,
      },
    });
    if (!response.ok) {
      return undefined;
    }
    let { nodeStream } = response as Response & { nodeStream?: Readable };
    return nodeStream
      ? (await nodeStreamToBuffer(nodeStream)).toString('utf8')
      : await response.text();
  }

  test('a script that writes commits through its overlay', async function (assert) {
    let run = await runAutomation(WRITES, 600);
    assert.strictEqual(
      run.state,
      'complete',
      `the run completes (${run.errorReason}: ${run.errorMessage})`,
    );
    assert.ok(run.committedAt, 'its commit landed');
    assert.ok(run.scriptHash, 'its script is recorded');
    assert.strictEqual(
      await readFile('out/from-run.txt'),
      'written by a manual run',
      "the script's write is in the realm, and it saw its run context",
    );
  });

  test("a run's token never reaches its tab's storage or cookies, and is gone from the tab once the run answers", async function (assert) {
    let { tabs, restore } = keepRunTabs();
    let run: AutomationRun;
    try {
      run = await runAutomation(WRITES, 600);
    } finally {
      restore();
    }
    // The automation command refuses to run without a run token for its
    // realm, so a complete run is one whose token reached the tab.
    assert.strictEqual(
      run.state,
      'complete',
      `the run completes (${run.errorReason}: ${run.errorMessage})`,
    );
    assert.strictEqual(tabs.size, 1, 'the run ran in one tab');
    for (let tab of tabs) {
      let held = await tab.evaluate((sessionsGlobal: string) => {
        let storage: Record<string, string | null> = {};
        for (let i = 0; i < localStorage.length; i++) {
          let key = localStorage.key(i)!;
          storage[key] = localStorage.getItem(key);
        }
        return {
          storage,
          documentCookie: document.cookie,
          inMemorySessions: (globalThis as any)[sessionsGlobal] ?? null,
        };
      }, inMemorySessionsGlobal);
      let cookies = await tab.browserContext().cookies();
      assert.false(
        'boxel-session' in held.storage,
        "the tab's storage holds no sessions",
      );
      let runTokens = [
        ...Object.entries(held.storage).flatMap(([key, value]) =>
          jwtClaimsIn(`${key} ${value ?? ''}`),
        ),
        ...jwtClaimsIn(held.documentCookie),
        ...cookies.flatMap((cookie) =>
          jwtClaimsIn(`${cookie.name} ${cookie.value}`),
        ),
      ].filter((claims) => claims.run !== undefined);
      assert.deepEqual(
        runTokens,
        [],
        "no run token is in the tab's storage or its cookies",
      );
      assert.strictEqual(
        held.inMemorySessions,
        null,
        "the run's in-memory sessions are dropped once it answers",
      );
    }
  });

  test('a script that throws commits nothing and records its line', async function (assert) {
    let run = await runAutomation(THROWS, 600);
    assert.strictEqual(run.state, 'error');
    assert.strictEqual(run.errorReason, 'script-error');
    assert.ok(
      run.errorMessage?.startsWith('line 2:'),
      `the error names the line that threw: ${run.errorMessage}`,
    );
    assert.ok(run.errorMessage?.includes('upstream said no'));
    assert.strictEqual(run.commitStartedAt, null, 'no commit was claimed');
    assert.strictEqual(
      await readFile('out/before-throw.txt'),
      undefined,
      'what it staged before throwing never landed',
    );
  });

  test('a script that runs past its time limit is stopped and records the timeout', async function (assert) {
    let started = Date.now();
    let run = await runAutomation(SLOW, 3);
    assert.ok(
      Date.now() - started < 60_000,
      'the run is stopped near its 3-second limit, not left to the render timeout',
    );
    assert.strictEqual(run.state, 'error');
    assert.strictEqual(run.errorReason, 'timed-out');
    assert.ok(
      run.errorMessage?.includes('time limit'),
      `the error says it reached its time limit: ${run.errorMessage}`,
    );
    assert.strictEqual(
      await readFile('out/before-loop.txt'),
      undefined,
      'what it staged never landed',
    );
  });
});
