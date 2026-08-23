import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DeckRealmWatcher,
  RealmWatcher,
  type FlushResult,
  watchRealms,
} from '../../src/commands/realm/watch/start.ts';
import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
import { pushDeckBranch } from '../../src/lib/deck-realm-push.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

const REALM_URL = 'https://realm.example/pretui/';

function snapshot(
  content: Record<string, string>,
  generation: number,
): DeckBranchSnapshot {
  let files = Object.fromEntries(
    Object.entries(content).map(([path, bytes]) => [
      path,
      hashWorkspaceBytes(bytes),
    ]),
  );
  return {
    schema: DECK_BRANCH_OBSERVATION_SPEC,
    realmRRI: '@cardstack/pretui/',
    branchId: '@cardstack/pretui/:main',
    branchName: 'main',
    repositoryHash: hashWorkspaceBytes(`repository:${generation}`),
    treeHash: inventoryTreeHash(files),
    lockHash: hashWorkspaceBytes('lock'),
    historyHead: `step${generation}`,
    indexGenerationHash: hashWorkspaceBytes(`index:${generation}`),
    refGeneration: generation,
    checkpointHash: null,
    files,
  };
}

class TeamRealm implements RealmAuthenticator {
  branch: DeckBranchSnapshot;
  content: Record<string, string>;
  posts = 0;

  constructor(content: Record<string, string>) {
    this.content = content;
    this.branch = snapshot(content, 1);
  }

  moveRefWithoutChangingContent(): void {
    this.branch = snapshot(this.content, this.branch.refGeneration + 1);
  }

  async authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let request = new Request(input, init);
    let url = new URL(request.url);
    if (url.pathname.endsWith('/.deck/capabilities')) {
      return url.pathname.includes('/pretui/')
        ? new Response(
            JSON.stringify({
              deckCollaboration: true,
              realmRRI: '@cardstack/pretui/',
              protocol: 'deck-r0',
              sync: 'content-addressed',
              history: 'jj',
            }),
          )
        : new Response('not found', { status: 404 });
    }
    if (url.pathname.endsWith('/_mtimes')) {
      return new Response(
        JSON.stringify({ data: { attributes: { mtimes: {} } } }),
      );
    }
    if (url.pathname.endsWith('/.deck/branch') && request.method === 'GET') {
      return new Response(JSON.stringify(this.branch));
    }
    if (url.pathname.endsWith('/.deck/branch') && request.method === 'POST') {
      let update = (await request.json()) as {
        expected: { refGeneration: number };
        operations: Array<{
          path: string;
          sha256: string | null;
          contentBase64?: string;
        }>;
      };
      if (update.expected.refGeneration !== this.branch.refGeneration) {
        return new Response('moved', { status: 409 });
      }
      this.posts++;
      for (let operation of update.operations) {
        if (operation.sha256 === null) delete this.content[operation.path];
        else {
          this.content[operation.path] = Buffer.from(
            operation.contentBase64!,
            'base64',
          ).toString();
        }
      }
      this.branch = snapshot(this.content, this.branch.refGeneration + 1);
      return new Response(JSON.stringify(this.branch));
    }
    if (url.pathname.endsWith('/.deck/tree-file')) {
      let value = this.content[url.searchParams.get('path')!];
      return value === undefined
        ? new Response('not found', { status: 404 })
        : new Response(value);
    }
    return new Response('not found', { status: 404 });
  }
}

async function localWorkspace(realm: TeamRealm): Promise<string> {
  let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-watch-'));
  await pullDeckBranch({
    realmURL: REALM_URL,
    branchName: 'main',
    localDir,
    authenticator: realm,
  });
  return localDir;
}

async function flush(watcher: DeckRealmWatcher): Promise<FlushResult> {
  return await new Promise((resolve) => watcher.scheduleFlush(resolve));
}

