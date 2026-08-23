import { mkdtemp, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DECK_WORKSPACE_STATE_SPEC,
  DeckBranchMovedError,
  assertObservedBranchHead,
  hashWorkspaceBytes,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  planContentAddressedSync,
  saveDeckWorkspaceState,
  type DeckWorkspaceState,
} from '../../src/lib/deck-workspace-state.ts';

const hash = (value: string) => hashWorkspaceBytes(value);

function state(files: Record<string, string>): DeckWorkspaceState {
  return {
    schema: DECK_WORKSPACE_STATE_SPEC,
    realmRRI: '@cardstack/pretui/',
    realmURL: 'https://realm.example/pretui/',
    branchId: 'pretui:main',
    branchName: 'main',
    baseRepositoryHash: hash('repository'),
    baseTreeHash: inventoryTreeHash(files),
    baseLockHash: hash('lock'),
    observedRefGeneration: 7,
    files,
  };
}

describe('Deck workspace state', () => {
  it('persists an exact branch base atomically and rejects legacy manifests', async () => {
    let dir = await mkdtemp(join(tmpdir(), 'boxel-deck-workspace-'));
    let base = state({
      'controls/known-date.gts': hash('known date v1'),
      'importmap.json': hash('{"imports":{}}'),
    });

    await saveDeckWorkspaceState(dir, base);

    expect(await loadDeckWorkspaceState(dir)).toEqual(base);
    expect(
      JSON.parse(await readFile(join(dir, '.boxel-sync.json'), 'utf8')),
    ).not.toHaveProperty('remoteMtimes');
  });

  it('classifies two PretUI workspaces by content when mtimes say the opposite', async () => {
    let dir = await mkdtemp(join(tmpdir(), 'boxel-deck-mtime-proof-'));
    let oldLookingLocal = join(dir, 'old-looking-local');
    let newLookingRemote = join(dir, 'new-looking-remote');
    await Promise.all([
      import('node:fs/promises').then(({ writeFile }) =>
        writeFile(oldLookingLocal, 'developer changes Known Date'),
      ),
      import('node:fs/promises').then(({ writeFile }) =>
        writeFile(newLookingRemote, 'released Known Date'),
      ),
    ]);
    await utimes(oldLookingLocal, new Date(1_000), new Date(1_000));
    await utimes(newLookingRemote, new Date(2_000), new Date(2_000));

    let baseHash = hash('released Known Date');
    let plan = planContentAddressedSync({
      base: { 'controls/known-date.gts': baseHash },
      local: {
        'controls/known-date.gts': hash(
          await readFile(oldLookingLocal, 'utf8'),
        ),
      },
      remote: {
        'controls/known-date.gts': hash(
          await readFile(newLookingRemote, 'utf8'),
        ),
      },
    });

    expect(plan.canPublish).toBe(true);
    expect(plan.entries).toMatchObject([
      {
        path: 'controls/known-date.gts',
        localStatus: 'changed',
        remoteStatus: 'unchanged',
        action: 'push',
      },
    ]);
  });

  it('refuses a stale publish before invoking its write batch', () => {
    let base = state({ 'controls/known-date.gts': hash('v1') });
    let writes = 0;
    let publish = () => {
      assertObservedBranchHead(base, {
        repositoryHash: hash('repository-v2'),
        treeHash: hash('tree-v2'),
        lockHash: hash('lock-v2'),
        refGeneration: 8,
      });
      writes++;
    };

    expect(publish).toThrow(DeckBranchMovedError);
    expect(writes).toBe(0);
  });

  it('marks independently edited bytes as a conflict', () => {
    let plan = planContentAddressedSync({
      base: { 'theme/tokens.json': hash('base') },
      local: { 'theme/tokens.json': hash('mina') },
      remote: { 'theme/tokens.json': hash('kim') },
    });

    expect(plan.canPublish).toBe(false);
    expect(plan.conflicts[0]).toMatchObject({
      path: 'theme/tokens.json',
      localStatus: 'changed',
      remoteStatus: 'changed',
      action: 'conflict',
    });
  });
});
