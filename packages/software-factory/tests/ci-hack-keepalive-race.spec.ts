// CI HACK, DO NOT MERGE.
//
// Repro for the ECONNRESET on a test's first realm request (runParseInMemory
// "broken GTS template…"). The test client keeps a pooled socket to the
// worker-scoped compat proxy. If the client trusts the realm server's
// forwarded `Keep-Alive: timeout=4200`, it reuses a socket that the proxy
// closes after ~6 s idle, and a request written at that moment gets
// `read ECONNRESET`.
//
// This sweeps idle gaps around the proxy's idle close, through the same
// BoxelCLIClient.listFiles call the flaky test makes first. Each gap ends
// with an optional synchronous event-loop stall, as a realm restart in the
// same process would cause. The test prints a table and fails if any
// request failed.
import { resolve } from 'node:path';

import { expect, test } from './fixtures.ts';
import { buildTestClient } from './helpers/test-client.ts';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

const GAPS_MS: number[] = [];
for (let gap = 5300; gap <= 6700; gap += 50) {
  GAPS_MS.push(gap);
}
const STALLS_MS = [0, 1000];

function stall(ms: number) {
  let end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait: block the event loop, so the proxy's idle timer is late too
  }
}

test.describe('ci hack: client to compat-proxy keep-alive race', () => {
  test('listFiles after idle gaps around the proxy idle timeout', async ({
    realm,
  }) => {
    test.setTimeout(30 * 60_000);
    let realmUrl = realm.realmURL.href;
    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: realm.authorizationHeaders()['Authorization'],
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    let failures: string[] = [];
    let rows: string[] = [];
    try {
      let warm = await client.listFiles(realmUrl);
      expect(warm.error, `warm-up list failed: ${warm.error}`).toBeUndefined();

      for (let stallMs of STALLS_MS) {
        for (let gapMs of GAPS_MS) {
          await new Promise((r) => setTimeout(r, gapMs - stallMs));
          stall(stallMs);
          let started = Date.now();
          let result = await client.listFiles(realmUrl);
          let outcome = result.error ? `FAIL ${result.error}` : 'ok';
          let row = `stall=${stallMs}ms gap=${gapMs}ms -> ${outcome} (${Date.now() - started}ms)`;
          rows.push(row);
          console.log(`[keepalive-race] ${row}`);
          if (result.error) {
            failures.push(row);
          }
        }
      }
    } finally {
      cleanup();
    }

    console.log(
      `[keepalive-race] summary: ${failures.length} of ${rows.length} requests failed`,
    );
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
