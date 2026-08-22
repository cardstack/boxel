import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  canonicalJson,
  checkpoint,
  hashProtocolObject,
  isHash,
  type Actor,
  type JsonValue,
} from './repository.ts';
import { mergeRepositoryCheckpoints } from './repository-merge.ts';
import {
  ConditionalWriteConflictError,
  readBranchHead,
  readCheckpoint,
  readRepository,
  realmDeckPath,
  REVIEWS_DIR,
  storeCheckpoint,
  updateBranchHead,
  type ConditionalObjectStore,
} from './repository-store.ts';
import {
  review,
  reviewEvent,
  reviewEventHash,
  reviewHash,
  type Review,
  type ReviewEvent,
  type ReviewEventType,
  type ReviewSnapshot,
} from './review.ts';
import { realmRRI } from './rri.ts';

export const REVIEW_REF_SPEC = 'deck-review-ref-v2';
export const REVIEW_COUNTER_SPEC = 'deck-review-counter-v2';

interface ReviewCounter {
  schema: typeof REVIEW_COUNTER_SPEC;
  next: number;
}

export interface ReviewRef {
  schema: typeof REVIEW_REF_SPEC;
  number: number;
  reviewHash: string;
  eventHash?: string;
  generation: number;
  state: 'open' | 'merged' | 'closed';
}

export interface StoredReview {
  ref: ReviewRef;
  review: Review;
  events: ReviewEvent[];
}

function objectPath(realmDir: string, kind: 'objects' | 'events', hash: string): string {
  return realmDeckPath(realmDir, REVIEWS_DIR, kind, hash.slice(0, 2), `${hash}.json`);
}

export function reviewRefPath(realmDir: string, number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('invalid Review number');
  return realmDeckPath(realmDir, REVIEWS_DIR, 'numbers', `${number}.json`);
}

function counterPath(realmDir: string): string {
  return realmDeckPath(realmDir, REVIEWS_DIR, 'counter.json');
}

