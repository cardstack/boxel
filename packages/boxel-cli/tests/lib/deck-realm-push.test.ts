import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
import {
  applyDeckUpdate,
  refuseDeckUpdate,
  type FakeDeckUpdate,
} from '../helpers/deck-branch-update.ts';

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
    refGeneration: generation,
    checkpointHash: null,
    files,
  };
}

class Realm implements RealmAuthenticator {
  posts = 0;
  branch: DeckBranchSnapshot;
  content: Record<string, string>;

  constructor(branch: DeckBranchSnapshot, content: Record<string, string>) {
    this.branch = branch;
    this.content = content;
  }

  async authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let request = new Request(input, init);
    let url = new URL(request.url);
    if (url.pathname.endsWith('/.deck/branch') && request.method === 'GET') {
      return new Response(JSON.stringify(this.branch));
    }
    if (url.pathname.endsWith('/.deck/branch') && request.method === 'POST') {
      this.posts++;
      let update = (await request.json()) as FakeDeckUpdate;
      let refused = refuseDeckUpdate(
        this.content,
        this.branch.refGeneration,
        update,
      );
      if (refused) return refused;
      applyDeckUpdate(this.content, update);
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

describe('pushing an exact Deck branch', () => {
  it('publishes local bytes and advances the exact workspace base', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-push-'));
    let v1 = {
      'importmap.json': '{"imports":{}}',
      'controls/known-date.gts': 'known date v1',
    };
    let realm = new Realm(snapshot(v1, 1), { ...v1 });
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: realm,
    });
    await writeFile(
      join(localDir, 'controls/known-date.gts'),
      'mina known date v2',
    );

    let result = await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir,
      authenticator: realm,
    });

    expect(result).toEqual({
      files: ['controls/known-date.gts'],
      deleted: [],
      conflicts: [],
    });
    expect(realm.content['controls/known-date.gts']).toBe('mina known date v2');
    expect(
      (await loadDeckWorkspaceState(localDir))?.observedRefGeneration,
    ).toBe(2);
  });

  it('publishes onto a branch that moved elsewhere, keeping the other change', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-moved-push-'));
    let v1 = {
      'importmap.json': '{"imports":{}}',
      'controls/known-date.gts': 'known date v1',
      'theme/tokens.json': 'theme v1',
    };
    let realm = new Realm(snapshot(v1, 1), { ...v1 });
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: realm,
    });
    await writeFile(join(localDir, 'theme/tokens.json'), 'mina theme');
    // A host save of a different file moved main since the pull.
    realm.content['controls/known-date.gts'] = 'host known date v2';
    realm.branch = snapshot(realm.content, 2);

    let result = await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir,
      authenticator: realm,
    });

    expect(result.error).toBeUndefined();
    expect(result.files).toEqual(['theme/tokens.json']);
    expect(realm.content).toMatchObject({
      'controls/known-date.gts': 'host known date v2',
      'theme/tokens.json': 'mina theme',
    });
    let state = await loadDeckWorkspaceState(localDir);
    expect(state?.files['controls/known-date.gts']).toBe(
      hashWorkspaceBytes('known date v1'),
    );
    expect(state?.files['theme/tokens.json']).toBe(
      hashWorkspaceBytes('mina theme'),
    );
  });

  it('does not push a file the realm also changed, and says how to resolve it', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-stale-push-'));
    let v1 = {
      'importmap.json': '{"imports":{}}',
      'theme/tokens.json': 'theme v1',
    };
    let realm = new Realm(snapshot(v1, 1), { ...v1 });
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: realm,
    });
    await writeFile(join(localDir, 'theme/tokens.json'), 'mina local theme');
    realm.content['theme/tokens.json'] = 'kim remote theme';
    realm.branch = snapshot(realm.content, 2);

    let result = await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir,
      authenticator: realm,
    });

    expect(result.conflicts).toEqual(['theme/tokens.json']);
    expect(result.error).toMatch(/--prefer-local or --prefer-remote/);
    expect(realm.posts).toBe(0);
    expect(realm.content['theme/tokens.json']).toBe('kim remote theme');
  });
});
