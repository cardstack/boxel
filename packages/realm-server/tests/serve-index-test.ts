import { module, test } from 'qunit';
import { basename } from 'path';

import { createServeIndex } from '../handlers/serve-index.ts';
import { computeHostShellHash } from '../prerender/prerender-constants.ts';

function buildDeps(getIndexHTML: () => Promise<string>) {
  return {
    serverURL: new URL('http://127.0.0.1:4448'),
    // Non-localhost so the production cache branch is active.
    assetsURL: new URL('http://example.com/notional-assets-host/'),
    realms: [],
    reconciler: {} as any,
    dbAdapter: {} as any,
    matrixClient: {
      matrixURL: new URL('http://localhost:8008/'),
    } as any,
    getIndexHTML,
    cardSizeLimitBytes: 0,
    fileSizeLimitBytes: 0,
  };
}

function validIndexHTML(): string {
  return `<html><head><meta name="@cardstack/host/config/environment" content="${encodeURIComponent(
    JSON.stringify({
      matrixURL: 'http://localhost:8008',
      matrixServerName: 'localhost',
      realmServerURL: 'http://localhost:4201/',
      publishedRealmBoxelSpaceDomain: 'localhost:4201',
      publishedRealmBoxelSiteDomain: 'localhost:4201',
    }),
  )}"></head><body></body></html>`;
}

module(basename(__filename), function () {
  test('a thrown error in retrieveIndexHTML clears the cache so the next call retries', async function (assert) {
    let calls = 0;
    let { retrieveIndexHTML } = createServeIndex(
      buildDeps(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('simulated getIndexHTML failure');
        }
        return validIndexHTML();
      }),
    );

    await assert.rejects(
      retrieveIndexHTML(),
      /simulated getIndexHTML failure/,
      'first call propagates the underlying error',
    );

    let html = await retrieveIndexHTML();
    assert.ok(
      html.includes('@cardstack/host/config/environment'),
      'second call recovers and returns the rewritten index HTML',
    );
    assert.strictEqual(
      calls,
      2,
      'getIndexHTML was re-invoked after the failure (cache cleared)',
    );
  });

  test('a synchronous throw inside the rewrite step also clears the cache', async function (assert) {
    let calls = 0;
    let { retrieveIndexHTML } = createServeIndex(
      buildDeps(async () => {
        calls += 1;
        if (calls === 1) {
          // Malformed embedded config — JSON.parse inside the meta-rewrite
          // replacer will throw.
          return `<html><head><meta name="@cardstack/host/config/environment" content="not-a-valid-encoded-json"></head><body></body></html>`;
        }
        return validIndexHTML();
      }),
    );

    await assert.rejects(
      retrieveIndexHTML(),
      'first call propagates the JSON.parse failure',
    );

    let html = await retrieveIndexHTML();
    assert.ok(
      html.includes('@cardstack/host/config/environment'),
      'second call recovers after the synchronous rewrite failure',
    );
    assert.strictEqual(calls, 2, 'getIndexHTML was re-invoked after the throw');
  });

  test('successful calls are memoized — getIndexHTML runs once across concurrent callers', async function (assert) {
    let calls = 0;
    let { retrieveIndexHTML } = createServeIndex(
      buildDeps(async () => {
        calls += 1;
        return validIndexHTML();
      }),
    );

    let [a, b, c] = await Promise.all([
      retrieveIndexHTML(),
      retrieveIndexHTML(),
      retrieveIndexHTML(),
    ]);

    assert.strictEqual(calls, 1, 'getIndexHTML was only invoked once');
    assert.strictEqual(a, b, 'concurrent callers receive the same string');
    assert.strictEqual(b, c, 'concurrent callers receive the same string');

    let d = await retrieveIndexHTML();
    assert.strictEqual(calls, 1, 'subsequent calls also reuse the cache');
    assert.strictEqual(d, a, 'cached value is returned identically');
  });

  test('getHostShellHash digests the raw index HTML, matching the manager report', async function (assert) {
    let raw = validIndexHTML();
    let { getHostShellHash, retrieveIndexHTML } = createServeIndex(
      buildDeps(async () => raw),
    );

    let hash = await getHostShellHash();
    assert.strictEqual(
      hash,
      await computeHostShellHash(raw),
      'token is the digest of the raw getIndexHTML — the same value the realm server reports to the manager',
    );

    // The served shell is the rewritten HTML, which differs from the raw — the
    // token must not be derived from it, or it would never match the manager's.
    let rewritten = await retrieveIndexHTML();
    assert.notStrictEqual(
      hash,
      await computeHostShellHash(rewritten),
      'token is not derived from the rewritten shell',
    );
  });

  test('getHostShellHash is memoized — getIndexHTML runs once across calls', async function (assert) {
    let calls = 0;
    let { getHostShellHash } = createServeIndex(
      buildDeps(async () => {
        calls += 1;
        return validIndexHTML();
      }),
    );

    let [a, b] = await Promise.all([getHostShellHash(), getHostShellHash()]);
    let c = await getHostShellHash();

    assert.strictEqual(a, b, 'concurrent callers receive the same token');
    assert.strictEqual(b, c, 'subsequent calls reuse the cached token');
    assert.strictEqual(calls, 1, 'getIndexHTML was only invoked once');
  });
});
