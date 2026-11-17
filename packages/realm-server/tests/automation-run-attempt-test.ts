import QUnit from 'qunit';
import type { Readable } from 'stream';
const { module, test } = QUnit;
import { basename } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { PgAdapter } from '@cardstack/postgres';
import {
  AUTOMATION_COMMAND,
  automationRunDedupeKey,
  createAutomationRun,
  getAutomationRun,
  logger,
  param,
  query,
  ri,
  rri,
  runAutomationAttempt,
  CachingDefinitionLookup,
  type AutomationJobInput,
  type AutomationRun,
  type AutomationScriptInput,
  type AutomationScriptOutcome,
  type JobInfo,
  type Prerenderer,
  type Realm,
  type RunCommandArgs,
  type RunCommandResponse,
  type RealmAdapter,
  type ReportRunChange,
  type VirtualNetwork,
  insertRealmEventRoom,
  runChangeReporter,
  upsertSessionRoom,
} from '@cardstack/runtime-common';
import type { JobEventContent } from '@cardstack/base/matrix-event';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { presentsAsRunToken } from '@cardstack/runtime-common/run-token';
import {
  setAutomationRunTelemetrySink,
  type AutomationRunEvent,
} from '@cardstack/runtime-common/automation-run-telemetry';
import {
  RUN_LOG_PATH,
  setRunLogLokiSink,
} from '@cardstack/runtime-common/automation-run-log';
import {
  setAutomationMilestoneSink,
  type AutomationMilestoneEvent,
} from '@cardstack/runtime-common/automation-run-milestones';
import { runOverlayFiles } from '@cardstack/runtime-common/run-overlay';
import type { MeteredCharges } from '@cardstack/runtime-common/metered-charges';
import {
  addToCreditsLedger,
  getLedgerEntries,
  getUserByMatrixUserId,
  getLedgerUsage,
} from '@cardstack/billing/billing-queries';
import {
  TEST_AUTOMATION_PATH,
  automationFixture,
  ensureTestUser,
  waitUntil,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testAutomationAdmissionChecks,
  testCreatePrerenderAuth,
  testPricing,
} from './helpers/index.ts';
import { meteredChargesFor } from '../lib/metered-charge.ts';
import { nodeStreamToBuffer } from '../stream.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { buildMintRunToken, verifyRunToken } from '../lib/run-token.ts';

// One attempt of an automation run, from the worker's side: the run is taken
// through its row, its script is read with the run's token and its hash
// recorded, and the script goes to a tab on the run's own affinity with the
// run's token as the tab's only session. When the script finishes, the
// worker commits the run's overlay as one batch; when it throws or runs out
// of time, nothing it staged lands and the run records why. The tab is
// stubbed here: it stages what a script would, with the token it was given,
// and answers the outcome the automation command answers.

const realmURL = new URL('http://127.0.0.1:4444/automation-run-attempt-test/');
const OWNER = '@attempt-owner:localhost';
const SCRIPT = `realm.current.automation;
await realm.fs.writeText('out/result.txt', 'from the run');
return 'done';
`;
const SCRIPT_PATH = `${TEST_AUTOMATION_PATH}-script.js`;
const REALM_USER = '@node-test_realm:localhost';
const READER = '@attempt-reader:localhost';
const SOURCE = 'application/vnd.card+source';

const log = logger('automation-run-attempt-test');

