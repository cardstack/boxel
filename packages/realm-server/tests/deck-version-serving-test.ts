import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureRepositoryCheckpoint,
  hashBytes,
  pack,
  publishToStore,
  repositoryManifest,
} from '@cardstack/deck/node';
import type { Realm, ResponseWithNodeStream } from '@cardstack/runtime-common';
import { VirtualNetwork } from '@cardstack/runtime-common';
import QUnit from 'qunit';

import { handleDeckVersionRequest } from '../handlers/serve-deck-version.ts';
import { deckCollaborationPolicyFromEnvironment } from '../lib/deck-collaboration-policy.ts';

const { module, test } = QUnit;

function packageBytes(version: string): Buffer {
  return pack([
    {
      path: 'package.json',
      bytes: Buffer.from(
        JSON.stringify({ name: '@acme/theme', version }, null, 2) + '\n',
      ),
    },
    {
      path: 'index.js',
      bytes: Buffer.from('export const accent = "tomato";\n'),
    },
    {
      path: 'status.gts',
      bytes: Buffer.from(`
        import Component from '@glimmer/component';
        export default class Status extends Component {
          <template><strong>Exact status</strong></template>
        }
      `),
    },
    {
      path: 'card.json',
      bytes: Buffer.from(
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { title: 'Immutable theme' },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        }),
      ),
    },
    { path: 'pixel.bin', bytes: Buffer.from([0, 255, 1, 254]) },
  ]);
}

