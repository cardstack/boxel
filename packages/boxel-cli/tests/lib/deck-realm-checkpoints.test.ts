import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDeckWorkspaceCheckpoint } from '../../src/lib/deck-realm-checkpoints.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';
import {
  DECK_BRANCH_OBSERVATION_SPEC,
  hashWorkspaceBytes,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  saveDeckWorkspaceState,
  workspaceStateFromBranch,
  type DeckBranchSnapshot,
} from '../../src/lib/deck-workspace-state.ts';

async function workspace() {
  let localDir = await mkdtemp(join(tmpdir(), 'boxel-deck-checkpoint-'));
  let content = 'export const focus = true;\n';
  await writeFile(join(localDir, 'focus-ring.gts'), content);
  let files = { 'focus-ring.gts': hashWorkspaceBytes(content) };
  let snapshot: DeckBranchSnapshot = {
    schema: DECK_BRANCH_OBSERVATION_SPEC,
    realmRRI: '@cardstack/pretui/',
    branchId: '@cardstack/pretui/:mina/focus-ring',
    branchName: 'mina/focus-ring',
    repositoryHash: hashWorkspaceBytes('repository'),
    treeHash: inventoryTreeHash(files),
    lockHash: hashWorkspaceBytes('lock'),
    historyHead: 'jj-step-2',
    indexGenerationHash: hashWorkspaceBytes('index'),
    refGeneration: 2,
    checkpointHash: null,
    files,
  };
  await saveDeckWorkspaceState(
    localDir,
    workspaceStateFromBranch('https://realm.example/pretui/', snapshot),
  );
  return { localDir, snapshot };
}

describe('Deck Realm Checkpoints', () => {
  it('freezes the clean workspace base and advances its observed ref', async () => {
    let { localDir, snapshot } = await workspace();
    let request: Request | undefined;
    let checkpointHash = hashWorkspaceBytes('checkpoint');
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch(input, init) {
        request = new Request(input, init);
        return Response.json(
          {
            schema: 'boxel-deck-checkpoint-create-result-v1',
            realmRRI: snapshot.realmRRI,
            branchName: snapshot.branchName,
            checkpointHash,
            parentCheckpointHash: null,
            repositoryHash: snapshot.repositoryHash,
            treeHash: snapshot.treeHash,
            lockHash: snapshot.lockHash,
            historyHead: snapshot.historyHead,
            indexGenerationHash: snapshot.indexGenerationHash,
            refGeneration: 3,
          },
          { status: 201 },
        );
      },
    };

    await expect(
      createDeckWorkspaceCheckpoint({
        localDir,
        message: 'Focus ring candidate',
        authenticator,
      }),
    ).resolves.toMatchObject({ checkpointHash, refGeneration: 3 });
    expect(new URL(request!.url).searchParams.get('branch')).toBe(
      'mina/focus-ring',
    );
    expect(await request!.json()).toEqual({
      schema: 'boxel-deck-checkpoint-create-v1',
      message: 'Focus ring candidate',
      expected: {
        repositoryHash: snapshot.repositoryHash,
        treeHash: snapshot.treeHash,
        lockHash: snapshot.lockHash,
        refGeneration: 2,
      },
    });
    expect(await loadDeckWorkspaceState(localDir)).toMatchObject({
      observedRefGeneration: 3,
      baseTreeHash: snapshot.treeHash,
    });
  });

  it('does not call the Realm for unpushed local work', async () => {
    let { localDir } = await workspace();
    await writeFile(join(localDir, 'focus-ring.gts'), 'unfinished\n');
    let called = false;
    let authenticator: RealmAuthenticator = {
      async authedRealmFetch() {
        called = true;
        return new Response();
      },
    };

    await expect(
      createDeckWorkspaceCheckpoint({
        localDir,
        message: 'Too early',
        authenticator,
      }),
    ).rejects.toThrow(/unpushed changes/);
    expect(called).toBe(false);
    expect(
      JSON.parse(await readFile(join(localDir, '.boxel-sync.json'), 'utf8')),
    ).toMatchObject({ observedRefGeneration: 2 });
  });
});
