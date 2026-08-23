import { hashBytes, type BranchHead } from '@cardstack/deck/node';
import { readObject, readTree } from '@cardstack/deck/object-store';
import type {
  HistoryActor,
  HistoryBackend,
  HistoryEntry,
} from '@cardstack/deck-history/backend';
import { join } from 'node:path';

import {
  DECK_BRANCH_UPDATE_SPEC,
  updateDeckBranchContent,
  type DeckBranchUpdateOperation,
  type DeckBranchUpdateRequest,
} from './deck-branch-content-update.ts';
import {
  DeckProtocolIntegrityError,
  openDeckRepositoryProtocol,
} from './deck-repository-protocol.ts';
import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';

export const DECK_HISTORY_RESTORE_SPEC = 'boxel-deck-history-restore-v1';

export interface DeckHistoryRestoreRequest {
  schema: typeof DECK_HISTORY_RESTORE_SPEC;
  revisionId: string;
  expected: DeckBranchUpdateRequest['expected'];
}

export interface DeckBranchHistorySnapshot {
  branch: string;
  historyHead: string;
  entries: HistoryEntry[];
}

function entriesAtBranchHead(
  entries: HistoryEntry[],
  historyHead: string,
): HistoryEntry[] {
  let index = entries.findIndex(
    ({ changeId, commitId }) =>
      changeId === historyHead || commitId === historyHead,
  );
  if (index === -1) {
    // B0 initialized main before deckd existed. Until the first successful
    // B2b write adopts a real Step, any daemon entries are unreferenced
    // preparation/orphans and must not appear as branch History.
    if (historyHead.startsWith('jj:')) return [];
    throw new DeckProtocolIntegrityError(
      `Deck History does not contain branch head ${historyHead}`,
    );
  }
  return entries.slice(index);
}

function resolveHistoryEntry(
  entries: HistoryEntry[],
  revisionId: string,
): HistoryEntry {
  let exact = entries.find(
    ({ changeId, commitId }) =>
      changeId === revisionId || commitId === revisionId,
  );
  if (exact) return exact;
  let matches = entries.filter(
    ({ changeId, commitId }) =>
      changeId.startsWith(revisionId) || commitId.startsWith(revisionId),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`History revision is ambiguous: ${revisionId}`);
  }
  throw new Error(`History revision not found on this branch: ${revisionId}`);
}

export async function readDeckBranchHistory(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  limit?: number;
}): Promise<DeckBranchHistorySnapshot> {
  if (options.branch !== 'main') {
    throw new Error('B2b History currently supports only the implicit main');
  }
  let current = await openDeckRepositoryProtocol(options).readBranch(
    options.branch,
  );
  if (!current) throw new Error(`branch not found: ${options.branch}`);
  let entries = entriesAtBranchHead(
    await options.history.list(options.realmDir, { flush: false }),
    current.head.historyHead,
  );
  return {
    branch: options.branch,
    historyHead: current.head.historyHead,
    entries:
      options.limit && options.limit > 0
        ? entries.slice(0, options.limit)
        : entries,
  };
}

async function currentTreeFiles(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
}): Promise<Map<string, Buffer>> {
  let current = await openDeckRepositoryProtocol(options).readBranch(
    options.branch,
  );
  if (!current) throw new Error(`branch not found: ${options.branch}`);
  let treeHash = current.repository.members[current.realmRRI];
  let storeDir = join(options.realmDir, '.deck', 'store');
  let tree = await readTree(storeDir, treeHash);
  if (!tree) throw new DeckProtocolIntegrityError(`missing tree ${treeHash}`);
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

export async function restoreDeckBranchHistory(options: {
  realmDir: string;
  realmRRI: string;
  branch: string;
  policy: DeckCollaborationPolicy;
  history: HistoryBackend;
  actor?: HistoryActor;
  request: DeckHistoryRestoreRequest;
}): Promise<{ restored: string; head: BranchHead; treeHash: string }> {
  if (options.request.schema !== DECK_HISTORY_RESTORE_SPEC) {
    throw new Error('unsupported Deck History restore schema');
  }
  let history = await readDeckBranchHistory(options);
  let target = resolveHistoryEntry(history.entries, options.request.revisionId);
  let paths = await options.history.fileListAt(
    options.realmDir,
    target.changeId,
  );
  let targetFiles = new Map<string, Buffer>();
  for (let path of paths) {
    let bytes = await options.history.fileAt(
      options.realmDir,
      target.changeId,
      path,
    );
    if (!bytes) {
      throw new DeckProtocolIntegrityError(
        `${path} is missing from History Step ${target.changeId}`,
      );
    }
    targetFiles.set(path, bytes);
  }
  let currentFiles = await currentTreeFiles(options);
  let operations: DeckBranchUpdateOperation[] = [];
  for (let path of new Set([...currentFiles.keys(), ...targetFiles.keys()])) {
    let current = currentFiles.get(path);
    let targetBytes = targetFiles.get(path);
    if (targetBytes && current?.equals(targetBytes)) {
      continue;
    }
    operations.push(
      targetBytes
        ? {
            path,
            sha256: hashBytes(targetBytes),
            contentBase64: targetBytes.toString('base64'),
          }
        : { path, sha256: null },
    );
  }
  operations.sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  if (operations.length === 0) {
    throw new Error(
      `History Step ${target.changeId} is already materialized on ${options.branch}`,
    );
  }
  let updated = await updateDeckBranchContent({
    realmDir: options.realmDir,
    realmRRI: options.realmRRI,
    branch: options.branch,
    policy: options.policy,
    history: options.history,
    actor: options.actor,
    request: {
      schema: DECK_BRANCH_UPDATE_SPEC,
      message: `restore: ${target.changeId}`,
      expected: options.request.expected,
      operations,
    },
  });
  return {
    restored: target.changeId,
    head: updated.head,
    treeHash: updated.treeHash,
  };
}
