import QUnit from 'qunit';
import type { Readable } from 'stream';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getLedgerEntries,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import {
  createAutomationRun,
  finishAutomationRun,
  param,
  query,
  ri,
  rri,
  startAutomationRunAttempt,
  type AutomationRun,
  type QueuePublisher,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  readAutomationPreviewFile,
  readAutomationRunReport,
  startAutomationPreview,
  startAutomationRunNow,
  type AutomationRunReport,
  type ManualRunRequest,
  type ManualRunStart,
} from '@cardstack/runtime-common/automation-manual-runs';
import type { AutomationActorOptions } from '@cardstack/runtime-common/automations';
import { stageRunOverlayFile } from '@cardstack/runtime-common/run-overlay';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  automationFixture,
  ensureTestUser,
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
const SLOW = 'automation/slow';

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
        `return 'ok';`,
      ].join('\n'),
      ...automationFixture({ operations: [], path: THROWS }),
      [`${THROWS}-script.js`]: [
        `await realm.fs.writeText('out/before-throw.txt', 'staged, never lands');`,
        `throw new Error('upstream said no');`,
      ].join('\n'),
      // Holds the automation's concurrency group for its 5 s time limit, so
      // a run of it queued behind stays pending meanwhile.
      ...automationFixture({
        operations: [],
        path: SLOW,
        caps: { seconds: 5 },
      }),
      // Indexing also loads this file as a module in the prerender tab, where
      // `realm` isn't defined. Naming it first makes that load throw before
      // the loop, so the template build doesn't wait out the render timeout.
      [`${SLOW}-script.js`]: [`void realm;`, `while (true) {}`].join('\n'),
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
      report.stagedFiles,
      [
        {
          path: `out/${file}.txt`,
          size: 'dryRun=true trigger=manual'.length,
        },
      ],
      'the report lists the batch the script staged',
    );
    let staged = await readAutomationPreviewFile(
      dbAdapter,
      { runId: run.id, path: `out/${file}.txt`, user: CLICKER },
      options,
    );
    assert.deepEqual(
      staged.ok ? new TextDecoder().decode(staged.content) : staged,
      'dryRun=true trigger=manual',
      'and a staged file reads back with the text the script wrote',
    );
    assert.deepEqual(
      await readAutomationPreviewFile(
        dbAdapter,
        { runId: run.id, path: `out/${file}.txt`, user: READER },
        options,
      ),
      { ok: false, reason: 'not-a-direct-writer' },
      "a reader can't read a staged file",
    );
    assert.strictEqual(report.stagedFilesReplacedBy, undefined);
    assert.strictEqual(report.committedPaths, undefined);
    assert.ok(
      report.log.lines.some((l) => l.kind === 'finish'),
      'the report carries the run log, ending with how the run ended',
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

  test("Run now charges the run's compute to the clicker, not the automation's owner", async function (assert) {
    await ensureTestUser(dbAdapter, CLICKER);
    await ensureTestUser(dbAdapter, OWNER);
    let clicker = (await getUserByMatrixUserId(dbAdapter, CLICKER))!;
    let owner = (await getUserByMatrixUserId(dbAdapter, OWNER))!;
    for (let user of [clicker, owner]) {
      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: 10_000,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
    }
    let run = await finished(
      await startAutomationRunNow(
        { dbAdapter, queue: publisher },
        request(CLICKER),
        options,
      ),
    );

    let charges = await getLedgerEntries(dbAdapter, {
      runId: run.id,
      chargeKind: 'run',
    });
    assert.true(charges.length > 0, "the run's compute is charged");
    assert.true(
      charges.every((e) => e.userId === clicker.id),
      'to the person who clicked',
    );
    assert.deepEqual(
      await getLedgerEntries(dbAdapter, {
        userId: owner.id,
        chargeKind: 'run',
      }),
      [],
      "and nothing to the automation's owner",
    );
    let report = await reportFor(run.id);
    assert.true(report.run.prerenderTabMs > 0, 'the row holds its tab time');
    assert.strictEqual(
      report.cost.creditsByKind.run,
      -charges.reduce((sum, e) => sum + e.creditAmount, 0),
      "the run's report answers what it cost",
    );
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
    let [{ kept, staged }] = await query(dbAdapter, [
      'SELECT (SELECT count(*)::int FROM automation_preview_files WHERE run_id =',
      param(run.id),
      ') AS kept, (SELECT count(*)::int FROM run_overlay_files WHERE run_id =',
      param(run.id),
      ') AS staged',
    ]);
    assert.strictEqual(kept, 0, 'no batch was kept');
    assert.strictEqual(staged, 0, 'its overlay was discarded');
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
    let firstReport = await reportFor(first.id);
    assert.deepEqual(
      firstReport.stagedFiles,
      [],
      "the newer Preview discarded the earlier one's batch",
    );
    assert.strictEqual(
      firstReport.stagedFilesReplacedBy,
      second.id,
      'and the earlier report names the Preview that replaced it',
    );
    assert.strictEqual(
      (await reportFor(owners.id, OWNER)).stagedFiles?.length,
      1,
      "another person's Preview keeps its batch",
    );
  });

  test('a Preview that finishes after a later one has completed keeps nothing', async function (assert) {
    let automationId = rri(`${realm.url}${WRITES}`);
    let preview = (slot: string) =>
      createAutomationRun(dbAdapter, {
        automationId,
        realm: ri(realm.url),
        trigger: 'manual',
        slot,
        actsAs: CLICKER,
        dryRun: true,
      });
    // Asked for in this order; the later one's attempt finishes first.
    let earlier = await preview(randomUUID());
    let later = await preview(randomUUID());
    for (let [run, attempt] of [
      [later, 2],
      [earlier, 1],
    ] as const) {
      await startAutomationRunAttempt(dbAdapter, run.id, attempt);
      await stageRunOverlayFile(
        dbAdapter,
        { runId: run.id, attempt },
        `out/${run.id}.txt`,
        new TextEncoder().encode('staged'),
        10,
      );
      await finishAutomationRun(dbAdapter, run.id, attempt, {
        state: 'complete',
      });
    }
    assert.deepEqual(
      (await reportFor(later.id)).stagedFiles?.map(({ path }) => path),
      [`out/${later.id}.txt`],
      'the later Preview keeps its batch',
    );
    let earlierReport = await reportFor(earlier.id);
    assert.deepEqual(earlierReport.stagedFiles, []);
    assert.strictEqual(
      earlierReport.stagedFilesReplacedBy,
      later.id,
      'the earlier Preview, finishing last, keeps nothing and names the later one',
    );
  });

  test('a click sent again while its run is pending joins the job it enqueued', async function (assert) {
    let ctx = { dbAdapter, queue: publisher };
    // A slow run holds the automation's concurrency group, so the click's
    // run stays pending behind it.
    let holding = await startAutomationRunNow(
      ctx,
      request(CLICKER, { path: SLOW }),
      options,
    );
    let click = randomUUID();
    let first = await startAutomationPreview(
      ctx,
      request(CLICKER, { path: SLOW, click }),
      options,
    );
    let again = await startAutomationPreview(
      ctx,
      request(CLICKER, { path: SLOW, click }),
      options,
    );
    if (!first.ok || !again.ok) {
      throw new Error('expected both sends to answer the run');
    }
    assert.strictEqual(again.run.id, first.run.id, 'one click is one run');
    assert.strictEqual(again.run.state, 'pending');
    assert.ok(first.job, 'the first send enqueued the run');
    assert.strictEqual(
      again.job?.id,
      first.job?.id,
      'the second send joined the job the first enqueued',
    );
    await finished(holding);
    await finished(first);
    let after = await reportFor(first.run.id);
    assert.strictEqual(
      after.log.lines.filter((l) => l.kind === 'finish').length,
      1,
      'the run ran once',
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