async function writeOnce(path: string, value: JsonValue): Promise<string> {
  let bytes = canonicalJson(value);
  let hash = hashProtocolObject(value);
  await mkdir(dirname(path), { recursive: true });
  try {
    let existing = await readFile(path);
    if (!existing.equals(bytes)) throw new Error(`content-address collision at ${path}`);
    return hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  return hash;
}

async function readHashed<T>(path: string, hash: string): Promise<T> {
  let parsed = JSON.parse(await readFile(path, 'utf8')) as JsonValue;
  if (hashProtocolObject(parsed) !== hash) {
    throw new Error(`protocol object does not match its hash: ${path}`);
  }
  return parsed as unknown as T;
}

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Review metadata is busy: ${path}`);
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

function parseReviewRef(bytes: Buffer): ReviewRef {
  let value = JSON.parse(bytes.toString('utf8')) as ReviewRef;
  if (
    value.schema !== REVIEW_REF_SPEC ||
    !Number.isSafeInteger(value.number) ||
    value.number < 1 ||
    !isHash(value.reviewHash) ||
    (value.eventHash !== undefined && !isHash(value.eventHash)) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !['open', 'merged', 'closed'].includes(value.state)
  ) {
    throw new Error('invalid Review ref');
  }
  return value;
}

function parseCounter(bytes: Buffer): ReviewCounter {
  let value = JSON.parse(bytes.toString('utf8')) as ReviewCounter;
  if (
    value.schema !== REVIEW_COUNTER_SPEC ||
    !Number.isSafeInteger(value.next) ||
    value.next < 1
  ) {
    throw new Error('invalid Review counter');
  }
  return value;
}

async function allocateLocalReviewNumber(realmDir: string): Promise<number> {
  let path = counterPath(realmDir);
  return withLock(`${path}.lock`, async () => {
    let current: ReviewCounter;
    try {
      current = parseCounter(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      current = { schema: REVIEW_COUNTER_SPEC, next: 1 };
    }
    await mkdir(dirname(path), { recursive: true });
    let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(
      tmp,
      canonicalJson({ ...current, next: current.next + 1 } as unknown as JsonValue),
    );
    await rename(tmp, path);
    return current.next;
  });
}

export async function createReview(options: {
  realmDir: string;
  base: ReviewSnapshot;
  target: ReviewSnapshot;
  source: ReviewSnapshot;
  title: string;
  body?: string;
  author: Actor;
  createdAt: string;
}): Promise<StoredReview> {
  let value = review({
    base: options.base,
    target: options.target,
    source: options.source,
    title: options.title,
    body: options.body ?? '',
    author: options.author,
    createdAt: options.createdAt,
  });
  let hash = reviewHash(value);
  await writeOnce(objectPath(options.realmDir, 'objects', hash), value as unknown as JsonValue);
  let number = await allocateLocalReviewNumber(options.realmDir);
  let ref: ReviewRef = {
    schema: REVIEW_REF_SPEC,
    number,
    reviewHash: hash,
    generation: 1,
    state: 'open',
  };
  let path = reviewRefPath(options.realmDir, number);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(ref as unknown as JsonValue), { flag: 'wx' });
  return { ref, review: value, events: [] };
}

export async function createBranchReview(options: {
  realmDir: string;
  repository: string;
  sourceBranch: string;
  targetBranch: string;
  baseCheckpointHash?: string;
  title: string;
  body?: string;
  author: Actor;
  createdAt: string;
}): Promise<StoredReview> {
  let [source, target] = await Promise.all([
    readBranchHead(options.realmDir, options.sourceBranch),
    readBranchHead(options.realmDir, options.targetBranch),
  ]);
  if (!source?.latestCheckpointHash) {
    throw new Error(`source branch ${options.sourceBranch} has no Checkpoint`);
  }
  if (!target?.latestCheckpointHash) {
    throw new Error(`target branch ${options.targetBranch} has no Checkpoint`);
  }
  let repository = realmRRI(options.repository);
  let baseCheckpointHash = options.baseCheckpointHash ?? target.latestCheckpointHash;
  return createReview({
    realmDir: options.realmDir,
    base: { repository, branch: options.targetBranch, checkpointHash: baseCheckpointHash },
    target: {
      repository,
      branch: options.targetBranch,
      checkpointHash: target.latestCheckpointHash,
    },
    source: {
      repository,
      branch: options.sourceBranch,
      checkpointHash: source.latestCheckpointHash,
    },
    title: options.title,
    body: options.body,
    author: options.author,
    createdAt: options.createdAt,
  });
}

export async function readReview(realmDir: string, number: number): Promise<StoredReview | undefined> {
  let ref: ReviewRef;
  try {
    ref = parseReviewRef(await readFile(reviewRefPath(realmDir, number)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let value = await readHashed<Review>(objectPath(realmDir, 'objects', ref.reviewHash), ref.reviewHash);
  let events: ReviewEvent[] = [];
  let eventHash = ref.eventHash;
  let seen = new Set<string>();
  while (eventHash) {
    if (seen.has(eventHash)) throw new Error('Review event cycle');
    seen.add(eventHash);
    let event = await readHashed<ReviewEvent>(objectPath(realmDir, 'events', eventHash), eventHash);
    if (event.reviewHash !== ref.reviewHash) throw new Error('Review event belongs to another Review');
    events.push(event);
    eventHash = event.previousEventHash;
  }
  events.reverse();
  return { ref, review: value, events };
}

export async function appendReviewEvent(options: {
  realmDir: string;
  number: number;
  type: ReviewEventType;
  actor: Actor;
  createdAt: string;
  checkpointHash?: string;
  verdict?: 'approved' | 'changes-requested';
}): Promise<StoredReview> {
  let path = reviewRefPath(options.realmDir, options.number);
  return withLock(`${path}.lock`, async () => {
    let current = await readReview(options.realmDir, options.number);
    if (!current) throw new Error(`no Review #${options.number}`);
    if (current.ref.state !== 'open') throw new Error(`Review #${options.number} is ${current.ref.state}`);
    let event = reviewEvent({
      reviewHash: current.ref.reviewHash,
      previousEventHash: current.ref.eventHash,
      type: options.type,
      actor: options.actor,
      createdAt: options.createdAt,
      checkpointHash: options.checkpointHash,
      verdict: options.verdict,
    });
    let eventHash = reviewEventHash(event);
    await writeOnce(objectPath(options.realmDir, 'events', eventHash), event as unknown as JsonValue);
    let ref: ReviewRef = {
      ...current.ref,
      eventHash,
      generation: current.ref.generation + 1,
      state: options.type === 'merged' ? 'merged' : options.type === 'closed' ? 'closed' : 'open',
    };
    let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, canonicalJson(ref as unknown as JsonValue));
    await rename(tmp, path);
    return { ref, review: current.review, events: [...current.events, event] };
  });
}

