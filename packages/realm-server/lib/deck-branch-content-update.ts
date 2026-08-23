import {
  hashBytes,
  hashProtocolObject,
  pack,
  repository,
  storeRepository,
  storeRepositoryLock,
  updateBranchHead,
  type BranchHead,
  type JsonValue,
  type Repository,
} from '@cardstack/deck/node';
import { readObject, readTree, storePack } from '@cardstack/deck/object-store';
import { canonicalRRIImportMap } from '@cardstack/deck/rri';
import { join } from 'node:path';

import {
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
} from './deck-repository-protocol.ts';
import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';

export const DECK_BRANCH_UPDATE_SPEC = 'boxel-deck-branch-update-v1';

export interface DeckBranchUpdateOperation {
  path: string;
  sha256: string | null;
  contentBase64?: string;
}

export interface DeckBranchUpdateRequest {
  schema: typeof DECK_BRANCH_UPDATE_SPEC;
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

export async function updateDeckBranchContent(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  request: DeckBranchUpdateRequest;
}): Promise<{ head: BranchHead; repositoryHash: string; treeHash: string }> {
  if (options.request.schema !== DECK_BRANCH_UPDATE_SPEC) {
    throw new Error('unsupported Deck branch update schema');
  }
  validateOperations(options.request.operations);
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
  if (!importMapBytes)
    throw new Error('Deck branch tree requires importmap.json');
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
  let nextRepository = repository({
    roots: current.repository.roots,
    members: {
      ...current.repository.members,
      [protocol.realmRRI]: stored.treeHash,
    },
    lockHash,
  });
  let repositoryHash = await storeRepository(options.realmDir, nextRepository);
  let head = await updateBranchHead({
    realmDir: options.realmDir,
    branch: options.branch,
    expectedGeneration: current.head.generation,
    next: {
      repositoryHash,
      historyHead: current.head.historyHead,
      indexGenerationHash: hashProtocolObject({
        schema: 'boxel-deck-index-pending-v1',
        treeHash: stored.treeHash,
      }),
      latestCheckpointHash: null,
    },
  });
  return { head, repositoryHash, treeHash: stored.treeHash };
}
