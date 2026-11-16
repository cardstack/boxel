import QUnit from 'qunit';
import type { Readable } from 'stream';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { PgAdapter } from '@cardstack/postgres';
import {
  param,
  query,
  ri,
  rri,
  type AutomationRun,
  type QueuePublisher,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  readAutomationRunReport,
  startAutomationPreview,
  startAutomationRunNow,
  type AutomationRunReport,
  type ManualRunRequest,
  type ManualRunStart,
} from '@cardstack/runtime-common/automation-manual-runs';
import type { AutomationActorOptions } from '@cardstack/runtime-common/automations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  automationFixture,
  ROOMY_AUTOMATION_CAPS,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { nodeStreamToBuffer } from '../stream.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// Preview and Run now end to end: a direct writer starts a run at once, its
// job is claimed by a worker that runs the script in a real prerender tab as
// the person who clicked, and the run's report answers what it staged or
// saved, its log, timings and cost.

const realmURL = new URL('http://127.0.0.1:4444/automation-manual-runs-test/');
const OWNER = '@manual-runs-owner:localhost';
const CLICKER = '@manual-runs-clicker:localhost';
const READER = '@manual-runs-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const SOURCE = 'application/vnd.card+source';

const WRITES = 'automation/writes';
const THROWS = 'automation/throws';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let virtualNetwork: VirtualNetwork;
  let options: AutomationActorOptions;

  setupCatalogTestSubset(hooks);
  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [CLICKER]: ['read', 'write'],
      [READER]: ['read'],
      // The realm's own user, which indexes it.
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      ...automationFixture({ operations: [], path: WRITES }),
      // Each run writes to a file named for when it was asked for, so one
      // test's commit can't stand in for another's.
      [`${WRITES}-script.js`]: [
        `let { dryRun, trigger, scheduledAt } = realm.current.automation;`,
        `await realm.fs.writeText('out/' + scheduledAt.replace(/[^0-9]/g, '') + '.txt', 'dryRun=' + dryRun + ' trigger=' + trigger.kind);`,
        `console.log('wrote it');`,
        `return 'ok';`,
      ].join('\n'),
      ...automationFixture({ operations: [], path: THROWS }),
      [`${THROWS}-script.js`]: [
        `await realm.fs.writeText('out/before-throw.txt', 'staged, never lands');`,
        `throw new Error('upstream said no');`,
      ].join('\n'),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      publisher = args.publisher;
      virtualNetwork = args.virtualNetwork;
      options = { matrixServerName: 'localhost', virtualNetwork };
    },
  });

  // The automation's declaration as the route reads it from the card's
  // index row.
  function declarationOf(path: string): AutomationDeclaration {
    return {
      url: rri(`${realm.url}${path}`),
      realmURL: realm.url,
      script: rri(`${realm.url}${path}-script.js`),
      triggers: [],
      operations: [],
      caps: ROOMY_AUTOMATION_CAPS,
      params: {},
      batchedAI: false,
      batchDeadlineMinutes: 60,
    };
  }

  function request(
    user: string,
    {
      path = WRITES,
      click = randomUUID(),
    }: { path?: string; click?: string } = {},
  ): ManualRunRequest {
    return {
      automationId: rri(`${realm.url}${path}`),
      realm: ri(realm.url),
      user,
      click,
      declaration: declarationOf(path),
    };
  }

  async function finished(start: ManualRunStart) {
    if (!start.ok) {
      throw new Error(`expected the run to start, got ${start.reason}`);
    }
    await start.job?.done;
    return start.run;
  }

  // The file the writing script names for the run.
  function fileOf(run: AutomationRun): string {
    return run.createdAt.replace(/[^0-9]/g, '');
  }

  async function reportFor(
    runId: string,
    user = CLICKER,
  ): Promise<AutomationRunReport> {
    let read = await readAutomationRunReport(
      dbAdapter,
      { runId, user },
      options,
    );
    if (!read.ok) {
      throw new Error(`expected a report, got ${read.reason}`);
    }
    return read.report;
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

  test('a Preview runs as the clicker, leaves the realm unchanged and answers the files it staged', async function (assert) {
    let run = await finished(
      await startAutomationPreview(
        { dbAdapter, queue: publisher },
        request(CLICKER),
        options,
      ),
    );
    let file = fileOf(run);
    let report = await reportFor(run.id);
    assert.strictEqual(
      report.run.state,
      'complete',
      `the Preview completes (${report.run.errorReason}: ${report.run.errorMessage})`,
    );
    assert.strictEqual(report.run.actsAs, CLICKER, 'it ran as the clicker');
    assert.true(report.run.dryRun, 'its row is a Preview');
    assert.strictEqual(report.run.commitStartedAt, null, 'it never committed');
    assert.strictEqual(
      await readFile(`out/${file}.txt`),
      undefined,
      'nothing reached the realm',
    );
    assert.deepEqual(
      report.stagedFiles?.map(({ path, size, content }) => ({
        path,
        size,
        text: new TextDecoder().decode(content),
      })),
      [
        {
          path: `out/${file}.txt`,
          size: 'dryRun=true trigger=manual'.length,
          text: 'dryRun=true trigger=manual',
        },
      ],
      'the report answers the batch the script staged',
    );
    assert.strictEqual(report.committedPaths, undefined);
    assert.ok(
      report.log.lines.some(
        (l) => l.kind === 'console' && l.message === 'wrote it',
      ),
      "the report carries the script's log",
    );
    assert.ok(
      report.log.lines.some((l) => l.kind === 'finish'),
      'and the platform line saying how the run ended',
    );
    assert.strictEqual(typeof report.timings.queuedMs, 'number');
    assert.strictEqual(typeof report.timings.runMs, 'number');
    assert.strictEqual(report.timings.commitMs, null);
    assert.deepEqual(
      {
        credits: report.cost.credits,
        callApiCalls: report.cost.callApiCalls,
        writes: report.cost.writes,
      },
      { credits: 0, callApiCalls: 0, writes: 0 },
      'a script that calls nothing outside costs nothing',
    );
  });

  test('Run now runs as the clicker and commits', async function (assert) {
    let run = await finished(
      await startAutomationRunNow(
        { dbAdapter, queue: publisher },
        request(CLICKER),
        options,
      ),
    );
    let file = fileOf(run);
    let report = await reportFor(run.id);
    assert.strictEqual(
      report.run.state,
      'complete',
      `the run completes (${report.run.errorReason}: ${report.run.errorMessage})`,
    );
    assert.strictEqual(report.run.actsAs, CLICKER, 'it ran as the clicker');
    assert.false(report.run.dryRun);
    assert.ok(report.run.committedAt, 'its commit landed');
    assert.strictEqual(
      await readFile(`out/${file}.txt`),
      'dryRun=false trigger=manual',
      "the script's write is in the realm",
    );
    assert.deepEqual(report.committedPaths, [`out/${file}.txt`]);
    assert.strictEqual(report.stagedFiles, undefined);
    assert.strictEqual(report.cost.writes, 1, 'the commit counted its file');
    assert.strictEqual(typeof report.timings.commitMs, 'number');
  });

  test('a Preview whose script throws keeps nothing it staged', async function (assert) {
    let run = await finished(
      await startAutomationPreview(
        { dbAdapter, queue: publisher },
        request(CLICKER, { path: THROWS }),
        options,
      ),
    );
    let report = await reportFor(run.id);
    assert.strictEqual(report.run.state, 'error');
    assert.strictEqual(report.run.errorReason, 'script-error');
    assert.strictEqual(report.stagedFiles, undefined);
    let [{ count }] = await query(dbAdapter, [
      'SELECT count(*)::int AS count FROM run_overlay_files WHERE run_id =',
      param(run.id),
    ]);
    assert.strictEqual(count, 0, 'its overlay was discarded');
    assert.strictEqual(await readFile('out/before-throw.txt'), undefined);
  });

  test("a clicker's newer Preview replaces the batch their earlier one kept, and leaves other people's", async function (assert) {
    let ctx = { dbAdapter, queue: publisher };
    let owners = await finished(
      await startAutomationPreview(ctx, request(OWNER), options),
    );
    let first = await finished(
      await startAutomationPreview(ctx, request(CLICKER), options),
    );
    assert.strictEqual(
      (await reportFor(first.id)).stagedFiles?.length,
      1,
      'the first Preview keeps its batch',
    );
    let second = await finished(
      await startAutomationPreview(ctx, request(CLICKER), options),
    );
    assert.strictEqual((await reportFor(second.id)).stagedFiles?.length, 1);
    assert.deepEqual(
      (await reportFor(first.id)).stagedFiles,
      [],
      "the newer Preview discarded the earlier one's batch",
    );
    assert.strictEqual(
      (await reportFor(owners.id, OWNER)).stagedFiles?.length,
      1,
      "another person's Preview keeps its batch",
    );
  });

  test('the same click answers the run it started, and no one else can take it', async function (assert) {
    let ctx = { dbAdapter, queue: publisher };
    let click = randomUUID();
    let first = await startAutomationPreview(
      ctx,
      request(CLICKER, { click }),
      options,
    );
    let run = await finished(first);
    let again = await startAutomationPreview(
      ctx,
      request(CLICKER, { click }),
      options,
    );
    assert.true(again.ok);
    if (again.ok) {
      assert.strictEqual(again.run.id, run.id, 'one click is one run');
      assert.strictEqual(
        again.job,
        undefined,
        'a finished run is not enqueued again',
      );
    }
    assert.deepEqual(
      await startAutomationPreview(ctx, request(OWNER, { click }), options),
      { ok: false, reason: 'click-reused' },
      "another person's click can't answer the clicker's run",
    );
    assert.deepEqual(
      await startAutomationRunNow(ctx, request(CLICKER, { click }), options),
      { ok: false, reason: 'click-reused' },
      "a Run now can't reuse a Preview's click",
    );
  });

  test("someone who isn't a direct writer can't start a Preview or Run now, and nothing is enqueued", async function (assert) {
    let ctx = { dbAdapter, queue: publisher };
    let click = randomUUID();
    assert.deepEqual(
      await startAutomationPreview(ctx, request(READER, { click }), options),
      { ok: false, reason: 'not-a-direct-writer' },
    );
    assert.deepEqual(
      await startAutomationRunNow(ctx, request(READER, { click }), options),
      { ok: false, reason: 'not-a-direct-writer' },
    );
    let [{ count }] = await query(dbAdapter, [
      'SELECT count(*)::int AS count FROM automation_runs WHERE slot =',
      param(click),
    ]);
    assert.strictEqual(count, 0, 'no run row was made');
    assert.deepEqual(
      await readAutomationRunReport(
        dbAdapter,
        {
          runId: (
            await finished(
              await startAutomationPreview(ctx, request(CLICKER), options),
            )
          ).id,
          user: READER,
        },
        options,
      ),
      { ok: false, reason: 'not-a-direct-writer' },
      "a reader can't read a run's report",
    );
  });

  test("Preview and Run now refuse a realm the automation isn't in, and another card's declaration", async function (assert) {
    let ctx = { dbAdapter, queue: publisher };
    assert.deepEqual(
      await startAutomationRunNow(
        ctx,
        { ...request(CLICKER), realm: ri('http://127.0.0.1:4444/elsewhere/') },
        options,
      ),
      { ok: false, reason: 'outside-realm' },
    );
    assert.deepEqual(
      await startAutomationPreview(
        ctx,
        { ...request(CLICKER), declaration: declarationOf(THROWS) },
        options,
      ),
      { ok: false, reason: 'other-card' },
    );
  });
});
