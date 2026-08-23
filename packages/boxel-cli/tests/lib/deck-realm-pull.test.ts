import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pullDeckBranch } from '../../src/lib/deck-realm-pull.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

function remote(snapshot: DeckBranchSnapshot, content: Record<string, string>) {
  return {
    async authedRealmFetch(input: string | URL | Request) {
      let url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname.endsWith('/.deck/branch')) {
        return new Response(JSON.stringify(snapshot));
      }
      if (url.pathname.endsWith('/.deck/tree-file')) {
        let path = url.searchParams.get('path')!;
        let bytes = content[path];
        return bytes === undefined
          ? new Response('not found', { status: 404 })
          : new Response(bytes);
      }
      return new Response('not found', { status: 404 });
    },
  } satisfies RealmAuthenticator;
}

function snapshot(
  content: Record<string, string>,
  generation = 1,
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
    checkpointHash: hashWorkspaceBytes(`checkpoint:${generation}`),
    files,
  };
}

describe('pulling an exact Deck branch', () => {
  it('materializes immutable tree bytes and records their exact branch base', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-pull-'));
    let content = {
      'controls/known-date.gts': 'export const version = 1;\n',
      'theme/tokens.json': '{"accent":"violet"}\n',
    };
    let branch = snapshot(content);

    let result = await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: remote(branch, content),
    });

    expect(result).toEqual({
      files: ['controls/known-date.gts', 'theme/tokens.json'],
      deleted: [],
      conflicts: [],
    });
    expect(
      await readFile(join(localDir, 'controls/known-date.gts'), 'utf8'),
    ).toBe(content['controls/known-date.gts']);
    expect(await loadDeckWorkspaceState(localDir)).toMatchObject({
      branchName: 'main',
      baseRepositoryHash: branch.repositoryHash,
      baseTreeHash: branch.treeHash,
      observedRefGeneration: 1,
    });
  });

  it('pulls a disjoint remote edit without overwriting local work', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-reconcile-'));
    let v1 = {
      'controls/known-date.gts': 'known date v1',
      'theme/tokens.json': 'theme v1',
    };
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: remote(snapshot(v1), v1),
    });
    await writeFile(
      join(localDir, 'controls/known-date.gts'),
      'mina local known date v2',
    );
    let v2 = { ...v1, 'theme/tokens.json': 'kim remote theme v2' };

    let result = await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: remote(snapshot(v2, 2), v2),
    });

    expect(result.files).toEqual(['theme/tokens.json']);
    expect(
      await readFile(join(localDir, 'controls/known-date.gts'), 'utf8'),
    ).toBe('mina local known date v2');
    expect(await readFile(join(localDir, 'theme/tokens.json'), 'utf8')).toBe(
      'kim remote theme v2',
    );
  });

  it('writes nothing when the same bytes diverged on both sides', async () => {
    let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-conflict-'));
    let v1 = { 'theme/tokens.json': 'theme v1' };
    await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: remote(snapshot(v1), v1),
    });
    await writeFile(join(localDir, 'theme/tokens.json'), 'mina local theme');
    let remoteV2 = { 'theme/tokens.json': 'kim remote theme' };

    let result = await pullDeckBranch({
      realmURL: 'https://realm.example/pretui/',
      branchName: 'main',
      localDir,
      authenticator: remote(snapshot(remoteV2, 2), remoteV2),
    });

    expect(result.conflicts).toEqual(['theme/tokens.json']);
    expect(result.error).toMatch(/local files were not changed/);
    expect(await readFile(join(localDir, 'theme/tokens.json'), 'utf8')).toBe(
      'mina local theme',
    );
    expect(
      (await loadDeckWorkspaceState(localDir))?.observedRefGeneration,
    ).toBe(1);
  });
});
