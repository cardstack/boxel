import {
  createBranchReview,
  mergeReview,
  readCheckpoint,
  readTreeFromDir,
  writeTreeToDir,
  type Actor,
} from '@cardstack/deck/node';
import { readObject, readTree } from '@cardstack/deck/object-store';
import type {
  HistoryActor,
  HistoryBackend,
} from '@cardstack/deck-history/backend';
import { join } from 'node:path';

import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import {
  openDeckRepositoryProtocol,
  type CanonicalReview,
  type CanonicalReviewSnapshot,
} from './deck-repository-protocol.ts';
import {
  deckBranchWorkspaceDir,
  withDeckBranchWriter,
} from './deck-branch-workspace.ts';
import { buildDeckBranchIndex } from './deck-branch-index.ts';

export const DECK_REVIEW_OPEN_SPEC = 'boxel-deck-review-open-v1';
export const DECK_REVIEW_MERGE_SPEC = 'boxel-deck-review-merge-v1';

export interface DeckReviewOpenRequest {
  schema: typeof DECK_REVIEW_OPEN_SPEC;
  sourceBranch: string;
  targetBranch: string;
  expected: {
    sourceCheckpointHash: string;
    targetCheckpointHash: string;
  };
  title: string;
  body?: string;
}

export interface DeckReviewMergeRequest {
  schema: typeof DECK_REVIEW_MERGE_SPEC;
  expected: {
    reviewGeneration: number;
    targetCheckpointHash: string;
  };
  message?: string;
}

export class DeckReviewConflictError extends Error {}

function snapshotDocument(snapshot: CanonicalReviewSnapshot) {
  let realmRRI = snapshot.ref.repository;
  return {
    branch: snapshot.ref.branch,
    checkpointHash: snapshot.ref.checkpointHash,
    repositoryHash: snapshot.checkpoint.repositoryHash,
    treeHash: snapshot.repository.members[realmRRI],
    lockHash: snapshot.repository.lockHash,
    historyHead: snapshot.checkpoint.historyHead,
    indexGenerationHash: snapshot.checkpoint.indexGenerationHash,
  };
}

export function deckReviewDocument(value: CanonicalReview) {
  return {
    schema: 'boxel-deck-review-v1' as const,
    number: value.stored.ref.number,
    state: value.stored.ref.state,
    generation: value.stored.ref.generation,
    title: value.stored.review.title,
    body: value.stored.review.body,
    author: value.stored.review.author,
    createdAt: value.stored.review.createdAt,
    base: snapshotDocument(value.base),
    target: snapshotDocument(value.target),
    source: snapshotDocument(value.source),
    events: value.stored.events,
  };
}

export async function listDeckReviews(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
}) {
  let values = await openDeckRepositoryProtocol(options).listReviews();
  return values.map(deckReviewDocument);
}

export async function readDeckReview(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
  number: number;
}) {
  let value = await openDeckRepositoryProtocol(options).readReview(
    options.number,
  );
  return value ? deckReviewDocument(value) : undefined;
}

export async function openDeckReview(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
  actor: Actor;
  request: DeckReviewOpenRequest;
  createdAt?: string;
}) {
  if (options.request.schema !== DECK_REVIEW_OPEN_SPEC) {
    throw new Error('unsupported Deck Review creation schema');
  }
  let { sourceBranch, targetBranch, expected } = options.request;
  if (sourceBranch === targetBranch) {
    throw new Error('Review source and target branches must differ');
  }
  if (!options.request.title.trim()) {
    throw new Error('Review title must not be empty');
  }

  let [first, second] = [sourceBranch, targetBranch].sort((a, b) =>
    a.localeCompare(b),
  );
  return withDeckBranchWriter(options.realmDir, first, () =>
    withDeckBranchWriter(options.realmDir, second, async () => {
      let protocol = openDeckRepositoryProtocol(options);
      let [source, target] = await Promise.all([
        protocol.readBranch(sourceBranch),
        protocol.readBranch(targetBranch),
      ]);
      if (!source) throw new Error(`branch not found: ${sourceBranch}`);
      if (!target) throw new Error(`branch not found: ${targetBranch}`);
      if (
        source.head.latestCheckpointHash !== expected.sourceCheckpointHash ||
        target.head.latestCheckpointHash !== expected.targetCheckpointHash
      ) {
        throw new DeckReviewConflictError(
          'a Review branch moved after its Checkpoint was observed',
        );
      }
      let created = await createBranchReview({
        realmDir: options.realmDir,
        repository: options.realmRRI,
        sourceBranch,
        targetBranch,
        title: options.request.title.trim(),
        body: options.request.body,
        author: options.actor,
        createdAt: options.createdAt ?? new Date().toISOString(),
      });
      let canonical = await protocol.readReview(created.ref.number);
      if (!canonical) throw new Error('created Review disappeared');
      return deckReviewDocument(canonical);
    }),
  );
}

async function repositoryMemberFiles(
  realmDir: string,
  treeHash: string,
): Promise<Map<string, Buffer>> {
  let storeDir = join(realmDir, '.deck', 'store');
  let tree = await readTree(storeDir, treeHash);
  if (!tree) throw new Error(`missing merged tree ${treeHash}`);
  let files = new Map<string, Buffer>();
  for (let entry of tree.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes) throw new Error(`missing merged object ${entry.sha256}`);
    files.set(entry.path, bytes);
  }
  return files;
}

