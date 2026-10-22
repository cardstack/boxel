import {
  hashBytes,
  hashProtocolObject,
  pack,
  repository,
  storeRepository,
  storeRepositoryLock,
  updateBranchHead,
  readTreeFromDir,
  writeTreeToDir,
  RefBusyError,
  type BranchHead,
  type JsonValue,
  type Repository,
} from '@cardstack/deck/node';
import type {
  HistoryActor,
  HistoryBackend,
} from '@cardstack/deck-history/backend';
import { readObject, readTree, storePack } from '@cardstack/deck/object-store';
import { canonicalRRIImportMap } from '@cardstack/deck/rri';
import {
  isPartialWritePath,
  type LocalPath,
} from '@cardstack/runtime-common/paths';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
} from './deck-repository-protocol.ts';
import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import { readDeckRealmPackages } from './deck-realm-packages.ts';

export const DECK_BRANCH_UPDATE_SPEC = 'boxel-deck-branch-update-v2';

export interface DeckBranchUpdateOperation {
  path: string;
  sha256: string | null;
  contentBase64?: string;
  // The content this change was made against: the file's sha256 when the
  // writer last synced, or null when it did not exist. When every operation
  // names its base, the update merges per file the way mtime sync did: it
  // applies on top of whatever main holds now, and only a file that also
  // changed on main since that base is a conflict.
  base?: string | null;
}

export interface DeckBranchUpdateRequest {
  schema: typeof DECK_BRANCH_UPDATE_SPEC;
  message: string;
  expected: {
    repositoryHash: string;
    treeHash: string;
    lockHash: string;
    refGeneration: number;
  };
  operations: DeckBranchUpdateOperation[];
}

export class DeckBranchContentConflictError extends Error {}

// Some files the update touches changed on main since the writer's base.
// Nothing was written; the writer resolves just these paths.
export class DeckBranchPathConflictError extends DeckBranchContentConflictError {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(`changed on main since your last sync: ${paths.join(', ')}`);
    this.paths = paths;
  }
}

function isPerFileUpdate(request: DeckBranchUpdateRequest): boolean {
  return request.operations.every((operation) => 'base' in operation);
}

// Every package the realm hosts advances with the branch, as Deck core's
// Repository capture packs each member from its authoring path. The realm's
// own package is the whole tree; each other member is the subtree at its
// path, so its tree hash is what a Version cut from this head would carry.
async function memberTrees(options: {
  realmDir: string;
  realmRRI: string;
  realmTreeHash: string;
  files: Map<string, Buffer>;
  storeDir: string;
}): Promise<Record<string, string>> {
  let packages = await readDeckRealmPackages(options.realmDir);
  let members: Record<string, string> = {
    [options.realmRRI]: options.realmTreeHash,
  };
  for (let [member, path] of packages?.members ?? []) {
    if (path === '.') {
      continue;
    }
    let prefix = `${path}/`;
    let entries = [...options.files]
      .filter(([file]) => file.startsWith(prefix))
      .map(([file, bytes]) => ({ path: file.slice(prefix.length), bytes }));
    if (entries.length === 0) {
      throw new Error(`Deck package ${member} has no files at ${path}/`);
    }
    members[member] = (
      await storePack(options.storeDir, pack(entries))
    ).treeHash;
  }
  return members;
}

function sameExpected(
  request: DeckBranchUpdateRequest,
  snapshot: {
    head: BranchHead;
    repository: Repository;
    treeHash: string;
  },
): boolean {
  return (
    request.expected.refGeneration === snapshot.head.generation &&
    request.expected.repositoryHash === snapshot.head.repositoryHash &&
    request.expected.treeHash === snapshot.treeHash &&
    request.expected.lockHash === snapshot.repository.lockHash
  );
}

function validateOperations(operations: DeckBranchUpdateOperation[]): void {
  if (operations.length === 0) {
    throw new Error('Deck branch update requires at least one operation');
  }
  let seen = new Set<string>();
  for (let operation of operations) {
    if (
      operation.path === '' ||
      operation.path.startsWith('/') ||
      operation.path.includes('\\') ||
      operation.path.split('/').some((part) => part === '' || part === '..') ||
      seen.has(operation.path)
    ) {
      throw new Error(
        `invalid or duplicate Deck update path: ${operation.path}`,
      );
    }
    seen.add(operation.path);
    if (operation.sha256 === null) {
      if (operation.contentBase64 !== undefined) {
        throw new Error(`delete operation carries bytes: ${operation.path}`);
      }
    } else if (
      !/^[0-9a-f]{64}$/.test(operation.sha256) ||
      operation.contentBase64 === undefined
    ) {
      throw new Error(`write operation is incomplete: ${operation.path}`);
    }
    if (
      'base' in operation &&
      operation.base !== null &&
      !/^[0-9a-f]{64}$/.test(operation.base ?? '')
    ) {
      throw new Error(`invalid base for ${operation.path}`);
    }
  }
}

