import { createBranchReview, type Actor } from '@cardstack/deck/node';

import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import {
  openDeckRepositoryProtocol,
  type CanonicalReview,
  type CanonicalReviewSnapshot,
} from './deck-repository-protocol.ts';
import { withDeckBranchWriter } from './deck-branch-workspace.ts';

export const DECK_REVIEW_OPEN_SPEC = 'boxel-deck-review-open-v1';

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
