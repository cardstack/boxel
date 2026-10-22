import {
  canonicalInstant,
  hashProtocolObject,
  isHash,
  type Actor,
  type JsonValue,
} from './repository.ts';
import { realmRRI } from './rri.ts';

export const REVIEW_SPEC = 'deck-review-v2';
export const REVIEW_EVENT_SPEC = 'deck-review-event-v2';

export interface ReviewSnapshot {
  repository: string;
  branch: string;
  checkpointHash: string;
}

export interface Review {
  schema: typeof REVIEW_SPEC;
  base: ReviewSnapshot;
  target: ReviewSnapshot;
  source: ReviewSnapshot;
  title: string;
  body: string;
  author: Actor;
  createdAt: string;
}

export type ReviewEventType =
  | 'source-updated'
  | 'reviewed'
  | 'merge-started'
  | 'merged'
  | 'closed';

export interface ReviewEvent {
  schema: typeof REVIEW_EVENT_SPEC;
  reviewHash: string;
  previousEventHash?: string;
  type: ReviewEventType;
  actor: Actor;
  createdAt: string;
  checkpointHash?: string;
  verdict?: 'approved' | 'changes-requested';
}

const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,127}$/;

function snapshot(value: ReviewSnapshot): ReviewSnapshot {
  let repository = realmRRI(value.repository);
  if (!BRANCH.test(value.branch) || value.branch.includes('..') || value.branch.endsWith('/')) {
    throw new Error('Review snapshot requires a valid branch');
  }
  if (!isHash(value.checkpointHash)) {
    throw new Error('Review snapshot requires a Checkpoint hash');
  }
  return { repository, branch: value.branch, checkpointHash: value.checkpointHash };
}

function actor(value: Actor): Actor {
  if (value.id.trim() === '') throw new Error('Review actor must not be empty');
  return { id: value.id, ...(value.name ? { name: value.name } : {}) };
}

export function review(options: Omit<Review, 'schema'>): Review {
  if (options.title.trim() === '') throw new Error('Review title must not be empty');
  return {
    schema: REVIEW_SPEC,
    base: snapshot(options.base),
    target: snapshot(options.target),
    source: snapshot(options.source),
    title: options.title,
    body: options.body,
    author: actor(options.author),
    createdAt: canonicalInstant(options.createdAt),
  };
}

export function reviewHash(value: Review): string {
  return hashProtocolObject(value as unknown as JsonValue);
}

export function reviewEvent(options: Omit<ReviewEvent, 'schema'>): ReviewEvent {
  if (!isHash(options.reviewHash)) throw new Error('invalid Review hash');
  if (options.previousEventHash && !isHash(options.previousEventHash)) {
    throw new Error('invalid previous Review event hash');
  }
  let checkpointRequired = ['source-updated', 'reviewed', 'merge-started', 'merged'].includes(
    options.type,
  );
  if (checkpointRequired && !options.checkpointHash) {
    throw new Error(`${options.type} requires a Checkpoint hash`);
  }
  if (options.checkpointHash && !isHash(options.checkpointHash)) {
    throw new Error('invalid event Checkpoint hash');
  }
  if (options.type === 'reviewed' && !options.verdict) {
    throw new Error('reviewed requires a verdict');
  }
  if (options.type !== 'reviewed' && options.verdict) {
    throw new Error('only reviewed events may carry a verdict');
  }
  return {
    schema: REVIEW_EVENT_SPEC,
    reviewHash: options.reviewHash,
    ...(options.previousEventHash ? { previousEventHash: options.previousEventHash } : {}),
    type: options.type,
    actor: actor(options.actor),
    createdAt: canonicalInstant(options.createdAt),
    ...(options.checkpointHash ? { checkpointHash: options.checkpointHash } : {}),
    ...(options.verdict ? { verdict: options.verdict } : {}),
  };
}

export function reviewEventHash(value: ReviewEvent): string {
  return hashProtocolObject(value as unknown as JsonValue);
}
