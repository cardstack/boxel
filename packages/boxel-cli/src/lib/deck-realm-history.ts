import {
  assertObservedBranchHead,
  hashDeckWorkspaceDirectory,
  inventoryTreeHash,
  loadDeckWorkspaceState,
} from './deck-workspace-state.ts';
import { pullDeckBranch } from './deck-realm-pull.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { readDeckBranchSnapshot } from './realm-sync-mode.ts';

export interface DeckHistoryEntry {
  changeId: string;
  commitId: string;
  timestamp: string;
  description: string;
  filesSummary: string[];
  author?: string;
}

export interface DeckHistorySnapshot {
  branch: string;
  historyHead: string;
  entries: DeckHistoryEntry[];
}

function historyURL(realmURL: string, branch: string, limit?: number): URL {
  let url = new URL(realmURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/.deck/history`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('branch', branch);
  if (limit !== undefined) url.searchParams.set('limit', String(limit));
  return url;
}

function isDeckHistoryEntry(value: unknown): value is DeckHistoryEntry {
  let entry = value as Partial<DeckHistoryEntry>;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.changeId === 'string' &&
    typeof entry.commitId === 'string' &&
    typeof entry.timestamp === 'string' &&
    typeof entry.description === 'string' &&
    Array.isArray(entry.filesSummary) &&
    entry.filesSummary.every((path) => typeof path === 'string') &&
    (entry.author === undefined || typeof entry.author === 'string')
  );
}

function parseHistorySnapshot(value: unknown): DeckHistorySnapshot {
  let snapshot = value as Partial<DeckHistorySnapshot>;
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    typeof snapshot.branch !== 'string' ||
    typeof snapshot.historyHead !== 'string' ||
    !Array.isArray(snapshot.entries) ||
    !snapshot.entries.every(isDeckHistoryEntry)
  ) {
    throw new Error('Realm returned an invalid Deck History response');
  }
  return snapshot as DeckHistorySnapshot;
}

export async function readDeckHistory(options: {
  realmURL: string;
  branchName: string;
  limit?: number;
  authenticator: RealmAuthenticator;
}): Promise<DeckHistorySnapshot> {
  let response = await options.authenticator.authedRealmFetch(
    historyURL(options.realmURL, options.branchName, options.limit),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(
      `Could not read Deck History: ${response.status} ${await response.text()}`,
    );
  }
  return parseHistorySnapshot(await response.json());
}

export async function restoreDeckHistory(options: {
  realmURL: string;
  branchName: string;
  revisionId: string;
  authenticator: RealmAuthenticator;
  /** When supplied, require and refresh this exact local materialization. */
  localDir?: string;
}): Promise<{
  restored: string;
  historyHead: string;
  refGeneration: number;
}> {
  let remote = await readDeckBranchSnapshot(
    options.realmURL,
    options.branchName,
    options.authenticator,
  );
  if (options.localDir) {
    let workspace = await loadDeckWorkspaceState(options.localDir);
    if (!workspace) {
      throw new Error(
        'Deck restore requires a workspace created by realm pull',
      );
    }
    assertObservedBranchHead(workspace, remote);
    let local = await hashDeckWorkspaceDirectory(options.localDir);
    if (inventoryTreeHash(local) !== workspace.baseTreeHash) {
      throw new Error(
        'Deck restore requires a clean local workspace; sync or set aside local edits first',
      );
    }
  }
  let response = await options.authenticator.authedRealmFetch(
    historyURL(options.realmURL, options.branchName),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema: 'boxel-deck-history-restore-v1',
        revisionId: options.revisionId,
        expected: {
          repositoryHash: remote.repositoryHash,
          treeHash: remote.treeHash,
          lockHash: remote.lockHash,
          refGeneration: remote.refGeneration,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Could not restore Deck History: ${response.status} ${await response.text()}`,
    );
  }
  let result = (await response.json()) as {
    schema?: unknown;
    restored?: unknown;
    historyHead?: unknown;
    refGeneration?: unknown;
  };
  if (
    result.schema !== 'boxel-deck-history-restore-result-v1' ||
    typeof result.restored !== 'string' ||
    typeof result.historyHead !== 'string' ||
    !Number.isSafeInteger(result.refGeneration)
  ) {
    throw new Error('Realm returned an invalid Deck History restore response');
  }
  if (options.localDir) {
    let pulled = await pullDeckBranch({
      realmURL: options.realmURL,
      branchName: options.branchName,
      localDir: options.localDir,
      authenticator: options.authenticator,
    });
    if (pulled.error) {
      throw new Error(
        `History restored remotely but local refresh failed: ${pulled.error}`,
      );
    }
  }
  return {
    restored: result.restored,
    historyHead: result.historyHead,
    refGeneration: result.refGeneration as number,
  };
}