function effectiveSource(value: StoredReview): string {
  return (
    [...value.events].reverse().find((event) => event.type === 'source-updated')?.checkpointHash ??
    value.review.source.checkpointHash
  );
}

export async function previewReview(realmDir: string, number: number) {
  let value = await readReview(realmDir, number);
  if (!value) throw new Error(`no Review #${number}`);
  let target = await readBranchHead(realmDir, value.review.target.branch);
  if (!target?.latestCheckpointHash) throw new Error('Review target branch has no Checkpoint');
  return mergeRepositoryCheckpoints({
    realmDir,
    baseCheckpointHash: value.review.base.checkpointHash,
    targetCheckpointHash: target.latestCheckpointHash,
    sourceCheckpointHash: effectiveSource(value),
  });
}

export async function mergeReview(options: {
  realmDir: string;
  number: number;
  historyHead: string;
  indexGenerationHash: string;
  actor: Actor;
  message?: string;
  createdAt: string;
}) {
  let value = await readReview(options.realmDir, options.number);
  if (!value) throw new Error(`no Review #${options.number}`);
  if (value.ref.state !== 'open') throw new Error(`Review #${options.number} is ${value.ref.state}`);

  let pending = [...value.events].reverse().find((event) => event.type === 'merge-started');
  if (pending?.checkpointHash) {
    let prepared = await readCheckpoint(options.realmDir, pending.checkpointHash);
    if (!prepared || prepared.parents.length !== 2) {
      throw new Error('Review has an invalid pending merge Checkpoint');
    }
    let head = await readBranchHead(options.realmDir, value.review.target.branch);
    if (!head) throw new Error('Review target branch disappeared');
    if (head.latestCheckpointHash === prepared.parents[0]) {
      await updateBranchHead({
        realmDir: options.realmDir,
        branch: value.review.target.branch,
        expectedGeneration: head.generation,
        next: {
          repositoryHash: prepared.repositoryHash,
          historyHead: prepared.historyHead,
          indexGenerationHash: prepared.indexGenerationHash,
          latestCheckpointHash: pending.checkpointHash,
        },
      });
    } else if (head.latestCheckpointHash !== pending.checkpointHash) {
      throw new Error('target branch moved during a pending Review merge');
    }
    let repository = await readRepository(options.realmDir, prepared.repositoryHash);
    if (!repository) throw new Error('pending merge Repository is missing');
    await appendReviewEvent({
      realmDir: options.realmDir,
      number: options.number,
      type: 'merged',
      actor: options.actor,
      createdAt: options.createdAt,
      checkpointHash: pending.checkpointHash,
    });
    return {
      state: 'ready' as const,
      repository,
      repositoryHash: prepared.repositoryHash,
      changedMembers: [] as string[],
      mergeCheckpointHash: pending.checkpointHash,
      recovered: true,
    };
  }

  let target = await readBranchHead(options.realmDir, value.review.target.branch);
  if (!target?.latestCheckpointHash) throw new Error('Review target branch has no Checkpoint');
  let sourceCheckpointHash = effectiveSource(value);
  let result = await mergeRepositoryCheckpoints({
    realmDir: options.realmDir,
    baseCheckpointHash: value.review.base.checkpointHash,
    targetCheckpointHash: target.latestCheckpointHash,
    sourceCheckpointHash,
  });
  if (result.state === 'conflicted') return result;
  let prepared = checkpoint({
    repositoryHash: result.repositoryHash,
    parents: [target.latestCheckpointHash, sourceCheckpointHash],
    historyHead: options.historyHead,
    indexGenerationHash: options.indexGenerationHash,
    author: options.actor,
    message: options.message ?? `Merge Review #${options.number}: ${value.review.title}`,
    createdAt: options.createdAt,
  });
  let mergeCheckpointHash = await storeCheckpoint(options.realmDir, prepared);
  await appendReviewEvent({
    realmDir: options.realmDir,
    number: options.number,
    type: 'merge-started',
    actor: options.actor,
    createdAt: options.createdAt,
    checkpointHash: mergeCheckpointHash,
  });
  await updateBranchHead({
    realmDir: options.realmDir,
    branch: value.review.target.branch,
    expectedGeneration: target.generation,
    next: {
      repositoryHash: result.repositoryHash,
      historyHead: options.historyHead,
      indexGenerationHash: options.indexGenerationHash,
      latestCheckpointHash: mergeCheckpointHash,
    },
  });
  await appendReviewEvent({
    realmDir: options.realmDir,
    number: options.number,
    type: 'merged',
    actor: options.actor,
    createdAt: options.createdAt,
    checkpointHash: mergeCheckpointHash,
  });
  return { ...result, mergeCheckpointHash };
}

