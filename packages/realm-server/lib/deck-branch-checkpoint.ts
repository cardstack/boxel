import {
  checkpoint,
  storeCheckpoint,
  updateBranchHead,
  type Actor,
  type BranchHead,
} from '@cardstack/deck/node';

import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import { openDeckRepositoryProtocol } from './deck-repository-protocol.ts';
import { withDeckBranchWriter } from './deck-branch-workspace.ts';

export const DECK_CHECKPOINT_CREATE_SPEC = 'boxel-deck-checkpoint-create-v1';

export interface DeckCheckpointCreateRequest {
  schema: typeof DECK_CHECKPOINT_CREATE_SPEC;
  message: string;
  expected: {
    repositoryHash: string;
    treeHash: string;
    lockHash: string;
    refGeneration: number;
  };
}

export class DeckCheckpointConflictError extends Error {}

export async function createDeckBranchCheckpoint(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  actor: Actor;
  request: DeckCheckpointCreateRequest;
  createdAt?: string;
}): Promise<{
  head: BranchHead;
  checkpointHash: string;
  parentCheckpointHash: string | null;
  treeHash: string;
  lockHash: string;
}> {
  if (options.request.schema !== DECK_CHECKPOINT_CREATE_SPEC) {
    throw new Error('unsupported Deck Checkpoint creation schema');
  }
  let message = options.request.message.trim();
  if (!message) throw new Error('Checkpoint message must not be empty');

  return withDeckBranchWriter(options.realmDir, options.branch, async () => {
    let protocol = openDeckRepositoryProtocol(options);
    let current = await protocol.readBranch(options.branch);
    if (!current) throw new Error(`branch not found: ${options.branch}`);
    let treeHash = current.repository.members[protocol.realmRRI];
    let expected = options.request.expected;
    if (
      expected.refGeneration !== current.head.generation ||
      expected.repositoryHash !== current.head.repositoryHash ||
      expected.treeHash !== treeHash ||
      expected.lockHash !== current.repository.lockHash
    ) {
      throw new DeckCheckpointConflictError(
        `branch ${options.branch} moved since it was read`,
      );
    }

    let parentCheckpointHash = current.head.latestCheckpointHash;
    let value = checkpoint({
      repositoryHash: current.head.repositoryHash,
      parents: parentCheckpointHash ? [parentCheckpointHash] : [],
      historyHead: current.head.historyHead,
      indexGenerationHash: current.head.indexGenerationHash,
      author: options.actor,
      message,
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
    let checkpointHash = await storeCheckpoint(options.realmDir, value);
    let head = await updateBranchHead({
      realmDir: options.realmDir,
      branch: options.branch,
      expectedGeneration: current.head.generation,
      next: {
        repositoryHash: current.head.repositoryHash,
        historyHead: current.head.historyHead,
        indexGenerationHash: current.head.indexGenerationHash,
        latestCheckpointHash: checkpointHash,
      },
    });
    return {
      head,
      checkpointHash,
      parentCheckpointHash,
      treeHash,
      lockHash: current.repository.lockHash,
    };
  });
}
