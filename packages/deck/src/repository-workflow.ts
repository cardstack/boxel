import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { packFromDir } from './pack.ts';
import { storePack } from './object-store.ts';
import {
  checkpoint,
  repository,
  repositoryManifest,
  type Actor,
  type JsonValue,
  type RepositoryManifest,
} from './repository.ts';
import {
  readBranchHead,
  realmDeckPath,
  realmDeckStoreDir,
  storeCheckpoint,
  storeRepository,
  storeRepositoryLock,
  updateBranchHead,
} from './repository-store.ts';
import { canonicalRRIImportMap, parseRRI } from './rri.ts';

export const REPOSITORY_CONFIG_FILE = '.deck/repository.json';

export interface RepositoryContext {
  realmDir: string;
  config: RepositoryManifest;
}

export function repositoryConfig(value: unknown): RepositoryManifest {
  let input = value as Partial<RepositoryManifest>;
  if (!Array.isArray(input.roots) || input.members === null || typeof input.members !== 'object') {
    throw new Error('invalid Deck Repository manifest');
  }
  if (input.schema !== 'deck-repository-manifest-v2') {
    throw new Error('unsupported Deck Repository manifest schema');
  }
  return repositoryManifest({ roots: input.roots, members: input.members as Record<string, string> });
}

export async function readRepositoryConfig(realmDir: string): Promise<RepositoryManifest | undefined> {
  try {
    return repositoryConfig(JSON.parse(await readFile(join(realmDir, REPOSITORY_CONFIG_FILE), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeRepositoryConfig(
  realmDir: string,
  value: RepositoryManifest,
): Promise<void> {
  let path = join(realmDir, REPOSITORY_CONFIG_FILE);
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dirname(path), { recursive: true }));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

// A mutable package is already a Repository. The manifest exists only when
// several package paths must advance atomically.
export async function resolveRepositoryContext(
  depotDir: string,
  identity?: string,
): Promise<RepositoryContext> {
  let grouped = await readRepositoryConfig(depotDir);
  if (grouped && (!identity || repositoryIdentity(grouped) === identity)) {
    return { realmDir: depotDir, config: grouped };
  }
  if (!identity) throw new Error('repository required: use --repo <owner/package>');
  let parts = identity.split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(part))) {
    throw new Error('repository must be <owner>/<package>');
  }
  try {
    await readFile(join(depotDir, ...parts, 'package.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`mutable package not found: ${identity}`);
    }
    throw error;
  }
  let root = `@${parts[0]}/${parts[1]}/`;
  return {
    realmDir: join(depotDir, ...parts),
    config: repositoryManifest({ roots: [root], members: { [root]: '.' } }),
  };
}

export function repositoryIdentity(config: RepositoryManifest): string {
  let root = parseRRI(config.roots[0]);
  return `${root.scope}/${root.name}`;
}

async function captureRepository(options: {
  realmDir: string;
  config: RepositoryManifest;
}): Promise<string> {
  let members: Record<string, string> = {};
  let storeDir = realmDeckStoreDir(options.realmDir);
  for (let [member, path] of Object.entries(options.config.members)) {
    members[member] = (
      await storePack(
        storeDir,
        await packFromDir(path === '.' ? options.realmDir : join(options.realmDir, path)),
      )
    ).treeHash;
  }
  let authoredMap = JSON.parse(await readFile(join(options.realmDir, 'importmap.json'), 'utf8'));
  let lock = canonicalRRIImportMap(authoredMap, { relativeTo: options.config.roots[0] });
  let lockHash = await storeRepositoryLock(options.realmDir, lock as unknown as JsonValue);
  return storeRepository(
    options.realmDir,
    repository({ roots: options.config.roots, members, lockHash }),
  );
}

export async function advanceRepositoryBranch(options: {
  realmDir: string;
  config: RepositoryManifest;
  branch: string;
  historyHead: string;
  indexGenerationHash: string;
}): Promise<{ repositoryHash: string; generation: number; latestCheckpointHash: string | null }> {
  let current = await readBranchHead(options.realmDir, options.branch);
  let repositoryHash = await captureRepository(options);
  let next = await updateBranchHead({
    realmDir: options.realmDir,
    branch: options.branch,
    expectedGeneration: current?.generation ?? null,
    next: {
      repositoryHash,
      historyHead: options.historyHead,
      indexGenerationHash: options.indexGenerationHash,
      latestCheckpointHash: current?.latestCheckpointHash ?? null,
    },
  });
  return {
    repositoryHash,
    generation: next.generation,
    latestCheckpointHash: next.latestCheckpointHash,
  };
}

export async function captureRepositoryCheckpoint(options: {
  realmDir: string;
  config: RepositoryManifest;
  branch: string;
  historyHead: string;
  indexGenerationHash: string;
  message: string;
  author: Actor;
  createdAt?: string;
}): Promise<{
  repositoryHash: string;
  checkpointHash: string;
  parentCheckpointHash?: string;
}> {
  let current = await readBranchHead(options.realmDir, options.branch);
  let repositoryHash = await captureRepository(options);
  let value = checkpoint({
    repositoryHash,
    parents: current?.latestCheckpointHash ? [current.latestCheckpointHash] : [],
    historyHead: options.historyHead,
    indexGenerationHash: options.indexGenerationHash,
    author: options.author,
    message: options.message,
    createdAt: options.createdAt ?? new Date().toISOString(),
  });
  let checkpointHash = await storeCheckpoint(options.realmDir, value);
  await updateBranchHead({
    realmDir: options.realmDir,
    branch: options.branch,
    expectedGeneration: current?.generation ?? null,
    next: {
      repositoryHash,
      historyHead: options.historyHead,
      indexGenerationHash: options.indexGenerationHash,
      latestCheckpointHash: checkpointHash,
    },
  });
  return {
    repositoryHash,
    checkpointHash,
    ...(current?.latestCheckpointHash ? { parentCheckpointHash: current.latestCheckpointHash } : {}),
  };
}

export async function ensureRepositoryMain(options: {
  realmDir: string;
  config: RepositoryManifest;
  author: Actor;
  historyHead: string;
  indexGenerationHash: string;
}): Promise<string> {
  let current = await readBranchHead(options.realmDir, 'main');
  if (current?.latestCheckpointHash) return current.latestCheckpointHash;
  return (
    await captureRepositoryCheckpoint({
      ...options,
      branch: 'main',
      message: `Initialize ${repositoryIdentity(options.config)}`,
    })
  ).checkpointHash;
}

export async function createRepositoryBranch(options: {
  realmDir: string;
  branch: string;
  from?: string;
}) {
  let source = await readBranchHead(options.realmDir, options.from ?? 'main');
  if (!source) throw new Error(`source branch not found: ${options.from ?? 'main'}`);
  return updateBranchHead({
    realmDir: options.realmDir,
    branch: options.branch,
    expectedGeneration: null,
    next: {
      repositoryHash: source.repositoryHash,
      historyHead: source.historyHead,
      indexGenerationHash: source.indexGenerationHash,
      latestCheckpointHash: source.latestCheckpointHash,
    },
  });
}

export function repositoryMetadataPaths(realmDir: string) {
  return {
    manifest: join(realmDir, REPOSITORY_CONFIG_FILE),
    store: realmDeckStoreDir(realmDir),
    refs: realmDeckPath(realmDir, 'refs'),
    reviews: realmDeckPath(realmDir, 'reviews'),
    indexes: realmDeckPath(realmDir, 'indexes'),
    history: realmDeckPath(realmDir, 'history'),
  };
}
