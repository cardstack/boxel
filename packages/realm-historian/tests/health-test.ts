import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  Heartbeat,
  startHealthServer,
  type HealthServer,
} from '../src/health.ts';

module('health', (hooks) => {
  let server: HealthServer | undefined;

  hooks.afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  test('/health answers 200 until the heartbeat is stale, then 503', async (assert) => {
    let now = 1_000_000;
    let heartbeat = new Heartbeat(() => now);
    server = await startHealthServer({
      port: 0,
      heartbeat,
      staleAfterMs: 30_000,
    });
    let health = () => fetch(`http://127.0.0.1:${server!.port}/health`);

    assert.strictEqual((await health()).status, 200);
    now += 29_000;
    assert.strictEqual((await health()).status, 200, 'still fresh at 29s');
    now += 2_000;
    let stale = await health();
    assert.strictEqual(stale.status, 503, 'stale at 31s');
    assert.strictEqual(await stale.text(), 'the loop has not run for 31000ms');
    heartbeat.beat();
    assert.strictEqual(
      (await health()).status,
      200,
      'fresh again after a beat',
    );

    let elsewhere = await fetch(`http://127.0.0.1:${server.port}/other`);
    assert.strictEqual(elsewhere.status, 404);
  });
});
