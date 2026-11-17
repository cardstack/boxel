import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
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
  type AutomationRun,
  type AutomationScriptOutcome,
  type JobInfo,
  type Prerenderer,
  type Realm,
  type RunCommandArgs,
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
  switchOnAutomation,
} from '@cardstack/runtime-common/automations';
import { internalKeyFor } from '@cardstack/runtime-common';
import {
  ROOMY_AUTOMATION_CAPS,
  realmSecretSeed,
  createJWT,
  setupPermissionedRealmCached,
  testAccountStandings,
  testAutomationAdmissionChecks,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
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
  }: {
    operations?: { targetType: typeof INBOX; operation: string }[];
    script?: string;
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
          caps: { ...ROOMY_AUTOMATION_CAPS, seconds: 300 },
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

  // A tab that answers `outcome`, counting how often it is asked.
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
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'not-a-direct-writer');
    let automation = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(automation?.state, 'paused');
    assert.strictEqual(automation?.pauseReason, 'payer-lost-access');
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
    let result = await attempt(revoked, { calls });
    await assertRefused(assert, revoked, result, calls, 'session-revoked');
    let row = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(row?.state, 'paused');
    assert.strictEqual(row?.pauseReason, 'payer-lost-access');

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
});