interface TabCall {
  args: RunCommandArgs;
  token: string;
  input: AutomationScriptInput;
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let realmAdapter: RealmAdapter;
  let dbAdapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  setupCatalogTestSubset(hooks);
  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [READER]: ['read'],
      // The realm's own user, which indexes it.
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      ...automationFixture({ operations: [], caps: { seconds: 300 } }),
      [SCRIPT_PATH]: SCRIPT,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      realmAdapter = args.testRealmAdapter;
      dbAdapter = args.dbAdapter;
      virtualNetwork = args.virtualNetwork;
    },
  });

  async function newRun({
    dryRun = false,
  }: { dryRun?: boolean } = {}): Promise<AutomationRun> {
    return await createAutomationRun(dbAdapter, {
      automationId: rri(`${realm.url}${TEST_AUTOMATION_PATH}`),
      realm: ri(realm.url),
      trigger: 'manual',
      slot: randomUUID(),
      actsAs: OWNER,
      dryRun,
    });
  }

  // A tab that stages `writes` with the token it was handed, as the script
  // would, and then answers `answer`.
  function stubTab(
    calls: TabCall[],
    {
      writes = {},
      answer,
    }: {
      writes?: Record<string, string>;
      answer: (() => RunCommandResponse) | AutomationScriptOutcome;
    },
  ): Prerenderer {
    return {
      async runCommand(args: RunCommandArgs) {
        let sessions = JSON.parse(args.auth) as Record<string, string>;
        let token = sessions[realm.url];
        calls.push({
          args,
          token,
          input: (args.commandInput as { json: AutomationScriptInput }).json,
        });
        for (let [path, content] of Object.entries(writes)) {
          let response = await virtualNetwork.fetch(`${realm.url}${path}`, {
            method: 'POST',
            headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
            body: content,
          });
          if (!response.ok) {
            throw new Error(
              `staging ${path} failed: ${response.status} ${await response.text()}`,
            );
          }
        }
        if (typeof answer === 'function') {
          return answer();
        }
        return {
          status: 'ready',
          cardResultString: JSON.stringify({
            data: { type: 'card', attributes: { json: answer } },
          }),
        };
      },
    } as unknown as Prerenderer;
  }

  async function attempt(
    run: AutomationRun,
    prerenderer: Prerenderer,
    {
      input = {},
      dedupeKey = automationRunDedupeKey(run),
      jobId = 1,
      reservationId = 7,
      queueWaitMs = null,
      concurrencyGroup = null,
      commit,
      meteredCharges,
      workerLog = log,
      reportRunChange,
    }: {
      input?: Partial<AutomationJobInput>;
      dedupeKey?: string | null;
      jobId?: number;
      reservationId?: number;
      queueWaitMs?: number | null;
      concurrencyGroup?: string | null;
      // The worker's logger, which an attempt writes its own lines to.
      workerLog?: Parameters<typeof runAutomationAttempt>[0]['log'];
      // Stands in for the network on the worker's commit requests only;
      // `send` sends one to the realm.
      commit?: (send: () => Promise<Response>) => Promise<Response>;
      meteredCharges?: MeteredCharges;
      reportRunChange?: ReportRunChange;
    } = {},
  ) {
    let network = commit
      ? (new Proxy(virtualNetwork, {
          get(target, property) {
            if (property === 'fetch') {
              return (url: string | URL | Request, init?: RequestInit) => {
                let href = String(url instanceof Request ? url.url : url);
                let send = () => target.fetch(url, init);
                return href.endsWith('_run-commit') ? commit(send) : send();
              };
            }
            let value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as VirtualNetwork)
      : virtualNetwork;
    let jobInfo: JobInfo = {
      jobId,
      reservationId,
      priority: 5,
      queueWaitMs,
      concurrencyGroup,
      laneFamily: null,
    };
    let definitionLookup = new CachingDefinitionLookup(
      dbAdapter,
      prerenderer,
      virtualNetwork,
      testCreatePrerenderAuth,
    );
    return await runAutomationAttempt(
      {
        dbAdapter,
        definitionLookup,
        virtualNetwork: network,
        prerenderer,
        mintRunToken: buildMintRunToken(realmSecretSeed),
        matrixServerName: 'localhost',
        admissionChecks: testAutomationAdmissionChecks,
        meteredCharges,
        reportRunChange,
        log: workerLog,
      },
      {
        runId: run.id,
        scheduledAt: '2026-11-13T06:00:00.000Z',
        dryRun: false,
        triggerKind: 'manual',
        ...input,
      },
      dedupeKey,
      jobInfo,
    );
  }

  async function readFile(path: string): Promise<string | undefined> {
    let response = await virtualNetwork.fetch(`${realm.url}${path}`, {
      headers: {
        Accept: SOURCE,
        Authorization: `Bearer ${ownerSession()}`,
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

  function ownerSession() {
    let sessions = JSON.parse(
      testCreatePrerenderAuth(OWNER, { [realm.url]: ['read', 'write'] }),
    ) as Record<string, string>;
    return sessions[realm.url];
  }

  async function overlayCount(runId: string) {
    let [{ n }] = (await dbAdapter.execute(
      `SELECT count(*)::int AS n FROM run_overlay_files WHERE run_id = $1`,
      { bind: [runId] },
    )) as { n: number }[];
    return n;
  }

  test('a script that writes commits what it staged, and the run records its script', async function (assert) {
    let run = await newRun();
    let calls: TabCall[] = [];
    let result = await attempt(
      run,
      stubTab(calls, {
        writes: { 'out/result.txt': 'from the run' },
        answer: { state: 'complete' },
      }),
    );

    assert.deepEqual(result, { state: 'complete' }, 'the attempt completes');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'complete');
    assert.ok(after?.committedAt, 'the commit is recorded');
    assert.strictEqual(
      after?.scriptHash,
      createHash('sha256').update(SCRIPT).digest('hex'),
      'the hash of the text the run ran is on the row',
    );
    assert.strictEqual(
      after?.scriptId,
      rri(`${realm.url}${SCRIPT_PATH}`),
      'the script file is on the row',
    );
    assert.strictEqual(
      await readFile('out/result.txt'),
      'from the run',
      'the staged file landed in the realm',
    );
    assert.strictEqual(await overlayCount(run.id), 0, 'the overlay is gone');

    assert.strictEqual(calls.length, 1, 'the script ran once');
    let [{ args, token, input }] = calls;
    assert.strictEqual(args.command, AUTOMATION_COMMAND);
    assert.strictEqual(
      args.runRealm,
      realm.url,
      "the run goes to its realm's run affinity",
    );
    assert.deepEqual(
      Object.keys(JSON.parse(args.auth)),
      [realm.url],
      "the tab holds a session for the automation's realm and nothing else",
    );
    assert.ok(presentsAsRunToken(token), 'that session is a run token');
    let claims = verifyRunToken(token, realmSecretSeed);
    assert.strictEqual(claims?.runId, run.id, 'the token names the run');
    assert.strictEqual(claims?.attempt, 7, 'and the attempt');
    assert.strictEqual(claims?.actsAs, OWNER, "and acts as the run's identity");
    let timeoutMs = args.timeoutMs!;
    let inWindow = timeoutMs > 290_000 && timeoutMs <= 330_000;
    assert.true(
      inWindow,
      `the tab is given the run's time limit plus a grace, not the render timeout (${timeoutMs})`,
    );
    assert.strictEqual(input.code, SCRIPT, 'the tab runs the script file');
    assert.strictEqual(input.realmURL, realm.url);
    let capInWindow = input.secondsCap > 290 && input.secondsCap <= 300;
    assert.true(
      capInWindow,
      'the tab holds the script to what is left of the time limit',
    );
    let started = Date.parse(after!.startedAt!);
    assert.strictEqual(
      Date.parse(input.endsAt),
      started + 300_000,
      "the tab is told when the run's time limit passes, counted from its start",
    );
    assert.deepEqual(input.automation.trigger, {
      label: 'manual',
      kind: 'manual',
    });
    assert.strictEqual(
      input.automation.url,
      `${realm.url}${TEST_AUTOMATION_PATH}`,
    );
    assert.false(input.automation.dryRun);
    assert.strictEqual(
      input.automation.scheduledAt,
      '2026-11-13T06:00:00.000Z',
    );
    assert.strictEqual(
      input.automation.lastSuccessAt,
      undefined,
      'a first run has no last success',
    );

    let second = await newRun();
    let secondCalls: TabCall[] = [];
    await attempt(
      second,
      stubTab(secondCalls, { answer: { state: 'complete' } }),
    );
    let firstStartedAt = after?.startedAt;
    assert.strictEqual(
      secondCalls[0].input.automation.lastSuccessAt,
      firstStartedAt,
      'the next run is told when the last complete run started',
    );
  });

  test('a script that throws commits nothing and records its line', async function (assert) {
    let run = await newRun();
    let result = await attempt(
      run,
      stubTab([], {
        writes: { 'out/thrown.txt': 'never lands' },
        answer: {
          state: 'error',
          reason: 'script-error',
          message: 'Error: upstream said no',
          line: 3,
        },
      }),
    );
    assert.strictEqual(result.state, 'error');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'error');
    assert.strictEqual(after?.errorReason, 'script-error');
    assert.strictEqual(
      after?.errorMessage,
      'line 3: Error: upstream said no',
      "the error names the script's line",
    );
    assert.strictEqual(after?.commitStartedAt, null, 'no commit was claimed');
    assert.strictEqual(
      await readFile('out/thrown.txt'),
      undefined,
      'nothing the script staged reached the realm',
    );
    assert.strictEqual(await overlayCount(run.id), 0, 'the overlay is gone');
  });

  test('a script that runs out of time is stopped and records the time limit', async function (assert) {
    let run = await newRun();
    await attempt(
      run,
      stubTab([], {
        writes: { 'out/late.txt': 'never lands' },
        answer: {
          state: 'error',
          reason: 'timed-out',
          message:
            'The automation run reached its time limit of 300 s (its seconds cap)',
        },
      }),
    );
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'error');
    assert.strictEqual(after?.errorReason, 'timed-out');
    assert.strictEqual(await readFile('out/late.txt'), undefined);
    assert.strictEqual(await overlayCount(run.id), 0);
  });

  test("a tab that never answers ends the run as timed out, and the token doesn't reach the row", async function (assert) {
    let run = await newRun();
    let calls: TabCall[] = [];
    await attempt(
      run,
      stubTab(calls, {
        answer: () => ({
          status: 'unusable',
          error: `render timed out holding ${calls[0].token}`,
        }),
      }),
    );
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.errorReason, 'timed-out');
    assert.notOk(
      after?.errorMessage?.includes(calls[0].token),
      'the run token is redacted from the message',
    );
    assert.ok(after?.errorMessage?.includes('[REDACTED]'));
  });

  test('a commit whose answer is lost is sent again, and the run completes', async function (assert) {
    let run = await newRun();
    let sends = 0;
    await attempt(
      run,
      stubTab([], {
        writes: { 'out/lost-answer.txt': 'landed once' },
        answer: { state: 'complete' },
      }),
      {
        async commit(send) {
          sends++;
          let response = await send();
          if (sends === 1) {
            await response.text();
            throw new Error('socket hang up');
          }
          return response;
        },
      },
    );
    assert.strictEqual(sends, 2, 'the commit was sent again');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'complete');
    assert.ok(after?.committedAt);
    assert.strictEqual(await readFile('out/lost-answer.txt'), 'landed once');
  });

  test("a commit whose every answer is lost finishes from the run's row", async function (assert) {
    let run = await newRun();
    let sends = 0;
    await attempt(
      run,
      stubTab([], {
        writes: { 'out/all-lost.txt': 'landed' },
        answer: { state: 'complete' },
      }),
      {
        async commit(send) {
          sends++;
          let response = await send();
          await response.text();
          throw new Error('socket hang up');
        },
      },
    );
    assert.strictEqual(
      sends,
      3,
      'the commit was sent as many times as allowed',
    );
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(
      after?.state,
      'complete',
      'the batch landed, so the run is complete rather than left running',
    );
    assert.strictEqual(await readFile('out/all-lost.txt'), 'landed');
  });

  test('a commit refused because a write was staged while it started is sent again', async function (assert) {
    let run = await newRun();
    let sends = 0;
    await attempt(
      run,
      stubTab([], {
        writes: { 'out/raced.txt': 'after the race' },
        answer: { state: 'complete' },
      }),
      {
        async commit(send) {
          sends++;
          if (sends === 1) {
            return new Response(
              JSON.stringify({
                errors: [{ code: 'overlay-changed', detail: 'staged since' }],
              }),
              { status: 409 },
            );
          }
          return await send();
        },
      },
    );
    assert.strictEqual(sends, 2);
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'complete');
    assert.strictEqual(await readFile('out/raced.txt'), 'after the race');
  });

  test("a Preview runs the script, commits nothing, keeps a copy of its batch, and is never the automation's last success", async function (assert) {
    let preview = await newRun({ dryRun: true });
    let calls: TabCall[] = [];
    await attempt(
      preview,
      stubTab(calls, {
        writes: { 'out/kept.txt': 'the batch a Preview shows' },
        answer: { state: 'complete' },
      }),
      { input: { dryRun: true } },
    );
    assert.true(calls[0].input.automation.dryRun, 'the script sees dryRun');
    let after = await getAutomationRun(dbAdapter, preview.id);
    assert.strictEqual(after?.state, 'complete');
    assert.strictEqual(after?.commitStartedAt, null, 'no commit was claimed');
    assert.strictEqual(await readFile('out/kept.txt'), undefined);
    let kept = await query(dbAdapter, [
      "SELECT path, convert_from(content, 'UTF8') AS text FROM automation_preview_files WHERE run_id =",
      param(preview.id),
    ]);
    assert.deepEqual(
      kept,
      [{ path: 'out/kept.txt', text: 'the batch a Preview shows' }],
      'the finished Preview keeps a copy of the files it staged',
    );
    assert.deepEqual(
      await runOverlayFiles(dbAdapter, {
        runId: preview.id,
        attempt: after!.attempt!,
      }),
      [],
      'and its overlay is discarded, as for every run',
    );

    let next = await newRun();
    let nextCalls: TabCall[] = [];
    await attempt(next, stubTab(nextCalls, { answer: { state: 'complete' } }));
    assert.strictEqual(
      nextCalls[0].input.automation.lastSuccessAt,
      undefined,
      'a complete Preview is not a last success',
    );
  });

  test('a job that disagrees with its row about being a Preview runs nothing', async function (assert) {
    for (let { rowDryRun, jobDryRun } of [
      { rowDryRun: false, jobDryRun: true },
      { rowDryRun: true, jobDryRun: false },
    ]) {
      let run = await newRun({ dryRun: rowDryRun });
      let calls: TabCall[] = [];
      let result = await attempt(
        run,
        stubTab(calls, {
          writes: { 'out/mismatch.txt': 'never staged' },
          answer: { state: 'complete' },
        }),
        { input: { dryRun: jobDryRun } },
      );
      assert.strictEqual(calls.length, 0, 'no tab was asked to run anything');
      assert.strictEqual(result.state, 'error');
      assert.strictEqual(result.reason, 'dry-run-mismatch');
      let after = await getAutomationRun(dbAdapter, run.id);
      assert.strictEqual(after?.state, 'error');
      assert.strictEqual(after?.commitStartedAt, null);
    }
    assert.strictEqual(await readFile('out/mismatch.txt'), undefined);
  });

  // The run's identity, with credits to pay for its run.
  async function fundOwner() {
    await ensureTestUser(dbAdapter, OWNER);
    let user = (await getUserByMatrixUserId(dbAdapter, OWNER))!;
    await addToCreditsLedger(dbAdapter, {
      userId: user.id,
      creditAmount: 10_000,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
    return user;
  }

  test("an attempt adds its script's tab time to the run, and the run is charged its compute once it ends", async function (assert) {
    let owner = await fundOwner();
    let run = await newRun();
    let result = await attempt(
      run,
      stubTab([], {
        answer: () => ({
          status: 'ready',
          cardResultString: JSON.stringify({
            data: {
              type: 'card',
              attributes: { json: { state: 'complete' } },
            },
          }),
          meta: {
            diagnostics: { renderElapsedMs: 4200, totalElapsedMs: 4500 },
          },
        }),
      }),
      { meteredCharges: meteredChargesFor(dbAdapter, testPricing) },
    );

    assert.deepEqual(result, { state: 'complete' });
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(
      after?.prerenderTabMs,
      4200,
      "the tab time is the server's measure of the render",
    );
    let charges = await getLedgerEntries(dbAdapter, {
      runId: run.id,
      chargeKind: 'run',
    });
    assert.true(charges.length > 0, 'the run is charged');
    assert.true(
      charges.every((e) => e.userId === owner.id),
      "to the run's identity",
    );
    let usage = Object.fromEntries(
      (await getLedgerUsage(dbAdapter, { runId: run.id }))
        .filter((u) => u.chargeKind === 'run')
        .map(({ unit, quantity }) => [unit, quantity]),
    );
    assert.strictEqual(
      usage.prerender_tab_seconds,
      4.2,
      'for the tab time its script took',
    );
  });

  test("a script's tab time past the run's time limit isn't charged", async function (assert) {
    await fundOwner();
    let run = await newRun();
    await attempt(
      run,
      stubTab([], {
        answer: () => ({
          status: 'ready',
          cardResultString: JSON.stringify({
            data: {
              type: 'card',
              attributes: { json: { state: 'complete' } },
            },
          }),
          // Longer than the run's 300 s seconds cap: the tab answered in the
          // grace its call gets past the limit.
          meta: { diagnostics: { renderElapsedMs: 330_000 } },
        }),
      }),
      { meteredCharges: meteredChargesFor(dbAdapter, testPricing) },
    );

    let after = await getAutomationRun(dbAdapter, run.id);
    assert.true(
      after!.prerenderTabMs <= 300_000,
      `the recorded tab time (${after!.prerenderTabMs} ms) is held to the run's time limit`,
    );
    assert.true(
      after!.prerenderTabMs > 290_000,
      'and is what the run had left when its script started',
    );
  });

  test('a tab call that throws adds no tab time, and leaves nothing to charge', async function (assert) {
    await fundOwner();
    let run = await newRun();
    let result = await attempt(
      run,
      stubTab([], {
        answer: () => {
          throw new Error('no prerender server answered');
        },
      }),
      { meteredCharges: meteredChargesFor(dbAdapter, testPricing) },
    );

    assert.strictEqual(result.state, 'error');
    assert.strictEqual(result.reason, 'run-failed');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.prerenderTabMs, 0, 'no tab time is recorded');
    assert.deepEqual(
      await getLedgerEntries(dbAdapter, { runId: run.id, chargeKind: 'run' }),
      [],
      'and the run is not charged',
    );
  });

  test('every line and telemetry event of a run carries its automation, run and queue job', async function (assert) {
    await fundOwner();
    let run = await newRun();
    let automation = run.automationId;
    // The run's queue job, and the reservation a worker claims it with.
    let [{ id: jobId }] = (await dbAdapter.execute(
      `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args, status)
         VALUES ('run-command', $1, 420, 5, $2, 'unfulfilled') RETURNING id`,
      {
        bind: [
          `automation:${automation}`,
          JSON.stringify({ dedupeKey: automationRunDedupeKey(run) }),
        ],
      },
    )) as { id: number }[];
    let [{ id: reservationId }] = (await dbAdapter.execute(
      `INSERT INTO job_reservations (job_id, locked_until, worker_id)
         VALUES ($1, NOW() + interval '5 minutes', 'test-worker') RETURNING id`,
      { bind: [jobId] },
    )) as { id: number }[];
    jobId = Number(jobId);
    reservationId = Number(reservationId);

    let events: AutomationRunEvent[] = [];
    let milestones: AutomationMilestoneEvent[] = [];
    let lokiLines: string[] = [];
    let workerLines: string[] = [];
    let record =
      (level: string) =>
      (...args: unknown[]) =>
        workerLines.push(`${level} ${args.map(String).join(' ')}`);
    let workerLog = {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    };
    let scriptStartedAt = Date.now();
    setAutomationRunTelemetrySink((event) => events.push(event));
    setAutomationMilestoneSink((event) => milestones.push(event));
    setRunLogLokiSink((line) => lokiLines.push(line));
    try {
      // A tab that reports a milestone to the run's log, as the script would, stages a write, and answers with when the script
      // started and ended and what the prerender server measured.
      let tab = {
        async runCommand(args: RunCommandArgs) {
          let token = (JSON.parse(args.auth) as Record<string, string>)[
            realm.url
          ];
          let at = Date.now();
          let logged = await virtualNetwork.fetch(
            `${realm.url}${RUN_LOG_PATH.replace(/^\//, '')}`,
            {
              method: 'POST',
              headers: {
                Accept: 'application/vnd.api+json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                events: [
                  { kind: 'plan', at, milestones: ['fetch'] },
                  { kind: 'milestone', at, name: 'fetch' },
                ],
              }),
            },
          );
          if (!logged.ok) {
            throw new Error(`the run log refused: ${logged.status}`);
          }
          let staged = await virtualNetwork.fetch(
            `${realm.url}out/result.txt`,
            {
              method: 'POST',
              headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
              body: 'from the run',
            },
          );
          if (!staged.ok) {
            throw new Error(`staging failed: ${staged.status}`);
          }
          return {
            status: 'ready',
            cardResultString: JSON.stringify({
              data: {
                type: 'card',
                attributes: {
                  json: {
                    state: 'complete',
                    timing: {
                      startedAt: scriptStartedAt,
                      endedAt: scriptStartedAt + 800,
                    },
                  },
                },
              },
            }),
            meta: {
              requestId: 'prerender-request-1',
              diagnostics: {
                launchMs: 40,
                waits: { tabQueueMs: 30, tabStartupMs: 0 },
                tabReused: true,
                renderElapsedMs: 900,
                tabMemory: {
                  jsUsedMB: 12,
                  jsTotalMB: 20,
                  domMB: 3,
                  buffersMB: 1,
                },
              },
            },
          } as RunCommandResponse;
        },
      } as unknown as Prerenderer;
      let result = await attempt(run, tab, {
        jobId,
        reservationId,
        queueWaitMs: 250,
        concurrencyGroup: `automation:${automation}`,
        meteredCharges: meteredChargesFor(dbAdapter, testPricing),
        workerLog,
      });
      assert.deepEqual(result, { state: 'complete' }, 'the run completes');
    } finally {
      setAutomationRunTelemetrySink(undefined);
      setAutomationMilestoneSink(undefined);
      setRunLogLokiSink(undefined);
    }

    let ids = { automation, run: run.id, job: jobId };
    assert.deepEqual(
      events.map((e) => e.kind),
      ['claimed', 'admitted', 'script', 'commit', 'finished', 'charged'],
      'the run crosses each boundary once, in order',
    );
    for (let event of events) {
      assert.deepEqual(
        {
          automation: (event as { automation?: string }).automation,
          run: (event as { run?: string }).run,
          job: (event as { job?: number }).job,
        },
        ids,
        `the ${event.kind} event carries the run's ids`,
      );
    }
    assert.true(milestones.length > 0, 'the run reported a milestone');
    for (let milestone of milestones) {
      assert.deepEqual(
        {
          automation: milestone.automation,
          run: milestone.run,
          job: milestone.job,
        },
        ids,
        `the ${milestone.milestone} milestone carries the run's ids`,
      );
    }
    let tags = `[automation-run-log] automation=${automation} run=${run.id} job=${jobId} `;
    assert.true(lokiLines.length > 0, "the run's log reached Loki");
    for (let line of lokiLines) {
      assert.true(
        line.startsWith(tags),
        `the log line carries the run's ids: ${line}`,
      );
    }
    assert.true(workerLines.length > 0, 'the worker logged the attempt');
    for (let line of workerLines) {
      assert.true(
        line.includes(
          `automation=${automation} run=${run.id} job=${jobId} attempt=${reservationId}`,
        ),
        `the worker's line carries the run's ids: ${line}`,
      );
    }

    let byKind = <K extends AutomationRunEvent['kind']>(kind: K) =>
      events.find((e) => e.kind === kind) as Extract<
        AutomationRunEvent,
        { kind: K }
      >;
    let claimed = byKind('claimed');
    assert.strictEqual(
      claimed.queueWaitMs,
      250,
      'the claim says how long the job waited',
    );
    assert.strictEqual(claimed.lane, `automation:${automation}`);
    assert.true(byKind('admitted').admitted, 'admission let the run go ahead');
    let script = byKind('script');
    assert.strictEqual(
      script.tabLaunchMs,
      40,
      "the prerender server's own measure of giving the call a tab",
    );
    assert.true(
      Date.parse(script.tabAnsweredAt) >= Date.parse(script.tabRequestedAt),
      'the tab answered after the worker asked for it',
    );
    assert.strictEqual(
      script.scriptStartedAt,
      new Date(scriptStartedAt).toISOString(),
    );
    assert.strictEqual(
      script.scriptMs,
      800,
      'the script ran for what the tab measured',
    );
    assert.strictEqual(
      script.tabMs,
      900,
      'the tab time is what the run is charged',
    );
    assert.strictEqual(script.tabQueueMs, 30);
    assert.true(script.tabReused);
    assert.strictEqual(
      script.tabJsHeapUsedMB,
      12,
      "the tab's memory as the script ended",
    );
    assert.strictEqual(script.prerenderRequestId, 'prerender-request-1');
    let commit = byKind('commit');
    assert.strictEqual(commit.outcome, 'committed');
    assert.strictEqual(commit.tries, 1);
    let finished = byKind('finished');
    assert.strictEqual(finished.state, 'complete');
    assert.ok(finished.committedAt, 'the summary has the commit');
    assert.strictEqual(finished.prerenderTabMs, 900);
    let charged = byKind('charged');
    assert.strictEqual(charged.chargeKind, 'run');
    assert.strictEqual(charged.result, 'charged');
    assert.true((charged.credits ?? 0) > 0, 'the charge says what it cost');
  });

  test("a job whose key isn't its run's runs nothing", async function (assert) {
    let run = await newRun();
    let calls: TabCall[] = [];
    let result = await attempt(
      run,
      stubTab(calls, { answer: { state: 'complete' } }),
      { dedupeKey: null },
    );
    assert.deepEqual(result, { state: 'left', reason: 'not-the-runs-job' });
    assert.strictEqual(calls.length, 0, 'no tab was asked to run anything');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'pending', 'the run is untouched');
  });

  test('an attempt that a newer one replaced leaves the run alone', async function (assert) {
    let run = await newRun();
    await attempt(run, stubTab([], { answer: { state: 'complete' } }), {
      reservationId: 9,
    });
    let calls: TabCall[] = [];
    let result = await attempt(
      run,
      stubTab(calls, { answer: { state: 'complete' } }),
      { reservationId: 8 },
    );
    assert.strictEqual(result.state, 'left');
    assert.strictEqual(calls.length, 0);
  });

  module('the job realm event', function (hooks) {
    // Every Matrix send the realm's adapter makes for a run's job event, with
    // the delivery the realm asked for. The adapter sends them through a
    // client that records the room, so the test sees which rooms the event
    // reaches: the owner, a direct writer, has a session room, the reader
    // has one, and the realm, which is private, has an event room of its own.
    let delivered: { event: JobEventContent; recipients?: string[] }[];
    let rooms: string[];
    let restore: (() => void) | undefined;

    hooks.beforeEach(async function () {
      delivered = [];
      rooms = [];
      await ensureTestUser(dbAdapter, OWNER);
      await upsertSessionRoom(dbAdapter, OWNER, '!owner:localhost');
      await ensureTestUser(dbAdapter, READER);
      await upsertSessionRoom(dbAdapter, READER, '!reader:localhost');
      await insertRealmEventRoom(dbAdapter, realm.url, '!events:localhost');
      let recording = {
        login: async () => undefined,
        getUserId: () => '@realm_server:localhost',
        isLoggedIn: () => true,
        nextTxnId: () => randomUUID(),
        sendEvent: async (roomId: string) => {
          rooms.push(roomId);
          return '$event';
        },
      } as unknown as MatrixClient;
      let original = realmAdapter.broadcastRealmEvent.bind(realmAdapter);
      realmAdapter.broadcastRealmEvent = (async (
        event,
        realmUrl,
        matrixClient,
        db,
        delivery,
      ) => {
        if (event.eventName !== 'job') {
          return await original(event, realmUrl, matrixClient, db, delivery);
        }
        delivered.push({ event, recipients: delivery?.recipients });
        return await original(event, realmUrl, recording, db, delivery);
      }) as RealmAdapter['broadcastRealmEvent'];
      restore = () => {
        realmAdapter.broadcastRealmEvent = original;
      };
    });

    hooks.afterEach(function () {
      restore?.();
    });

    // A worker's reporter: the worker hands the event to the realm server,
    // which broadcasts it as the realm's own (`Realm.broadcastEvent`).
    function workerReporter(sent: JobEventContent[]): ReportRunChange {
      return runChangeReporter({
        dbAdapter,
        virtualNetwork,
        log,
        send: async (event) => {
          sent.push(event);
          await realm.broadcastEvent(event);
        },
      });
    }

    // A tab that reports its run milestones to the realm with the run's
    // token, as the script's `realm.progress` does, then stages and answers
    // as `stubTab` does.
    function milestoneTab(milestones: string[]): Prerenderer {
      let inner = stubTab([], {
        writes: { 'out/result.txt': 'from the run' },
        answer: { state: 'complete' },
      });
      return {
        async runCommand(args: RunCommandArgs) {
          let token = (JSON.parse(args.auth) as Record<string, string>)[
            realm.url
          ];
          let at = Date.now();
          let response = await virtualNetwork.fetch(
            new URL(RUN_LOG_PATH.slice(1), realm.url).href,
            {
              method: 'POST',
              headers: {
                Accept: 'application/vnd.api+json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                events: [
                  { at, kind: 'plan', milestones },
                  ...milestones.map((name, i) => ({
                    at: at + i + 1,
                    kind: 'milestone',
                    name,
                  })),
                ],
              }),
            },
          );
          if (!response.ok) {
            throw new Error(`run log refused: ${response.status}`);
          }
          return await inner.runCommand(args);
        },
      } as unknown as Prerenderer;
    }

    test("a run's job events reach its realm's direct writers' session rooms, and no reader's or the realm's room", async function (assert) {
      let run = await newRun();
      let fromWorker: JobEventContent[] = [];
      let result = await attempt(run, milestoneTab(['Fetch', 'Write']), {
        reportRunChange: workerReporter(fromWorker),
      });
      assert.deepEqual(result, { state: 'complete' });

      let automation = `${realm.url}${TEST_AUTOMATION_PATH}`;
      assert.deepEqual(
        fromWorker.map(({ state, step, milestone }) => [
          state,
          step,
          milestone,
        ]),
        [
          ['running', 'admission', null],
          ['running', 'script', null],
          ['complete', 'commit', 'Write'],
        ],
        'the attempt reports its start, its admission and its end',
      );

      // The realm's own reports (the milestones, the commit's claim and its
      // landing) aren't awaited by the requests that make them.
      let seen = () =>
        delivered.map(({ event }) => [
          event.state,
          event.step,
          event.milestone,
        ]);
      await waitUntil(
        async () =>
          seen().some(
            ([state, step, milestone]) =>
              state === 'running' && step === 'script' && milestone === 'Write',
          ) &&
          seen().some(
            ([state, step]) => state === 'running' && step === 'commit',
          ),
        {
          timeout: 5000,
          interval: 50,
          timeoutMessage: () =>
            `the realm's own job events arrive: ${JSON.stringify(seen())}`,
        },
      );
      assert.ok(
        seen().some(
          ([state, step, milestone]) =>
            state === 'running' &&
            step === 'script' &&
            (milestone === 'Fetch' || milestone === 'Write'),
        ),
        'reaching a milestone sends an event naming it',
      );
      assert.ok(
        seen().some(
          ([state, step]) => state === 'running' && step === 'commit',
        ),
        'claiming the commit sends an event at the commit step',
      );

      for (let { event, recipients } of delivered) {
        assert.deepEqual(
          recipients,
          [OWNER],
          `the ${event.state}/${event.step} event is meant for the direct writer alone`,
        );
        assert.deepEqual(
          Object.keys(event).sort(),
          [
            'automation',
            'eventName',
            'milestone',
            'realmURL',
            'runId',
            'state',
            'step',
          ],
          'the event carries no one but the run: not who it acts as',
        );
        assert.strictEqual(event.runId, run.id);
        assert.strictEqual(event.automation, automation);
        assert.strictEqual(event.realmURL, realm.url);
      }
      assert.true(rooms.length > 0, 'the events were sent');
      assert.deepEqual(
        [...new Set(rooms)],
        ['!owner:localhost'],
        "only the direct writer's session room receives them: not the reader's, not the realm's event room",
      );
    });

    test('a realm with no direct writer sends a job event to no one', async function (assert) {
      let run = await newRun();
      await query(dbAdapter, [
        'UPDATE realm_user_permissions SET write = false WHERE realm_url =',
        param(realm.url),
        'AND username =',
        param(OWNER),
      ]);
      await realm.broadcastEvent({
        eventName: 'job',
        runId: run.id,
        automation: `${realm.url}${TEST_AUTOMATION_PATH}`,
        state: 'pending',
        step: null,
        milestone: null,
        realmURL: realm.url,
      });
      assert.deepEqual(delivered, [], 'nothing is handed to the adapter');
      assert.deepEqual(rooms, [], 'and no room receives it');
    });
  });
});
