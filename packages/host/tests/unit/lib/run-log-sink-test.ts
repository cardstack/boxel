import { module, test } from 'qunit';

import {
  RUN_LOG_MAX_BATCH_LINES,
  RUN_LOG_PATH,
} from '@cardstack/runtime-common/automation-run-log';

import type { RunProgressEvent } from '@cardstack/host/lib/realm-runner/automation';
import { RunLogSink } from '@cardstack/host/lib/realm-runner/run-log-sink';

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
});