// Bytes of every file in a stored tree.
async function treeFiles(
  storeDir: string,
  treeHash: string,
): Promise<Map<string, Buffer>> {
  let tree = await readTree(storeDir, treeHash);
  if (!tree) {
    throw new DeckProtocolIntegrityError(
      `missing Repository member tree ${treeHash}`,
    );
  }
  let files = new Map<string, Buffer>();
  for (let entry of tree.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes) {
      throw new DeckProtocolIntegrityError(
        `missing tree object ${entry.sha256} for ${entry.path}`,
      );
    }
    files.set(entry.path, bytes);
  }
  return files;
}

async function storeLockFor(
  realmDir: string,
  realmRRI: string,
  files: Map<string, Buffer>,
): Promise<string> {
  let importMapBytes = files.get('importmap.json');
  if (!importMapBytes) {
    throw new Error('Deck branch tree requires importmap.json');
  }
  let importMap: unknown;
  try {
    importMap = JSON.parse(importMapBytes.toString('utf8'));
  } catch {
    throw new Error('Deck branch importmap.json is not valid JSON');
  }
  let lock = canonicalRRIImportMap(importMap, { relativeTo: realmRRI });
  return storeRepositoryLock(realmDir, lock as unknown as JsonValue);
}

// A staged write the realm has not yet renamed into place is no part of it.
function liveFiles(files: Map<string, Buffer>): Map<string, Buffer> {
  for (let path of [...files.keys()]) {
    if (isPartialWritePath(path as LocalPath)) files.delete(path);
  }
  return files;
}

// Commits the realm's live files: one History Step, and main advanced to the
// same tree, so main is always what the realm serves — the HEAD every
// boxel-cli user syncs against, as before Deck. The caller holds the branch
// writer lock. A realm whose main does not exist yet, or whose live files
// cannot form a tree (no importmap.json), only gets the History Step.
async function commitLiveTreeLocked(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  message: string;
  actor?: HistoryActor;
}): Promise<void> {
  let sealed = await options.history.seal(
    options.realmDir,
    options.message,
    options.actor,
  );
  let protocol = openDeckRepositoryProtocol(options);
  let current = await protocol.readBranch(options.branch);
  if (!current) return;
  let files = liveFiles(await readTreeFromDir(options.realmDir));
  if (!files.has('importmap.json')) return;
  let storeDir = join(options.realmDir, '.deck', 'store');
  let packed = pack([...files].map(([path, bytes]) => ({ path, bytes })));
  let stored = await storePack(storeDir, packed);
  if (stored.treeHash === current.repository.members[protocol.realmRRI]) {
    return;
  }
  let lockHash = await storeLockFor(options.realmDir, protocol.realmRRI, files);
  let repositoryHash = await storeRepository(
    options.realmDir,
    repository({
      roots: current.repository.roots,
      members: await memberTrees({
        realmDir: options.realmDir,
        realmRRI: protocol.realmRRI,
        realmTreeHash: stored.treeHash,
        files,
        storeDir,
      }),
      lockHash,
    }),
  );
  let historyHead = sealed ?? (await options.history.head(options.realmDir));
  if (!historyHead) {
    throw new Error('deckd did not create a History Step');
  }
  await updateBranchHead({
    realmDir: options.realmDir,
    branch: options.branch,
    expectedGeneration: current.head.generation,
    next: {
      repositoryHash,
      historyHead,
      indexGenerationHash: hashProtocolObject({
        schema: 'boxel-deck-index-pending-v1',
        treeHash: stored.treeHash,
      }),
      latestCheckpointHash: null,
    },
  });
}

// Commits host saves after their debounce: a History Step, with main moved
// to the realm's live files. A branch update holding the writer lock commits
// them itself first, so a busy writer is reported to the caller to retry.
export async function commitHostSaves(options: {
  realmDir: string;
  realmRRI: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  message: string;
}): Promise<void> {
  await withBranchWriter(options.realmDir, 'main', () =>
    commitLiveTreeLocked({ ...options, branch: 'main' }),
  );
}