module('exact Deck Version serving', function (hooks) {
  let realmDir: string;
  let virtualNetwork: VirtualNetwork;
  let realm: Realm;
  let authorized = true;
  let publicReadable = true;

  test('normalizes the operator allowlist as canonical realm RRIs', function (assert) {
    let policy = deckCollaborationPolicyFromEnvironment({
      BOXEL_DECK_COLLABORATION_ENABLED: 'true',
      BOXEL_DECK_COLLABORATION_REALM_RRIS:
        ' @cardstack/pretui/ , @acme/theme/ ',
    });

    assert.true(policy.enabled);
    assert.deepEqual(
      [...policy.realmRRIs],
      ['@cardstack/pretui/', '@acme/theme/'],
    );
    assert.throws(
      () =>
        deckCollaborationPolicyFromEnvironment({
          BOXEL_DECK_COLLABORATION_ENABLED: 'true',
          BOXEL_DECK_COLLABORATION_REALM_RRIS:
            'https://realms.example/acme/theme/',
        }),
      /URL-form identity is not a Deck RRI/,
    );
  });

  hooks.beforeEach(async function () {
    authorized = true;
    publicReadable = true;
    realmDir = await mkdtemp(join(tmpdir(), 'deck-version-serving-'));
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@acme/theme/',
      'https://realms.example/acme/theme/',
    );
    realm = {
      dir: realmDir,
      url: 'https://realms.example/acme/theme/',
      handle: async () =>
        authorized
          ? new Response('missing', {
              status: 404,
              headers: publicReadable
                ? { 'x-boxel-realm-public-readable': 'true' }
                : undefined,
            })
          : new Response('unauthorized', { status: 401 }),
    } as unknown as Realm;
    await publishToStore(
      join(realmDir, '.deck', 'store'),
      'acme/theme',
      '1.1.0',
      packageBytes('1.1.0'),
    );
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@acme/theme', version: '1.1.0' }),
    );
    await writeFile(
      join(realmDir, 'importmap.json'),
      JSON.stringify({ imports: {} }),
    );
    await writeFile(
      join(realmDir, 'index.js'),
      'export const accent = "tomato";\n',
    );
    await captureRepositoryCheckpoint({
      realmDir,
      config: repositoryManifest({
        roots: ['@acme/theme/'],
        members: { '@acme/theme/': '.' },
      }),
      branch: 'main',
      historyHead: 'jj:main',
      indexGenerationHash: hashBytes('index:main'),
      author: { id: '@mina:boxel.test', name: 'Mina' },
      message: 'Initialize theme',
      createdAt: '2026-08-23T06:00:00.000Z',
    });
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  function serve(request: Request, isPublic = true) {
    publicReadable = isPublic;
    return handleDeckVersionRequest(request, {
      virtualNetwork,
      realms: [],
      reconciler: {} as never,
      dbAdapter: {} as never,
      resolveRealm: async () => realm,
      deckCollaboration: {
        enabled: true,
        realmRRIs: new Set(['@acme/theme/', '@user/theme/']),
      },
    });
  }

  test('serves immutable exact bytes from the realm-local CAS', async function (assert) {
    let response = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/index.js'),
    );

    assert.strictEqual(response?.status, 200);
    assert.strictEqual(
      await response?.text(),
      'export const accent = "tomato";\n',
    );
    assert.strictEqual(
      response?.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    assert.strictEqual(
      response?.headers.get('content-type'),
      'application/javascript',
    );
    assert.strictEqual(
      response?.headers.get('x-boxel-version-rri'),
      '@acme/theme@1.1.0/index.js',
    );
    assert.ok(response?.headers.get('etag'), 'content has a stable ETag');
  });

  test('advertises the authenticated server capability only for an allowed realm', async function (assert) {
    let allowed = await serve(
      new Request('https://realms.example/acme/theme/.deck/capabilities'),
    );
    let wrongRealm = await handleDeckVersionRequest(
      new Request('https://realms.example/acme/theme/.deck/capabilities'),
      {
        virtualNetwork,
        realms: [],
        reconciler: {} as never,
        dbAdapter: {} as never,
        resolveRealm: async () => realm,
        deckCollaboration: {
          enabled: true,
          realmRRIs: new Set(['@cardstack/pretui/']),
        },
      },
    );

    assert.strictEqual(allowed?.status, 200);
    assert.strictEqual(
      allowed?.headers.get('x-boxel-deck-collaboration'),
      'true',
    );
    assert.deepEqual(await allowed?.json(), {
      deckCollaboration: true,
      realmRRI: '@acme/theme/',
      protocol: 'deck-r0',
      sync: 'content-addressed',
      history: 'jj',
    });
    assert.strictEqual(wrongRealm?.status, 404);

    authorized = false;
    let privateResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/capabilities'),
    );
    assert.strictEqual(privateResponse?.status, 401);
  });

  test('observes one exact branch and its content hashes without mtimes', async function (assert) {
    let response = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let observation = (await response?.json()) as {
      schema: string;
      realmRRI: string;
      branchName: string;
      repositoryHash: string;
      treeHash: string;
      lockHash: string;
      refGeneration: number;
      checkpointHash: string;
      files: Record<string, string>;
    };

    assert.strictEqual(response?.status, 200);
    assert.strictEqual(observation.schema, 'boxel-deck-branch-observation-v1');
    assert.strictEqual(observation.realmRRI, '@acme/theme/');
    assert.strictEqual(observation.branchName, 'main');
    assert.strictEqual(observation.refGeneration, 1);
    assert.ok(observation.repositoryHash);
    assert.ok(observation.treeHash);
    assert.ok(observation.lockHash);
    assert.ok(observation.checkpointHash);
    assert.strictEqual(
      observation.files['index.js'],
      hashBytes('export const accent = "tomato";\n'),
    );
    assert.notOk('remoteMtimes' in observation);
  });

  test('serves branch bytes from the observed immutable tree', async function (assert) {
    let branch = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let { treeHash, files } = (await branch?.json()) as {
      treeHash: string;
      files: Record<string, string>;
    };
    let response = await serve(
      new Request(
        `https://realms.example/acme/theme/.deck/tree-file?tree=${treeHash}&path=index.js`,
      ),
    );

    assert.strictEqual(response?.status, 200);
    assert.strictEqual(
      await response?.text(),
      'export const accent = "tomato";\n',
    );
    assert.strictEqual(response?.headers.get('etag'), `"${files['index.js']}"`);
    assert.strictEqual(
      response?.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    );
  });

  test('conditionally publishes branch bytes without mutating the live realm', async function (assert) {
    let observedResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let observed = (await observedResponse?.json()) as {
      repositoryHash: string;
      treeHash: string;
      lockHash: string;
      refGeneration: number;
    };
    let nextBytes = 'export const accent = "indigo";\n';
    let update = {
      schema: 'boxel-deck-branch-update-v1',
      expected: observed,
      operations: [
        {
          path: 'index.js',
          sha256: hashBytes(nextBytes),
          contentBase64: Buffer.from(nextBytes).toString('base64'),
        },
      ],
    };
    let published = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      }),
    );
    let next = (await published?.json()) as {
      treeHash: string;
      refGeneration: number;
    };

    assert.strictEqual(published?.status, 200);
    assert.strictEqual(next.refGeneration, 2);
    let exact = await serve(
      new Request(
        `https://realms.example/acme/theme/.deck/tree-file?tree=${next.treeHash}&path=index.js`,
      ),
    );
    assert.strictEqual(await exact?.text(), nextBytes);
    assert.strictEqual(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(join(realmDir, 'index.js'), 'utf8'),
      ),
      'export const accent = "tomato";\n',
    );

    let stale = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      }),
    );
    assert.strictEqual(stale?.status, 409);
  });

  test('resolves semver intent to one immutable Version index', async function (assert) {
    let ranged = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/versions?spec=%5E1.0.0&q=immutable',
      ),
    );
    let result = await ranged?.json();
    let exact = await serve(
      new Request(
        'https://realms.example/acme/theme@1.1.0/.deck/index?q=immutable',
      ),
    );
    let exactResult = await exact?.json();
    let exactNoMatch = await serve(
      new Request(
        'https://realms.example/acme/theme@1.1.0/.deck/index?q=route-map',
      ),
    );

    assert.strictEqual(ranged?.status, 200);
    assert.strictEqual(
      ranged?.headers.get('cache-control'),
      'private, no-store',
    );
    assert.strictEqual(result.requested, '^1.0.0');
    assert.strictEqual(result.resolved, '1.1.0');
    assert.strictEqual(result.versionRRI, '@acme/theme@1.1.0/');
    assert.strictEqual(result.cards.length, 1);
    assert.strictEqual(result.cards[0].sourcePath, 'card.json');
    assert.strictEqual(exact?.status, 200);
    assert.deepEqual(exactResult.cards, result.cards);
    assert.strictEqual(exactNoMatch?.status, 200);
    assert.strictEqual((await exactNoMatch!.json()).cards.length, 0);
    assert.strictEqual(exactResult.indexHash, result.indexHash);
    assert.strictEqual(
      exact?.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
  });

  test('keeps Version indexes behind realm authorization', async function (assert) {
    authorized = false;
    let ranged = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/versions?spec=%5E1.0.0',
      ),
    );
    let exact = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/.deck/index'),
    );

    assert.strictEqual(ranged?.status, 401);
    assert.strictEqual(exact?.status, 401);
  });

  test('serves executable exact Versions while preserving CardSource reads', async function (assert) {
    let url = 'https://realms.example/acme/theme@1.1.0/status.gts';
    let moduleResponse = await serve(new Request(url));
    let sourceResponse = await serve(
      new Request(url, {
        headers: { accept: 'application/vnd.card+source' },
      }),
    );
    let moduleBody = await moduleResponse?.text();
    let sourceBody = await sourceResponse?.text();

    assert.strictEqual(moduleResponse?.status, 200);
    assert.strictEqual(
      moduleResponse?.headers.get('content-type'),
      'text/javascript',
    );
    assert.true(moduleBody?.includes('setComponentTemplate'));
    assert.false(moduleBody?.includes('<template'));
    assert.true(sourceBody?.includes('<template'));
    assert.strictEqual(
      sourceResponse?.headers.get('content-type'),
      'text/typescript+glimmer',
    );
  });

  test('projects extensionless card requests from immutable card JSON', async function (assert) {
    let response = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/card', {
        headers: { accept: 'application/vnd.card+json' },
      }),
    );
    let document = await response?.json();

    assert.strictEqual(response?.status, 200);
    assert.strictEqual(
      response?.headers.get('content-type'),
      'application/vnd.card+json',
    );
    assert.strictEqual(
      response?.headers.get('x-boxel-realm-url'),
      'https://realms.example/acme/theme/',
    );
    assert.strictEqual(
      document.data.id,
      'https://realms.example/acme/theme@1.1.0/card',
    );
    assert.strictEqual(
      document.data.meta.realmURL,
      'https://realms.example/acme/theme/',
    );
    assert.strictEqual(
      document.data.links.self,
      'https://realms.example/acme/theme@1.1.0/card',
    );
  });

  test('cold realms resolve from the official transport path without a preinstalled mapping', async function (assert) {
    virtualNetwork = new VirtualNetwork();
    realm = {
      ...realm,
      url: 'https://realms.example/user/theme/',
    } as Realm;
    await publishToStore(
      join(realmDir, '.deck', 'store'),
      'user/theme',
      '1.1.0',
      packageBytes('1.1.0'),
    );

    let response = await serve(
      new Request('https://realms.example/user/theme@1.1.0/index.js'),
    );

    assert.strictEqual(response?.status, 200);
    assert.strictEqual(
      await response?.text(),
      'export const accent = "tomato";\n',
    );
    assert.strictEqual(
      response?.headers.get('x-boxel-version-rri'),
      '@user/theme@1.1.0/index.js',
    );
  });

  test('keeps private Version bytes out of shared caches', async function (assert) {
    let response = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/index.js'),
      false,
    );
    assert.strictEqual(
      response?.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    );
  });

  test('supports HEAD and conditional reads', async function (assert) {
    let url = 'https://realms.example/acme/theme@1.1.0/index.js';
    let first = await serve(new Request(url));
    let etag = first!.headers.get('etag')!;
    let head = await serve(new Request(url, { method: 'HEAD' }));
    let unchanged = await serve(
      new Request(url, { headers: { 'if-none-match': etag } }),
    );

    assert.strictEqual(head?.status, 200);
    assert.strictEqual(await head?.text(), '');
    assert.strictEqual(head?.headers.get('etag'), etag);
    assert.strictEqual(unchanged?.status, 304);
  });

  test('preserves binary assets across the Realm Server stream boundary', async function (assert) {
    let response = (await serve(
      new Request('https://realms.example/acme/theme@1.1.0/pixel.bin'),
    )) as ResponseWithNodeStream;
    let chunks: Buffer[] = [];
    for await (let chunk of response.nodeStream!) {
      chunks.push(Buffer.from(chunk));
    }

    assert.deepEqual([...Buffer.concat(chunks)], [0, 255, 1, 254]);
    assert.strictEqual(
      response.headers.get('content-type'),
      'application/octet-stream',
    );
  });

  test('does not leak private or missing exact Versions', async function (assert) {
    authorized = false;
    let privateResponse = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/index.js'),
    );
    authorized = true;
    let missingResponse = await serve(
      new Request('https://realms.example/acme/theme@9.9.9/index.js'),
    );

    assert.strictEqual(privateResponse?.status, 401);
    assert.strictEqual(missingResponse?.status, 404);
  });

  test('declines ordinary mutable realm requests and rejects writes', async function (assert) {
    let mutable = await serve(
      new Request('https://realms.example/acme/theme/index.js'),
    );
    let write = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/index.js', {
        method: 'PUT',
        body: 'replacement',
      }),
    );

    assert.strictEqual(mutable, null);
    assert.strictEqual(write?.status, 405);
    assert.strictEqual(write?.headers.get('allow'), 'GET, HEAD');
  });

  test('is inert when the pilot is disabled or the realm is not allowlisted', async function (assert) {
    let request = new Request(
      'https://realms.example/acme/theme@1.1.0/index.js',
    );
    let baseDeps = {
      virtualNetwork,
      realms: [],
      reconciler: {} as never,
      dbAdapter: {} as never,
      resolveRealm: async () => realm,
    };

    assert.strictEqual(
      await handleDeckVersionRequest(request, {
        ...baseDeps,
        deckCollaboration: {
          enabled: false,
          realmRRIs: new Set(['@acme/theme/']),
        },
      }),
      null,
      'operator kill switch removes the exact-Version surface',
    );
    assert.strictEqual(
      await handleDeckVersionRequest(request, {
        ...baseDeps,
        deckCollaboration: {
          enabled: true,
          realmRRIs: new Set(['@cardstack/pretui/']),
        },
      }),
      null,
      'a different realm cannot opt itself in',
    );
  });
});
