import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  cancelAutomationRun,
  finishAutomationRun,
  rri,
  SupportedMimeType,
  type Realm,
} from '@cardstack/runtime-common';
import {
  RUN_LOG_MAX_BATCH_LINES,
  RUN_LOG_MAX_MESSAGE_CHARS,
  RUN_LOG_PATH,
  appendRunLog,
  maskedRunLogURL,
  readRunLog,
  runLogLokiLine,
  runLogTags,
  scriptRunLogLines,
} from '@cardstack/runtime-common/automation-run-log';
import { callApiLogLine } from '@cardstack/runtime-common/automation-run-limits';
import { RUN_COMMIT_PATH } from '@cardstack/runtime-common/run-overlay';
import { REDACTED } from '@cardstack/runtime-common/redact-secrets';
import {
  automationFixture,
  createAutomationRunToken,
  createJWT,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { resolveLogLine } from '../handlers/handle-request-forward.ts';

// An automation run's log: the script's lines its tab sends to the realm's
// `_run-log` with the run's token, and the platform's own lines for each
// `callApi` call, the commit and a cap that ended the run. Every line is
// redacted as it is stored, and a run's log is capped.

const realmURL = new URL('http://127.0.0.1:4444/automation-run-log-test/');
const VENDOR_PORT = 4543;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const JSONAPI = 'application/vnd.api+json';
const SOURCE = 'application/vnd.card+source';
const OWNER = '@run-log-owner:localhost';
const REALM_USER = '@node-test_realm:localhost';
const FEED = { module: rri(`${realmURL.href}feed`), name: 'Feed' };
const AUTOMATION = 'automation/logged';
const TIGHT = 'automation/tight';
// Shaped like a vendor key, so it is redacted wherever it turns up.
const LEAKED_KEY = 'sk-live-run-log-test-0123456789abcdef';

const feedModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";

  export class Feed extends CardDef {
    @operation static latest = {
      base: 'callApi',
      params: { city: StringField },
      url: '${VENDOR}/status/200',
      query: { city: params('city') },
    };

    @operation static broken = {
      base: 'callApi',
      url: '${VENDOR}/status/503',
    };

    @operation static undeclared = {
      base: 'callApi',
      url: '${VENDOR}/status/200',
    };
  }
`;

module(basename(import.meta.filename), function (hooks) {
  setupCatalogTestSubset(hooks);

  let realm: Realm;
  let dbAdapter: PgAdapter;
  let vendor: StubVendor;

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });
  hooks.beforeEach(function () {
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
  });
  hooks.afterEach(function () {
    resetOutbound();
  });

  const declared = [{ type: FEED, names: ['latest', 'broken'] }];

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'feed.gts': feedModule,
      'notes.txt': 'in the realm',
      ...automationFixture({ operations: declared, path: AUTOMATION }),
      ...automationFixture({
        operations: declared,
        path: TIGHT,
        caps: { callApiCalls: 1 },
      }),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter as PgAdapter;
      vendor.requests.length = 0;
    },
  });

  async function runOf(automation = AUTOMATION) {
    return await createAutomationRunToken(dbAdapter, realm, OWNER, {
      automation,
    });
  }

  async function sendLog(token: string, body: unknown) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${RUN_LOG_PATH.slice(1)}`, {
        method: 'POST',
        headers: {
          Accept: JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    ))!;
    let text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { text };
    }
    return { status: response.status, json };
  }

  async function callApi(
    token: string,
    name: string,
    params: Record<string, unknown> = {},
  ) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': name,
              data: { ...params, meta: { adoptsFrom: FEED } },
            },
          ],
        }),
      }),
    ))!;
    return { status: response.status, text: await response.text() };
  }

  async function logOf(runId: string) {
    return (await readRunLog(dbAdapter, runId))!;
  }

  test("a run's tab sends the script's lines, and the log keeps them in order with their kinds, levels and script lines", async function (assert) {
    let { token, run } = await runOf();
    let at = Date.now();
    let sent = await sendLog(token, {
      events: [
        { kind: 'plan', at, milestones: ['fetch', 'write'] },
        { kind: 'milestone', at, name: 'fetch' },
        { kind: 'count', at, done: 3, total: 10 },
        { kind: 'activity', at, line: 'Fetching the roster' },
        { kind: 'console', at, level: 'warn', message: 'slow page', line: 7 },
        {
          kind: 'error',
          at,
          message: 'Error: no roster',
          line: 12,
          stack:
            'at fetchRoster (script line 12)\nat <anonymous> (script line 30)',
        },
      ],
    });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual(sent.json.data.attributes, { stored: 6, dropped: 0 });

    let { lines, dropped } = await logOf(run.id);
    assert.strictEqual(dropped, 0);
    assert.deepEqual(
      lines.map(({ seq, source, kind, level, message, scriptLine }) => ({
        seq,
        source,
        kind,
        level,
        message,
        scriptLine,
      })),
      [
        {
          seq: 0,
          source: 'script',
          kind: 'plan',
          level: undefined,
          message: 'Plan: fetch → write',
          scriptLine: undefined,
        },
        {
          seq: 1,
          source: 'script',
          kind: 'milestone',
          level: undefined,
          message: 'Milestone: fetch',
          scriptLine: undefined,
        },
        {
          seq: 2,
          source: 'script',
          kind: 'count',
          level: undefined,
          message: '3 of 10',
          scriptLine: undefined,
        },
        {
          seq: 3,
          source: 'script',
          kind: 'activity',
          level: undefined,
          message: 'Fetching the roster',
          scriptLine: undefined,
        },
        {
          seq: 4,
          source: 'script',
          kind: 'console',
          level: 'warn',
          message: 'slow page',
          scriptLine: 7,
        },
        {
          seq: 5,
          source: 'script',
          kind: 'error',
          level: 'error',
          message: 'Error: no roster',
          scriptLine: 12,
        },
      ],
    );
    assert.deepEqual(lines[0].data, { milestones: ['fetch', 'write'] });
    assert.strictEqual(
      lines[5].data?.stack,
      'at fetchRoster (script line 12)\nat <anonymous> (script line 30)',
      "the error's stack is kept in the script's lines",
    );
  });

  test("the script's lines are redacted as they are stored, the run's own token included", async function (assert) {
    let { token, run } = await runOf();
    let sent = await sendLog(token, {
      events: [
        {
          kind: 'console',
          at: Date.now(),
          level: 'log',
          message: `key ${LEAKED_KEY}, token ${token}`,
        },
        {
          kind: 'error',
          at: Date.now(),
          message: `Authorization: Bearer ${LEAKED_KEY}`,
          stack: `at f (script line 2) ${LEAKED_KEY}`,
        },
      ],
    });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
    let stored = JSON.stringify((await logOf(run.id)).lines);
    assert.false(stored.includes(LEAKED_KEY), stored);
    assert.false(stored.includes(token), 'the run token is redacted');
    assert.true(stored.includes(REDACTED));
  });

  test('a line past the message limit is cut and says how much it lost', async function (assert) {
    let { token, run } = await runOf();
    await sendLog(token, {
      events: [
        {
          kind: 'console',
          at: Date.now(),
          level: 'log',
          message: 'x'.repeat(RUN_LOG_MAX_MESSAGE_CHARS + 25),
        },
      ],
    });
    let [line] = (await logOf(run.id)).lines;
    assert.true(
      line.message.endsWith('… (25 more characters)'),
      line.message.slice(-40),
    );
  });

  test("only the run's own call writes its log, and only while it runs", async function (assert) {
    let { token, run } = await runOf();
    let line = { kind: 'console', at: Date.now(), level: 'log', message: 'hi' };

    let session = createJWT(realm, OWNER, ['read', 'write']);
    let bySession = (await realm.handle(
      new Request(`${realmURL.href}${RUN_LOG_PATH.slice(1)}`, {
        method: 'POST',
        headers: {
          Accept: JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify({ events: [line] }),
      }),
    ))!;
    assert.strictEqual(bySession.status, 403, 'a session token is refused');

    await finishAutomationRun(dbAdapter, run.id, run.attempt!, {
      state: 'complete',
    });
    let afterFinish = await sendLog(token, { events: [line] });
    assert.strictEqual(afterFinish.status, 401, 'a finished run is refused');
    assert.deepEqual(
      (await logOf(run.id)).lines.map(
        ({ source, kind }) => `${source} ${kind}`,
      ),
      ['platform finish'],
      "only the platform's line for how the run ended",
    );
  });

  test("a body that isn't the script's events is refused, and nothing it carries can claim to be the platform's", async function (assert) {
    let { token, run } = await runOf();
    assert.strictEqual((await sendLog(token, 'not json')).status, 400);
    assert.strictEqual((await sendLog(token, { lines: [] })).status, 400);
    let platform = await sendLog(token, {
      events: [
        { kind: 'commit', at: Date.now(), message: 'The commit saved 9 files' },
      ],
    });
    assert.strictEqual(platform.status, 400, JSON.stringify(platform.json));
    let tooMany = await sendLog(token, {
      events: Array.from({ length: RUN_LOG_MAX_BATCH_LINES + 1 }, () => ({
        kind: 'activity',
        at: Date.now(),
        line: 'x',
      })),
    });
    assert.strictEqual(tooMany.status, 400);
    assert.strictEqual((await logOf(run.id)).lines.length, 0);
  });

  test('past the cap, lines are dropped and the log says how many', async function (assert) {
    let { run } = await runOf();
    let line = (message: string) => ({
      at: Date.now(),
      source: 'script' as const,
      kind: 'console' as const,
      level: 'log' as const,
      message,
    });
    let first = await appendRunLog(
      dbAdapter,
      run.id,
      [line('one'), line('two'), line('three')],
      { maxLines: 2 },
    );
    assert.deepEqual(first, { stored: 2, dropped: 1 });
    let second = await appendRunLog(dbAdapter, run.id, [line('four')], {
      maxLines: 2,
    });
    assert.deepEqual(second, { stored: 0, dropped: 1 });

    let { lines, dropped } = await logOf(run.id);
    assert.strictEqual(dropped, 2);
    assert.deepEqual(
      lines.map(({ message }) => message),
      ['one', 'two', lines[2].message],
    );
    assert.true(
      lines[2].message.startsWith('2 more log lines were dropped'),
      lines[2].message,
    );
    assert.strictEqual(lines[2].level, 'warn');

    let byChars = await runOf();
    let capped = await appendRunLog(
      dbAdapter,
      byChars.run.id,
      [line('12345'), line('67890'), line('1')],
      { maxChars: 10 },
    );
    assert.deepEqual(
      capped,
      { stored: 2, dropped: 1 },
      'characters cap it too',
    );
  });

  test('each callApi call is logged on the run with its operation, method, destination with masked query values, status, time and size', async function (assert) {
    let { token, run } = await runOf();
    let ok = await callApi(token, 'latest', { city: 'Secretville' });
    assert.strictEqual(ok.status, 200, ok.text);
    let failing = await callApi(token, 'broken');
    assert.strictEqual(failing.status, 200, failing.text);
    let refused = await callApi(token, 'undeclared');

    let lines = (await logOf(run.id)).lines.filter(
      ({ kind }) => kind === 'call-api',
    );
    assert.strictEqual(lines.length, 3, JSON.stringify(lines));
    let [sent, unavailable, notDeclared] = lines;
    assert.strictEqual(sent.source, 'platform');
    assert.strictEqual(sent.level, 'info');
    assert.true(
      sent.message.startsWith(
        `callApi latest GET ${VENDOR}/status/200?city=…: 200 in `,
      ),
      sent.message,
    );
    assert.false(
      JSON.stringify(sent).includes('Secretville'),
      'a query value never reaches the log',
    );
    assert.strictEqual(sent.data?.status, 200);
    assert.strictEqual(typeof sent.data?.ms, 'number');
    assert.true((sent.data?.bytes as number) > 0, 'the response size');

    assert.strictEqual(unavailable.level, 'warn');
    assert.strictEqual(unavailable.data?.status, 503);

    assert.strictEqual(notDeclared.level, 'error');
    assert.strictEqual(notDeclared.data?.code, 'operation-not-declared');
    assert.true(
      notDeclared.message.startsWith(
        'callApi undeclared: refused (operation-not-declared)',
      ),
      notDeclared.message,
    );
    assert.notOk(refused.text.includes('Secretville'));
  });

  test('the log ends with how the run ended: a cap that ended it, a finish, a cancel', async function (assert) {
    let capped = await runOf(TIGHT);
    await callApi(capped.token, 'latest', { city: 'a' });
    await callApi(capped.token, 'latest', { city: 'b' });
    let lines = (await logOf(capped.run.id)).lines;
    // The cap ends the run as it refuses the call, so the finish line comes
    // before the refused call's own line.
    let last = lines.find(({ kind }) => kind === 'finish')!;
    assert.ok(last, JSON.stringify(lines));
    assert.strictEqual(
      lines.filter(({ kind }) => kind === 'finish').length,
      1,
      'one finish line',
    );
    assert.strictEqual(last.level, 'error');
    assert.strictEqual(
      last.message,
      'The run ended with an error (hit-a-cap): The run hit its callApiCalls cap',
    );

    let finished = await runOf();
    await finishAutomationRun(
      dbAdapter,
      finished.run.id,
      finished.run.attempt!,
      {
        state: 'complete',
      },
    );
    let [done] = (await logOf(finished.run.id)).lines;
    assert.strictEqual(done.message, 'The run finished');
    assert.strictEqual(done.level, 'info');

    let timedOut = await runOf();
    await finishAutomationRun(
      dbAdapter,
      timedOut.run.id,
      timedOut.run.attempt!,
      {
        state: 'error',
        reason: 'timed-out',
        message:
          'The automation run reached its time limit of 30 s (its seconds cap)',
      },
    );
    let [late] = (await logOf(timedOut.run.id)).lines;
    assert.strictEqual(
      late.message,
      'The run ended with an error (timed-out): The automation run reached its time limit of 30 s (its seconds cap)',
      'a run whose tab can no longer send still ends its log with why',
    );

    let canceled = await runOf();
    await cancelAutomationRun(dbAdapter, canceled.run.id, OWNER);
    let [stopped] = (await logOf(canceled.run.id)).lines;
    assert.strictEqual(stopped.message, `The run was canceled by ${OWNER}`);
    assert.strictEqual(stopped.level, 'warn');
  });

  test('a time no Date holds is stored at the time it arrived, and a script line past an integer is left off', async function (assert) {
    let { token, run } = await runOf();
    let before = Date.now();
    let sent = await sendLog(token, {
      events: [
        {
          kind: 'console',
          at: 1e300,
          level: 'log',
          message: 'far future',
          line: 2 ** 40,
        },
      ],
    });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
    let [line] = (await logOf(run.id)).lines;
    assert.true(line.at >= before, `stored at ${line.at}`);
    assert.strictEqual(line.scriptLine, undefined);
  });

  test('the commit is logged on the run: the files it saved, or why it was refused', async function (assert) {
    let { token, run } = await runOf();
    let staged = (await realm.handle(
      new Request(`${realmURL.href}out/report.txt`, {
        method: 'POST',
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        body: 'hello',
      }),
    ))!;
    assert.strictEqual(staged.status, 204);
    let commit = (await realm.handle(
      new Request(`${realmURL.href}${RUN_COMMIT_PATH.slice(1)}`, {
        method: 'POST',
        headers: { Accept: JSONAPI, Authorization: `Bearer ${token}` },
      }),
    ))!;
    assert.strictEqual(commit.status, 200, await commit.clone().text());
    let line = (await logOf(run.id)).lines.find(
      ({ kind }) => kind === 'commit',
    );
    assert.strictEqual(
      line?.message,
      'The commit saved 1 file: out/report.txt',
    );
    assert.strictEqual(line?.data?.files, 1);

    let again = (await realm.handle(
      new Request(`${realmURL.href}${RUN_COMMIT_PATH.slice(1)}`, {
        method: 'POST',
        headers: { Accept: JSONAPI, Authorization: `Bearer ${token}` },
      }),
    ))!;
    assert.strictEqual(
      again.status,
      200,
      'a repeated commit answers as it did',
    );
    assert.strictEqual(
      (await logOf(run.id)).lines.filter(({ kind }) => kind === 'commit')
        .length,
      1,
      'and adds no second commit line',
    );

    // The realm holds notes.txt as a file, so a file under it clashes.
    let refused = await runOf();
    let clashing = (await realm.handle(
      new Request(`${realmURL.href}notes.txt/inner.txt`, {
        method: 'POST',
        headers: { Accept: SOURCE, Authorization: `Bearer ${refused.token}` },
        body: 'inner',
      }),
    ))!;
    assert.strictEqual(clashing.status, 204);
    let answer = (await realm.handle(
      new Request(`${realmURL.href}${RUN_COMMIT_PATH.slice(1)}`, {
        method: 'POST',
        headers: { Accept: JSONAPI, Authorization: `Bearer ${refused.token}` },
      }),
    ))!;
    assert.strictEqual(answer.status, 409, await answer.clone().text());
    let refusal = (await logOf(refused.run.id)).lines.find(
      ({ kind }) => kind === 'commit',
    );
    assert.strictEqual(refusal?.level, 'error');
    assert.true(
      refusal?.message.startsWith('The commit was refused (path-clash)'),
      refusal?.message,
    );
  });

  test('the Loki line carries the automation, run and queue job, with the message quoted last', async function (assert) {
    let tags = runLogTags({
      automationId: 'http://x/automation/a',
      runId: 'r-1',
      jobId: 42,
    });
    assert.strictEqual(
      runLogLokiLine(tags, {
        seq: 3,
        at: 0,
        source: 'platform',
        kind: 'call-api',
        level: 'info',
        message:
          'callApi latest GET https://v.example/x: 200 in 5 ms run=forged',
        data: { status: 200, ms: 5, destination: 'https://v.example/x' },
      }),
      '[automation-run-log] automation=http://x/automation/a run=r-1 job=42 seq=3 source=platform kind=call-api level=info status=200 ms=5 msg="callApi latest GET https://v.example/x: 200 in 5 ms run=forged"',
    );
  });

  test('a URL is logged with its query values masked', function (assert) {
    assert.strictEqual(
      maskedRunLogURL('https://api.example.com/v1/items?key=abc&page=2#x'),
      'https://api.example.com/v1/items?key=…&page=…',
    );
    assert.strictEqual(
      maskedRunLogURL('https://api.example.com/v1/items'),
      'https://api.example.com/v1/items',
    );
  });

  test('platform lines for callApi and resolve read plainly', function (assert) {
    assert.strictEqual(
      callApiLogLine({
        operation: 'list',
        method: 'POST',
        url: 'https://v.example/items?q=secret',
        status: 201,
        ms: 12,
        bytes: 300,
      }).message,
      'callApi list POST https://v.example/items?q=…: 201 in 12 ms, 300 bytes',
    );
    assert.strictEqual(
      callApiLogLine({
        operation: 'list',
        code: 'failed',
        detail: 'socket hang up',
      }).message,
      'callApi list: failed: socket hang up',
    );
    assert.strictEqual(
      resolveLogLine({
        model: 'anthropic/claude',
        status: 200,
        ms: 800,
        costInUsd: 0.0012,
      }).message,
      'resolve anthropic/claude: 200 (800 ms, $0.001200)',
    );
    assert.strictEqual(
      resolveLogLine({ model: 'anthropic/claude' }).level,
      'error',
    );
  });

  test('the parser takes only the run progress events', function (assert) {
    let parsed = scriptRunLogLines({
      events: [{ kind: 'console', at: 1, level: 'shout', message: 'x' }],
    });
    assert.false(parsed.ok, 'an unknown console level is refused');
    let ok = scriptRunLogLines({
      events: [{ kind: 'count', at: 1, done: 2 }],
    });
    assert.true(ok.ok);
    if (ok.ok) {
      assert.strictEqual(ok.lines[0].message, '2');
    }
  });
});
