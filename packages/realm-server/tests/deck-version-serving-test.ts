import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RealmEventContent } from '@cardstack/base/matrix-event';
import {
  captureRepositoryCheckpoint,
  hashBytes,
  pack,
  publishToStore,
  readCheckpoint,
  readTreeFromDir,
  repositoryManifest,
} from '@cardstack/deck/node';
import type {
  HistoryActor,
  HistoryBackend,
  HistoryEntry,
  RestorePlan,
} from '@cardstack/deck-history/backend';
import type { Realm, ResponseWithNodeStream } from '@cardstack/runtime-common';
import {
  REALM_VIEW_HEADER,
  SupportedMimeType,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import QUnit from 'qunit';

import { handleDeckVersionRequest } from '../handlers/serve-deck-version.ts';
import { deckCollaborationPolicyFromEnvironment } from '../lib/deck-collaboration-policy.ts';
import { createJWT } from '../utils/jwt.ts';

const { module, test } = QUnit;
const REALM_SECRET_SEED = 'deck-b2b-test-secret';

class TestHistory implements HistoryBackend {
  readonly kind = 'deckd' as const;
  private entries: Array<{
    id: string;
    message: string;
    files: Map<string, Buffer>;
    actor?: HistoryActor;
  }> = [];

  noteMutation(): void {}
  async fork(): Promise<void> {}
  async discard(): Promise<void> {}
  async flush(): Promise<string | undefined> {
    return undefined;
  }
  async seal(
    dir: string,
    message: string,
    actor?: HistoryActor,
  ): Promise<string | undefined> {
    let files = await readTreeFromDir(dir);
    let prior = this.entries.at(-1)?.files;
    if (
      prior &&
      prior.size === files.size &&
      [...files].every(([path, bytes]) => prior.get(path)?.equals(bytes))
    ) {
      return undefined;
    }
    let id = `step${this.entries.length + 1}`;
    this.entries.push({ id, message, files, actor });
    return id;
  }
  async merge(
    dir: string,
    _targetRevisionId: string,
    _sourceRevisionId: string,
    message: string,
    actor?: HistoryActor,
  ): Promise<string> {
    let id = `step${this.entries.length + 1}`;
    this.entries.push({
      id,
      message,
      files: await readTreeFromDir(dir),
      actor,
    });
    return id;
  }
  async head(): Promise<string | undefined> {
    return this.entries.length ? `step${this.entries.length}` : undefined;
  }
  async list(): Promise<HistoryEntry[]> {
    return [...this.entries].reverse().map(({ id, message, files, actor }) => ({
      changeId: id,
      commitId: hashBytes(`commit:${id}`),
      timestamp: '2026-08-23T08:00:00.000Z',
      description: message,
      filesSummary: [...files.keys()],
      ...(actor ? { author: actor.name } : {}),
    }));
  }
  async fileAt(
    _dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined> {
    return this.entries.find(({ id }) => id === revisionId)?.files.get(path);
  }
  async fileListAt(_dir: string, revisionId: string): Promise<string[]> {
    let entry = this.entries.find(({ id }) => id === revisionId);
    if (!entry) throw new Error(`missing History Step ${revisionId}`);
    return [...entry.files.keys()];
  }
  async restorePlan(): Promise<RestorePlan> {
    return { writes: [], deletes: [] };
  }
  close(): void {}
}

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
  let deckHistory: TestHistory;
  let realmEvents: RealmEventContent[];

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
    deckHistory = new TestHistory();
    realmEvents = [];
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
      async broadcastEvent(event: RealmEventContent) {
        realmEvents.push(event);
      },
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
      deckHistory,
      realmSecretSeed: REALM_SECRET_SEED,
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
        deckHistory,
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
    assert.strictEqual(observation.schema, 'boxel-deck-branch-observation-v2');
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

  test('creates and lists a branch through the authenticated Realm surface', async function (assert) {
    let created = await serve(
      new Request('https://realms.example/acme/theme/.deck/branches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schema: 'boxel-deck-branch-create-v1',
          branchName: 'ana/button-tone',
          fromBranch: 'main',
        }),
      }),
    );
    let result = (await created?.json()) as {
      schema: string;
      branchName: string;
      fromBranch: string;
      refGeneration: number;
      indexGenerationHash: string;
    };
    assert.strictEqual(created?.status, 201);
    assert.strictEqual(result.schema, 'boxel-deck-branch-create-result-v1');
    assert.strictEqual(result.branchName, 'ana/button-tone');
    assert.strictEqual(result.fromBranch, 'main');
    assert.strictEqual(result.refGeneration, 1);
    assert.ok(result.indexGenerationHash);

    let listed = await serve(
      new Request('https://realms.example/acme/theme/.deck/branches'),
    );
    let list = (await listed?.json()) as {
      schema: string;
      branches: { branchName: string }[];
    };
    assert.strictEqual(listed?.status, 200);
    assert.strictEqual(list.schema, 'boxel-deck-branch-list-v1');
    assert.deepEqual(
      list.branches.map(({ branchName }) => branchName),
      ['ana/button-tone', 'main'],
    );
    assert.strictEqual(realmEvents.at(-1)?.eventName, 'branch');
    assert.strictEqual(
      (realmEvents.at(-1) as { branch?: string }).branch,
      'ana/button-tone',
    );
  });

  test('opens and reads a Review pinned to exact branch Checkpoints', async function (assert) {
    let createdBranch = await serve(
      new Request('https://realms.example/acme/theme/.deck/branches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schema: 'boxel-deck-branch-create-v1',
          branchName: 'mina/focus-ring',
          fromBranch: 'main',
        }),
      }),
    );
    assert.strictEqual(createdBranch?.status, 201);

    let sourceResponse = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/branch?name=mina%2Ffocus-ring',
      ),
    );
    let source = (await sourceResponse?.json()) as {
      repositoryHash: string;
      treeHash: string;
      lockHash: string;
      refGeneration: number;
      checkpointHash: string;
    };
    let nextBytes = 'export const accent = "visible-focus";\n';
    let updatedResponse = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/branch?name=mina%2Ffocus-ring',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: 'boxel-deck-branch-update-v2',
            message: 'save: visible focus ring',
            expected: source,
            operations: [
              {
                path: 'index.js',
                sha256: hashBytes(nextBytes),
                contentBase64: Buffer.from(nextBytes).toString('base64'),
              },
            ],
          }),
        },
      ),
    );
    let updated = (await updatedResponse?.json()) as typeof source;
    assert.strictEqual(updatedResponse?.status, 200);
    let checkpointResponse = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/checkpoint?branch=mina%2Ffocus-ring',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: 'boxel-deck-checkpoint-create-v1',
            message: 'Visible focus candidate',
            expected: updated,
          }),
        },
      ),
    );
    let checkpointed = (await checkpointResponse?.json()) as {
      checkpointHash: string;
    };
    assert.strictEqual(checkpointResponse?.status, 201);
    let mainResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let main = (await mainResponse?.json()) as {
      checkpointHash: string;
    };

    let openedResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schema: 'boxel-deck-review-open-v1',
          sourceBranch: 'mina/focus-ring',
          targetBranch: 'main',
          expected: {
            sourceCheckpointHash: checkpointed.checkpointHash,
            targetCheckpointHash: main.checkpointHash,
          },
          title: 'Make keyboard focus unmistakable',
          body: 'A visible design-system change for PretUI consumers.',
        }),
      }),
    );
    let opened = (await openedResponse?.json()) as {
      schema: string;
      number: number;
      state: string;
      generation: number;
      base: { checkpointHash: string };
      target: { checkpointHash: string };
      source: { checkpointHash: string; treeHash: string };
    };
    assert.strictEqual(openedResponse?.status, 201);
    assert.strictEqual(opened.schema, 'boxel-deck-review-v1');
    assert.strictEqual(opened.state, 'open');
    assert.strictEqual(opened.base.checkpointHash, main.checkpointHash);
    assert.strictEqual(opened.target.checkpointHash, main.checkpointHash);
    assert.strictEqual(
      opened.source.checkpointHash,
      checkpointed.checkpointHash,
    );
    assert.strictEqual(opened.source.treeHash, updated.treeHash);

    let shown = await serve(
      new Request(
        `https://realms.example/acme/theme/.deck/review?number=${opened.number}`,
      ),
    );
    let listed = await serve(
      new Request('https://realms.example/acme/theme/.deck/reviews'),
    );
    assert.strictEqual(shown?.status, 200);
    assert.strictEqual(
      ((await shown?.json()) as { source: { checkpointHash: string } }).source
        .checkpointHash,
      checkpointed.checkpointHash,
    );
    assert.deepEqual(
      ((await listed?.json()) as { reviews: { number: number }[] }).reviews.map(
        ({ number }) => number,
      ),
      [opened.number],
    );

    let mergedResponse = await serve(
      new Request(
        `https://realms.example/acme/theme/.deck/review?number=${opened.number}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: 'boxel-deck-review-merge-v1',
            expected: {
              reviewGeneration: opened.generation,
              targetCheckpointHash: main.checkpointHash,
            },
          }),
        },
      ),
    );
    let merged = (await mergedResponse?.json()) as {
      schema: string;
      state: string;
      treeHash: string;
      mergeCheckpointHash: string;
      review: { state: string; events: Array<{ type: string }> };
    };
    assert.strictEqual(mergedResponse?.status, 201);
    assert.strictEqual(merged.schema, 'boxel-deck-review-merge-result-v1');
    assert.strictEqual(merged.state, 'ready');
    assert.strictEqual(merged.review.state, 'merged');
    assert.deepEqual(
      merged.review.events.map(({ type }) => type),
      ['merge-started', 'merged'],
    );
    assert.strictEqual(
      await readFile(join(realmDir, 'index.js'), 'utf8'),
      nextBytes,
      'the target workspace now contains the reviewed bytes',
    );
    let mergedMainResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let mergedMain = (await mergedMainResponse?.json()) as {
      treeHash: string;
      checkpointHash: string;
    };
    assert.strictEqual(mergedMain.treeHash, merged.treeHash);
    assert.strictEqual(
      mergedMain.checkpointHash,
      merged.mergeCheckpointHash,
      'the mutable main ref advances once to the two-parent Checkpoint',
    );
    assert.deepEqual(
      (await readCheckpoint(realmDir, merged.mergeCheckpointHash))?.parents,
      [main.checkpointHash, checkpointed.checkpointHash],
      'the merge Checkpoint preserves exact target and source ancestry',
    );
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

  test('does not expose a branch until its immutable index generation exists', async function (assert) {
    let response = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/branch-index?branch=main',
      ),
    );

    assert.strictEqual(response?.status, 409);
    assert.true((await response?.text())?.includes('not available'));
  });

  test('queries the exact RRI-bearing view installed by an accepted write', async function (assert) {
    let observedResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let observed = (await observedResponse?.json()) as {
      repositoryHash: string;
      treeHash: string;
      lockHash: string;
      refGeneration: number;
    };
    let sourcePath = 'catalog/compact-status.json';
    let bytes = JSON.stringify({
      data: {
        type: 'card',
        attributes: { title: 'Compact Status preview' },
      },
    });
    let published = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schema: 'boxel-deck-branch-update-v2',
          message: `save: ${sourcePath}`,
          expected: observed,
          operations: [
            {
              path: sourcePath,
              sha256: hashBytes(bytes),
              contentBase64: Buffer.from(bytes).toString('base64'),
            },
          ],
        }),
      }),
    );
    let branch = (await published?.json()) as {
      repositoryHash: string;
      treeHash: string;
      lockHash: string;
      historyHead: string;
      indexGenerationHash: string;
    };
    let response = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/branch-index?branch=main&q=compact',
      ),
    );
    let result = (await response?.json()) as {
      schema: string;
      indexGenerationHash: string;
      view: Record<string, unknown>;
      cards: Array<{ rri: string; sourcePath: string }>;
    };

    assert.strictEqual(published?.status, 200);
    assert.strictEqual(response?.status, 200);
    assert.strictEqual(
      response?.headers.get('cache-control'),
      'private, no-store',
    );
    assert.strictEqual(result.schema, 'boxel-deck-branch-index-query-v1');
    assert.strictEqual(result.indexGenerationHash, branch.indexGenerationHash);
    assert.deepEqual(result.view, {
      schema: 'boxel-realm-view-context-v1',
      realmRRI: '@acme/theme/',
      branch: 'main',
      repositoryHash: branch.repositoryHash,
      treeHash: branch.treeHash,
      lockHash: branch.lockHash,
      historyHead: branch.historyHead,
    });
    assert.deepEqual(
      result.cards.map(({ rri, sourcePath: path }) => ({
        rri,
        sourcePath: path,
      })),
      [{ rri: '@acme/theme/catalog/compact-status', sourcePath }],
    );
  });

  test('serves two immutable source trees at one realm URL without falling through to live', async function (assert) {
    async function observe() {
      let response = await serve(
        new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
      );
      return (await response?.json()) as {
        repositoryHash: string;
        treeHash: string;
        lockHash: string;
        refGeneration: number;
      };
    }

    async function publish(source: string) {
      let expected = await observe();
      let response = await serve(
        new Request(
          'https://realms.example/acme/theme/.deck/branch?name=main',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              schema: 'boxel-deck-branch-update-v2',
              message: 'save: index.js',
              expected,
              operations: [
                {
                  path: 'index.js',
                  sha256: hashBytes(source),
                  contentBase64: Buffer.from(source).toString('base64'),
                },
              ],
            }),
          },
        ),
      );
      assert.strictEqual(response?.status, 200);
      return (await response?.json()) as { indexGenerationHash: string };
    }

    let blueSource = 'export const accent = "blue";\n';
    let blue = await publish(blueSource);
    let greenSource = 'export const accent = "green";\n';
    let green = await publish(greenSource);
    await writeFile(
      join(realmDir, 'index.js'),
      'export const accent = "uncommitted live bytes";\n',
    );
    await writeFile(join(realmDir, 'scratch.js'), 'not in either view\n');

    async function sourceAt(indexGenerationHash: string) {
      return serve(
        new Request('https://realms.example/acme/theme/index.js', {
          headers: {
            accept: SupportedMimeType.CardSource,
            [REALM_VIEW_HEADER]: indexGenerationHash,
          },
        }),
      );
    }
    let blueResponse = await sourceAt(blue.indexGenerationHash);
    let greenResponse = await sourceAt(green.indexGenerationHash);

    assert.strictEqual(await blueResponse?.text(), blueSource);
    assert.strictEqual(await greenResponse?.text(), greenSource);
    assert.strictEqual(
      blueResponse?.headers.get('x-boxel-realm-view'),
      blue.indexGenerationHash,
    );
    assert.strictEqual(
      greenResponse?.headers.get('x-boxel-realm-view'),
      green.indexGenerationHash,
    );
    assert.true(
      blueResponse?.headers.get('vary')?.includes(REALM_VIEW_HEADER),
      'shared URL caches vary on exact Realm view',
    );
    let inventoryResponse = await serve(
      new Request('https://realms.example/acme/theme/_mtimes', {
        headers: {
          accept: SupportedMimeType.Mtimes,
          [REALM_VIEW_HEADER]: blue.indexGenerationHash,
        },
      }),
    );
    let inventory = (await inventoryResponse?.json()) as {
      data: { attributes: { mtimes: Record<string, number> } };
    };
    assert.strictEqual(inventoryResponse?.status, 200);
    assert.strictEqual(
      inventory.data.attributes.mtimes[
        'https://realms.example/acme/theme/index.js'
      ],
      0,
    );
    assert.notOk(
      inventory.data.attributes.mtimes[
        'https://realms.example/acme/theme/scratch.js'
      ],
      'the exact inventory excludes uncommitted live files',
    );
  });

  test('an exact Realm view fails closed for invalid identity and writes', async function (assert) {
    let invalid = await serve(
      new Request('https://realms.example/acme/theme/index.js', {
        headers: { [REALM_VIEW_HEADER]: 'main' },
      }),
    );
    let write = await serve(
      new Request('https://realms.example/acme/theme/index.js', {
        method: 'POST',
        headers: { [REALM_VIEW_HEADER]: 'a'.repeat(64) },
      }),
    );

    assert.strictEqual(invalid?.status, 400);
    assert.strictEqual(write?.status, 405);
  });

  test('conditionally publishes branch bytes and records exact main History', async function (assert) {
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
      schema: 'boxel-deck-branch-update-v2',
      message: 'save: index.js',
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
        headers: {
          authorization: `Bearer ${createJWT(
            { user: '@mina:boxel.test', sessionRoom: '!deck:test' },
            REALM_SECRET_SEED,
          )}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(update),
      }),
    );
    let next = (await published?.json()) as {
      treeHash: string;
      repositoryHash: string;
      historyHead: string;
      indexGenerationHash: string;
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
      nextBytes,
    );

    let stale = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      }),
    );
    assert.strictEqual(stale?.status, 409);
    assert.strictEqual(
      (await deckHistory.list())[0].author,
      '@mina:boxel.test',
      'the accepted writer is attributed from the verified realm token',
    );
    assert.deepEqual(
      realmEvents,
      [
        {
          eventName: 'branch',
          realmURL: 'https://realms.example/acme/theme/',
          branch: 'main',
          previousRealmView: hashBytes('index:main'),
          realmView: next.indexGenerationHash,
          refGeneration: 2,
          repositoryHash: next.repositoryHash,
          treeHash: next.treeHash,
          historyHead: next.historyHead,
          message: 'save: index.js',
          actor: '@mina:boxel.test',
        },
      ],
      'one accepted ref movement becomes one attributed activity event',
    );
  });

  test('lists branch History and restores an old Step by moving forward', async function (assert) {
    let observedResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let observed = (await observedResponse?.json()) as {
      repositoryHash: string;
      treeHash: string;
      lockHash: string;
      refGeneration: number;
    };
    let indigo = 'export const accent = "indigo";\n';
    await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schema: 'boxel-deck-branch-update-v2',
          message: 'save: index.js',
          expected: observed,
          operations: [
            {
              path: 'index.js',
              sha256: hashBytes(indigo),
              contentBase64: Buffer.from(indigo).toString('base64'),
            },
          ],
        }),
      }),
    );
    let historyResponse = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/history?branch=main',
      ),
    );
    let history = (await historyResponse?.json()) as {
      historyHead: string;
      entries: HistoryEntry[];
    };
    assert.strictEqual(historyResponse?.status, 200);
    assert.deepEqual(
      history.entries.map(({ changeId, description }) => ({
        changeId,
        description,
      })),
      [
        { changeId: 'step2', description: 'save: index.js' },
        { changeId: 'step1', description: 'History baseline' },
      ],
    );

    let currentResponse = await serve(
      new Request('https://realms.example/acme/theme/.deck/branch?name=main'),
    );
    let current = (await currentResponse?.json()) as typeof observed;
    let restoredResponse = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/history?branch=main',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: 'boxel-deck-history-restore-v1',
            revisionId: 'step1',
            expected: current,
          }),
        },
      ),
    );
    let restored = await restoredResponse?.json();
    assert.strictEqual(restoredResponse?.status, 200);
    assert.strictEqual(restored.refGeneration, 3);
    assert.strictEqual(restored.historyHead, 'step3');
    assert.strictEqual(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(join(realmDir, 'index.js'), 'utf8'),
      ),
      'export const accent = "tomato";\n',
      'restore replays the target bytes into main',
    );
    let afterHistory = await serve(
      new Request(
        'https://realms.example/acme/theme/.deck/history?branch=main',
      ),
    );
    assert.deepEqual(
      ((await afterHistory?.json()) as { entries: HistoryEntry[] }).entries.map(
        ({ changeId, description }) => ({ changeId, description }),
      ),
      [
        { changeId: 'step3', description: 'restore: step1' },
        { changeId: 'step2', description: 'save: index.js' },
        { changeId: 'step1', description: 'History baseline' },
      ],
      'History grows; restore does not rewind it',
    );
    let branchEvents = realmEvents.filter(
      (event) => event.eventName === 'branch',
    );
    assert.deepEqual(
      branchEvents.map((event) => ({
        message: event.message,
        previousRealmView: event.previousRealmView,
        realmView: event.realmView,
        refGeneration: event.refGeneration,
      })),
      [
        {
          message: 'save: index.js',
          previousRealmView: hashBytes('index:main'),
          realmView: branchEvents[0].realmView,
          refGeneration: 2,
        },
        {
          message: 'restore: step1',
          previousRealmView: branchEvents[0].realmView,
          realmView: restored.indexGenerationHash,
          refGeneration: 3,
        },
      ],
      'restore is a second ref movement instead of synthetic file activity',
    );
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

  test('resolves extensionless modules inside exact Versions', async function (assert) {
    let response = await serve(
      new Request('https://realms.example/acme/theme@1.1.0/status'),
    );
    let body = await response?.text();

    assert.strictEqual(response?.status, 200);
    assert.strictEqual(
      response?.headers.get('content-type'),
      'text/javascript',
    );
    assert.true(body?.includes('setComponentTemplate'));
    assert.false(body?.includes('<template'));
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
      deckHistory,
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
