import QUnit from 'qunit';
import type { Readable } from 'stream';
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
