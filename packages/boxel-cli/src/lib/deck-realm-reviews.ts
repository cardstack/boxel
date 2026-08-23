import type { RealmAuthenticator } from './realm-authenticator.ts';
import { readDeckBranchSnapshot } from './realm-sync-mode.ts';
import {
  hashDeckWorkspaceDirectory,
  inventoryTreeHash,
  loadDeckWorkspaceState,
} from './deck-workspace-state.ts';

const HASH = /^[0-9a-f]{64}$/;

export interface DeckReviewSnapshot {
  branch: string;
  checkpointHash: string;
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
  historyHead: string;
  indexGenerationHash: string;
}

export interface DeckReviewDocument {
  schema: 'boxel-deck-review-v1';
  number: number;
  state: 'open' | 'merged' | 'closed';
  generation: number;
  title: string;
  body: string;
  author: { id: string; name?: string };
  createdAt: string;
  base: DeckReviewSnapshot;
  target: DeckReviewSnapshot;
  source: DeckReviewSnapshot;
  events: unknown[];
}

export interface DeckReviewList {
  schema: 'boxel-deck-review-list-v1';
  realmRRI: string;
  reviews: DeckReviewDocument[];
}

function reviewsURL(realmURL: string): URL {
  let url = new URL(realmURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/.deck/reviews`;
  url.search = '';
  url.hash = '';
  return url;
}

function reviewURL(realmURL: string, number: number): URL {
  let url = reviewsURL(realmURL);
  url.pathname = url.pathname.replace(/reviews$/, 'review');
  url.searchParams.set('number', String(number));
  return url;
}

function isSnapshot(value: unknown): value is DeckReviewSnapshot {
  let snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    typeof snapshot.branch === 'string' &&
    snapshot.branch !== '' &&
    typeof snapshot.checkpointHash === 'string' &&
    HASH.test(snapshot.checkpointHash) &&
    typeof snapshot.repositoryHash === 'string' &&
    HASH.test(snapshot.repositoryHash) &&
    typeof snapshot.treeHash === 'string' &&
    HASH.test(snapshot.treeHash) &&
    typeof snapshot.lockHash === 'string' &&
    HASH.test(snapshot.lockHash) &&
    typeof snapshot.historyHead === 'string' &&
    snapshot.historyHead !== '' &&
    typeof snapshot.indexGenerationHash === 'string' &&
    HASH.test(snapshot.indexGenerationHash)
  );
}

function isReview(value: unknown): value is DeckReviewDocument {
  let review = value as Record<string, unknown>;
  return (
    typeof review === 'object' &&
    review !== null &&
    review.schema === 'boxel-deck-review-v1' &&
    Number.isSafeInteger(review.number) &&
    (review.number as number) >= 1 &&
    ['open', 'merged', 'closed'].includes(review.state as string) &&
    Number.isSafeInteger(review.generation) &&
    typeof review.title === 'string' &&
    typeof review.body === 'string' &&
    typeof review.createdAt === 'string' &&
    isSnapshot(review.base) &&
    isSnapshot(review.target) &&
    isSnapshot(review.source) &&
    Array.isArray(review.events)
  );
}

async function responseError(response: Response, operation: string) {
  let detail = (await response.text()).trim().slice(0, 300);
  return new Error(
    `${operation}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
  );
}

export async function listDeckRealmReviews(options: {
  realmURL: string;
  authenticator: RealmAuthenticator;
}): Promise<DeckReviewList> {
  let response = await options.authenticator.authedRealmFetch(
    reviewsURL(options.realmURL),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok)
    throw await responseError(response, 'Could not list Reviews');
  let value = (await response.json()) as DeckReviewList;
  if (
    value.schema !== 'boxel-deck-review-list-v1' ||
    typeof value.realmRRI !== 'string' ||
    !Array.isArray(value.reviews) ||
    !value.reviews.every(isReview)
  ) {
    throw new Error('Realm returned an invalid Review list');
  }
  return value;
}

export async function readDeckRealmReview(options: {
  realmURL: string;
  number: number;
  authenticator: RealmAuthenticator;
}): Promise<DeckReviewDocument> {
  let response = await options.authenticator.authedRealmFetch(
    reviewURL(options.realmURL, options.number),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok)
    throw await responseError(
      response,
      `Could not read Review #${options.number}`,
    );
  let value: unknown = await response.json();
  if (!isReview(value)) throw new Error('Realm returned an invalid Review');
  return value;
}

export async function openDeckWorkspaceReview(options: {
  localDir: string;
  targetBranch: string;
  title: string;
  body?: string;
  authenticator: RealmAuthenticator;
}): Promise<DeckReviewDocument> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  if (!workspace) {
    throw new Error(
      'Deck Review requires an existing .boxel-sync.json workspace',
    );
  }
  let localFiles = await hashDeckWorkspaceDirectory(options.localDir);
  if (inventoryTreeHash(localFiles) !== workspace.baseTreeHash) {
    throw new Error(
      `Workspace has unpushed changes on ${workspace.branchName}; push and Checkpoint them before opening a Review`,
    );
  }
  let [source, target] = await Promise.all([
    readDeckBranchSnapshot(
      workspace.realmURL,
      workspace.branchName,
      options.authenticator,
    ),
    readDeckBranchSnapshot(
      workspace.realmURL,
      options.targetBranch,
      options.authenticator,
    ),
  ]);
  if (
    source.refGeneration !== workspace.observedRefGeneration ||
    source.repositoryHash !== workspace.baseRepositoryHash ||
    source.treeHash !== workspace.baseTreeHash ||
    source.lockHash !== workspace.baseLockHash
  ) {
    throw new Error(
      `Deck branch ${workspace.branchName} moved; pull or sync before opening a Review`,
    );
  }
  if (!source.checkpointHash) {
    throw new Error(
      `Branch ${workspace.branchName} has no Checkpoint; run boxel realm checkpoint first`,
    );
  }
  if (!target.checkpointHash) {
    throw new Error(`Target branch ${options.targetBranch} has no Checkpoint`);
  }
  let response = await options.authenticator.authedRealmFetch(
    reviewsURL(workspace.realmURL),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema: 'boxel-deck-review-open-v1',
        sourceBranch: workspace.branchName,
        targetBranch: options.targetBranch,
        expected: {
          sourceCheckpointHash: source.checkpointHash,
          targetCheckpointHash: target.checkpointHash,
        },
        title: options.title,
        ...(options.body ? { body: options.body } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      response.status === 409
        ? 'A Review branch moved; pull or sync and try again'
        : 'Could not open Review',
    );
  }
  let value: unknown = await response.json();
  if (!isReview(value)) throw new Error('Realm returned an invalid Review');
  return value;
}
