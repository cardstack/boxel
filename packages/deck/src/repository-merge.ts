import { pack, unpack } from './pack.ts';
import { mergeJsonValues, mergeTrees } from './merge.ts';
import { readObject, readTree, storePack } from './object-store.ts';
import {
  changedMembers,
  checkpoint,
  repository,
  type Actor,
  type JsonValue,
  type Repository,
} from './repository.ts';
import {
  readBranchHead,
  readCheckpoint,
  readRepository,
  readRepositoryLock,
  realmDeckStoreDir,
  storeCheckpoint,
  storeRepository,
  storeRepositoryLock,
  updateBranchHead,
} from './repository-store.ts';

export interface RepositoryMergeReady {
  state: 'ready';
  baseCheckpointHash: string;
  targetCheckpointHash: string;
  sourceCheckpointHash: string;
  repository: Repository;
  repositoryHash: string;
  changedMembers: string[];
}

export interface RepositoryMergeConflicted {
  state: 'conflicted';
  baseCheckpointHash: string;
  targetCheckpointHash: string;
  sourceCheckpointHash: string;
  conflicts: string[];
}

export type RepositoryMergeResult = RepositoryMergeReady | RepositoryMergeConflicted;

async function requiredCheckpoint(realmDir: string, hash: string) {
  let value = await readCheckpoint(realmDir, hash);
  if (!value) throw new Error(`missing Checkpoint ${hash}`);
  return value;
}

async function requiredRepository(realmDir: string, hash: string) {
  let value = await readRepository(realmDir, hash);
  if (!value) throw new Error(`missing Repository ${hash}`);
  return value;
}

async function requiredLock(realmDir: string, hash: string) {
  let value = await readRepositoryLock(realmDir, hash);
  if (!value) throw new Error(`missing Repository lock ${hash}`);
  return value;
}

async function treeFiles(realmDir: string, treeHash: string): Promise<Map<string, Buffer>> {
  let storeDir = realmDeckStoreDir(realmDir);
  let tree = await readTree(storeDir, treeHash);
  if (!tree) throw new Error(`missing package tree ${treeHash}`);
  let files = new Map<string, Buffer>();
  for (let entry of tree.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes) throw new Error(`missing object ${entry.sha256} for ${treeHash}`);
    files.set(entry.path, bytes);
  }
  return files;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function mergeRoots(
  base: string[],
  target: string[],
  source: string[],
): { roots?: string[]; conflicted: boolean } {
  if (sameJson(target, source)) return { roots: target, conflicted: false };
  if (sameJson(base, target)) return { roots: source, conflicted: false };
  if (sameJson(base, source)) return { roots: target, conflicted: false };
  return { conflicted: true };
}