describe('watching an exact Deck branch', () => {
  it('detects local bytes without mtimes and conditionally publishes once', async () => {
    let realm = new TeamRealm({
      'importmap.json': '{"imports":{}}',
      'controls/known-date.gts': 'known date v1',
    });
    let localDir = await localWorkspace(realm);
    let watcher = new DeckRealmWatcher(
      { realmUrl: REALM_URL, localDir },
      realm,
      { debounceMs: 0, claudeSkills: false },
    );
    await watcher.initialize();

    await writeFile(join(localDir, 'controls/known-date.gts'), 'known date v2');
    expect(await watcher.poll()).toBe(true);
    expect(watcher.pendingCount).toBe(1);
    expect(await watcher.poll()).toBe(false);
    expect(realm.posts).toBe(0);

    let result = await flush(watcher);
    watcher.shutdown();
    expect(result.error).toBeUndefined();
    expect(result.pushed).toEqual(['controls/known-date.gts']);
    expect(realm.posts).toBe(1);
    expect(realm.content['controls/known-date.gts']).toBe('known date v2');
  });

  it('reconciles disjoint teammate work before publishing local work', async () => {
    let realm = new TeamRealm({
      'controls/known-date.gts': 'known date v1',
      'theme/tokens.json': 'theme v1',
    });
    let [watchedDir, teammateDir] = await Promise.all([
      localWorkspace(realm),
      localWorkspace(realm),
    ]);
    let watcher = new DeckRealmWatcher(
      { realmUrl: REALM_URL, localDir: watchedDir },
      realm,
      { debounceMs: 0, claudeSkills: false },
    );
    await watcher.initialize();
    await writeFile(join(watchedDir, 'theme/tokens.json'), 'theme v2');
    await writeFile(
      join(teammateDir, 'controls/known-date.gts'),
      'known date v2',
    );
    await pushDeckBranch({
      realmURL: REALM_URL,
      localDir: teammateDir,
      authenticator: realm,
    });

    expect(await watcher.poll()).toBe(true);
    let result = await flush(watcher);
    watcher.shutdown();
    expect(result.error).toBeUndefined();
    expect(result.pulled).toEqual(['controls/known-date.gts']);
    expect(result.pushed).toEqual(['theme/tokens.json']);
    expect(
      await readFile(join(watchedDir, 'controls/known-date.gts'), 'utf8'),
    ).toBe('known date v2');
    expect(realm.content['theme/tokens.json']).toBe('theme v2');
  });

  it('reports same-file conflicts and sends no conditional write', async () => {
    let realm = new TeamRealm({ 'theme/tokens.json': 'theme v1' });
    let [watchedDir, teammateDir] = await Promise.all([
      localWorkspace(realm),
      localWorkspace(realm),
    ]);
    let watcher = new DeckRealmWatcher(
      { realmUrl: REALM_URL, localDir: watchedDir },
      realm,
      { debounceMs: 0, claudeSkills: false },
    );
    await watcher.initialize();
    await writeFile(join(watchedDir, 'theme/tokens.json'), 'mine');
    await writeFile(join(teammateDir, 'theme/tokens.json'), 'theirs');
    await pushDeckBranch({
      realmURL: REALM_URL,
      localDir: teammateDir,
      authenticator: realm,
    });
    let postsBeforeConflict = realm.posts;

    expect(await watcher.poll()).toBe(true);
    let result = await flush(watcher);
    watcher.shutdown();
    expect(result.error).toMatch(/content conflict/);
    expect(result.skipped).toEqual(['theme/tokens.json']);
    expect(realm.posts).toBe(postsBeforeConflict);
    expect(realm.content['theme/tokens.json']).toBe('theirs');
  });

  it('observes a ref-only move and ignores generated local agent metadata', async () => {
    let realm = new TeamRealm({
      'skills/theme-review/SKILL.md': 'review the theme',
    });
    let localDir = await localWorkspace(realm);
    let watcher = new DeckRealmWatcher(
      { realmUrl: REALM_URL, localDir },
      realm,
      { debounceMs: 0, claudeSkills: true },
    );
    await watcher.initialize();

    expect(await watcher.poll()).toBe(false);
    realm.moveRefWithoutChangingContent();
    expect(await watcher.poll()).toBe(true);
    expect(watcher.pendingCount).toBe(1);
    let result = await flush(watcher);
    watcher.shutdown();

    expect(result.error).toBeUndefined();
    expect(result.pushed).toEqual([]);
    expect(realm.posts).toBe(0);
    expect(
      (await loadDeckWorkspaceState(localDir))?.observedRefGeneration,
    ).toBe(2);
  });

  it('selects a complete watcher implementation independently per realm', async () => {
    let realm = new TeamRealm({ 'theme/tokens.json': 'theme v1' });
    let deckDir = await mkdtemp(join(tmpdir(), 'boxel-deck-watch-route-'));
    let legacyDir = await mkdtemp(join(tmpdir(), 'boxel-legacy-watch-route-'));
    let controller = new AbortController();
    controller.abort();

    let result = await watchRealms(
      [
        { realmUrl: REALM_URL, localDir: deckDir },
        {
          realmUrl: 'https://realm.example/legacy/',
          localDir: legacyDir,
        },
      ],
      {
        authenticator: realm,
        signal: controller.signal,
        quiet: true,
        debounceMs: 0,
        claudeSkills: false,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.watchers).toHaveLength(2);
    expect(result.watchers[0]).toBeInstanceOf(DeckRealmWatcher);
    expect(result.watchers[1]).toBeInstanceOf(RealmWatcher);
  });
});
