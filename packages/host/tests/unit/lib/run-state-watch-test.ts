import { module, test } from 'qunit';

import { RUN_STATE_PATH } from '@cardstack/runtime-common/automation-run-command';

import {
  AutomationRunStoppedError,
  RunStateWatch,
} from '@cardstack/host/lib/realm-runner/run-state-watch';

const REALM = 'https://realm.example/team/';
const TOKEN = 'run-token-for-the-watch';

// Answers each ask with the next status in `statuses` (the last one repeats),
// or throws for a status of 0.
function answering(statuses: number[]) {
  let asked: { url: string; init: RequestInit }[] = [];
  let fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, init });
    let status = statuses[Math.min(asked.length - 1, statuses.length - 1)];
    if (status === 0) {
      throw new TypeError('Failed to fetch');
    }
    return new Response('', { status });
  }) as unknown as typeof globalThis.fetch;
  return { asked, fetch };
}

function waitFor(condition: () => boolean, ms = 2000): Promise<void> {
  let until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    let check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() > until) {
        reject(new Error('timed out waiting'));
      } else {
        setTimeout(check, 5);
      }
    };
    check();
  });
}

module('Unit | Lib | run state watch', function () {
  test("it asks the run's realm with the run's token, and aborts once the realm answers 401", async function (assert) {
    let { asked, fetch } = answering([200, 200, 401]);
    let watch = new RunStateWatch({
      realmURL: REALM,
      runToken: TOKEN,
      fetch,
      intervalMs: 10,
    });
    watch.start();
    await waitFor(() => watch.signal.aborted);
    watch.stop();
    assert.strictEqual(asked.length, 3);
    assert.strictEqual(asked[0].url, `${REALM}${RUN_STATE_PATH.slice(1)}`);
    let headers = asked[0].init.headers as Record<string, string>;
    assert.strictEqual(headers.Authorization, `Bearer ${TOKEN}`);
    assert.true(watch.signal.reason instanceof AutomationRunStoppedError);
  });

  test('a failed ask or another status is not a stop', async function (assert) {
    let { asked, fetch } = answering([0, 500, 403, 200]);
    let watch = new RunStateWatch({
      realmURL: REALM,
      runToken: TOKEN,
      fetch,
      intervalMs: 5,
    });
    watch.start();
    await waitFor(() => asked.length >= 6);
    watch.stop();
    assert.false(watch.signal.aborted);
  });

  test('once stopped it asks no more and never aborts', async function (assert) {
    let { asked, fetch } = answering([401]);
    let watch = new RunStateWatch({
      realmURL: REALM,
      runToken: TOKEN,
      fetch,
      intervalMs: 10,
    });
    watch.start();
    watch.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(asked.length, 0);
    assert.false(watch.signal.aborted);
  });
});