export async function mergeRepositoryCheckpoints(options: {
  realmDir: string;
  baseCheckpointHash: string;
  targetCheckpointHash: string;
  sourceCheckpointHash: string;
}): Promise<RepositoryMergeResult> {
  let [baseCheckpoint, targetCheckpoint, sourceCheckpoint] = await Promise.all([
    requiredCheckpoint(options.realmDir, options.baseCheckpointHash),
    requiredCheckpoint(options.realmDir, options.targetCheckpointHash),
    requiredCheckpoint(options.realmDir, options.sourceCheckpointHash),
  ]);
  let [base, target, source] = await Promise.all([
    requiredRepository(options.realmDir, baseCheckpoint.repositoryHash),
    requiredRepository(options.realmDir, targetCheckpoint.repositoryHash),
    requiredRepository(options.realmDir, sourceCheckpoint.repositoryHash),
  ]);
  let conflicts: string[] = [];
  let roots = mergeRoots(base.roots, target.roots, source.roots);
  if (roots.conflicted) conflicts.push('.deck/repository.json#roots');

  let [baseLock, targetLock, sourceLock] = await Promise.all([
    requiredLock(options.realmDir, base.lockHash),
    requiredLock(options.realmDir, target.lockHash),
    requiredLock(options.realmDir, source.lockHash),
  ]);
  let lockMerge = mergeJsonValues(baseLock, targetLock, sourceLock);
  if (lockMerge.conflicted) conflicts.push('importmap.json');

  let members: Record<string, string> = {};
  let pendingPacks = new Map<string, Buffer>();
  let names = [
    ...new Set([
      ...Object.keys(base.members),
      ...Object.keys(target.members),
      ...Object.keys(source.members),
    ]),
  ].sort();
  for (let name of names) {
    let b = base.members[name];
    let o = target.members[name];
    let t = source.members[name];
    if (o === t) {
      if (o) members[name] = o;
      continue;
    }
    if (o === b) {
      if (t) members[name] = t;
      continue;
    }
    if (t === b) {
      if (o) members[name] = o;
      continue;
    }
    if (!b || !o || !t) {
      conflicts.push(name);
      continue;
    }
    let merged = mergeTrees(
      await treeFiles(options.realmDir, b),
      await treeFiles(options.realmDir, o),
      await treeFiles(options.realmDir, t),
    );
    if (merged.conflicts.length > 0) {
      conflicts.push(...merged.conflicts.map((path) => `${name}${path}`));
      continue;
    }
    let bytes = pack([...merged.files].map(([path, fileBytes]) => ({ path, bytes: fileBytes })));
    let treeHash = unpack(bytes).treeHash;
    members[name] = treeHash;
    pendingPacks.set(treeHash, bytes);
  }

  if (conflicts.length > 0 || !roots.roots) {
    return {
      state: 'conflicted',
      baseCheckpointHash: options.baseCheckpointHash,
      targetCheckpointHash: options.targetCheckpointHash,
      sourceCheckpointHash: options.sourceCheckpointHash,
      conflicts: [...new Set(conflicts)].sort(),
    };
  }

  let storeDir = realmDeckStoreDir(options.realmDir);
  for (let bytes of pendingPacks.values()) await storePack(storeDir, bytes);
  let lockHash = await storeRepositoryLock(options.realmDir, lockMerge.value as JsonValue);
  let value = repository({ roots: roots.roots, members, lockHash });
  let repositoryHash = await storeRepository(options.realmDir, value);
  return {
    state: 'ready',
    baseCheckpointHash: options.baseCheckpointHash,
    targetCheckpointHash: options.targetCheckpointHash,
    sourceCheckpointHash: options.sourceCheckpointHash,
    repository: value,
    repositoryHash,
    changedMembers: changedMembers(target, value),
  };
}

export async function landRepositoryMerge(options: {
  realmDir: string;
  branch: string;
  expectedGeneration: number;
  baseCheckpointHash: string;
  targetCheckpointHash: string;
  sourceCheckpointHash: string;
  historyHead: string;
  indexGenerationHash: string;
  author: Actor;
  message: string;
  createdAt: string;
}): Promise<RepositoryMergeConflicted | (RepositoryMergeReady & { mergeCheckpointHash: string })> {
  let result = await mergeRepositoryCheckpoints(options);
  if (result.state === 'conflicted') return result;
  let mergeCheckpoint = checkpoint({
    repositoryHash: result.repositoryHash,
    parents: [options.targetCheckpointHash, options.sourceCheckpointHash],
    historyHead: options.historyHead,
    indexGenerationHash: options.indexGenerationHash,
    author: options.author,
    message: options.message,
    createdAt: options.createdAt,
  });
  let mergeCheckpointHash = await storeCheckpoint(options.realmDir, mergeCheckpoint);
  let head = await readBranchHead(options.realmDir, options.branch);
  if (!head || head.generation !== options.expectedGeneration) {
    throw new Error('target branch moved before merge settlement');
  }
  await updateBranchHead({
    realmDir: options.realmDir,
    branch: options.branch,
    expectedGeneration: options.expectedGeneration,
    next: {
      repositoryHash: result.repositoryHash,
      historyHead: options.historyHead,
      indexGenerationHash: options.indexGenerationHash,
      latestCheckpointHash: mergeCheckpointHash,
    },
  });
  return { ...result, mergeCheckpointHash };
}
