import {
  checkpoint,
  readBranchHead,
  storeCheckpoint,
  updateBranchHead,
  type Actor,
  type BranchHead,
} from '@cardstack/deck/node';
import type { HistoryBackend } from '@cardstack/deck-history/backend';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { buildDeckBranchIndex } from './deck-branch-index.ts';
import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import {
  openDeckRepositoryProtocol,
  type CanonicalBranchSnapshot,
} from './deck-repository-protocol.ts';
import {
  deckBranchWorkspaceDir,
  deckBranchWorkspaceName,
  withDeckBranchWriter,
} from './deck-branch-workspace.ts';

export const DECK_BRANCH_CREATE_SPEC = 'boxel-deck-branch-create-v1';

export interface DeckBranchCreateRequest {
  schema: typeof DECK_BRANCH_CREATE_SPEC;
  branchName: string;
  fromBranch?: string;
}

export interface DeckBranchSummary {
  branchName: string;
  repositoryHash: string;
  historyHead: string;
  indexGenerationHash: string;
  refGeneration: number;
}

function summary(branchName: string, head: BranchHead): DeckBranchSummary {
  return {
    branchName,
    repositoryHash: head.repositoryHash,
    historyHead: head.historyHead,
    indexGenerationHash: head.indexGenerationHash,
    refGeneration: head.generation,
  };
}

export async function listDeckBranches(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
}): Promise<DeckBranchSummary[]> {
  // Opening the protocol enforces the feature flag and canonical Realm RRI.
  let protocol = openDeckRepositoryProtocol(options);
  let names: string[];
  try {
    names = (
      await readdir(join(options.realmDir, '.deck', 'refs', 'heads'), {
        recursive: true,
      })
    )
      .filter((path) => path.endsWith('.json'))
      .map((path) => path.slice(0, -'.json'.length));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  names.sort((a, b) => a.localeCompare(b));
  let branches = await Promise.all(
    names.map(async (branchName) => {
      let branch = await protocol.readBranch(branchName);
      return branch ? summary(branchName, branch.head) : undefined;
    }),
  );
  return branches.filter((branch) => branch !== undefined);
}

export async function createDeckBranch(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  actor: Actor;
  createdAt?: string;
  request: DeckBranchCreateRequest;
  prepareView?: (view: {
    indexGenerationHash: string;
    repositoryHash: string;
    treeHash: string;
    historyHead: string;
  }) => Promise<void>;
}): Promise<{
  branch: CanonicalBranchSnapshot;
  source: CanonicalBranchSnapshot;
}> {
  if (options.request.schema !== DECK_BRANCH_CREATE_SPEC) {
    throw new Error('unsupported Deck branch creation schema');
  }
  let branchName = options.request.branchName;
  let fromBranch = options.request.fromBranch ?? 'main';
  if (branchName === 'main') {
    throw new Error('main already exists');
  }

  return withDeckBranchWriter(options.realmDir, branchName, async () => {
    // These reads also validate both names through Deck's canonical ref path.
    if (await readBranchHead(options.realmDir, branchName)) {
      throw new Error(`branch already exists: ${branchName}`);
    }
    let protocol = openDeckRepositoryProtocol(options);
    let source = await protocol.readBranch(fromBranch);
    if (!source) throw new Error(`source branch not found: ${fromBranch}`);

    let sourceWorkspace = deckBranchWorkspaceDir(options.realmDir, fromBranch);
    let targetWorkspace = deckBranchWorkspaceDir(options.realmDir, branchName);
    let workspacePrepared = false;
    try {
      await options.history.fork(
        sourceWorkspace,
        targetWorkspace,
        source.head.historyHead,
        deckBranchWorkspaceName(branchName),
      );
      workspacePrepared = true;

      // Branch identity is part of RealmViewContext, so the source's card
      // inventory can be reused but its immutable generation hash cannot.
      let preparedBranch: CanonicalBranchSnapshot = {
        ...source,
        branch: branchName,
      };
      let treeHash = source.repository.members[source.realmRRI];
      let index = await buildDeckBranchIndex({
        realmDir: options.realmDir,
        branch: preparedBranch,
        historyHead: source.head.historyHead,
        repositoryHash: source.head.repositoryHash,
        treeHash,
        lockHash: source.repository.lockHash,
      });
      await options.prepareView?.({
        indexGenerationHash: index.indexGenerationHash,
        repositoryHash: source.head.repositoryHash,
        treeHash,
        historyHead: source.head.historyHead,
      });

      let branchCheckpoint = checkpoint({
        repositoryHash: source.head.repositoryHash,
        parents: source.head.latestCheckpointHash
          ? [source.head.latestCheckpointHash]
          : [],
        historyHead: source.head.historyHead,
        indexGenerationHash: index.indexGenerationHash,
        author: options.actor,
        message: `Branch ${branchName} from ${fromBranch}`,
        createdAt: options.createdAt ?? new Date().toISOString(),
      });
      let branchCheckpointHash = await storeCheckpoint(
        options.realmDir,
        branchCheckpoint,
      );

      let head = await updateBranchHead({
        realmDir: options.realmDir,
        branch: branchName,
        expectedGeneration: null,
        next: {
          repositoryHash: source.head.repositoryHash,
          historyHead: source.head.historyHead,
          indexGenerationHash: index.indexGenerationHash,
          // The branch gets a distinct index generation, so it also needs a
          // distinct Checkpoint. Its parent preserves the exact fork base.
          latestCheckpointHash: branchCheckpointHash,
        },
      });
      let branch: CanonicalBranchSnapshot = {
        realmRRI: source.realmRRI,
        branch: branchName,
        head,
        repository: source.repository,
        lock: source.lock,
      };
      return { branch, source };
    } catch (error) {
      if (workspacePrepared) {
        await options.history.discard(targetWorkspace).catch(() => undefined);
      }
      throw error;
    }
  });
}