export async function allocateConditionalReviewNumber(options: {
  objects: ConditionalObjectStore;
  key: string;
  maxAttempts?: number;
}): Promise<number> {
  for (let attempt = 0; attempt < (options.maxAttempts ?? 8); attempt++) {
    let currentObject = await options.objects.get(options.key);
    let current = currentObject
      ? parseCounter(currentObject.bytes)
      : ({ schema: REVIEW_COUNTER_SPEC, next: 1 } satisfies ReviewCounter);
    try {
      await options.objects.put(
        options.key,
        canonicalJson({ ...current, next: current.next + 1 } as unknown as JsonValue),
        currentObject ? { ifMatch: currentObject.etag } : { ifNoneMatch: '*' },
      );
      return current.next;
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) throw error;
    }
  }
  throw new Error('Review number allocation stayed contended');
}

async function putConditionalOnce(options: {
  objects: ConditionalObjectStore;
  key: string;
  bytes: Buffer;
}): Promise<void> {
  let existing = await options.objects.get(options.key);
  if (existing) {
    if (!existing.bytes.equals(options.bytes)) {
      throw new Error(`content-address collision at ${options.key}`);
    }
    return;
  }
  try {
    await options.objects.put(options.key, options.bytes, { ifNoneMatch: '*' });
  } catch (error) {
    if (!(error instanceof ConditionalWriteConflictError)) throw error;
    let winner = await options.objects.get(options.key);
    if (!winner?.bytes.equals(options.bytes)) {
      throw new Error(`content-address collision at ${options.key}`);
    }
  }
}

export async function createConditionalReview(options: {
  objects: ConditionalObjectStore;
  prefix: string;
  base: ReviewSnapshot;
  target: ReviewSnapshot;
  source: ReviewSnapshot;
  title: string;
  body?: string;
  author: Actor;
  createdAt: string;
}): Promise<{ ref: ReviewRef; review: Review }> {
  let value = review({
    base: options.base,
    target: options.target,
    source: options.source,
    title: options.title,
    body: options.body ?? '',
    author: options.author,
    createdAt: options.createdAt,
  });
  let hash = reviewHash(value);
  await putConditionalOnce({
    objects: options.objects,
    key: `${options.prefix}/reviews/objects/${hash.slice(0, 2)}/${hash}.json`,
    bytes: canonicalJson(value as unknown as JsonValue),
  });
  let number = await allocateConditionalReviewNumber({
    objects: options.objects,
    key: `${options.prefix}/reviews/counter.json`,
  });
  let ref: ReviewRef = {
    schema: REVIEW_REF_SPEC,
    number,
    reviewHash: hash,
    generation: 1,
    state: 'open',
  };
  await options.objects.put(
    `${options.prefix}/reviews/numbers/${number}.json`,
    canonicalJson(ref as unknown as JsonValue),
    { ifNoneMatch: '*' },
  );
  return { ref, review: value };
}
