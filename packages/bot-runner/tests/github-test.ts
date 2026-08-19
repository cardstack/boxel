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
});
