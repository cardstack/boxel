import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
import { pushDeckBranch } from '../../src/lib/deck-realm-push.ts';
import { syncDeckBranch } from '../../src/lib/deck-realm-sync.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
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

class TeamRealm implements RealmAuthenticator {
  branch: DeckBranchSnapshot;
  content: Record<string, string>;
  posts = 0;
  beforeNextPost: (() => void) | undefined;

  constructor(content: Record<string, string>) {
    this.content = content;
    this.branch = snapshot(content, 1);
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
      let race = this.beforeNextPost;
      this.beforeNextPost = undefined;
      race?.();
      let update = (await request.json()) as FakeDeckUpdate;
      let refused = refuseDeckUpdate(
        this.content,
        this.branch.refGeneration,
        update,
      );
      if (refused) return refused;
      this.posts++;
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

async function workspace(realm: TeamRealm): Promise<string> {
  let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-team-'));
  await pullDeckBranch({
    realmURL: 'https://realm.example/pretui/',
    branchName: 'main',
    localDir,
    authenticator: realm,
  });
  return localDir;
}

describe('synchronizing an exact Deck branch', () => {
  it('reconciles disjoint work from two PretUI developers then publishes once', async () => {
    let realm = new TeamRealm({
      'importmap.json': '{"imports":{}}',
      'controls/known-date.gts': 'known date v1',
      'theme/tokens.json': 'theme v1',
    });
    let [mina, kim] = await Promise.all([workspace(realm), workspace(realm)]);
    await writeFile(
      join(mina, 'controls/known-date.gts'),
      'mina known date v2',
    );
    await writeFile(join(kim, 'theme/tokens.json'), 'kim theme v2');
    await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir: mina,
      authenticator: realm,
    });

    let result = await syncDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir: kim,
      authenticator: realm,
    });

    expect(result.error).toBeUndefined();
    expect(result.pulled).toEqual(['controls/known-date.gts']);
    expect(result.pushed).toEqual(['theme/tokens.json']);
    expect(realm.content).toMatchObject({
      'controls/known-date.gts': 'mina known date v2',
      'theme/tokens.json': 'kim theme v2',
    });
    expect(realm.branch.refGeneration).toBe(3);
  });

  it('skips and reports a file both developers changed, and syncs the rest', async () => {
    let realm = new TeamRealm({
      'importmap.json': '{"imports":{}}',
      'theme/tokens.json': 'theme v1',
      'controls/known-date.gts': 'known date v1',
    });
    let [mina, kim] = await Promise.all([workspace(realm), workspace(realm)]);
    await writeFile(join(mina, 'theme/tokens.json'), 'mina theme');
    await writeFile(join(kim, 'theme/tokens.json'), 'kim theme');
    await writeFile(join(kim, 'controls/known-date.gts'), 'kim known date');
    await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir: mina,
      authenticator: realm,
    });

    let result = await syncDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir: kim,
      authenticator: realm,
    });

    expect(result.error).toBeUndefined();
    expect(result.conflicts).toEqual(['theme/tokens.json']);
    expect(result.pushed).toEqual(['controls/known-date.gts']);
    expect(realm.content['theme/tokens.json']).toBe('mina theme');
    expect(realm.content['controls/known-date.gts']).toBe('kim known date');
    expect(await readFile(join(kim, 'theme/tokens.json'), 'utf8')).toBe(
      'kim theme',
    );

    // Still a conflict next time: the skipped file kept its old base.
    let again = await syncDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir: kim,
      authenticator: realm,
    });
    expect(again.conflicts).toEqual(['theme/tokens.json']);
  });

  it("--prefer-local publishes the local file on top of the realm's", async () => {
    let realm = new TeamRealm({
      'importmap.json': '{"imports":{}}',
      'theme/tokens.json': 'theme v1',
    });
    let [mina, kim] = await Promise.all([workspace(realm), workspace(realm)]);
    await writeFile(join(mina, 'theme/tokens.json'), 'mina theme');
    await writeFile(join(kim, 'theme/tokens.json'), 'kim theme');
    await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir: mina,
      authenticator: realm,
    });

    let result = await syncDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir: kim,
      authenticator: realm,
      strategy: 'prefer-local',
    });

    expect(result.error).toBeUndefined();
    expect(result.conflicts).toEqual([]);
    expect(result.pushed).toEqual(['theme/tokens.json']);
    expect(realm.content['theme/tokens.json']).toBe('kim theme');
  });

  it("--prefer-remote takes the realm's file and publishes nothing for it", async () => {
    let realm = new TeamRealm({
      'importmap.json': '{"imports":{}}',
      'theme/tokens.json': 'theme v1',
    });
    let [mina, kim] = await Promise.all([workspace(realm), workspace(realm)]);
    await writeFile(join(mina, 'theme/tokens.json'), 'mina theme');
    await writeFile(join(kim, 'theme/tokens.json'), 'kim theme');
    await pushDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      localDir: mina,
      authenticator: realm,
    });
    let postsAfterMina = realm.posts;

    let result = await syncDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir: kim,
      authenticator: realm,
      strategy: 'prefer-remote',
    });

    expect(result.error).toBeUndefined();
    expect(result.pulled).toEqual(['theme/tokens.json']);
    expect(realm.posts).toBe(postsAfterMina);
    expect(await readFile(join(kim, 'theme/tokens.json'), 'utf8')).toBe(
      'mina theme',
    );
  });

  it('reads again when the realm changes a pushed file between read and publish', async () => {
    let realm = new TeamRealm({
      'importmap.json': '{"imports":{}}',
      'theme/tokens.json': 'theme v1',
    });
    let kim = await workspace(realm);
    await writeFile(join(kim, 'theme/tokens.json'), 'kim theme');
    // A host save lands after kim's read but before kim's publish.
    realm.beforeNextPost = () => {
      realm.content['theme/tokens.json'] = 'host theme';
      realm.branch = snapshot(realm.content, realm.branch.refGeneration + 1);
    };

    let result = await syncDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir: kim,
      authenticator: realm,
      strategy: 'prefer-local',
    });

    expect(result.error).toBeUndefined();
    expect(result.pushed).toEqual(['theme/tokens.json']);
    expect(realm.content['theme/tokens.json']).toBe('kim theme');
  });
});
