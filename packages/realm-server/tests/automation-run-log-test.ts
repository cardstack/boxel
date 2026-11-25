import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  cancelAutomationRun,
  finishAutomationRun,
  startAutomationRunAttempt,
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
import {
  RUN_MAX_MILESTONES,
  RUN_MAX_TASKS,
  RUN_TASK_MAX_CHARS,
  readLastRunMilestones,
  readRunMilestones,
  setAutomationMilestoneSink,
  type AutomationMilestoneEvent,
} from '@cardstack/runtime-common/automation-run-milestones';
import {
  RUN_COMMIT_PATH,
  stageRunOverlayFile,
} from '@cardstack/runtime-common/run-overlay';
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
import {
  resolveLogLine,
  tokensOf,
} from '../handlers/handle-request-forward.ts';

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
        { kind: 'task', at, text: 'Fetched 3 rosters' },
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
          kind: 'task',
          level: undefined,
          message: 'Task: Fetched 3 rosters',
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

  test("the run's transforms are stored as one transform line, with their tally", async function (assert) {
    let { token, run } = await runOf();
    let sent = await sendLog(token, {
      events: [
        {
          kind: 'transform',
          at: Date.now(),
          calls: 2,
          failed: 1,
          ms: 340,
          inBytes: 1200,
          outBytes: 80,
        },
      ],
    });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
    let { lines } = await logOf(run.id);
    assert.deepEqual(
      lines.map(({ source, kind, level, message, data }) => ({
        source,
        kind,
        level,
        message,
        data,
      })),
      [
        {
          source: 'script',
          kind: 'transform',
          level: undefined,
          message: 'Transforms: 2 calls, 1 failed, 340 ms',
          data: { calls: 2, failed: 1, ms: 340, inBytes: 1200, outBytes: 80 },
        },
      ],
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

  test("a NUL or an unpaired surrogate in a script's line is replaced, and the batch is stored", async function (assert) {
    let { token, run } = await runOf();
    let pair = '\u{1F600}';
    let sent = await sendLog(token, {
      events: [
        {
          kind: 'console',
          at: Date.now(),
          level: 'log',
          message: 'binary\u0000body',
        },
        { kind: 'milestone', at: Date.now(), name: 'lone \uD83D surrogate' },
        {
          kind: 'console',
          at: Date.now(),
          level: 'log',
          // A pair the message limit cuts in half.
          message: `${'x'.repeat(RUN_LOG_MAX_MESSAGE_CHARS - 1)}${pair}`,
        },
      ],
    });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
    let { lines } = await logOf(run.id);
    assert.strictEqual(lines.length, 3, 'the whole batch is stored');
    assert.strictEqual(lines[0].message, 'binary\uFFFDbody');
    assert.strictEqual(lines[1].data?.name, 'lone \uFFFD surrogate');
    assert.false(
      /[\uD800-\uDFFF]/.test(lines[2].message.slice(-30)),
      'the half pair the cut left is replaced',
    );
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
    assert.deepEqual(first, { stored: 2, dropped: 1, milestones: 0, tasks: 0 });
    let second = await appendRunLog(dbAdapter, run.id, [line('four')], {
      maxLines: 2,
    });
    assert.deepEqual(second, {
      stored: 0,
      dropped: 1,
      milestones: 0,
      tasks: 0,
    });

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
      { stored: 2, dropped: 1, milestones: 0, tasks: 0 },
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

    // The realm holds notes.txt as a file, so a file under it clashes. The
    // stage route refuses that path itself, so the file goes straight into
    // the overlay, where the commit's own check finds it.
    let refused = await runOf();
    let overlaid = await stageRunOverlayFile(
      dbAdapter,
      { runId: refused.run.id, attempt: refused.run.attempt! },
      'notes.txt/inner.txt',
      new TextEncoder().encode('inner'),
      100,
    );
    assert.strictEqual(overlaid.kind, 'staged', JSON.stringify(overlaid));
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
        inputTokens: 1200,
        outputTokens: 300,
      }).message,
      'resolve anthropic/claude: 200 (800 ms, 1200 tokens in, 300 out)',
      'the message names the tokens',
    );
    assert.deepEqual(
      resolveLogLine({
        model: 'anthropic/claude',
        status: 200,
        ms: 800,
        inputTokens: 1200,
        outputTokens: 300,
      }).data,
      {
        model: 'anthropic/claude',
        status: 200,
        ms: 800,
        inputTokens: 1200,
        outputTokens: 300,
      },
      'the data holds the tokens',
    );
    assert.deepEqual(
      tokensOf({ usage: { prompt_tokens: 12, completion_tokens: 3, cost: 1 } }),
      { inputTokens: 12, outputTokens: 3 },
    );
    assert.deepEqual(tokensOf({ usage: { prompt_tokens: -1 } }), {});
    assert.deepEqual(tokensOf(undefined), {});
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
      events: [
        { kind: 'task', at: 1, text: 'Grouped the bug label' },
        { kind: 'count', at: 1, done: 2 },
      ],
    });
    assert.true(ok.ok);
    if (ok.ok) {
      assert.deepEqual(
        ok.lines.map(({ kind, message, data }) => ({ kind, message, data })),
        [
          {
            kind: 'task',
            message: 'Task: Grouped the bug label',
            data: { text: 'Grouped the bug label' },
          },
          { kind: 'count', message: '2', data: { done: 2 } },
        ],
        'a task, and a count from a tab whose host still sends one',
      );
    }
    assert.false(
      scriptRunLogLines({ events: [{ kind: 'task', at: 1, text: 3 }] }).ok,
      'a task that is not text is refused',
    );
    let tally = { calls: 1, failed: 0, ms: 5, inBytes: 10, outBytes: 2 };
    assert.true(
      scriptRunLogLines({ events: [{ kind: 'transform', at: 1, ...tally }] })
        .ok,
      'a transform line with its whole tally is taken',
    );
    for (let [field, value] of [
      ['calls', -1],
      ['ms', 1.5],
      ['failed', '1'],
      ['outBytes', undefined],
    ] as const) {
      assert.false(
        scriptRunLogLines({
          events: [{ kind: 'transform', at: 1, ...tally, [field]: value }],
        }).ok,
        `a transform line whose ${field} is ${String(value)} is refused`,
      );
    }
  });
  module('milestones', function (hooks) {
    let telemetry: AutomationMilestoneEvent[];
    hooks.beforeEach(function () {
      telemetry = [];
      setAutomationMilestoneSink((event) => telemetry.push(event));
    });
    hooks.afterEach(function () {
      setAutomationMilestoneSink(undefined);
    });

    async function milestonesOf(runId: string, now?: number) {
      return (await readRunMilestones(dbAdapter, runId, { now }))!;
    }

    test('the run records the plan it declared, each milestone in the order reached, and the tasks inside each', async function (assert) {
      let { token, run } = await runOf();
      let t0 = Date.parse('2026-11-16T10:00:00.000Z');
      let sent = await sendLog(token, {
        events: [
          {
            kind: 'plan',
            at: t0,
            milestones: ['Fetch issues', 'Group', 'Write digest'],
          },
          { kind: 'milestone', at: t0, name: 'Fetch issues' },
          { kind: 'task', at: t0 + 100, text: 'Skipped 3 archived issues' },
          { kind: 'task', at: t0 + 200, text: '  Fetched 42 open issues  ' },
          { kind: 'milestone', at: t0 + 1_000, name: 'Group' },
          { kind: 'count', at: t0 + 1_050, done: 7 },
          { kind: 'task', at: t0 + 1_100, text: 'Grouped the bug label' },
        ],
      });
      assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));

      let running = await milestonesOf(run.id, t0 + 1_500);
      assert.deepEqual(running.plan, ['Fetch issues', 'Group', 'Write digest']);
      assert.strictEqual(running.state, 'running');
      assert.strictEqual(running.current, 'Group', 'the milestone it is in');
      assert.deepEqual(running.ahead, ['Write digest'], 'the ones still ahead');
      assert.strictEqual(running.failedIn, null);
      assert.deepEqual(running.milestones, [
        {
          name: 'Fetch issues',
          planned: true,
          startedAt: new Date(t0).toISOString(),
          endedAt: new Date(t0 + 1_000).toISOString(),
          ms: 1_000,
          tasks: [
            {
              text: 'Skipped 3 archived issues',
              at: new Date(t0 + 100).toISOString(),
            },
            {
              text: 'Fetched 42 open issues',
              at: new Date(t0 + 200).toISOString(),
            },
          ],
        },
        {
          name: 'Group',
          planned: true,
          startedAt: new Date(t0 + 1_000).toISOString(),
          endedAt: null,
          ms: 500,
          tasks: [
            {
              text: 'Grouped the bug label',
              at: new Date(t0 + 1_100).toISOString(),
            },
          ],
        },
      ]);

      // A later batch's task belongs to the milestone the run is still in.
      await sendLog(token, {
        events: [
          { kind: 'task', at: t0 + 1_200, text: 'Grouped the docs label' },
        ],
      });
      let [, group] = (await milestonesOf(run.id, t0 + 1_500)).milestones;
      assert.deepEqual(
        group.tasks.map(({ text }) => text),
        ['Grouped the bug label', 'Grouped the docs label'],
      );

      await finishAutomationRun(dbAdapter, run.id, run.attempt!, {
        state: 'complete',
      });
      let finished = await milestonesOf(run.id);
      assert.strictEqual(finished.current, null);
      assert.strictEqual(
        finished.milestones[1].endedAt,
        finished.finishedAt,
        'the last milestone lasts until the run ends',
      );
      assert.deepEqual(
        telemetry.map(
          ({ milestone, position, planned, outcome, failedHere }) => ({
            milestone,
            position,
            planned,
            outcome,
            failedHere,
          }),
        ),
        [
          {
            milestone: 'Fetch issues',
            position: 0,
            planned: true,
            outcome: 'complete',
            failedHere: false,
          },
          {
            milestone: 'Group',
            position: 1,
            planned: true,
            outcome: 'complete',
            failedHere: false,
          },
        ],
        'each milestone goes to telemetry once, as the run ends',
      );
      assert.strictEqual(telemetry[0].ms, 1_000);
      assert.strictEqual(telemetry[0].run, run.id);
      assert.deepEqual(
        telemetry.map(({ tasks }) => tasks),
        [2, 2],
        'each milestone tells telemetry how many tasks the run recorded in it',
      );
    });

    test('a run that fails inside a milestone names it', async function (assert) {
      let { token, run } = await runOf();
      let at = Date.now();
      await sendLog(token, {
        events: [
          { kind: 'plan', at, milestones: ['Fetch', 'Write'] },
          { kind: 'milestone', at, name: 'Fetch' },
          { kind: 'task', at, text: 'Fetched page 1 of the vendor list' },
          { kind: 'error', at, message: 'Error: the vendor answered 503' },
        ],
      });
      await finishAutomationRun(dbAdapter, run.id, run.attempt!, {
        state: 'error',
        reason: 'script-error',
        message: 'Error: the vendor answered 503',
      });
      let milestones = await milestonesOf(run.id);
      assert.strictEqual(milestones.state, 'error');
      assert.strictEqual(milestones.failedIn, 'Fetch');
      assert.deepEqual(milestones.ahead, ['Write']);
      assert.deepEqual(
        milestones.milestones[0].tasks.map(({ text }) => text),
        ['Fetched page 1 of the vendor list'],
        'the milestone a run failed in keeps the tasks the script reported before the error',
      );
      assert.deepEqual(
        telemetry.map(({ milestone, outcome, errorReason, failedHere }) => ({
          milestone,
          outcome,
          errorReason,
          failedHere,
        })),
        [
          {
            milestone: 'Fetch',
            outcome: 'error',
            errorReason: 'script-error',
            failedHere: true,
          },
        ],
      );
    });

    test("a milestone the plan didn't declare is recorded as unplanned, and the order is the order reached", async function (assert) {
      let { token, run } = await runOf();
      let at = Date.now();
      await sendLog(token, {
        events: [
          { kind: 'plan', at, milestones: ['A', 'B', 'C'] },
          { kind: 'milestone', at, name: 'B' },
          { kind: 'milestone', at: at + 1, name: 'Retry' },
          { kind: 'milestone', at: at + 2, name: 'A' },
        ],
      });
      let milestones = await milestonesOf(run.id);
      assert.deepEqual(
        milestones.milestones.map(({ name, planned }) => ({ name, planned })),
        [
          { name: 'B', planned: true },
          { name: 'Retry', planned: false },
          { name: 'A', planned: true },
        ],
      );
      assert.deepEqual(milestones.ahead, ['C']);
    });

    test('a plan that names a milestone twice keeps the second one ahead until the run reaches it again', async function (assert) {
      let { token, run } = await runOf();
      let at = Date.now();
      await sendLog(token, {
        events: [
          { kind: 'plan', at, milestones: ['Fetch', 'Transform', 'Fetch'] },
          { kind: 'milestone', at, name: 'Fetch' },
        ],
      });
      assert.deepEqual((await milestonesOf(run.id)).ahead, [
        'Transform',
        'Fetch',
      ]);
      await sendLog(token, {
        events: [
          { kind: 'milestone', at: at + 1, name: 'Transform' },
          { kind: 'milestone', at: at + 2, name: 'Fetch' },
        ],
      });
      assert.deepEqual((await milestonesOf(run.id)).ahead, []);
    });

    test('lines that land after the run ended, or from an attempt that no longer owns it, add nothing to its milestones', async function (assert) {
      let { run } = await runOf();
      let at = Date.now();
      let mark = (name: string) => ({
        at,
        source: 'script' as const,
        kind: 'milestone' as const,
        message: `Milestone: ${name}`,
        data: { name },
      });
      await appendRunLog(dbAdapter, run.id, [mark('Mine')], {
        attempt: run.attempt!,
      });
      await appendRunLog(dbAdapter, run.id, [mark('Stale')], {
        attempt: run.attempt! - 1,
      });
      await finishAutomationRun(dbAdapter, run.id, run.attempt!, {
        state: 'complete',
      });
      let telemetryAtEnd = telemetry.map(({ milestone }) => milestone);
      await appendRunLog(dbAdapter, run.id, [mark('Late')], {
        attempt: run.attempt!,
      });
      assert.deepEqual(
        (await milestonesOf(run.id)).milestones.map(({ name }) => name),
        ['Mine'],
      );
      assert.deepEqual(
        telemetryAtEnd,
        ['Mine'],
        'telemetry at the end holds the same milestones the run keeps',
      );
      let lines = (await logOf(run.id)).lines.map(({ message }) => message);
      assert.true(
        lines.includes('Milestone: Late'),
        'the log still keeps the late line',
      );
    });

    test('a run without a plan records its milestones, and a task before the first milestone is ignored', async function (assert) {
      let { token, run } = await runOf();
      let at = Date.now();
      await sendLog(token, {
        events: [
          { kind: 'task', at, text: 'Read the settings' },
          { kind: 'milestone', at, name: 'Only' },
        ],
      });
      let milestones = await milestonesOf(run.id);
      assert.deepEqual(milestones.plan, []);
      assert.deepEqual(milestones.ahead, []);
      assert.deepEqual(
        milestones.milestones.map(({ name, planned, tasks }) => ({
          name,
          planned,
          tasks,
        })),
        [{ name: 'Only', planned: false, tasks: [] }],
      );
      assert.strictEqual(milestones.tasksDropped, 0, 'nor counted as dropped');
    });

    test("a task past the run's limit is counted, not recorded, and a task past the length limit is cut", async function (assert) {
      let { run } = await runOf();
      let at = Date.now();
      let task = (text: string) => ({
        at,
        source: 'script' as const,
        kind: 'task' as const,
        message: `Task: ${text}`,
        data: { text },
      });
      let result = await appendRunLog(dbAdapter, run.id, [
        {
          at,
          source: 'script',
          kind: 'milestone',
          message: 'Milestone: Import',
          data: { name: 'Import' },
        },
        ...Array.from({ length: RUN_MAX_TASKS + 2 }, (_, i) =>
          task(`Imported invoice ${i}`),
        ),
      ]);
      assert.strictEqual(result.milestones, 1);
      assert.strictEqual(result.tasks, RUN_MAX_TASKS);
      let capped = await milestonesOf(run.id);
      assert.strictEqual(capped.milestones[0].tasks.length, RUN_MAX_TASKS);
      assert.strictEqual(capped.tasksDropped, 2);
      let later = await appendRunLog(dbAdapter, run.id, [
        task('Imported one more'),
      ]);
      assert.strictEqual(later.tasks, 0, 'a later batch records none either');
      assert.strictEqual((await milestonesOf(run.id)).tasksDropped, 3);

      let other = await runOf();
      await appendRunLog(dbAdapter, other.run.id, [
        {
          at,
          source: 'script',
          kind: 'milestone',
          message: 'Milestone: Import',
          data: { name: 'Import' },
        },
        task('x'.repeat(RUN_TASK_MAX_CHARS + 20)),
      ]);
      assert.strictEqual(
        (await milestonesOf(other.run.id)).milestones[0].tasks[0].text,
        'x'.repeat(RUN_TASK_MAX_CHARS),
      );
    });

    test('a request that records a milestone or a task reports the run moved, and one that records neither does not', async function (assert) {
      let { token, run } = await runOf();
      let reported: string[] = [];
      let reportRunChange = realm.reportRunChange;
      realm.reportRunChange = async (runId: string) => {
        reported.push(runId);
      };
      try {
        let at = Date.now();
        let send = async (events: unknown[]) => {
          let sent = await sendLog(token, { events });
          assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
          return reported.length;
        };
        assert.strictEqual(
          await send([{ kind: 'milestone', at, name: 'Group by label' }]),
          1,
          'a milestone reports',
        );
        assert.strictEqual(
          await send([
            { kind: 'task', at: at + 1, text: 'Grouped the bug label' },
            { kind: 'task', at: at + 2, text: 'Grouped the docs label' },
          ]),
          2,
          'a batch of tasks reports once',
        );
        assert.strictEqual(
          await send([
            { kind: 'count', at: at + 3, done: 2, total: 5 },
            { kind: 'console', at: at + 3, level: 'log', message: 'hi' },
          ]),
          2,
          'a count or a console line reports nothing',
        );
        assert.deepEqual([...new Set(reported)], [run.id]);
      } finally {
        realm.reportRunChange = reportRunChange;
      }
    });

    test('a count inside a milestone records nothing on the milestone', async function (assert) {
      let { token, run } = await runOf();
      let at = Date.now();
      let sent = await sendLog(token, {
        events: [
          { kind: 'milestone', at, name: 'Import' },
          { kind: 'count', at, done: 3, total: 9 },
        ],
      });
      assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
      assert.deepEqual((await milestonesOf(run.id)).milestones[0].tasks, []);
      assert.true(
        (await logOf(run.id)).lines.some(({ kind }) => kind === 'count'),
        'the log keeps the line',
      );
    });

    test("milestones are recorded when the log is full, and past the run's limit they are counted", async function (assert) {
      let { run } = await runOf();
      let at = Date.now();
      let result = await appendRunLog(
        dbAdapter,
        run.id,
        [
          {
            at,
            source: 'script',
            kind: 'plan',
            message: 'Plan: A',
            data: { milestones: ['A'] },
          },
          {
            at,
            source: 'script',
            kind: 'milestone',
            message: 'Milestone: A',
            data: { name: 'A' },
          },
        ],
        { maxLines: 0 },
      );
      assert.deepEqual(
        result,
        { stored: 0, dropped: 2, milestones: 1, tasks: 0 },
        'the log is full, and the milestone is recorded',
      );
      let milestones = await milestonesOf(run.id);
      assert.deepEqual(milestones.plan, ['A']);
      assert.deepEqual(
        milestones.milestones.map(({ name }) => name),
        ['A'],
      );

      let marks = Array.from({ length: RUN_MAX_MILESTONES + 3 }, (_, i) => ({
        at,
        source: 'script' as const,
        kind: 'milestone' as const,
        message: `Milestone: m${i}`,
        data: { name: `m${i}` },
      }));
      let many = await runOf();
      await appendRunLog(dbAdapter, many.run.id, marks);
      let capped = await milestonesOf(many.run.id);
      assert.strictEqual(capped.milestones.length, RUN_MAX_MILESTONES);
      assert.strictEqual(capped.dropped, 3);

      await appendRunLog(dbAdapter, many.run.id, [
        {
          at,
          source: 'script',
          kind: 'task',
          message: 'Task: Wrote the digest',
          data: { text: 'Wrote the digest' },
        },
      ]);
      let afterTask = await milestonesOf(many.run.id);
      assert.deepEqual(
        afterTask.milestones.at(-1)!.tasks,
        [],
        "a later batch's task inside an unrecorded milestone belongs to none",
      );
      assert.strictEqual(afterTask.tasksDropped, 1, 'and is counted');
    });

    test('an attempt that takes the run from another clears its milestones, since the script runs again', async function (assert) {
      let { token, run } = await runOf();
      let at = Date.now();
      await sendLog(token, {
        events: [
          { kind: 'plan', at, milestones: ['Fetch', 'Write'] },
          { kind: 'milestone', at, name: 'Fetch' },
          { kind: 'task', at, text: 'Fetched 2 pages' },
        ],
      });
      let retry = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        run.attempt! + 1,
      );
      assert.strictEqual(retry.kind, 'run');
      let cleared = await milestonesOf(run.id);
      assert.deepEqual(cleared.plan, []);
      assert.deepEqual(cleared.milestones, []);
      assert.strictEqual(cleared.tasksDropped, 0);
      let [{ n }] = (await dbAdapter.execute(
        `SELECT count(*)::int AS n FROM automation_run_tasks WHERE run_id = '${run.id}'`,
      )) as { n: number }[];
      assert.strictEqual(n, 0, "the retry clears the run's tasks too");

      await appendRunLog(dbAdapter, run.id, [
        {
          at: at + 10,
          source: 'script',
          kind: 'milestone',
          message: 'Milestone: Fetch',
          data: { name: 'Fetch' },
        },
      ]);
      assert.deepEqual(
        (await milestonesOf(run.id)).milestones.map(({ name }) => name),
        ['Fetch'],
        'only the attempt that owns the run reports its milestones',
      );

      let same = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        run.attempt! + 1,
      );
      assert.strictEqual(same.kind, 'run');
      assert.strictEqual(
        (await milestonesOf(run.id)).milestones.length,
        1,
        'the owning attempt starting again keeps them',
      );
    });

    test("an automation's last run is the latest one that ended, with its milestone times", async function (assert) {
      let automation = 'automation/last-run';
      let first = await createAutomationRunToken(dbAdapter, realm, OWNER, {
        automation,
      });
      let second = await createAutomationRunToken(dbAdapter, realm, OWNER, {
        automation,
      });
      let still = await createAutomationRunToken(dbAdapter, realm, OWNER, {
        automation,
      });
      let at = Date.now();
      await sendLog(first.token, {
        events: [{ kind: 'milestone', at, name: 'First run step' }],
      });
      await sendLog(second.token, {
        events: [{ kind: 'milestone', at, name: 'Second run step' }],
      });
      await sendLog(still.token, {
        events: [{ kind: 'milestone', at, name: 'Running step' }],
      });
      await finishAutomationRun(dbAdapter, first.run.id, first.run.attempt!, {
        state: 'complete',
      });
      await finishAutomationRun(dbAdapter, second.run.id, second.run.attempt!, {
        state: 'complete',
      });
      let last = await readLastRunMilestones(
        dbAdapter,
        second.run.automationId,
      );
      assert.strictEqual(
        last?.runId,
        second.run.id,
        'a running run is not the last run',
      );
      assert.deepEqual(
        last?.milestones.map(({ name }) => name),
        ['Second run step'],
      );
      assert.strictEqual(
        await readLastRunMilestones(
          dbAdapter,
          rri(`${realmURL.href}automation/never-ran`),
        ),
        undefined,
      );
    });
  });
});