async function withBranchWriter<T>(
  realmDir: string,
  branch: string,
  callback: () => Promise<T>,
): Promise<T> {
  let lock = join(
    realmDir,
    '.deck',
    '_writer-locks',
    `${hashBytes(branch)}.lock`,
  );
  await mkdir(dirname(lock), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RefBusyError(`branch writer is busy: ${branch}`);
    }
    throw error;
  }
  try {
    return await callback();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function updateDeckBranchContent(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  actor?: HistoryActor;
  request: DeckBranchUpdateRequest;
  // Takes the message of host saves still waiting out their debounce,
  // cancelling it, so this update commits them first as their own Step.
  takePendingHostSaves?: (realmDir: string) => string | undefined;
}): Promise<{ head: BranchHead; repositoryHash: string; treeHash: string }> {
  if (options.request.schema !== DECK_BRANCH_UPDATE_SPEC) {
    throw new Error('unsupported Deck branch update schema');
  }
  if (options.request.message.trim() === '') {
    throw new Error('Deck branch update message must not be empty');
  }
  validateOperations(options.request.operations);
  if (options.branch !== 'main') {
    throw new Error('Deck History currently supports only the main branch');
  }
  return withBranchWriter(options.realmDir, options.branch, async () => {
    // Whatever the realm holds now — host saves still waiting out their
    // debounce, or files that predate deckd — is committed first, as its own
    // Step, and becomes main. The update then applies on top of it, so it
    // never writes over a host save.
    await commitLiveTreeLocked({
      ...options,
      message:
        options.takePendingHostSaves?.(options.realmDir) ?? 'History baseline',
      actor: undefined,
    });
    let protocol = openDeckRepositoryProtocol(options);
    let current = await protocol.readBranch(options.branch);
    if (!current) throw new Error(`branch not found: ${options.branch}`);
    let currentTreeHash = current.repository.members[protocol.realmRRI];
    let storeDir = join(options.realmDir, '.deck', 'store');
    let files = await treeFiles(storeDir, currentTreeHash);
    if (isPerFileUpdate(options.request)) {
      let conflicts = options.request.operations
        .filter((operation) => {
          let now = files.get(operation.path);
          let nowHash = now ? hashBytes(now) : null;
          // Already what the writer wants, or untouched since its base.
          return nowHash !== operation.sha256 && nowHash !== operation.base;
        })
        .map((operation) => operation.path);
      if (conflicts.length > 0) {
        throw new DeckBranchPathConflictError(conflicts);
      }
    } else if (
      !sameExpected(options.request, {
        head: current.head,
        repository: current.repository,
        treeHash: currentTreeHash,
      })
    ) {
      throw new DeckBranchContentConflictError(
        `branch ${options.branch} moved since it was read`,
      );
    }
    for (let operation of options.request.operations) {
      if (operation.sha256 === null) {
        files.delete(operation.path);
        continue;
      }
      let bytes = Buffer.from(operation.contentBase64!, 'base64');
      if (hashBytes(bytes) !== operation.sha256) {
        throw new Error(`content hash mismatch: ${operation.path}`);
      }
      files.set(operation.path, bytes);
    }
    let lockHash = await storeLockFor(
      options.realmDir,
      protocol.realmRRI,
      files,
    );
    let packed = pack([...files].map(([path, bytes]) => ({ path, bytes })));
    let stored = await storePack(storeDir, packed);
    if (stored.treeHash === currentTreeHash) {
      throw new Error('Deck branch update does not change tree content');
    }
    let nextRepository = repository({
      roots: current.repository.roots,
      members: await memberTrees({
        realmDir: options.realmDir,
        realmRRI: protocol.realmRRI,
        realmTreeHash: stored.treeHash,
        files,
        storeDir,
      }),
      lockHash,
    });
    let repositoryHash = await storeRepository(
      options.realmDir,
      nextRepository,
    );
    let priorLive = await readTreeFromDir(options.realmDir);
    let liveChanged = false;
    try {
      let materialized = await writeTreeToDir(options.realmDir, files);
      liveChanged =
        materialized.written.length > 0 || materialized.deleted.length > 0;
      let historyHead = await options.history.seal(
        options.realmDir,
        options.request.message.trim(),
        options.actor,
      );
      if (!historyHead) {
        throw new Error('deckd did not create a History Step');
      }
      let head = await updateBranchHead({
        realmDir: options.realmDir,
        branch: options.branch,
        expectedGeneration: current.head.generation,
        next: {
          repositoryHash,
          historyHead,
          indexGenerationHash: hashProtocolObject({
            schema: 'boxel-deck-index-pending-v1',
            treeHash: stored.treeHash,
          }),
          latestCheckpointHash: null,
        },
      });
      return { head, repositoryHash, treeHash: stored.treeHash };
    } catch (error) {
      if (liveChanged) {
        await writeTreeToDir(options.realmDir, priorLive);
      }
      throw error;
    }
  });
}