export async function mergeDeckReview(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  historyActor?: HistoryActor;
  actor: Actor;
  number: number;
  request: DeckReviewMergeRequest;
  createdAt?: string;
  prepareView?: (view: { indexGenerationHash: string }) => Promise<void>;
}) {
  if (options.request.schema !== DECK_REVIEW_MERGE_SPEC) {
    throw new Error('unsupported Deck Review merge schema');
  }
  let protocol = openDeckRepositoryProtocol(options);
  let observed = await protocol.readReview(options.number);
  if (!observed) throw new Error(`Review #${options.number} not found`);
  if (observed.stored.ref.state !== 'open') {
    throw new Error(
      `Review #${options.number} is ${observed.stored.ref.state}`,
    );
  }
  if (
    observed.stored.ref.generation !== options.request.expected.reviewGeneration
  ) {
    throw new DeckReviewConflictError(
      `Review #${options.number} changed after it was observed`,
    );
  }

  let targetBranch = observed.stored.review.target.branch;
  return withDeckBranchWriter(options.realmDir, targetBranch, async () => {
    let currentReview = await protocol.readReview(options.number);
    let target = await protocol.readBranch(targetBranch);
    if (!currentReview || !target?.checkpoint) {
      throw new DeckReviewConflictError(
        'Review target no longer has an exact Checkpoint',
      );
    }
    if (
      currentReview.stored.ref.generation !==
        options.request.expected.reviewGeneration ||
      target.head.latestCheckpointHash !==
        options.request.expected.targetCheckpointHash
    ) {
      throw new DeckReviewConflictError(
        'Review or target branch moved after it was observed',
      );
    }

    let preview = await protocol.previewReview(options.number);
    if (preview.state === 'conflicted') return preview;
    if (preview.repositoryHash === target.head.repositoryHash) {
      throw new Error(`Review #${options.number} has no changes to merge`);
    }
    let sourceCheckpoint = await readCheckpoint(
      options.realmDir,
      preview.sourceCheckpointHash,
    );
    if (!sourceCheckpoint)
      throw new Error('Review source Checkpoint is missing');
    let treeHash = preview.repository.members[protocol.realmRRI];
    let files = await repositoryMemberFiles(options.realmDir, treeHash);
    let workspaceDir = deckBranchWorkspaceDir(options.realmDir, targetBranch);
    let priorLive = await readTreeFromDir(workspaceDir);
    let liveChanged = false;
    let historyHead: string | undefined;
    try {
      let materialized = await writeTreeToDir(workspaceDir, files);
      liveChanged =
        materialized.written.length > 0 || materialized.deleted.length > 0;
      let message =
        options.request.message?.trim() ||
        `Merge Review #${options.number}: ${currentReview.stored.review.title}`;
      historyHead = await options.history.merge(
        workspaceDir,
        target.checkpoint.historyHead,
        sourceCheckpoint.historyHead,
        message,
        options.historyActor,
      );
      let index = await buildDeckBranchIndex({
        realmDir: options.realmDir,
        branch: target,
        historyHead,
        repositoryHash: preview.repositoryHash,
        treeHash,
        lockHash: preview.repository.lockHash,
      });
      if (liveChanged) {
        await writeTreeToDir(workspaceDir, priorLive);
        liveChanged = false;
      }
      await options.prepareView?.({
        indexGenerationHash: index.indexGenerationHash,
      });
      let accepted = await writeTreeToDir(workspaceDir, files);
      liveChanged = accepted.written.length > 0 || accepted.deleted.length > 0;
      let merged = await mergeReview({
        realmDir: options.realmDir,
        number: options.number,
        historyHead,
        indexGenerationHash: index.indexGenerationHash,
        actor: options.actor,
        message,
        createdAt: options.createdAt ?? new Date().toISOString(),
      });
      if (
        merged.state !== 'ready' ||
        merged.repositoryHash !== preview.repositoryHash
      ) {
        throw new DeckReviewConflictError(
          'Review merge changed while it was being prepared',
        );
      }
      let review = await protocol.readReview(options.number);
      if (!review) throw new Error('merged Review disappeared');
      let mergedTarget = await protocol.readBranch(targetBranch);
      if (!mergedTarget) throw new Error('merged Review target disappeared');
      return {
        state: 'ready' as const,
        review: deckReviewDocument(review),
        mergeCheckpointHash: merged.mergeCheckpointHash,
        repositoryHash: merged.repositoryHash,
        treeHash,
        historyHead,
        indexGenerationHash: index.indexGenerationHash,
        targetBranch,
        previousIndexGenerationHash: target.head.indexGenerationHash,
        refGeneration: mergedTarget.head.generation,
      };
    } catch (error) {
      let head = await protocol.readBranch(targetBranch).catch(() => undefined);
      let landed =
        historyHead !== undefined &&
        head?.head.repositoryHash === preview.repositoryHash &&
        head.head.historyHead === historyHead;
      if (liveChanged && !landed) {
        await writeTreeToDir(workspaceDir, priorLive);
      }
      throw error;
    }
  });
}
