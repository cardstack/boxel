import {
  hashBytes,
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
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
} from './deck-repository-protocol.ts';
import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import { buildDeckBranchIndex } from './deck-branch-index.ts';

export const DECK_BRANCH_UPDATE_SPEC = 'boxel-deck-branch-update-v2';

export interface DeckBranchUpdateOperation {
  path: string;
  sha256: string | null;
  contentBase64?: string;
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
  }
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
  prepareView?: (view: {
    indexGenerationHash: string;
    repositoryHash: string;
    treeHash: string;
    historyHead: string;
  }) => Promise<void>;
}): Promise<{
  head: BranchHead;
  previousIndexGenerationHash: string;
  repositoryHash: string;
  treeHash: string;
  indexGenerationHash: string;
}> {
  if (options.request.schema !== DECK_BRANCH_UPDATE_SPEC) {
    throw new Error('unsupported Deck branch update schema');
  }
  if (options.request.message.trim() === '') {
    throw new Error('Deck branch update message must not be empty');
  }
  validateOperations(options.request.operations);
  if (options.branch !== 'main') {
    throw new Error('B2b History currently supports only the implicit main');
  }
  return withBranchWriter(options.realmDir, options.branch, async () => {
    let protocol = openDeckRepositoryProtocol(options);
    let current = await protocol.readBranch(options.branch);
    if (!current) throw new Error(`branch not found: ${options.branch}`);
    let currentTreeHash = current.repository.members[protocol.realmRRI];
    if (
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
    let storeDir = join(options.realmDir, '.deck', 'store');
    let currentTree = await readTree(storeDir, currentTreeHash);
    if (!currentTree) {
      throw new DeckProtocolIntegrityError(
        `missing Repository member tree ${currentTreeHash}`,
      );
    }
    let files = new Map<string, Buffer>();
    for (let entry of currentTree.entries) {
      let bytes = await readObject(storeDir, entry.sha256);
      if (!bytes) {
        throw new DeckProtocolIntegrityError(
          `missing tree object ${entry.sha256} for ${entry.path}`,
        );
      }
      files.set(entry.path, bytes);
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
    let lock = canonicalRRIImportMap(importMap, {
      relativeTo: protocol.realmRRI,
    });
    let lockHash = await storeRepositoryLock(
      options.realmDir,
      lock as unknown as JsonValue,
    );
    let packed = pack([...files].map(([path, bytes]) => ({ path, bytes })));
    let stored = await storePack(storeDir, packed);
    if (stored.treeHash === currentTreeHash) {
      throw new Error('Deck branch update does not change tree content');
    }
    let nextRepository = repository({
      roots: current.repository.roots,
      members: {
        ...current.repository.members,
        [protocol.realmRRI]: stored.treeHash,
      },
      lockHash,
    });
    let repositoryHash = await storeRepository(
      options.realmDir,
      nextRepository,
    );
    let priorLive = await readTreeFromDir(options.realmDir);
    let liveChanged = false;
    try {
      // The first B2b write adopts an existing main branch whose B0/B2a head
      // may predate deckd. Seal the state being left before changing bytes;
      // later calls are no-ops because that tree is already History HEAD.
      await options.history.seal(options.realmDir, 'History baseline');
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
      let index = await buildDeckBranchIndex({
        realmDir: options.realmDir,
        branch: current,
        historyHead,
        repositoryHash,
        treeHash: stored.treeHash,
        lockHash,
      });
      // History currently seals the Realm working tree, so creating the Step
      // briefly required materializing the candidate. Put the old bytes back
      // during the potentially long index/prerender wait. Exact-view workers
      // read the candidate from CAS; ordinary live readers keep seeing the
      // branch state that the still-current ref describes.
      if (liveChanged) {
        await writeTreeToDir(options.realmDir, priorLive);
        liveChanged = false;
      }
      // The immutable tree and its static Deck index can be addressed before
      // the mutable ref points at them. Give Realm Server the same window to
      // build its view-qualified SQL index and prerendered HTML. A reader that
      // observes the next ref must never race those derived artifacts.
      await options.prepareView?.({
        indexGenerationHash: index.indexGenerationHash,
        repositoryHash,
        treeHash: stored.treeHash,
        historyHead,
      });
      let acceptedLive = await writeTreeToDir(options.realmDir, files);
      liveChanged =
        acceptedLive.written.length > 0 || acceptedLive.deleted.length > 0;
      let head = await updateBranchHead({
        realmDir: options.realmDir,
        branch: options.branch,
        expectedGeneration: current.head.generation,
        next: {
          repositoryHash,
          historyHead,
          indexGenerationHash: index.indexGenerationHash,
          latestCheckpointHash: null,
        },
      });
      return {
        head,
        previousIndexGenerationHash: current.head.indexGenerationHash,
        repositoryHash,
        treeHash: stored.treeHash,
        indexGenerationHash: index.indexGenerationHash,
      };
    } catch (error) {
      if (liveChanged) {
        await writeTreeToDir(options.realmDir, priorLive);
      }
      throw error;
    }
  });
}
