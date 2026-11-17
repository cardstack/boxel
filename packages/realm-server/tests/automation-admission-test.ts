import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import {
  automationRunDedupeKey,
  chargeAutomationRun,
  createAutomationRun,
  creditsHeldByRunsInFlight,
  dbAdapterQuerier,
  holdAutomationRunCredits,
  getAutomationRun,
  logger,
  param,
  query,
  ri,
  rri,
  runAutomationAttempt,
  CachingDefinitionLookup,
  type AutomationRun,
  type AutomationScriptOutcome,
  type JobInfo,
  type Prerenderer,
  type Realm,
  type ReportAutomationChange,
  type ReportRunChange,
  type RunCommandArgs,
  type SpendCharge,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { AutomationAdmissionChecks } from '@cardstack/runtime-common/automation-admission';
import {
  automationRef,
  readAutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import { readRunLog } from '@cardstack/runtime-common/automation-run-log';
import {
  getAutomation,
  pauseAutomation,
  removeAutomation,
  setAutomationWaitingForCredits,
  switchOnAutomation,
} from '@cardstack/runtime-common/automations';
import { internalKeyFor } from '@cardstack/runtime-common';
import {
  ROOMY_AUTOMATION_CAPS,
  ensureTestUser,
  realmSecretSeed,
  createJWT,
  setupPermissionedRealmCached,
  testAccountStandings,
  testAutomationAdmissionChecks,
  testCreatePrerenderAuth,
  testPricing,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { runCostCeiling } from '../lib/automation-estimate.ts';
import { buildAdmitSpending } from '../lib/automation-spending.ts';
import { meteredChargesFor } from '../lib/metered-charge.ts';
import { buildMintRunToken } from '../lib/run-token.ts';

// An automation run's admission: before a run costs anything, the worker
// checks the automation's row, the person the run acts as, the script, every
// operation the card declares, and the run's spending. A refused run ends as
// an error named by the refusal's code, its tab is never asked to run the
// script, and its log says admission refused it.

const realmURL = new URL('http://127.0.0.1:4444/automation-admission-test/');
const OWNER = '@admission-owner:localhost';
const WRITER = '@admission-writer:localhost';
const READER = '@admission-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';
const VENDOR = 'http://127.0.0.1:4542';
const INBOX = { module: `${realmURL.href}inbox`, name: 'Inbox' };

const log = logger('automation-admission-test');

const inboxModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import { operation } from "@cardstack/base/operations";

  export class Inbox extends CardDef {
    @operation static list = {
      base: 'callApi',
      url: '${VENDOR}/echo/list',
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

const SCRIPT = `await realm.fs.writeText('out/result.txt', 'from the run');
return 'done';
`;

// An automation card at `path`, with a nightly cron trigger, its script
// beside it, and the operations it declares.
function automationCard(
  path: string,
  {
    operations = [],
    script = SCRIPT,
    caps = {},
  }: {
    operations?: { targetType: typeof INBOX; operation: string }[];
    script?: string;
    caps?: Partial<Record<keyof typeof ROOMY_AUTOMATION_CAPS, number | null>>;
  } = {},
): Record<string, string> {
  let scriptName = `${path.split('/').pop()}-script.js`;
  return {
    [`${path}.json`]: JSON.stringify({
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Admission test automation' },
          triggers: [
            {
              kind: 'cron',
              label: 'nightly',
              expression: '30 5 * * *',
              timeZone: 'America/Chicago',
            },
          ],
          operations,
          caps: { ...ROOMY_AUTOMATION_CAPS, seconds: 300, ...caps },
          params: [],
        },
        relationships: {
          script: { links: { self: `./${scriptName}` } },
        },
        meta: { adoptsFrom: automationRef },
      },
    }),
    [`${path}-script.js`]: script,
  };
}

const CLEAN = 'automation/clean';
const NEEDS_APPROVAL = 'automation/needs-approval';
const BROKEN = 'automation/broken';
// Caps small enough that one run's cost ceiling (505 credits at the test
// prices) is below the minimum balance floor (1,000 credits).
const SPENDING_CAPS = {
  seconds: 300,
  responseBytes: 1024 * 1024,
  aiCredits: 500,
  dailyCredits: null,
  monthlyCredits: 2_000,
};
const SPENDING = 'automation/spending';
const DAILY = 'automation/daily';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let request: SuperTest<Test>;

  setupCatalogTestSubset(hooks);
  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [WRITER]: ['read', 'write'],
      [READER]: ['read'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'inbox.gts': inboxModule,
      ...automationCard(CLEAN),
      ...automationCard(NEEDS_APPROVAL, {
        operations: [{ targetType: INBOX, operation: 'list' }],
      }),
      ...automationCard(BROKEN, { script: 'await realm.fs.writeText(\n' }),
      ...automationCard(SPENDING, { caps: SPENDING_CAPS }),
      ...automationCard(DAILY, {
        caps: { ...SPENDING_CAPS, dailyCredits: 600 },
      }),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      virtualNetwork = args.virtualNetwork;
      request = args.request;
    },
  });

  hooks.afterEach(function () {
    testAccountStandings.clear();
  });

  function automationId(path: string) {
    return rri(`${realm.url}${path}`);
  }

  async function newRun(
    path: string,
    {
      trigger = 'manual',
      actsAs = OWNER,
    }: { trigger?: string; actsAs?: string } = {},
  ): Promise<AutomationRun> {
    return await createAutomationRun(dbAdapter, {
      automationId: automationId(path),
      realm: ri(realm.url),
      trigger,
      slot: randomUUID(),
      actsAs,
    });
  }

  // Switches the automation at `path` on for `payer`, from its card as
  // indexed.
  async function switchOn(path: string, payer = OWNER) {
    let id = automationId(path);
    let card = await realm.realmIndexQueryEngine.instanceSource(
      new URL(`${realm.url}${path}`),
    );
    let read = readAutomationDeclaration(
      {
        url: id,
        realmURL: card!.realmURL,
        types: card!.types,
        instance: card!.instance!,
      },
      {
        automationTypeKey: internalKeyFor(
          automationRef,
          undefined,
          virtualNetwork,
        ),
        virtualNetwork,
      },
    );
    if (!read.ok) {
      throw new Error(`the card doesn't read: ${JSON.stringify(read)}`);
    }
    let switched = await switchOnAutomation(
      dbAdapter,
      {
        automationId: id,
        realm: ri(realm.url),
        user: payer,
        declaration: read.declaration,
      },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    if (!switched.ok) {
      throw new Error(`switch-on refused: ${switched.reason}`);
    }
    return switched.automation;
  }

  // Records that `user`'s sessions were revoked at `seconds`.
  async function revokeSessionsAt(user: string, seconds: number) {
    await query(dbAdapter, [
      'INSERT INTO users (matrix_user_id, sessions_revoked_at) VALUES (',
      param(user),
      ',',
      param(seconds),
      ') ON CONFLICT (matrix_user_id) DO UPDATE SET sessions_revoked_at = EXCLUDED.sessions_revoked_at',
    ]);
  }

  // A tab that answers `outcome`, counting how often it is asked. It reports
  // a fixed tab time, so a run it runs always has compute to charge.
  function stubTab(calls: RunCommandArgs[]): Prerenderer {
    let outcome: AutomationScriptOutcome = {
      state: 'complete',
      result: 'done',
    } as AutomationScriptOutcome;
    return {
      async runCommand(args: RunCommandArgs) {
        calls.push(args);
        return {
          status: 'ready',
          cardResultString: JSON.stringify({
            data: { type: 'card', attributes: { json: outcome } },
          }),
          meta: { diagnostics: { renderElapsedMs: 250 } },
        };
      },
    } as unknown as Prerenderer;
  }

  async function attempt(
    run: AutomationRun,
    {
      checks,
      realmAdmission,
      triggerKind,
      calls = [],
      reportAutomationChange,
      reportRunChange,
    }: {
      // The job's `triggerKind`; by default a run labeled `manual` says so,
      // and any other is its trigger's.
      triggerKind?: 'manual' | 'batch';
      // Stands in for the worker's admission checks; undefined for a worker
      // that has none.
      checks?: (
        real: AutomationAdmissionChecks,
      ) => AutomationAdmissionChecks | undefined;
      // Stands in for the realm's answer to the run's admission request.
      realmAdmission?: () => Response;
      calls?: RunCommandArgs[];
      reportAutomationChange?: ReportAutomationChange;
      reportRunChange?: ReportRunChange;
    } = {},
  ) {
    let prerenderer = stubTab(calls);
    let definitionLookup = new CachingDefinitionLookup(
      dbAdapter,
      prerenderer,
      virtualNetwork,
      testCreatePrerenderAuth,
    );
    let real = testAutomationAdmissionChecks;
    let network = realmAdmission
      ? (new Proxy(virtualNetwork, {
          get(target, property) {
            if (property === 'fetch') {
              return (url: string | URL | Request, init?: RequestInit) => {
                let href = String(url instanceof Request ? url.url : url);
                return href.endsWith('_run-admission')
                  ? Promise.resolve(realmAdmission())
                  : target.fetch(url, init);
              };
            }
            let value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as VirtualNetwork)
      : virtualNetwork;
    let jobInfo: JobInfo = {
      jobId: 1,
      reservationId: 7,
      priority: 5,
      queueWaitMs: null,
      concurrencyGroup: null,
      laneFamily: null,
    };
    return await runAutomationAttempt(
      {
        dbAdapter,
        definitionLookup,
        virtualNetwork: network,
        prerenderer,
        mintRunToken: buildMintRunToken(realmSecretSeed),
        matrixServerName: 'localhost',
        admissionChecks: checks ? checks(real) : real,
        reportAutomationChange,
        reportRunChange,
        log,
      },
      {
        runId: run.id,
        scheduledAt: new Date().toISOString(),
        dryRun: false,
        // A run started by hand says so; any other run is its trigger's.
        ...(triggerKind
          ? { triggerKind }
          : run.trigger === 'manual'
            ? { triggerKind: 'manual' as const }
            : {}),
      },
      automationRunDedupeKey(run),
      jobInfo,
    );
  }

  // The realm's answer to a run's admission request, refusing with
  // `refusal`.
  function admissionAnswer(refusal: {
    code: string;
    detail: string;
    operation?: string;
    targetType?: { module: string; name: string };
  }) {
    return new Response(
      JSON.stringify({
        data: {
          type: 'run-admission',
          id: 'run',
          attributes: { refusal },
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/vnd.api+json' },
      },
    );
  }

  async function admissionLines(runId: string) {
    let runLog = await readRunLog(dbAdapter, runId);
    return (runLog?.lines ?? [])
      .filter((line) => line.kind === 'admission')
      .map((line) => ({ level: line.level, data: line.data }));
  }

  // Asserts that the run ended at admission with `reason`, before its tab
  // was asked anything.
  async function assertRefused(
    assert: Assert,
    run: AutomationRun,
    result: Awaited<ReturnType<typeof attempt>>,
    calls: RunCommandArgs[],
    reason: string,
  ) {
    assert.strictEqual(result.state, 'error');
    assert.strictEqual(result.reason, reason);
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(row?.state, 'error');
    assert.strictEqual(row?.errorReason, reason);
    assert.strictEqual(row?.admittedAt, null, 'the run was never admitted');
    assert.strictEqual(calls.length, 0, 'the script never ran');
    assert.deepEqual(
      (await admissionLines(run.id)).map((line) => line.data?.reason),
      [reason],
      'the run’s log says admission refused it, and why',
    );
  }

  test('a run that passes every check is admitted, recorded on its row and in its log, and runs', async function (assert) {
    let run = await newRun(CLEAN);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    assert.strictEqual(result.state, 'complete');
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.ok(row?.admittedAt, 'the admission is on the run row');
    assert.strictEqual(calls.length, 1, 'the script ran');
    assert.deepEqual(await admissionLines(run.id), [
      {
        level: 'info',
        data: { admitted: true, actsAs: OWNER, operations: 0 },
      },
    ]);
  });

  test('a scheduled run of a switched-on automation is admitted', async function (assert) {
    await switchOn(CLEAN);
    let run = await newRun(CLEAN, { trigger: 'nightly' });
    let result = await attempt(run);
    assert.strictEqual(result.state, 'complete');
  });

  test('a scheduled run of an automation that isn’t switched on is refused', async function (assert) {
    let run = await newRun(CLEAN, { trigger: 'nightly' });
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'not-switched-on');
  });

  test('a scheduled run enqueued before its automation was paused or removed doesn’t start', async function (assert) {
    await switchOn(CLEAN);
    let paused = await newRun(CLEAN, { trigger: 'nightly' });
    await pauseAutomation(
      dbAdapter,
      { automationId: automationId(CLEAN), user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    // Pausing cancels a pending run; this one stands for a run its worker
    // had already taken when the pause landed.
    await query(dbAdapter, [
      "UPDATE automation_runs SET state = 'pending', finished_at = NULL, error_reason = NULL WHERE id =",
      param(paused.id),
    ]);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(paused, { calls });
    await assertRefused(assert, paused, result, calls, 'automation-paused');

    await removeAutomation(
      dbAdapter,
      { automationId: automationId(CLEAN), user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    let removed = await newRun(CLEAN, { trigger: 'nightly' });
    result = await attempt(removed, { calls });
    await assertRefused(assert, removed, result, calls, 'not-switched-on');
  });

  test('a run someone started by hand needs no switch-on, and runs while its automation is paused', async function (assert) {
    await switchOn(CLEAN);
    await pauseAutomation(
      dbAdapter,
      { automationId: automationId(CLEAN), user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    let result = await attempt(await newRun(CLEAN));
    assert.strictEqual(result.state, 'complete');
  });

  test('a payer who lost direct write is refused, and the automation pauses with payer-lost-access', async function (assert) {
    await switchOn(CLEAN, WRITER);
    await query(dbAdapter, [
      'UPDATE realm_user_permissions SET write = false WHERE realm_url =',
      param(realm.url),
      'AND username =',
      param(WRITER),
    ]);
    let run = await newRun(CLEAN, { trigger: 'nightly', actsAs: WRITER });
    let next = await newRun(CLEAN, { trigger: 'nightly', actsAs: WRITER });
    let calls: RunCommandArgs[] = [];
    let reports: string[] = [];
    let result = await attempt(run, {
      calls,
      reportAutomationChange: async ({ automationId }) => {
        reports.push(`automation ${automationId}`);
      },
      reportRunChange: async (runId) => {
        reports.push(`run ${runId}`);
      },
    });
    await assertRefused(assert, run, result, calls, 'not-a-direct-writer');
    let automation = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(automation?.state, 'paused');
    assert.strictEqual(automation?.pauseReason, 'payer-lost-access');
    assert.deepEqual(
      reports.filter((r) => r.startsWith('automation ')),
      [`automation ${automationId(CLEAN)}`],
      "the attempt reports the automation its admission paused, through the worker's reporter",
    );
    assert.true(
      reports.includes(`run ${next.id}`),
      'and the pending run the pause canceled',
    );
    let pending = await getAutomationRun(dbAdapter, next.id);
    assert.strictEqual(
      pending?.state,
      'canceled',
      'the pause cancels the automation’s other pending runs',
    );
    assert.strictEqual(pending?.errorReason, 'payer-lost-access');
  });

  test('someone who isn’t a direct writer is refused a run they started, and no automation pauses', async function (assert) {
    await switchOn(CLEAN);
    let run = await newRun(CLEAN, { actsAs: READER });
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'not-a-direct-writer');
    let automation = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(automation?.state, 'active', 'the payer still pays');
  });

  test('a run whose identity’s sessions were revoked after the run was given their authority is refused', async function (assert) {
    let run = await newRun(CLEAN);
    await revokeSessionsAt(
      OWNER,
      Math.floor(Date.parse(run.createdAt) / 1000) + 60,
    );
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'session-revoked');
  });

  test('sessions revoked before the run was given its identity’s authority don’t refuse it', async function (assert) {
    let run = await newRun(CLEAN);
    await revokeSessionsAt(
      OWNER,
      Math.floor(Date.parse(run.createdAt) / 1000) - 60,
    );
    let result = await attempt(run);
    assert.strictEqual(result.state, 'complete');
  });

  test('a scheduled run whose trigger the card no longer names is still held to the automation’s row', async function (assert) {
    await switchOn(CLEAN);
    await pauseAutomation(
      dbAdapter,
      { automationId: automationId(CLEAN), user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    let run = await newRun(CLEAN, { trigger: 'renamed-since' });
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'automation-paused');
  });

  test('a scheduled run enqueued before a resume made someone else the payer doesn’t start as the old payer', async function (assert) {
    await switchOn(CLEAN, OWNER);
    let run = await newRun(CLEAN, { trigger: 'nightly', actsAs: WRITER });
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'payer-changed');
  });

  test('a payer whose sessions were revoked or whose account can’t sign in pauses the automation with payer-lost-access', async function (assert) {
    let automation = await switchOn(CLEAN);
    await revokeSessionsAt(OWNER, automation.scheduledSince + 60);
    // The run was enqueued well after the revocation, so only the payer's
    // switch-on, not the run's own start, places the revocation after the
    // run was given the payer's authority.
    let revoked = await newRun(CLEAN, { trigger: 'nightly' });
    await query(dbAdapter, [
      'UPDATE automation_runs SET created_at = to_timestamp(',
      param(automation.scheduledSince + 3600),
      ') WHERE id =',
      param(revoked.id),
    ]);
    let calls: RunCommandArgs[] = [];
    let paused: string[] = [];
    let result = await attempt(revoked, {
      calls,
      reportAutomationChange: async ({ automationId }) => {
        paused.push(automationId);
      },
    });
    await assertRefused(assert, revoked, result, calls, 'session-revoked');
    let row = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(row?.state, 'paused');
    assert.strictEqual(row?.pauseReason, 'payer-lost-access');
    assert.deepEqual(
      paused,
      [automationId(CLEAN)],
      'pauseForPayerLostAccess reports the automation it paused',
    );

    await removeAutomation(
      dbAdapter,
      { automationId: automationId(CLEAN), user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    await revokeSessionsAt(OWNER, 0);
    await switchOn(CLEAN);
    testAccountStandings.set(OWNER, 'deactivated');
    let deactivated = await newRun(CLEAN, { trigger: 'nightly' });
    result = await attempt(deactivated, { calls });
    await assertRefused(
      assert,
      deactivated,
      result,
      calls,
      'account-deactivated',
    );
    row = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(row?.pauseReason, 'payer-lost-access');
  });

  test('a run whose identity’s account is deactivated, locked or gone is refused', async function (assert) {
    for (let standing of ['deactivated', 'locked', 'missing'] as const) {
      testAccountStandings.set(OWNER, standing);
      let run = await newRun(CLEAN);
      let calls: RunCommandArgs[] = [];
      let result = await attempt(run, { calls });
      await assertRefused(assert, run, result, calls, 'account-deactivated');
    }
  });

  test('a worker that can’t ask about the account refuses the run', async function (assert) {
    let calls: RunCommandArgs[] = [];
    let run = await newRun(CLEAN);
    let result = await attempt(run, { calls, checks: () => undefined });
    await assertRefused(assert, run, result, calls, 'account-unverifiable');

    let failing = await newRun(CLEAN);
    result = await attempt(failing, {
      calls,
      checks: (real) => ({
        ...real,
        accountStanding: async () => {
          throw new Error('the Matrix server is down');
        },
      }),
    });
    await assertRefused(assert, failing, result, calls, 'account-unverifiable');
    let row = await getAutomationRun(dbAdapter, failing.id);
    assert.false(
      row?.errorMessage?.includes('the Matrix server is down'),
      'what the Matrix server answered stays out of the run, which the realm’s writers read',
    );
  });

  // A batch's follow-up: its slot is the batch's id, and the batch names the
  // run that submitted it.
  async function batchFollowUp(submitting: AutomationRun) {
    let batchId = `batch-${randomUUID()}`;
    await query(dbAdapter, [
      'INSERT INTO ai_batches (batch_id, run_id, acts_as, realm, automation_id, model, request_count, estimated_usd, run_ai_reservation, deadline, state) VALUES (',
      param(batchId),
      ',',
      param(submitting.id),
      ',',
      param(OWNER),
      ',',
      param(realm.url),
      ',',
      param(automationId(CLEAN)),
      ", 'test/model', 1, 0, 'reservation', now() + interval '1 day', 'completed')",
    ]);
    return await createAutomationRun(dbAdapter, {
      automationId: automationId(CLEAN),
      realm: ri(realm.url),
      trigger: 'batch',
      slot: batchId,
      actsAs: OWNER,
    });
  }

  test('a batch’s follow-up runs while its automation is paused, and is held to the submitting run’s authority', async function (assert) {
    let automation = await switchOn(CLEAN);
    let submitting = await newRun(CLEAN, { trigger: 'nightly' });
    await pauseAutomation(
      dbAdapter,
      { automationId: automationId(CLEAN), user: OWNER },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    let followUp = await batchFollowUp(submitting);
    let result = await attempt(followUp, { triggerKind: 'batch' });
    assert.strictEqual(
      result.state,
      'complete',
      'the batch’s results are read, though the automation is paused',
    );

    // Revoked after the submitting run started but before the follow-up was
    // enqueued: the follow-up still acts on the authority the submitting run
    // had, so it is refused.
    let submittedAt = Math.floor(Date.parse(submitting.createdAt) / 1000);
    assert.true(submittedAt >= automation.scheduledSince);
    let late = await batchFollowUp(submitting);
    await query(dbAdapter, [
      'UPDATE automation_runs SET created_at = to_timestamp(',
      param(submittedAt + 3600),
      ') WHERE id =',
      param(late.id),
    ]);
    await revokeSessionsAt(OWNER, submittedAt + 60);
    let calls: RunCommandArgs[] = [];
    result = await attempt(late, { triggerKind: 'batch', calls });
    await assertRefused(assert, late, result, calls, 'session-revoked');
  });

  test('a script that doesn’t parse is refused before it runs', async function (assert) {
    let run = await newRun(BROKEN);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'script-error');
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.true(row?.errorMessage?.includes("doesn't parse"));
  });

  test('an operation that isn’t approved for automations refuses the run', async function (assert) {
    let run = await newRun(NEEDS_APPROVAL);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'binding-not-approved');
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.true(
      row?.errorMessage?.startsWith('The declared operation "list" on Inbox'),
      'the run says which operation was refused',
    );
  });

  test('each refusal of a declared operation ends the run with its code', async function (assert) {
    for (let code of [
      'share-suspended',
      'binding-needs-reapproval',
      'credential-rejected',
    ]) {
      let run = await newRun(NEEDS_APPROVAL);
      let calls: RunCommandArgs[] = [];
      let result = await attempt(run, {
        calls,
        realmAdmission: () =>
          admissionAnswer({
            code,
            detail: `refused with ${code}`,
            operation: 'list',
            targetType: INBOX,
          }),
      });
      await assertRefused(assert, run, result, calls, code);
    }
  });

  test('a realm that can’t be asked about the operations refuses the run', async function (assert) {
    let run = await newRun(NEEDS_APPROVAL);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, {
      calls,
      realmAdmission: () => new Response('down', { status: 503 }),
    });
    await assertRefused(assert, run, result, calls, 'run-admission-failed');
  });

  test('the realm refuses an admission request that doesn’t carry a run’s token', async function (assert) {
    let response = await request
      .get(`/${new URL(realm.url).pathname.split('/')[1]}/_run-admission`)
      .set('Accept', 'application/vnd.api+json')
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, OWNER, ['read', 'write'])}`,
      );
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.errors[0].code, 'not-a-run');
  });

  test('the spending check runs last, and its refusal ends the run', async function (assert) {
    let asked: string[] = [];
    let run = await newRun(CLEAN);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, {
      calls,
      checks: (real) => ({
        ...real,
        admitSpending: async ({ run: admitted }) => {
          asked.push(admitted.id);
          return {
            reason: 'insufficient-credits',
            message: 'The balance is below the minimum',
          };
        },
      }),
    });
    await assertRefused(assert, run, result, calls, 'insufficient-credits');
    assert.deepEqual(asked, [run.id]);

    asked.length = 0;
    testAccountStandings.set(OWNER, 'deactivated');
    await attempt(await newRun(CLEAN), {
      checks: (real) => ({
        ...real,
        admitSpending: async ({ run: admitted }) => {
          asked.push(admitted.id);
          return undefined;
        },
      }),
    });
    assert.deepEqual(asked, [], 'a run refused earlier is never priced');
  });
  module('the spending check', function (hooks) {
    let ceiling: number;

    hooks.beforeEach(function () {
      ceiling = Math.ceil(
        runCostCeiling(SPENDING_CAPS, testPricing()).totalCredits,
      );
    });

    // The real spending check, at the test prices and, when given, the
    // clock `now` (unix seconds).
    function spending({
      now,
      pricing = testPricing,
    }: {
      now?: number;
      pricing?: () => ReturnType<typeof testPricing> | undefined;
    } = {}) {
      return (real: AutomationAdmissionChecks) => ({
        ...real,
        admitSpending: buildAdmitSpending({
          dbAdapter,
          pricing,
          ...(now !== undefined ? { now: () => now } : {}),
        }),
      });
    }

    // Gives `user` `credits` more credits to spend.
    async function fund(user: string, credits: number) {
      await ensureTestUser(dbAdapter, user);
      let { id } = (await getUserByMatrixUserId(dbAdapter, user))!;
      await addToCreditsLedger(dbAdapter, {
        userId: id,
        creditAmount: credits,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
      return id;
    }

    // Charges `credits` to `user` as `what`, dated `seconds` (unix).
    async function charge(
      user: string,
      credits: number,
      seconds: number,
      what: SpendCharge,
    ) {
      await ensureTestUser(dbAdapter, user);
      let { id: userId } = (await getUserByMatrixUserId(dbAdapter, user))!;
      let chargeId = randomUUID();
      await addToCreditsLedger(dbAdapter, {
        userId,
        creditAmount: -credits,
        creditType: 'extra_credit_used',
        subscriptionCycleId: null,
        charge: what,
        chargeId,
      });
      await query(dbAdapter, [
        'UPDATE credits_ledger SET created_at =',
        param(seconds),
        'WHERE charge_id =',
        param(chargeId),
      ]);
    }

    test('the minimum balance is one run’s cost ceiling, never below the floor', async function (assert) {
      assert.true(
        ceiling < testPricing().values.minimumBalanceFloorCredits,
        'the test card’s ceiling is below the floor',
      );
      await fund(OWNER, 999);
      let calls: RunCommandArgs[] = [];
      let short = await newRun(SPENDING);
      let result = await attempt(short, { calls, checks: spending() });
      await assertRefused(assert, short, result, calls, 'insufficient-credits');
      let message = (await getAutomationRun(dbAdapter, short.id))?.errorMessage;
      assert.true(
        message?.includes('1000 credits'),
        'the refusal names the minimum',
      );
      assert.false(
        message?.includes('999'),
        'the refusal never says what the person holds, since every direct writer reads it',
      );

      await fund(OWNER, 1);
      let run = await newRun(SPENDING);
      result = await attempt(run, { checks: spending() });
      assert.strictEqual(result.state, 'complete');
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))?.costCeilingCredits,
        ceiling,
        'the admitted run holds its cost ceiling',
      );
    });

    test('a payer’s short balance puts the automation into waiting for credits, and it continues at its next due run once the balance recovers', async function (assert) {
      await switchOn(SPENDING);
      await fund(OWNER, 500);
      let calls: RunCommandArgs[] = [];
      let short = await newRun(SPENDING, { trigger: 'nightly' });
      let result = await attempt(short, { calls, checks: spending() });
      await assertRefused(assert, short, result, calls, 'insufficient-credits');
      let automation = await getAutomation(dbAdapter, automationId(SPENDING));
      assert.strictEqual(automation?.state, 'waiting-for-credits');
      assert.strictEqual(automation?.pauseReason, null);

      // Still short: the next due run waits too.
      let stillShort = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(stillShort, { checks: spending() });
      assert.strictEqual(result.reason, 'insufficient-credits');
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SPENDING)))?.state,
        'waiting-for-credits',
      );

      await fund(OWNER, 500);
      let next = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(next, { checks: spending() });
      assert.strictEqual(result.state, 'complete');
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SPENDING)))?.state,
        'active',
        'the first run admitted once the balance recovers makes it active',
      );
    });

    test('a move into or out of waiting for credits reports the automation once, and a run that moves nothing reports nothing', async function (assert) {
      let id = automationId(SPENDING);
      await switchOn(SPENDING);
      await fund(OWNER, 500);
      // Each report with the state the row holds when it arrives.
      let reports: string[] = [];
      let reportAutomationChange: ReportAutomationChange = async ({
        automationId: reported,
        realm,
      }) => {
        let automation = await getAutomation(dbAdapter, reported);
        reports.push(`${reported} in ${realm} ${automation?.state}`);
      };

      let short = await newRun(SPENDING, { trigger: 'nightly' });
      let result = await attempt(short, {
        checks: spending(),
        reportAutomationChange,
      });
      assert.strictEqual(result.reason, 'insufficient-credits');
      assert.deepEqual(
        reports,
        [`${id} in ${short.realm} waiting-for-credits`],
        'a short run that moves the automation to waiting reports it',
      );

      reports = [];
      let stillShort = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(stillShort, {
        checks: spending(),
        reportAutomationChange,
      });
      assert.strictEqual(result.reason, 'insufficient-credits');
      assert.deepEqual(
        reports,
        [],
        'a short run of an automation already waiting reports nothing',
      );

      await fund(OWNER, 500);
      let funded = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(funded, {
        checks: spending(),
        reportAutomationChange,
      });
      assert.strictEqual(result.state, 'complete');
      assert.deepEqual(
        reports,
        [`${id} in ${funded.realm} active`],
        'the funded run that makes it active again reports it',
      );

      reports = [];
      let again = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(again, {
        checks: spending(),
        reportAutomationChange,
      });
      assert.strictEqual(result.state, 'complete');
      assert.deepEqual(
        reports,
        [],
        'a funded run of an active automation reports nothing',
      );
    });

    test('waiting for credits never moves a paused or done automation, or one whose payer changed', async function (assert) {
      let id = automationId(SPENDING);
      await switchOn(SPENDING);
      let setState = async (state: string, pauseReason: string | null) =>
        await query(dbAdapter, [
          'UPDATE automations SET state =',
          param(state),
          ', pause_reason =',
          param(pauseReason),
          'WHERE automation_id =',
          param(id),
        ]);
      let state = async () => (await getAutomation(dbAdapter, id))?.state;

      await setState('paused', 'requested');
      assert.strictEqual(
        await setAutomationWaitingForCredits(dbAdapter, id, {
          payer: OWNER,
          waiting: true,
        }),
        undefined,
      );
      assert.strictEqual(
        await state(),
        'paused',
        'a short run never resurrects a paused automation',
      );

      await setState('done', null);
      await setAutomationWaitingForCredits(dbAdapter, id, {
        payer: OWNER,
        waiting: true,
      });
      assert.strictEqual(await state(), 'done');

      await setState('active', null);
      assert.strictEqual(
        await setAutomationWaitingForCredits(dbAdapter, id, {
          payer: WRITER,
          waiting: true,
        }),
        undefined,
      );
      assert.strictEqual(
        await state(),
        'active',
        'a run that acts as someone other than the payer doesn’t move it',
      );

      await setState('waiting-for-credits', null);
      await setAutomationWaitingForCredits(dbAdapter, id, {
        payer: WRITER,
        waiting: false,
      });
      assert.strictEqual(await state(), 'waiting-for-credits');
      await setAutomationWaitingForCredits(dbAdapter, id, {
        payer: OWNER,
        waiting: false,
      });
      assert.strictEqual(
        await state(),
        'active',
        'only the payer’s run moves it',
      );
    });

    test('a Run now on a short balance is refused without changing the automation’s state', async function (assert) {
      await switchOn(SPENDING);
      await fund(WRITER, 10);
      let run = await newRun(SPENDING, { actsAs: WRITER });
      let result = await attempt(run, { checks: spending() });
      assert.strictEqual(result.reason, 'insufficient-credits');
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SPENDING)))?.state,
        'active',
        'the clicker’s balance says nothing about the payer’s',
      );
    });

    test('two runs at once can’t both pass on one run’s worth of balance', async function (assert) {
      await fund(OWNER, 1_000);
      let runs = [await newRun(SPENDING), await newRun(SPENDING)];
      let results = await Promise.all(
        runs.map((run) => attempt(run, { checks: spending() })),
      );
      assert.deepEqual(
        results.map((r) => r.reason ?? r.state).sort(),
        ['complete', 'insufficient-credits'],
        'one run holds its ceiling, and the other is short by it',
      );

      // With the minimum free beside one run's hold, the next one passes.
      await fund(OWNER, ceiling);
      let third = await newRun(SPENDING);
      let result = await attempt(third, { checks: spending() });
      assert.strictEqual(result.state, 'complete');
    });

    test('the monthly cap counts every charge kind and the automation’s runs in flight, and leaves a Run now alone', async function (assert) {
      let now = Date.UTC(2026, 10, 16, 12) / 1000;
      await switchOn(SPENDING);
      await fund(OWNER, 10_000);
      // 1,700 credits this month across every kind. Each is large enough that
      // leaving any one out would let the capped run below through.
      let earlier = await newRun(SPENDING, { trigger: 'nightly' });
      await charge(OWNER, 500, now - 60, {
        kind: 'run',
        realm: ri(realm.url),
        runId: earlier.id,
        pricingVersion: testPricing().version,
      });
      await charge(OWNER, 300, now - 60, {
        kind: 'run_indexing',
        realm: ri(realm.url),
        runId: earlier.id,
        pricingVersion: testPricing().version,
      });
      await charge(OWNER, 400, now - 60, {
        kind: 'ai',
        realm: ri(realm.url),
        runId: earlier.id,
      });
      await charge(OWNER, 500, now - 60, {
        kind: 'storage',
        realm: ri(realm.url),
        automationId: automationId(SPENDING),
        day: '2026-11-15',
        pricingVersion: testPricing().version,
      });
      // A charge last month doesn't count.
      await charge(OWNER, 5_000, Date.UTC(2026, 9, 31, 23) / 1000, {
        kind: 'run',
        realm: ri(realm.url),
        runId: (await newRun(SPENDING, { trigger: 'nightly' })).id,
        pricingVersion: testPricing().version,
      });

      let first = await newRun(SPENDING, { trigger: 'nightly' });
      let result = await attempt(first, { checks: spending({ now }) });
      assert.strictEqual(
        result.state,
        'complete',
        '1,700 charged is under the 2,000 cap',
      );

      // The first run still holds its ceiling (nothing has charged it yet):
      // 1,700 + 505 reaches the cap. The automation was waiting for credits,
      // but its balance passes, so the cap's refusal makes it active.
      await query(dbAdapter, [
        "UPDATE automations SET state = 'waiting-for-credits' WHERE automation_id =",
        param(automationId(SPENDING)),
      ]);
      let calls: RunCommandArgs[] = [];
      let capped = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(capped, {
        calls,
        checks: spending({ now }),
      });
      await assertRefused(
        assert,
        capped,
        result,
        calls,
        'monthly-credit-cap-reached',
      );
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SPENDING)))?.state,
        'active',
        'a run refused only for a cap had balance enough, so the automation isn’t waiting for credits',
      );

      let runNow = await newRun(SPENDING);
      result = await attempt(runNow, { checks: spending({ now }) });
      assert.strictEqual(
        result.state,
        'complete',
        'a Run now is charged to whoever clicked, outside the payer’s cap',
      );

      let nextMonth = Date.UTC(2026, 11, 1, 0, 5) / 1000;
      let december = await newRun(SPENDING, { trigger: 'nightly' });
      result = await attempt(december, {
        checks: spending({ now: nextMonth }),
      });
      assert.strictEqual(result.state, 'complete');
    });

    test('the daily cap stops the automation’s runs until the UTC day turns', async function (assert) {
      let now = Date.UTC(2026, 10, 16, 12) / 1000;
      await switchOn(DAILY);
      await fund(OWNER, 10_000);
      await charge(OWNER, 600, now - 60, {
        kind: 'run',
        realm: ri(realm.url),
        runId: (await newRun(DAILY, { trigger: 'nightly' })).id,
        pricingVersion: testPricing().version,
      });

      let capped = await newRun(DAILY, { trigger: 'nightly' });
      let result = await attempt(capped, { checks: spending({ now }) });
      assert.strictEqual(result.reason, 'daily-credit-cap-reached');

      let tomorrow = Date.UTC(2026, 10, 17, 0, 5) / 1000;
      let next = await newRun(DAILY, { trigger: 'nightly' });
      result = await attempt(next, { checks: spending({ now: tomorrow }) });
      assert.strictEqual(result.state, 'complete');
    });

    test('a worker without prices admits no run', async function (assert) {
      await fund(OWNER, 10_000);
      let calls: RunCommandArgs[] = [];
      let run = await newRun(SPENDING);
      let result = await attempt(run, {
        calls,
        checks: spending({ pricing: () => undefined }),
      });
      await assertRefused(assert, run, result, calls, 'pricing-unavailable');
    });

    test('a run holds its ceiling, less the AI the ledger charged it, until its charge releases the hold', async function (assert) {
      let querier = dbAdapterQuerier(dbAdapter);
      let held = (excludeRunId: string = randomUUID()) =>
        creditsHeldByRunsInFlight(querier, { actsAs: OWNER, excludeRunId });
      let meteredCharges = meteredChargesFor(dbAdapter, testPricing);
      await fund(OWNER, 10_000);
      let running = async (path: string) => {
        let run = await newRun(path);
        await query(dbAdapter, [
          "UPDATE automation_runs SET state = 'running', attempt = 7 WHERE id =",
          param(run.id),
        ]);
        return run;
      };

      let run = await running(SPENDING);
      assert.strictEqual(
        await held(),
        0,
        'a run not yet admitted holds nothing',
      );
      await holdAutomationRunCredits(dbAdapter, run.id, 7, 505);
      assert.strictEqual(await held(), 505);
      assert.strictEqual(
        await held(run.id),
        0,
        'a run’s own hold isn’t counted against it',
      );

      await query(dbAdapter, [
        'UPDATE automation_runs SET ai_credits_spent = 120 WHERE id =',
        param(run.id),
      ]);
      assert.strictEqual(
        await held(),
        505,
        'AI the run recorded but the ledger never charged (a cost that couldn’t be learned) stays held',
      );
      await charge(OWNER, 120, Math.floor(Date.now() / 1000), {
        kind: 'ai',
        realm: ri(realm.url),
        runId: run.id,
      });
      assert.strictEqual(
        await held(),
        385,
        'AI the ledger charged is out of the balance already, so it isn’t held twice',
      );

      // Canceled while its tab still runs: no tab time is on the row yet.
      await query(dbAdapter, [
        "UPDATE automation_runs SET state = 'canceled', finished_at = now() WHERE id =",
        param(run.id),
      ]);
      assert.strictEqual(
        await held(),
        385,
        'a run that ended keeps its hold until its charge releases it',
      );
      await query(dbAdapter, [
        'UPDATE automation_runs SET prerender_tab_ms = 1500 WHERE id =',
        param(run.id),
      ]);
      await chargeAutomationRun({
        dbAdapter,
        meteredCharges,
        runId: run.id,
        log,
      });
      assert.strictEqual(await held(), 0, 'its run charge releases the hold');
      let charged = await getAutomationRun(dbAdapter, run.id);
      assert.ok(charged?.creditHoldReleasedAt, 'the release is on the row');

      let unused = await running(SPENDING);
      await holdAutomationRunCredits(dbAdapter, unused.id, 7, 505);
      await query(dbAdapter, [
        "UPDATE automation_runs SET state = 'canceled', finished_at = now() WHERE id =",
        param(unused.id),
      ]);
      assert.strictEqual(await held(), 505);
      await chargeAutomationRun({
        dbAdapter,
        meteredCharges,
        runId: unused.id,
        log,
      });
      assert.strictEqual(
        await held(),
        0,
        'a run with nothing to charge releases its hold once it is charged nothing',
      );

      let stale = await running(SPENDING);
      await holdAutomationRunCredits(dbAdapter, stale.id, 7, 505);
      await query(dbAdapter, [
        "UPDATE automation_runs SET state = 'error', finished_at = now() - interval '2 hours' WHERE id =",
        param(stale.id),
      ]);
      assert.strictEqual(
        await held(),
        0,
        'a hold nothing released lapses an hour after its run ended',
      );
    });
  });
});
