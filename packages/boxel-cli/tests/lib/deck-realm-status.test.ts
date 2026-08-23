import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { status } from '../../src/commands/realm/status.ts';
import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
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
    checkpointHash: hashWorkspaceBytes(`checkpoint:${generation}`),
    files,
  };
}

function realm(
  branch: DeckBranchSnapshot,
  content: Record<string, string>,
): RealmAuthenticator {
  return {
    async authedRealmFetch(input) {
      let url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname.endsWith('/.deck/capabilities')) {
        return new Response(
          JSON.stringify({
            deckCollaboration: true,
            realmRRI: '@cardstack/pretui/',
            protocol: 'deck-r0',
            sync: 'content-addressed',
            history: 'jj',
          }),
        );
      }
      if (url.pathname.endsWith('/.deck/branch')) {
        return new Response(JSON.stringify(branch));
      }
      if (url.pathname.endsWith('/.deck/tree-file')) {
        let value = content[url.searchParams.get('path')!];
        return value === undefined
          ? new Response('not found', { status: 404 })
          : new Response(value);
      }
      return new Response('not found', { status: 404 });
    },
  };
}

describe('Deck realm status', () => {
  it('reports local and remote changes against an exact branch base', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-status-'));
    let v1 = {
      'controls/known-date.gts': 'known date v1',
      'theme/tokens.json': 'theme v1',
    };
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: realm(snapshot(v1, 1), v1),
    });
    await writeFile(
      join(localDir, 'controls/known-date.gts'),
      'mina local known date v2',
    );
    let v2 = { ...v1, 'theme/tokens.json': 'kim remote theme v2' };

    let result = await status(localDir, {
      authenticator: realm(snapshot(v2, 2), v2),
    });

    expect(result.hasError).toBe(false);
    expect(result.inSync).toBe(false);
    expect(result.branch).toEqual({
      name: 'main',
      baseGeneration: 1,
      remoteGeneration: 2,
    });
    expect(result.changes).toEqual([
      { file: 'controls/known-date.gts', status: 'modified-local' },
      { file: 'theme/tokens.json', status: 'modified-remote' },
    ]);
  });
});
