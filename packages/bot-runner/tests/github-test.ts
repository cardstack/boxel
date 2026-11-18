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
      if (url.includes('/commits?sha=')) {
        return jsonResponse([]);
      }
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

  test('writeFilesToBranch refuses a folder the base branch already holds', async (assert) => {
    let wrote = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.toString();
      let method = init?.method ?? 'GET';
      if (url.includes('/git/ref/heads/main')) {
        return jsonResponse({ object: { sha: 'main-commit-sha' } });
      }
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'branch-commit-sha' } });
      }
      if (url.includes('/git/commits/main-commit-sha')) {
        return jsonResponse({ tree: { sha: 'main-tree-sha' } });
      }
      if (url.includes('/git/commits/branch-commit-sha')) {
        return jsonResponse({ tree: { sha: 'branch-tree-sha' } });
      }
      if (url.includes('/git/trees/main-tree-sha') && method === 'GET') {
        return jsonResponse({
          tree: [{ path: 'a1b2c3-listing', type: 'tree', sha: 'folder-sha' }],
        });
      }
      if (url.includes('/git/trees/folder-sha?recursive=1')) {
        return jsonResponse({
          tree: [{ path: 'CardListing/abc.json', type: 'blob' }],
        });
      }
      if (method !== 'GET') {
        wrote = true;
        return jsonResponse({ sha: 'x' });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    let client = new OctokitGitHubClient('test-token');
    await assert.rejects(
      client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'a1b2c3-listing',
        files: [{ path: 'a1b2c3-listing/kept.json', content: '{}' }],
        message: 'update listing',
        syncFolder: 'a1b2c3-listing',
        folderMustBeNewOn: 'main',
      }),
      /already exists on main/,
    );
    assert.false(wrote, 'no blob, tree or commit is created');
  });

  test("writeFilesToBranch refuses a folder another submitter's commits fill on the branch, and takes its own", async (assert) => {
    let wrote = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.toString();
      let method = init?.method ?? 'GET';
      if (url.includes('/commits?sha=a1b2c3-listing&path=a1b2c3-listing')) {
        return jsonResponse([
          { commit: { message: 'Merge branch main into a1b2c3-listing' } },
          {
            commit: {
              message:
                'add [boxel-submitter:ffff] changes [boxel-content-hash:abc] [boxel-submitter:1111]',
            },
          },
        ]);
      }
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'commit-sha' } });
      }
      if (url.includes('/git/commits/commit-sha')) {
        return jsonResponse({ tree: { sha: 'root-tree-sha' } });
      }
      if (url.includes('/git/trees/root-tree-sha') && method === 'GET') {
        return jsonResponse({ tree: [] });
      }
      if (method !== 'GET') {
        wrote = true;
        return jsonResponse({ sha: 'x' });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    let client = new OctokitGitHubClient('test-token');
    let write = (submitterTag: string) =>
      client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'a1b2c3-listing',
        files: [{ path: 'a1b2c3-listing/kept.json', content: '{}' }],
        message: `update listing [boxel-submitter:${submitterTag}]`,
        syncFolder: 'a1b2c3-listing',
        submitterTag,
      });

    await assert.rejects(write('2222'), /holds another submitter's files/);
    await assert.rejects(
      write('ffff'),
      /holds another submitter's files/,
      "a tag inside the listing name is not the commit's tag",
    );
    assert.false(wrote, 'nothing is written for another submitter');

    await write('1111');
    assert.true(wrote, 'the same submitter writes again');
  });

  test("writeFilesToBranch finds another submitter's commit past the first page of the folder's history", async (assert) => {
    let pagesRead: string[] = [];
    let wrote = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.toString();
      let method = init?.method ?? 'GET';
      if (url.includes('/commits?sha=')) {
        let page = new URL(url).searchParams.get('page') ?? '';
        pagesRead.push(page);
        return jsonResponse(
          page === '1'
            ? Array.from({ length: 100 }, () => ({
                commit: { message: 'Merge branch main' },
              }))
            : [
                {
                  commit: {
                    message: 'add listing changes [boxel-submitter:1111]',
                  },
                },
              ],
        );
      }
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'commit-sha' } });
      }
      if (url.includes('/git/commits/commit-sha')) {
        return jsonResponse({ tree: { sha: 'root-tree-sha' } });
      }
      if (method !== 'GET') {
        wrote = true;
        return jsonResponse({ sha: 'x' });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    let client = new OctokitGitHubClient('test-token');
    await assert.rejects(
      client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'a1b2c3-listing',
        files: [{ path: 'a1b2c3-listing/kept.json', content: '{}' }],
        message: 'update listing [boxel-submitter:2222]',
        syncFolder: 'a1b2c3-listing',
        submitterTag: '2222',
      }),
      /holds another submitter's files/,
    );
    assert.deepEqual(pagesRead, ['1', '2'], 'reads on while a page is full');
    assert.false(wrote, 'nothing is written');
  });

  test("writeFilesToBranch refuses a file on the base branch that has the folder's name", async (assert) => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'commit-sha' } });
      }
      if (url.includes('/git/commits/commit-sha')) {
        return jsonResponse({ tree: { sha: 'root-tree-sha' } });
      }
      if (url.includes('/git/trees/root-tree-sha')) {
        return jsonResponse({
          tree: [{ path: 'a1b2c3', type: 'blob', sha: 'blob-sha' }],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    let client = new OctokitGitHubClient('test-token');
    await assert.rejects(
      client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'a1b2c3',
        files: [{ path: 'a1b2c3/kept.json', content: '{}' }],
        message: 'update listing',
        syncFolder: 'a1b2c3',
        folderMustBeNewOn: 'main',
      }),
      /already exists on main/,
    );
  });

  test('writeFilesToBranch with syncFolder is a no-op deletion-wise when the folder is new', async (assert) => {
    let createdTreeBodies: any[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.toString();
      let method = init?.method ?? 'GET';
      if (url.includes('/commits?sha=')) {
        return jsonResponse([]);
      }
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

      assert.deepEqual(
        waits,
        [11_000],
        'waits until the reset time, plus a margin',
      );
    });

    test('backs off when the reset time has already passed', async (assert) => {
      stubWrite([
        secondaryRateLimit({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1000',
        }),
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
        now: () => 1_000_000,
      });

      await client.writeFilesToBranch({
        owner: 'cardstack',
        repo: 'boxel-catalog',
        branch: 'listing',
        files,
        message: 'add listing',
      });

      assert.deepEqual(
        waits,
        [60_000, 120_000],
        'does not retry immediately at the reset boundary',
      );
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
