import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
  spendCredits,
} from '@cardstack/billing/billing-queries';
import {
  createAutomationRun,
  DAYS_PER_AVERAGE_MONTH,
  insertPermissions,
  param,
  query,
  ri,
  rri,
  type AutomationRun,
  type Realm,
} from '@cardstack/runtime-common';
import {
  appendRunLog,
  logRunPlatformLine,
} from '@cardstack/runtime-common/automation-run-log';
import { callApiLogLine } from '@cardstack/runtime-common/automation-run-limits';
import {
  AUTOMATION_PREVIEW_FILE_PATH,
  AUTOMATION_RUN_REPORT_PATH,
  AUTOMATION_STORAGE_PATH,
} from '@cardstack/runtime-common/automation-routes';
import {
  realmSecretSeed,
  setupPermissionedRealmCached,
  setupProcessPricing,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { resolveLogLine } from '../handlers/handle-request-forward.ts';
import { exactMeteredCredits } from '../lib/metered-charge.ts';
import { BYTES_PER_GB, currentPricing } from '../lib/pricing.ts';

// What the automations console reads: a run's report, a Preview's staged
// file and an automation's storage. Each answers only a direct writer of the
// realm the request names, and shows a person's Matrix id only to a viewer
// who shares a named realm grant with that person (ADR 011 §1.2).

const realmURL = new URL(
  'http://127.0.0.1:4444/automation-console-reads-test/',
);
const OTHER_REALM = 'http://127.0.0.1:4444/automation-console-reads-other/';
const OWNER = '@console-reads-owner:localhost';
const WRITER = '@console-reads-writer:localhost';
const READER = '@console-reads-reader:localhost';
// Holds a grant only in another realm, so shares none with WRITER.
const OUTSIDER = '@console-reads-outsider:localhost';
const REALM_USER = '@node-test_realm:localhost';

const AUTOMATION = 'automation/nightly';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let request: SuperTest<Test>;

  setupProcessPricing(hooks, 'automation-console-reads-test');

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [WRITER]: ['read', 'write'],
      [READER]: ['read'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'notes/seed.txt': 'seed',
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      request = args.request;
    },
  });

  hooks.beforeEach(async function () {
    await insertPermissions(dbAdapter, new URL(OTHER_REALM), {
      [OUTSIDER]: ['read', 'write'],
    });
  });

  function auth(user: string): string {
    return `Bearer ${createRealmServerJWT(
      { user, sessionRoom: 'test-session' },
      realmSecretSeed,
    )}`;
  }

  // OWNER, with credits to spend. The realm's fixture gives each user it
  // grants a `users` row.
  async function ownerUser() {
    let user = await getUserByMatrixUserId(dbAdapter, OWNER);
    if (!user) {
      throw new Error(`expected a users row for ${OWNER}`);
    }
    await addToCreditsLedger(dbAdapter, {
      userId: user.id,
      creditAmount: 1_000,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
    return user;
  }

  function automationURL(): string {
    return `${realm.url}${AUTOMATION}`;
  }

  async function newRun(
    actsAs: string,
    { dryRun = false, slot = randomUUID() } = {},
  ): Promise<AutomationRun> {
    return await createAutomationRun(dbAdapter, {
      automationId: rri(automationURL()),
      realm: ri(realm.url),
      trigger: 'manual',
      slot,
      actsAs,
      dryRun,
    });
  }

  async function setRun(runId: string, set: string) {
    await dbAdapter.execute(`UPDATE automation_runs SET ${set} WHERE id = $1`, {
      bind: [runId],
    });
  }

  function get(path: string, user: string, params: Record<string, string>) {
    return request
      .get(path)
      .query({ realm: realm.url, ...params })
      .set('Authorization', auth(user));
  }

  module('a run’s report', function () {
    test('a direct writer reads a run’s timings, log summary, calls, writes and cost', async function (assert) {
      let run = await newRun(OWNER);
      await setRun(
        run.id,
        `state = 'complete', started_at = created_at + interval '2 seconds',
         commit_started_at = created_at + interval '5 seconds',
         committed_at = created_at + interval '6 seconds',
         finished_at = created_at + interval '6 seconds', writes = 2,
         call_api_calls = 1, resolve_calls = 1`,
      );
      let now = Date.now();
      await appendRunLog(dbAdapter, run.id, [
        {
          at: now,
          source: 'script',
          kind: 'console',
          level: 'log',
          message: 'starting',
        },
        {
          at: now,
          source: 'script',
          kind: 'console',
          level: 'warn',
          message: 'slow vendor',
        },
      ]);
      await logRunPlatformLine(
        dbAdapter,
        run.id,
        callApiLogLine({
          operation: 'listIssues',
          method: 'GET',
          url: 'https://api.example.com/issues?token=abc',
          status: 200,
          ms: 120,
          bytes: 2048,
        } as Parameters<typeof callApiLogLine>[0]),
      );
      await logRunPlatformLine(dbAdapter, run.id, {
        ...resolveLogLine({ model: 'test/model', status: 200, ms: 900 }),
        // A stored line can carry an AI request's cost in its data.
        data: { model: 'test/model', status: 200, ms: 900, costInUsd: 0.002 },
      });
      await logRunPlatformLine(dbAdapter, run.id, {
        kind: 'commit',
        level: 'info',
        message: 'The commit saved 2 files: out/a.json, out/b.json',
        data: {
          status: 201,
          files: 2,
          paths: ['out/a.json', 'out/b.json'],
          ms: 40,
        },
      });
      let owner = await ownerUser();
      let spent = await spendCredits(dbAdapter, owner.id, 3, {
        kind: 'run',
        runId: run.id,
        realm: ri(realm.url),
        pricingVersion: 'test',
      });
      assert.strictEqual(spent, 'charged', 'the run is charged');

      let response = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, {
        run: run.id,
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      let { data } = response.body;
      assert.strictEqual(data.type, 'automation-run-report');
      assert.strictEqual(data.id, run.id);
      let a = data.attributes;
      assert.strictEqual(a.automation, automationURL());
      assert.strictEqual(a.state, 'complete');
      assert.false(a.dryRun);
      assert.strictEqual(
        a.actsAs,
        OWNER,
        'a writer sharing the realm sees who the run acts as',
      );
      assert.false(a.viewerIsActsAs);
      assert.strictEqual(a.canceledBy, null);
      assert.false(a.canceledByAPerson);
      assert.strictEqual(a.timings.queuedMs, 2000);
      assert.strictEqual(a.timings.runMs, 4000);
      assert.strictEqual(a.timings.commitMs, 1000);
      assert.deepEqual(
        a.log,
        {
          lines: 5,
          dropped: 0,
          byLevel: { log: 1, warn: 1, info: 3 },
          byKind: { console: 2, 'call-api': 1, resolve: 1, commit: 1 },
        },
        'the log is counted by level and kind, without its text',
      );
      assert.strictEqual(a.callApiCalls.length, 1);
      let [call] = a.callApiCalls;
      assert.strictEqual(call.operation, 'listIssues');
      assert.strictEqual(call.method, 'GET');
      assert.strictEqual(call.status, 200);
      assert.strictEqual(call.ms, 120);
      assert.strictEqual(call.bytes, 2048);
      assert.notOk(
        String(call.destination).includes('abc'),
        `the destination's query values are masked: ${call.destination}`,
      );
      assert.strictEqual(a.resolveCalls.length, 1);
      assert.strictEqual(a.resolveCalls[0].model, 'test/model');
      assert.notOk(
        'costInUsd' in a.resolveCalls[0],
        'a writer never reads an AI request’s cost',
      );
      assert.deepEqual(a.writes, {
        count: 2,
        committed: ['out/a.json', 'out/b.json'],
      });
      assert.deepEqual(a.cost.creditsByKind, { run: 3 });
      assert.strictEqual(a.cost.credits, 3);
      assert.strictEqual(a.milestones.runId, run.id);
      assert.deepEqual(a.milestones.milestones, []);
    });

    test('who a run acts as and who canceled it are hidden from a writer who shares no grant with them', async function (assert) {
      let run = await newRun(OUTSIDER);
      await setRun(
        run.id,
        `state = 'canceled', canceled_by = '${OUTSIDER}', finished_at = now(),
         error_reason = 'not-a-direct-writer',
         error_message = '${OUTSIDER}, whom the run acts as, is no longer a direct writer of ${realm.url}; ${OWNER} pays for the automation'`,
      );
      let response = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, {
        run: run.id,
      });
      assert.strictEqual(response.status, 200, response.text);
      let a = response.body.data.attributes;
      assert.strictEqual(a.actsAs, null, 'who the run acts as is hidden');
      assert.false(a.viewerIsActsAs);
      assert.strictEqual(a.canceledBy, null, 'who canceled it is hidden');
      assert.true(a.canceledByAPerson, 'but a person canceled it');
      assert.false(a.viewerCanceled);
      assert.strictEqual(
        a.errorMessage,
        `someone, whom the run acts as, is no longer a direct writer of ${realm.url}; ${OWNER} pays for the automation`,
        'the error message hides the id the viewer may not see, and keeps the one the viewer may',
      );
      assert.notOk(response.text.includes(OUTSIDER), 'the id appears nowhere');

      await setRun(run.id, `acts_as = '${WRITER}', canceled_by = '${WRITER}'`);
      let own = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, { run: run.id });
      let ownAttributes = own.body.data.attributes;
      assert.strictEqual(
        ownAttributes.actsAs,
        WRITER,
        'a viewer sees their own id',
      );
      assert.true(ownAttributes.viewerIsActsAs);
      assert.strictEqual(ownAttributes.canceledBy, WRITER);
      assert.true(ownAttributes.viewerCanceled);
    });

    test('a complete Preview’s report lists the files it staged, or the Preview that replaced them', async function (assert) {
      let run = await newRun(WRITER, { dryRun: true });
      await setRun(run.id, `state = 'complete', finished_at = now()`);
      await dbAdapter.execute(
        `INSERT INTO automation_preview_files (run_id, path, content, size) VALUES ($1, 'out/b.json', 'bb', 2), ($1, 'out/a.json', 'a', 1)`,
        { bind: [run.id] },
      );
      let response = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, {
        run: run.id,
      });
      assert.strictEqual(response.status, 200, response.text);
      let a = response.body.data.attributes;
      assert.true(a.dryRun);
      assert.deepEqual(a.writes, {
        count: 0,
        staged: [
          { path: 'out/a.json', size: 1 },
          { path: 'out/b.json', size: 2 },
        ],
      });

      let later = await newRun(WRITER, { dryRun: true });
      await dbAdapter.execute(
        `DELETE FROM automation_preview_files WHERE run_id = $1`,
        { bind: [run.id] },
      );
      await setRun(run.id, `preview_replaced_by = '${later.id}'`);
      let replaced = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, {
        run: run.id,
      });
      assert.deepEqual(replaced.body.data.attributes.writes, {
        count: 0,
        staged: [],
        stagedReplacedBy: later.id,
      });
    });

    test('a caller who is not a direct writer is refused, and a run of another realm is not found', async function (assert) {
      let run = await newRun(OWNER);
      let reader = await get(AUTOMATION_RUN_REPORT_PATH, READER, {
        run: run.id,
      });
      assert.strictEqual(reader.status, 403, reader.text);
      let outsider = await get(AUTOMATION_RUN_REPORT_PATH, OUTSIDER, {
        run: run.id,
      });
      assert.strictEqual(outsider.status, 403, outsider.text);
      let unknown = await get(AUTOMATION_RUN_REPORT_PATH, READER, {
        run: randomUUID(),
      });
      assert.strictEqual(
        unknown.status,
        403,
        'a non-writer is refused the same way whether or not the run exists',
      );
      let anonymous = await request
        .get(AUTOMATION_RUN_REPORT_PATH)
        .query({ realm: realm.url, run: run.id });
      assert.strictEqual(anonymous.status, 401, anonymous.text);

      let elsewhere = await createAutomationRun(dbAdapter, {
        automationId: rri(`${OTHER_REALM}automation/x`),
        realm: ri(OTHER_REALM),
        trigger: 'manual',
        slot: randomUUID(),
        actsAs: OUTSIDER,
      });
      let other = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, {
        run: elsewhere.id,
      });
      assert.strictEqual(other.status, 404, other.text);
      let malformed = await get(AUTOMATION_RUN_REPORT_PATH, WRITER, {
        run: 'nope',
      });
      assert.strictEqual(malformed.status, 404, malformed.text);
    });
  });

  module('a Preview’s staged file', function () {
    test('a direct writer reads one staged file’s bytes', async function (assert) {
      let run = await newRun(OWNER, { dryRun: true });
      await setRun(run.id, `state = 'complete', finished_at = now()`);
      await dbAdapter.execute(
        `INSERT INTO automation_preview_files (run_id, path, content, size) VALUES ($1, 'out/page.html', convert_to('<script>alert(1)</script>', 'UTF8'), 25)`,
        { bind: [run.id] },
      );
      let response = await get(AUTOMATION_PREVIEW_FILE_PATH, WRITER, {
        run: run.id,
        path: 'out/page.html',
      }).buffer(true);
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(
        response.headers['content-type'],
        'application/octet-stream',
        'the script’s bytes are never served as the type they claim',
      );
      assert.strictEqual(response.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(
        Buffer.from(response.body).toString('utf8'),
        '<script>alert(1)</script>',
      );

      let missing = await get(AUTOMATION_PREVIEW_FILE_PATH, WRITER, {
        run: run.id,
        path: 'out/none.html',
      });
      assert.strictEqual(missing.status, 404, missing.text);
      let noPath = await get(AUTOMATION_PREVIEW_FILE_PATH, WRITER, {
        run: run.id,
      });
      assert.strictEqual(noPath.status, 400, noPath.text);
      let reader = await get(AUTOMATION_PREVIEW_FILE_PATH, READER, {
        run: run.id,
        path: 'out/page.html',
      });
      assert.strictEqual(reader.status, 403, reader.text);
    });
  });

  module('an automation’s storage', function () {
    async function writeAsRun(runId: string, path: string, content: string) {
      await realm.write(path, content, {
        automationRun: { runId, automationId: rri(automationURL()) },
      });
    }

    test('a direct writer reads the files the automation’s runs created, their bytes and the daily charge', async function (assert) {
      let run = await newRun(OWNER);
      await writeAsRun(run.id, 'out/report.txt', 'hello world');
      await writeAsRun(run.id, 'out/log.txt', 'line one\n');
      // A later run, which the run list puts ahead of the run that created
      // the files.
      let later = await newRun(OWNER);
      await setRun(run.id, "created_at = '2026-11-14T08:00:00Z'");
      await setRun(later.id, "created_at = '2026-11-15T08:00:00Z'");
      await query(dbAdapter, [
        'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since) VALUES (',
        param(rri(automationURL())),
        ',',
        param(ri(realm.url)),
        ',',
        param(OWNER),
        ", 'active', '{}'::jsonb, '{}'::jsonb, now())",
      ]);
      let owner = await ownerUser();
      for (let day of ['2026-11-14', '2026-11-16']) {
        if (day === '2026-11-16') {
          // One daily credit, so this charge draws a credit from the daily
          // bucket and a credit from the extra one: two ledger rows.
          await addToCreditsLedger(dbAdapter, {
            userId: owner.id,
            creditAmount: 1,
            creditType: 'daily_credit',
            subscriptionCycleId: null,
          });
        }
        let spent = await spendCredits(dbAdapter, owner.id, 2, {
          kind: 'storage',
          realm: ri(realm.url),
          automationId: rri(automationURL()),
          day,
          pricingVersion: 'test',
        });
        assert.strictEqual(
          spent,
          'charged',
          `the storage of ${day} is charged`,
        );
      }

      let [{ rows }] = (await dbAdapter.execute(
        `SELECT COUNT(*) AS rows FROM credits_ledger WHERE charge_kind = 'storage' AND charge_day = '2026-11-16'`,
      )) as { rows: string }[];
      assert.strictEqual(
        Number(rows),
        2,
        'the charge of 2026-11-16 is two ledger rows',
      );

      let response = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: automationURL(),
      });
      assert.strictEqual(response.status, 200, response.text);
      let { data } = response.body;
      assert.strictEqual(data.type, 'automation-storage');
      assert.strictEqual(data.id, automationURL());
      let a = data.attributes;
      assert.true(a.switchedOn);
      assert.strictEqual(
        a.payer,
        OWNER,
        'a writer sharing the realm sees the payer',
      );
      assert.false(a.viewerIsPayer);
      assert.deepEqual(
        a.files.map((f: { path: string; run: string; fileBytes: number }) => [
          f.path,
          f.run,
          f.fileBytes,
        ]),
        [
          ['out/log.txt', run.id, 'line one\n'.length],
          ['out/report.txt', run.id, 'hello world'.length],
        ],
      );
      assert.strictEqual(
        a.fileBytes,
        'line one\n'.length + 'hello world'.length,
      );
      assert.deepEqual(
        a.files.map((f: { runsAhead: number | null }) => f.runsAhead),
        [1, 1],
        'one run is listed ahead of the run that created each file',
      );
      let pricing = currentPricing()!;
      assert.strictEqual(
        a.dailyCredits,
        exactMeteredCredits(
          {
            file_storage_gb_months:
              a.fileBytes / BYTES_PER_GB / DAYS_PER_AVERAGE_MONTH,
            database_storage_gb_months:
              a.indexBytes / BYTES_PER_GB / DAYS_PER_AVERAGE_MONTH,
          },
          pricing,
        ),
        'a day of the storage costs its bytes at the server’s prices',
      );
      assert.ok(a.dailyCredits > 0);
      assert.strictEqual(a.pricingVersion, pricing.version);
      assert.deepEqual(
        a.charges,
        [
          {
            day: '2026-11-16',
            firstDay: '2026-11-16',
            days: 0,
            fileBytes: 0,
            indexBytes: 0,
            credits: 2,
          },
          {
            day: '2026-11-14',
            firstDay: '2026-11-14',
            days: 0,
            fileBytes: 0,
            indexBytes: 0,
            credits: 2,
          },
        ],
        'the storage charges written so far, newest first, each with no measured day to list',
      );
      assert.false(a.moreCharges, 'every charge is listed');
      assert.strictEqual(
        a.chargeStopped,
        null,
        'Boxel charges for the storage of an active automation',
      );
    });

    test('each charge lists the days it billed since the charge before, from the switch-on day, with their bytes averaged', async function (assert) {
      await query(dbAdapter, [
        'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since, switched_on_at) VALUES (',
        param(rri(automationURL())),
        ',',
        param(ri(realm.url)),
        ',',
        param(OWNER),
        ", 'active', '{}'::jsonb, '{}'::jsonb, now(), '2026-11-10T09:00:00Z')",
      ]);
      // 2026-11-08 was measured before a removal and never charged, and
      // 2026-11-13 the automation spent wholly stopped, so neither is billed.
      let measured: [string, number, number][] = [
        ['2026-11-08', 9000, 900],
        ['2026-11-10', 1000, 100],
        ['2026-11-11', 2000, 200],
        ['2026-11-12', 3000, 300],
        ['2026-11-14', 4000, 0],
        ['2026-11-15', 6000, 100],
      ];
      for (let [day, fileBytes, indexBytes] of measured) {
        await query(dbAdapter, [
          'INSERT INTO automation_storage_days (automation_id, day, realm, file_bytes, index_bytes) VALUES (',
          param(rri(automationURL())),
          ',',
          param(day),
          '::date,',
          param(ri(realm.url)),
          ',',
          param(fileBytes),
          ',',
          param(indexBytes),
          ')',
        ]);
      }
      let owner = await ownerUser();
      for (let day of ['2026-11-12', '2026-11-15']) {
        let spent = await spendCredits(dbAdapter, owner.id, 1, {
          kind: 'storage',
          realm: ri(realm.url),
          automationId: rri(automationURL()),
          day,
          pricingVersion: 'test',
        });
        assert.strictEqual(
          spent,
          'charged',
          `the storage through ${day} is charged`,
        );
      }

      let response = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: automationURL(),
      });

      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data.attributes.charges, [
        {
          day: '2026-11-15',
          firstDay: '2026-11-14',
          days: 2,
          fileBytes: 5000,
          indexBytes: 50,
          credits: 1,
        },
        {
          day: '2026-11-12',
          firstDay: '2026-11-10',
          days: 3,
          fileBytes: 2000,
          indexBytes: 200,
          credits: 1,
        },
      ]);
    });

    test('the route lists the newest 62 charges, says older ones exist, and the oldest listed still spans from the charge before', async function (assert) {
      await query(dbAdapter, [
        'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since, switched_on_at) VALUES (',
        param(rri(automationURL())),
        ',',
        param(ri(realm.url)),
        ',',
        param(OWNER),
        ", 'active', '{}'::jsonb, '{}'::jsonb, now(), '2026-01-01T08:00:00Z')",
      ]);
      let owner = await ownerUser();
      // 63 charges, every other day, each billing the two days it covers.
      let days: string[] = [];
      for (let i = 0; i < 63; i++) {
        let first = new Date(Date.UTC(2026, 0, 1 + 2 * i));
        let last = new Date(Date.UTC(2026, 0, 2 + 2 * i));
        for (let day of [first, last]) {
          await query(dbAdapter, [
            'INSERT INTO automation_storage_days (automation_id, day, realm, file_bytes, index_bytes) VALUES (',
            param(rri(automationURL())),
            ',',
            param(day.toISOString().slice(0, 10)),
            '::date,',
            param(ri(realm.url)),
            ', 1000, 0)',
          ]);
        }
        days.push(last.toISOString().slice(0, 10));
        await spendCredits(dbAdapter, owner.id, 1, {
          kind: 'storage',
          realm: ri(realm.url),
          automationId: rri(automationURL()),
          day: last.toISOString().slice(0, 10),
          pricingVersion: 'test',
        });
      }

      let response = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: automationURL(),
      });

      assert.strictEqual(response.status, 200, response.text);
      let a = response.body.data.attributes;
      assert.strictEqual(a.charges.length, 62);
      assert.true(a.moreCharges, 'the oldest charge is left out');
      assert.strictEqual(a.charges[0].day, days[62]);
      let oldest = a.charges[61];
      assert.strictEqual(oldest.day, days[1]);
      assert.strictEqual(
        oldest.firstDay,
        '2026-01-03',
        'the oldest listed charge starts after the charge the listing leaves out',
      );
      assert.strictEqual(oldest.days, 2);
    });

    test('a paused automation’s storage says why and since when Boxel stopped charging', async function (assert) {
      await query(dbAdapter, [
        'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since) VALUES (',
        param(rri(automationURL())),
        ',',
        param(ri(realm.url)),
        ',',
        param(OWNER),
        ", 'active', '{}'::jsonb, '{}'::jsonb, now())",
      ]);
      await dbAdapter.execute(
        `UPDATE automations SET state = 'paused', pause_reason = 'payer-lost-access' WHERE automation_id = $1`,
        { bind: [rri(automationURL())] },
      );
      await dbAdapter.execute(
        `UPDATE automation_state_changes
         SET changed_at = CASE state WHEN 'paused' THEN '2026-11-15T10:00:00Z'::timestamptz
                                     ELSE '2026-11-14T08:00:00Z'::timestamptz END
         WHERE automation_id = $1`,
        { bind: [rri(automationURL())] },
      );

      let response = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: automationURL(),
      });

      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.data.attributes.chargeStopped, {
        state: 'paused',
        pauseReason: 'payer-lost-access',
        since: '2026-11-15T10:00:00.000Z',
        fromDay: '2026-11-16',
      });
    });

    test('a payer who shares no grant with the viewer is hidden, and nothing is listed for an automation whose runs created nothing', async function (assert) {
      await query(dbAdapter, [
        'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since) VALUES (',
        param(rri(automationURL())),
        ',',
        param(ri(realm.url)),
        ',',
        param(OUTSIDER),
        ", 'active', '{}'::jsonb, '{}'::jsonb, now())",
      ]);
      let response = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: automationURL(),
      });
      assert.strictEqual(response.status, 200, response.text);
      let a = response.body.data.attributes;
      assert.strictEqual(a.payer, null, 'the payer is hidden');
      assert.false(a.viewerIsPayer);
      assert.notOk(response.text.includes(OUTSIDER), 'the id appears nowhere');
      assert.deepEqual(a.files, []);
      assert.strictEqual(a.fileBytes, 0);
      assert.strictEqual(a.dailyCredits, 0);
      assert.deepEqual(a.charges, []);
    });

    test('an automation row, a file or a charge that records another realm is left out', async function (assert) {
      let elsewhere = ri(OTHER_REALM);
      await query(dbAdapter, [
        'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since) VALUES (',
        param(rri(automationURL())),
        ',',
        param(elsewhere),
        ',',
        param(OWNER),
        ", 'active', '{}'::jsonb, '{}'::jsonb, now())",
      ]);
      let owner = await ownerUser();
      let spent = await spendCredits(dbAdapter, owner.id, 2, {
        kind: 'storage',
        realm: elsewhere,
        automationId: rri(automationURL()),
        day: '2026-11-15',
        pricingVersion: 'test',
      });
      assert.strictEqual(spent, 'charged');
      await dbAdapter.execute(
        `INSERT INTO automation_files (realm_url, file_path, automation_id, run_id) VALUES ($1, 'notes/seed.txt', $2, $3)`,
        { bind: [OTHER_REALM, rri(automationURL()), randomUUID()] },
      );

      let response = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: automationURL(),
      });
      assert.strictEqual(response.status, 200, response.text);
      let a = response.body.data.attributes;
      assert.false(a.switchedOn, 'a row of another realm reads as no row');
      assert.strictEqual(a.payer, null);
      assert.deepEqual(a.files, []);
      assert.deepEqual(a.charges, []);
    });

    test('a caller who is not a direct writer is refused, and an automation outside the realm is a bad request', async function (assert) {
      let reader = await get(AUTOMATION_STORAGE_PATH, READER, {
        automation: automationURL(),
      });
      assert.strictEqual(reader.status, 403, reader.text);
      let outside = await get(AUTOMATION_STORAGE_PATH, WRITER, {
        automation: `${OTHER_REALM}automation/x`,
      });
      assert.strictEqual(outside.status, 400, outside.text);
    });
  });
});
