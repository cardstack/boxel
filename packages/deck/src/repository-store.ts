import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  canonicalJson,
  checkpointHash,
  hashProtocolObject,
  isHash,
  repositoryHash,
  type Checkpoint,
  type JsonValue,
  type Repository,
} from './repository.ts';

export const DECK_DIR = '.deck';
export const STORE_DIR = 'store';
export const LOCKS_DIR = '_locks';
export const REPOSITORIES_DIR = '_repositories';
export const CHECKPOINTS_DIR = '_checkpoints';
export const REFS_DIR = 'refs';
export const REVIEWS_DIR = 'reviews';
export const INDEXES_DIR = 'indexes';
export const HISTORY_DIR = 'history';
export const BRANCH_HEAD_SPEC = 'deck-branch-head-v2';

export interface BranchHead {
  schema: typeof BRANCH_HEAD_SPEC;
  generation: number;
  repositoryHash: string;
  historyHead: string;
  indexGenerationHash: string;
  latestCheckpointHash: string | null;
}

export type BranchHeadState = Omit<BranchHead, 'schema' | 'generation'>;

export function realmDeckPath(realmDir: string, ...parts: string[]): string {
  return join(realmDir, DECK_DIR, ...parts);
}

export function realmDeckStoreDir(realmDir: string): string {
  return realmDeckPath(realmDir, STORE_DIR);
}

function validateBranchHead(value: Partial<BranchHead>): BranchHead {
  if (
    value.schema !== BRANCH_HEAD_SPEC ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation ?? 0) < 1 ||
    typeof value.repositoryHash !== 'string' ||
    !isHash(value.repositoryHash) ||
    typeof value.historyHead !== 'string' ||
    value.historyHead.trim() === '' ||
    typeof value.indexGenerationHash !== 'string' ||
    !isHash(value.indexGenerationHash) ||
    !(
      value.latestCheckpointHash === null ||
      (typeof value.latestCheckpointHash === 'string' && isHash(value.latestCheckpointHash))
    )
  ) {
    throw new Error('invalid Deck branch head');
  }
  return value as BranchHead;
}

function parseBranchHead(bytes: Buffer): BranchHead {
  return validateBranchHead(JSON.parse(bytes.toString('utf8')) as Partial<BranchHead>);
}

function casPath(realmDir: string, kind: string, hash: string): string {
  return realmDeckPath(realmDir, STORE_DIR, kind, hash.slice(0, 2), `${hash}.json`);
}

async function writeOnce(path: string, bytes: Buffer): Promise<void> {
  try {
    let existing = await readFile(path);
    if (!existing.equals(bytes)) throw new Error(`content-address collision at ${path}`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function readHashedJson<T>(path: string, expectedHash: string): Promise<T | undefined> {
  try {
    let bytes = await readFile(path);
    let parsed = JSON.parse(bytes.toString('utf8')) as JsonValue;
    if (hashProtocolObject(parsed) !== expectedHash) {
      throw new Error(`protocol object does not match its hash: ${path}`);
    }
    return parsed as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function storeRepositoryLock(realmDir: string, lock: JsonValue): Promise<string> {
  let hash = hashProtocolObject(lock);
  await writeOnce(casPath(realmDir, LOCKS_DIR, hash), canonicalJson(lock));
  return hash;
}

export async function readRepositoryLock(
  realmDir: string,
  lockHash: string,
): Promise<JsonValue | undefined> {
  if (!isHash(lockHash)) return undefined;
  return readHashedJson(casPath(realmDir, LOCKS_DIR, lockHash), lockHash);
}

export async function storeRepository(realmDir: string, value: Repository): Promise<string> {
  let hash = repositoryHash(value);
  await writeOnce(
    casPath(realmDir, REPOSITORIES_DIR, hash),
    canonicalJson(value as unknown as JsonValue),
  );
  return hash;
}

export async function readRepository(
  realmDir: string,
  hash: string,
): Promise<Repository | undefined> {
  if (!isHash(hash)) return undefined;
  return readHashedJson(casPath(realmDir, REPOSITORIES_DIR, hash), hash);
}

export async function storeCheckpoint(realmDir: string, value: Checkpoint): Promise<string> {
  let hash = checkpointHash(value);
  await writeOnce(
    casPath(realmDir, CHECKPOINTS_DIR, hash),
    canonicalJson(value as unknown as JsonValue),
  );
  return hash;
}

export async function readCheckpoint(
  realmDir: string,
  hash: string,
): Promise<Checkpoint | undefined> {
  if (!isHash(hash)) return undefined;
  return readHashedJson(casPath(realmDir, CHECKPOINTS_DIR, hash), hash);
}

const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,127}$/;

export function branchHeadPath(realmDir: string, branch: string): string {
  if (!BRANCH.test(branch) || branch.includes('..') || branch.endsWith('/')) {
    throw new Error('invalid branch name');
  }
  return realmDeckPath(realmDir, REFS_DIR, 'heads', `${branch}.json`);
}

export async function readBranchHead(
  realmDir: string,
  branch: string,
): Promise<BranchHead | undefined> {
  try {
    return parseBranchHead(await readFile(branchHeadPath(realmDir, branch)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export class RefConflictError extends Error {}
export class RefBusyError extends Error {}
export class ConditionalWriteConflictError extends Error {}

function nextBranchHead(generation: number, value: BranchHeadState): BranchHead {
  return validateBranchHead({ schema: BRANCH_HEAD_SPEC, generation, ...value });
}

export async function updateBranchHead(options: {
  realmDir: string;
  branch: string;
  expectedGeneration: number | null;
  next: BranchHeadState;
}): Promise<BranchHead> {
  let path = branchHeadPath(options.realmDir, options.branch);
  let lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RefBusyError(`branch head is being updated: ${options.branch}`);
    }
    throw error;
  }
  try {
    let current = await readBranchHead(options.realmDir, options.branch);
    if ((current?.generation ?? null) !== options.expectedGeneration) {
      throw new RefConflictError('branch moved since it was read');
    }
    let next = nextBranchHead((current?.generation ?? 0) + 1, options.next);
    let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, canonicalJson(next as unknown as JsonValue));
    await rename(tmp, path);
    return next;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export interface ConditionalObject {
  bytes: Buffer;
  etag: string;
}

export interface ConditionalObjectStore {
  get(key: string): Promise<ConditionalObject | undefined>;
  put(
    key: string,
    bytes: Buffer,
    condition: { ifMatch?: string; ifNoneMatch?: '*' },
  ): Promise<{ etag: string }>;
}

export async function updateConditionalBranchHead(options: {
  objects: ConditionalObjectStore;
  key: string;
  expectedGeneration: number | null;
  next: BranchHeadState;
}): Promise<BranchHead> {
  let currentObject = await options.objects.get(options.key);
  let current = currentObject ? parseBranchHead(currentObject.bytes) : undefined;
  if ((current?.generation ?? null) !== options.expectedGeneration) {
    throw new RefConflictError('branch moved since it was read');
  }
  let next = nextBranchHead((current?.generation ?? 0) + 1, options.next);
  await options.objects.put(
    options.key,
    canonicalJson(next as unknown as JsonValue),
    currentObject ? { ifMatch: currentObject.etag } : { ifNoneMatch: '*' },
  );
  return next;
}
