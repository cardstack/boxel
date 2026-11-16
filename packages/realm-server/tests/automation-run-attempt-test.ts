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
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { presentsAsRunToken } from '@cardstack/runtime-common/run-token';
import {
  TEST_AUTOMATION_PATH,
  automationFixture,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
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
const SOURCE = 'application/vnd.card+source';

const log = logger('automation-run-attempt-test');

interface TabCall {
  args: RunCommandArgs;
  token: string;
  input: AutomationScriptInput;
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
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
      ...automationFixture({ operations: [], caps: { seconds: 300 } }),
      [SCRIPT_PATH]: SCRIPT,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      virtualNetwork = args.virtualNetwork;
    },
  });

  async function newRun(): Promise<AutomationRun> {
    return await createAutomationRun(dbAdapter, {
      automationId: rri(`${realm.url}${TEST_AUTOMATION_PATH}`),
      realm: ri(realm.url),
      trigger: 'manual',
      slot: randomUUID(),
      actsAs: OWNER,
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
      reservationId = 7,
      commit,
    }: {
      input?: Partial<AutomationJobInput>;
      dedupeKey?: string | null;
      reservationId?: number;
      // Stands in for the network on the worker's commit requests only;
      // `send` sends one to the realm.
      commit?: (send: () => Promise<Response>) => Promise<Response>;
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
      jobId: 1,
      reservationId,
      priority: 5,
      queueWaitMs: null,
      concurrencyGroup: null,
      laneFamily: null,
    };
    return await runAutomationAttempt(
      {
        dbAdapter,
        definitionLookup: new CachingDefinitionLookup(
          dbAdapter,
          prerenderer,
          virtualNetwork,
          testCreatePrerenderAuth,
        ),
        virtualNetwork: network,
        prerenderer,
        mintRunToken: buildMintRunToken(realmSecretSeed),
        log,
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

  test('a Preview runs the script and commits nothing', async function (assert) {
    let run = await newRun();
    let calls: TabCall[] = [];
    await attempt(
      run,
      stubTab(calls, {
        writes: { 'out/preview.txt': 'shown, not written' },
        answer: { state: 'complete' },
      }),
      { input: { dryRun: true } },
    );
    assert.true(calls[0].input.automation.dryRun, 'the script sees dryRun');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'complete');
    assert.strictEqual(after?.commitStartedAt, null, 'no commit was claimed');
    assert.strictEqual(await readFile('out/preview.txt'), undefined);
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
});
