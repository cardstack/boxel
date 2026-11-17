import QUnit from 'qunit';
const { module, test } = QUnit;
import { OctokitGitHubClient } from '../lib/github.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

module('github client', (hooks) => {
  let originalFetch: typeof fetch;
  hooks.beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  hooks.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('writeFilesToBranch with syncFolder deletes stale blobs under the folder', async (assert) => {
    let createdTreeBodies: any[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.toString();
      let method = init?.method ?? 'GET';
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'commit-sha' } });
      }
      if (url.includes('/git/commits/commit-sha')) {
        return jsonResponse({ tree: { sha: 'root-tree-sha' } });
      }
      if (url.includes('/git/blobs') && method === 'POST') {
        return jsonResponse({ sha: 'blob-sha' });
      }
      if (url.includes('/git/trees/root-tree-sha') && method === 'GET') {
        return jsonResponse({
          tree: [{ path: 'a1b2c3-listing', type: 'tree', sha: 'folder-sha' }],
        });
      }
      if (url.includes('/git/trees/folder-sha?recursive=1')) {
        return jsonResponse({
          tree: [
            { path: 'kept.json', type: 'blob' },
            { path: 'nested/stale.json', type: 'blob' },
            { path: 'nested', type: 'tree' },
          ],
        });
      }
      if (url.endsWith('/git/trees') && method === 'POST') {
        createdTreeBodies.push(JSON.parse(init?.body as string));
        return jsonResponse({ sha: 'new-tree-sha' });
      }
      if (url.endsWith('/git/commits') && method === 'POST') {
        return jsonResponse({ sha: 'new-commit-sha' });
      }
      if (url.includes('/git/refs/heads/') && method === 'PATCH') {
        return jsonResponse({});
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    let client = new OctokitGitHubClient('test-token');
    await client.writeFilesToBranch({
      owner: 'cardstack',
      repo: 'boxel-catalog',
      branch: 'a1b2c3-listing',
      files: [{ path: 'a1b2c3-listing/kept.json', content: '{}' }],
      message: 'update listing',
      syncFolder: 'a1b2c3-listing',
    });

    assert.strictEqual(createdTreeBodies.length, 1, 'creates one tree');
    let entries = createdTreeBodies[0].tree as {
      path: string;
      mode: string;
      type: string;
      sha: string | null;
    }[];
    assert.deepEqual(
      entries.find((e) => e.path === 'a1b2c3-listing/nested/stale.json'),
      {
        path: 'a1b2c3-listing/nested/stale.json',
        mode: '100644',
        type: 'blob',
        sha: null,
      },
      'the blob missing from the fresh file set gets a deletion entry',
    );
    assert.notOk(
      entries.some((e) => e.path === 'a1b2c3-listing/kept.json' && !e.sha),
      'the kept blob is written, not deleted',
    );
  });

  test('writeFilesToBranch with syncFolder is a no-op deletion-wise when the folder is new', async (assert) => {
    let createdTreeBodies: any[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.toString();
      let method = init?.method ?? 'GET';
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'commit-sha' } });
      }
      if (url.includes('/git/commits/commit-sha')) {
        return jsonResponse({ tree: { sha: 'root-tree-sha' } });
      }
      if (url.includes('/git/blobs') && method === 'POST') {
        return jsonResponse({ sha: 'blob-sha' });
      }
      if (url.includes('/git/trees/root-tree-sha') && method === 'GET') {
        return jsonResponse({
          tree: [{ path: 'other', type: 'tree', sha: 'x' }],
        });
      }
      if (url.endsWith('/git/trees') && method === 'POST') {
        createdTreeBodies.push(JSON.parse(init?.body as string));
        return jsonResponse({ sha: 'new-tree-sha' });
      }
      if (url.endsWith('/git/commits') && method === 'POST') {
        return jsonResponse({ sha: 'new-commit-sha' });
      }
      if (url.includes('/git/refs/heads/') && method === 'PATCH') {
        return jsonResponse({});
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    let client = new OctokitGitHubClient('test-token');
    await client.writeFilesToBranch({
      owner: 'cardstack',
      repo: 'boxel-catalog',
      branch: 'a1b2c3-listing',
      files: [{ path: 'a1b2c3-listing/new.json', content: '{}' }],
      message: 'add listing',
      syncFolder: 'a1b2c3-listing',
    });

    let entries = createdTreeBodies[0].tree as { sha: string | null }[];
    assert.notOk(
      entries.some((e) => e.sha === null),
      'no deletion entries on a first write',
    );
  });

  module('rate limits', () => {
    // Answers every request of a three-file write. `blobResponses` supplies
    // the blob answers in order; the rest succeed.
    function stubWrite(
      blobResponses: (() => Response)[],
      onBlob?: () => Promise<void>,
    ) {
      let blobCalls = 0;
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        let url = typeof input === 'string' ? input : input.toString();
        let method = init?.method ?? 'GET';
        if (url.includes('/git/ref/heads/')) {
          return jsonResponse({ object: { sha: 'commit-sha' } });
        }
        if (url.includes('/git/commits/commit-sha')) {
          return jsonResponse({ tree: { sha: 'root-tree-sha' } });
        }
        if (url.includes('/git/blobs') && method === 'POST') {
          let next = blobResponses[blobCalls++];
          await onBlob?.();
          return next ? next() : jsonResponse({ sha: `blob-${blobCalls}` });
        }
        if (url.endsWith('/git/trees') && method === 'POST') {
          return jsonResponse({ sha: 'new-tree-sha' });
        }
        if (url.endsWith('/git/commits') && method === 'POST') {
          return jsonResponse({ sha: 'new-commit-sha' });
        }
        if (url.includes('/git/refs/heads/') && method === 'PATCH') {
          return jsonResponse({});
        }
        throw new Error(`unexpected request: ${method} ${url}`);
      };
      return { blobCalls: () => blobCalls };
    }

    function secondaryRateLimit(headers: Record<string, string> = {}) {
      return () =>
        new Response(
          JSON.stringify({
            message: 'You have exceeded a secondary rate limit.',
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...headers },
          },
        );
    }

    let files = [
      { path: 'listing/a.json', content: '{}' },
      { path: 'listing/b.json', content: '{}' },
      { path: 'listing/c.json', content: '{}' },
    ];

    test('creates blobs one at a time', async (assert) => {
      let inFlight = 0;
      let maxInFlight = 0;
      stubWrite([], async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      });

      let client = new OctokitGitHubClient('test-token');
      await client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'listing',
        files,
        message: 'add listing',
      });

      assert.strictEqual(maxInFlight, 1, 'no two blob requests overlap');
    });

    test('waits for retry-after and retries a secondary rate limit', async (assert) => {
      let stub = stubWrite([secondaryRateLimit({ 'retry-after': '30' })]);
      let waits: number[] = [];
      let client = new OctokitGitHubClient('test-token', {
        sleep: async (ms) => {
          waits.push(ms);
        },
      });

      let result = await client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'listing',
        files,
        message: 'add listing',
      });

      assert.strictEqual(result.commitSha, 'new-commit-sha', 'the write lands');
      assert.deepEqual(waits, [30_000], 'waits the retry-after seconds');
      assert.strictEqual(stub.blobCalls(), 4, 'retries the refused blob');
    });

    test('waits until x-ratelimit-reset when the quota is spent', async (assert) => {
      stubWrite([
        secondaryRateLimit({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1000',
        }),
      ]);
      let waits: number[] = [];
      let client = new OctokitGitHubClient('test-token', {
        sleep: async (ms) => {
          waits.push(ms);
        },
        now: () => 990_000,
      });

      await client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'listing',
        files,
        message: 'add listing',
      });

      assert.deepEqual(waits, [10_000], 'waits until the reset time');
    });

    test('backs off without headers, then gives up', async (assert) => {
      stubWrite([
        secondaryRateLimit(),
        secondaryRateLimit(),
        secondaryRateLimit(),
        secondaryRateLimit(),
      ]);
      let waits: number[] = [];
      let client = new OctokitGitHubClient('test-token', {
        sleep: async (ms) => {
          waits.push(ms);
        },
      });

      await assert.rejects(
        client.writeFilesToBranch({
          owner: 'cardstack',
          repo: 'boxel-catalog',
          branch: 'listing',
          files,
          message: 'add listing',
        }),
        /Failed to create blob \(403\).*secondary rate limit/,
      );
      assert.deepEqual(
        waits,
        [60_000, 120_000, 240_000],
        'waits longer after each refusal',
      );
    });

    test('does not retry a 403 that is not a rate limit', async (assert) => {
      let stub = stubWrite([
        () =>
          new Response(JSON.stringify({ message: 'Resource not accessible' }), {
            status: 403,
          }),
      ]);
      let waits: number[] = [];
      let client = new OctokitGitHubClient('test-token', {
        sleep: async (ms) => {
          waits.push(ms);
        },
      });

      await assert.rejects(
        client.writeFilesToBranch({
          owner: 'cardstack',
          repo: 'boxel-catalog',
          branch: 'listing',
          files,
          message: 'add listing',
        }),
        /Failed to create blob \(403\)/,
      );
      assert.deepEqual(waits, [], 'no wait');
      assert.strictEqual(stub.blobCalls(), 1, 'no retry');
    });
  });
});
