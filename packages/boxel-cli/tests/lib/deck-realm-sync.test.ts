import { mkdtemp, writeFile } from 'node:fs/promises';
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

  it('publishes nothing when both developers changed the same bytes', async () => {
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
    });

    expect(result.error).toMatch(/content conflict/);
    expect(result.conflicts).toEqual(['theme/tokens.json']);
    expect(realm.posts).toBe(postsAfterMina);
    expect(realm.content['theme/tokens.json']).toBe('mina theme');
  });
});
