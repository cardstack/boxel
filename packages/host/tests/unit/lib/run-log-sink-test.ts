import { module, test } from 'qunit';

import {
  RUN_LOG_MAX_BATCH_LINES,
  RUN_LOG_MAX_REQUEST_BYTES,
  RUN_LOG_PATH,
} from '@cardstack/runtime-common/automation-run-log';

import type { RunProgressEvent } from '@cardstack/host/lib/realm-runner/automation';
import {
  RUN_LOG_MAX_PENDING,
  RunLogSink,
} from '@cardstack/host/lib/realm-runner/run-log-sink';

const REALM = 'https://realm.example/team/';
const TOKEN = 'run-token-for-the-sink';

function line(n: number): RunProgressEvent {
  return { kind: 'console', at: n, level: 'log', message: `line ${n}` };
}

function recordingFetch(status = 200) {
  let sent: { url: string; init: RequestInit; events: RunProgressEvent[] }[] =
    [];
  let fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      init,
      events: JSON.parse(String(init.body)).events,
    });
    return new Response('{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

module('Unit | Lib | run log sink', function () {
  test("flush sends every recorded line to the realm's run log with the run's token, in order", async function (assert) {
    let { sent, fetch } = recordingFetch();
    let sink = new RunLogSink({ realmURL: REALM, runToken: TOKEN, fetch });
    sink.record(line(1));
    sink.record(line(2));
    await sink.flush();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].url, `${REALM}${RUN_LOG_PATH.slice(1)}`);
    let headers = sent[0].init.headers as Record<string, string>;
    assert.strictEqual(headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(
      sent[0].events.map((event) => event.at),
      [1, 2],
    );
    await sink.flush();
    assert.strictEqual(sent.length, 1, 'nothing is sent twice');
  });

  test("a realm that refuses a batch's tasks gets the batch again without them, and the run's later batches leave tasks out", async function (assert) {
    let sent: RunProgressEvent[][] = [];
    let errors: string[] = [];
    // A realm server that reads no task refuses any body that carries one.
    let fetch = (async (_url: string, init: RequestInit) => {
      let events = JSON.parse(String(init.body)).events as RunProgressEvent[];
      sent.push(events);
      return new Response('{}', {
        status: events.some((event) => event.kind === 'task') ? 400 : 200,
      });
    }) as unknown as typeof globalThis.fetch;
    let sink = new RunLogSink({
      realmURL: REALM,
      runToken: TOKEN,
      fetch,
      onError: (message) => errors.push(message),
    });
    sink.record({ kind: 'milestone', at: 1, name: 'Import' });
    sink.record({ kind: 'task', at: 2, text: 'Imported 3 invoices' });
    sink.record(line(3));
    await sink.flush();
    sink.record({ kind: 'task', at: 4, text: 'Imported 2 more invoices' });
    sink.record(line(5));
    await sink.flush();
    assert.deepEqual(
      sent.map((events) => events.map(({ kind }) => kind)),
      [['milestone', 'task', 'console'], ['milestone', 'console'], ['console']],
    );
    assert.deepEqual(errors, [], 'the rest of the log lands');
  });

  test('a full batch is sent without waiting, and the rest follows in order', async function (assert) {
    let { sent, fetch } = recordingFetch();
    let sink = new RunLogSink({ realmURL: REALM, runToken: TOKEN, fetch });
    for (let n = 0; n < RUN_LOG_MAX_BATCH_LINES + 3; n++) {
      sink.record(line(n));
    }
    await sink.flush();
    assert.deepEqual(
      sent.map(({ events }) => events.length),
      [RUN_LOG_MAX_BATCH_LINES, 3],
    );
    assert.strictEqual(sent[1].events[0].at, RUN_LOG_MAX_BATCH_LINES);
  });

  test('a refused or failed send is reported and never throws', async function (assert) {
    let errors: string[] = [];
    let { fetch } = recordingFetch(401);
    let sink = new RunLogSink({
      realmURL: REALM,
      runToken: TOKEN,
      fetch,
      onError: (message) => errors.push(message),
    });
    sink.record(line(1));
    await sink.flush();
    assert.strictEqual(errors.length, 1);
    assert.true(errors[0].includes('401'), errors[0]);

    let broken = new RunLogSink({
      realmURL: REALM,
      runToken: TOKEN,
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof globalThis.fetch,
      onError: (message) => errors.push(message),
    });
    broken.record(line(2));
    await broken.flush();
    assert.true(errors[1].includes('offline'), errors[1]);
  });
  test('a send that never answers is given up on, so flush always settles', async function (assert) {
    let errors: string[] = [];
    let sink = new RunLogSink({
      realmURL: REALM,
      runToken: TOKEN,
      timeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        )) as unknown as typeof globalThis.fetch,
      onError: (message) => errors.push(message),
    });
    sink.record(line(1));
    await sink.flush();
    assert.strictEqual(errors.length, 1);
    assert.true(errors[0].includes('did not answer within 20 ms'), errors[0]);
  });

  test('while a send is slow, the waiting lines are bounded and the next batch says how many were dropped', async function (assert) {
    let release: () => void = () => undefined;
    let sent: RunProgressEvent[][] = [];
    let first = true;
    let sink = new RunLogSink({
      realmURL: REALM,
      runToken: TOKEN,
      fetch: (async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)).events);
        if (first) {
          first = false;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return new Response('{}');
      }) as unknown as typeof globalThis.fetch,
    });
    let total = RUN_LOG_MAX_BATCH_LINES + RUN_LOG_MAX_PENDING + 7;
    for (let n = 0; n < total; n++) {
      sink.record(line(n));
    }
    release();
    await sink.flush();
    let all = sent.flat();
    let warning = all.find(
      (event) =>
        event.kind === 'console' && event.message.includes('were dropped'),
    ) as Extract<RunProgressEvent, { kind: 'console' }> | undefined;
    assert.ok(warning, 'a line says lines were dropped');
    assert.true(warning!.message.startsWith('7 log lines'), warning!.message);
    assert.strictEqual(all.length, total - 7 + 1);
  });

  test("a batch stays under the realm's request limit in bytes, however few lines fill it", async function (assert) {
    let { sent, fetch } = recordingFetch();
    let sink = new RunLogSink({ realmURL: REALM, runToken: TOKEN, fetch });
    // Each line is 10,000 two-byte characters, so 105 of them are well under
    // the line count of a batch but over its byte limit.
    let wide = 'é'.repeat(10_000);
    let count = 105;
    for (let n = 0; n < count; n++) {
      sink.record({ kind: 'console', at: n, level: 'log', message: wide });
    }
    await sink.flush();
    assert.true(sent.length > 1, `the lines went in ${sent.length} batches`);
    for (let { init } of sent) {
      let bytes = new TextEncoder().encode(String(init.body)).length;
      assert.true(
        bytes <= RUN_LOG_MAX_REQUEST_BYTES,
        `a batch of ${bytes} bytes fits the realm's limit`,
      );
    }
    assert.deepEqual(
      sent.flatMap(({ events }) => events.map((event) => event.at)),
      Array.from({ length: count }, (_, n) => n),
      'every line was sent once, in order',
    );
  });
});
