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
import { listAutomationNotices } from '@cardstack/runtime-common/automation-notices';
import { internalKeyFor } from '@cardstack/runtime-common';
import {
  ROOMY_AUTOMATION_CAPS,
  insertUser,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testAccountStandings,
  testAutomationAdmissionChecks,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { buildMintRunToken } from '../lib/run-token.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// An automation run's admission: before a run costs anything, the worker
// checks the automation's row, the person the run acts as, the script, every
// operation the card declares, and the run's spending. A refused run ends as
// an error named by the refusal's code, its tab is never asked to run the
// script, and its log says admission refused it. A refusal a person fixes in
// the secure window leaves them a notice, which the realm server lists for
// them and the secure window marks read.

const realmURL = new URL('http://127.0.0.1:4444/automation-admission-test/');
const secureOriginURL = new URL('https://secure.admission.test/secure');
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
    secureOriginURL,
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
      calls = [],
    }: {
      // Stands in for the worker's admission checks; null for a worker that
      // has none.
      checks?: (
        real: AutomationAdmissionChecks,
      ) => AutomationAdmissionChecks | undefined;
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
    let real = testAutomationAdmissionChecks(
      dbAdapter,
      virtualNetwork,
    )({ definitionLookup });
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
        virtualNetwork,
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
      },
      automationRunDedupeKey(run),
      jobInfo,
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
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'not-a-direct-writer');
    let automation = await getAutomation(dbAdapter, automationId(CLEAN));
    assert.strictEqual(automation?.state, 'paused');
    assert.strictEqual(automation?.pauseReason, 'payer-lost-access');
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
    await insertUser(dbAdapter, OWNER, 'cus_admission', 'owner@example.com');
    let run = await newRun(CLEAN);
    await query(dbAdapter, [
      'UPDATE users SET sessions_revoked_at =',
      param(Math.floor(Date.parse(run.createdAt) / 1000) + 60),
      'WHERE matrix_user_id =',
      param(OWNER),
    ]);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'session-revoked');
  });

  test('sessions revoked before the run was given its identity’s authority don’t refuse it', async function (assert) {
    await insertUser(dbAdapter, OWNER, 'cus_admission', 'owner@example.com');
    let run = await newRun(CLEAN);
    await query(dbAdapter, [
      'UPDATE users SET sessions_revoked_at =',
      param(Math.floor(Date.parse(run.createdAt) / 1000) - 60),
      'WHERE matrix_user_id =',
      param(OWNER),
    ]);
    let result = await attempt(run);
    assert.strictEqual(result.state, 'complete');
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
  });

  test('a script that doesn’t parse is refused before it runs', async function (assert) {
    let run = await newRun(BROKEN);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, { calls });
    await assertRefused(assert, run, result, calls, 'script-error');
    let row = await getAutomationRun(dbAdapter, run.id);
    assert.true(row?.errorMessage?.includes("doesn't parse"));
  });

  test('an operation that isn’t approved refuses the run and leaves the run’s identity one notice', async function (assert) {
    let first = await newRun(NEEDS_APPROVAL);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(first, { calls });
    await assertRefused(assert, first, result, calls, 'binding-not-approved');

    let second = await newRun(NEEDS_APPROVAL);
    result = await attempt(second, { calls });
    await assertRefused(assert, second, result, calls, 'binding-not-approved');

    let notices = await listAutomationNotices(dbAdapter, OWNER, {
      virtualNetwork,
      matrixServerName: 'localhost',
    });
    assert.deepEqual(
      notices.map((notice) => ({
        reason: notice.reason,
        automationId: notice.automationId,
        operation: notice.operation,
        targetType: notice.targetType,
        runId: notice.runId,
      })),
      [
        {
          reason: 'binding-not-approved',
          automationId: automationId(NEEDS_APPROVAL),
          operation: 'list',
          targetType: INBOX,
          runId: first.id,
        },
      ],
      'one unread notice, however many runs it stops',
    );
  });

  test('each refusal a person fixes in the secure window ends the run with its code and leaves a notice', async function (assert) {
    for (let code of [
      'share-suspended',
      'binding-needs-reapproval',
      'credential-rejected',
    ]) {
      let run = await newRun(NEEDS_APPROVAL);
      let calls: RunCommandArgs[] = [];
      let result = await attempt(run, {
        calls,
        checks: (real) => ({
          ...real,
          admitOperation: async () => ({
            status: 403,
            code: code as any,
            title: 'Refused',
            detail: `refused with ${code}`,
          }),
        }),
      });
      await assertRefused(assert, run, result, calls, code);
    }
    let notices = await listAutomationNotices(dbAdapter, OWNER, {
      virtualNetwork,
      matrixServerName: 'localhost',
    });
    assert.deepEqual(notices.map((notice) => notice.reason).sort(), [
      'binding-needs-reapproval',
      'credential-rejected',
      'share-suspended',
    ]);
  });

  test('an operation refused for a reason no one fixes in the secure window leaves no notice', async function (assert) {
    let run = await newRun(NEEDS_APPROVAL);
    let calls: RunCommandArgs[] = [];
    let result = await attempt(run, {
      calls,
      checks: (real) => ({
        ...real,
        admitOperation: async () => ({
          status: 404,
          code: 'target-not-found',
          title: 'Unknown operation',
          detail: 'no such operation',
        }),
      }),
    });
    await assertRefused(assert, run, result, calls, 'target-not-found');
    assert.deepEqual(
      await listAutomationNotices(dbAdapter, OWNER, {
        virtualNetwork,
        matrixServerName: 'localhost',
      }),
      [],
    );
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

  module('the notice routes', function () {
    function appSession(user: string): string {
      return `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
    }

    async function list(authorization: string) {
      return await request
        .get('/_automation-notices')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', authorization);
    }

    async function markRead(authorization: string, ids: unknown[]) {
      return await request
        .post('/_automation-notices/read')
        .set('Authorization', authorization)
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({ data: ids.map((id) => ({ type: 'automation-notice', id })) });
    }

    test('the app’s session lists a person’s notices with the unread count; the secure window marks them read', async function (assert) {
      await attempt(await newRun(NEEDS_APPROVAL));
      let listed = await list(appSession(OWNER));
      assert.strictEqual(listed.status, 200);
      assert.strictEqual(listed.body.meta.unread, 1);
      let [notice] = listed.body.data;
      assert.strictEqual(notice.type, 'automation-notice');
      assert.strictEqual(notice.attributes.reason, 'binding-not-approved');
      assert.strictEqual(notice.attributes.operation, 'list');

      let refused = await markRead(appSession(OWNER), [notice.id]);
      assert.strictEqual(
        refused.status,
        403,
        'the app’s session, which card code holds, can’t clear the badge',
      );

      let marked = await markRead(await secureSessionAuth(dbAdapter, OWNER), [
        notice.id,
      ]);
      assert.strictEqual(marked.status, 200);
      assert.deepEqual(marked.body.meta, { marked: 1, unread: 0 });

      // Read, the notice no longer holds back a new one.
      await attempt(await newRun(NEEDS_APPROVAL));
      let after = await list(appSession(OWNER));
      assert.strictEqual(after.body.data.length, 2);
      assert.strictEqual(after.body.meta.unread, 1);
    });

    test('a notice is listed only while its recipient directly writes the automation’s realm', async function (assert) {
      await attempt(await newRun(NEEDS_APPROVAL));
      await query(dbAdapter, [
        'UPDATE realm_user_permissions SET write = false WHERE realm_url =',
        param(realm.url),
        'AND username =',
        param(OWNER),
      ]);
      let listed = await list(appSession(OWNER));
      assert.deepEqual(listed.body, { data: [], meta: { unread: 0 } });
    });

    test('a request to mark notices read that names something else is refused', async function (assert) {
      let response = await markRead(await secureSessionAuth(dbAdapter, OWNER), [
        'not-an-id',
      ]);
      assert.strictEqual(response.status, 400);
    });
  });
});
