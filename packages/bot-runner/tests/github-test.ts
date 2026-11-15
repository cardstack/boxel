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
});
