import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  hashDeckWorkspaceDirectory,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  saveDeckWorkspaceState,
  workspaceStateFromBranch,
  type DeckBranchSnapshot,
} from './deck-workspace-state.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { readDeckBranchSnapshot, readDeckTreeFile } from './realm-sync-mode.ts';

const HASH = /^[0-9a-f]{64}$/;

export interface DeckRealmBranchSummary {
  branchName: string;
  repositoryHash: string;
  historyHead: string;
  indexGenerationHash: string;
  refGeneration: number;
}

export interface DeckRealmBranchList {
  schema: 'boxel-deck-branch-list-v1';
  realmRRI: string;
  branches: DeckRealmBranchSummary[];
}

export interface DeckRealmBranchCreateResult {
  schema: 'boxel-deck-branch-create-result-v1';
  realmRRI: string;
  branchName: string;
  fromBranch: string;
  repositoryHash: string;
  treeHash: string;
  historyHead: string;
  indexGenerationHash: string;
  refGeneration: number;
}

function branchesURL(realmURL: string): URL {
  let url = new URL(realmURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/.deck/branches`;
  url.search = '';
  url.hash = '';
  return url;
}

function isBranchSummary(value: unknown): value is DeckRealmBranchSummary {
  let branch = value as Record<string, unknown>;
  return (
    typeof branch === 'object' &&
    branch !== null &&
    typeof branch.branchName === 'string' &&
    branch.branchName !== '' &&
    typeof branch.repositoryHash === 'string' &&
    HASH.test(branch.repositoryHash) &&
    typeof branch.historyHead === 'string' &&
    branch.historyHead !== '' &&
    typeof branch.indexGenerationHash === 'string' &&
    HASH.test(branch.indexGenerationHash) &&
    Number.isSafeInteger(branch.refGeneration) &&
    (branch.refGeneration as number) >= 1
  );
}

function isBranchList(value: unknown): value is DeckRealmBranchList {
  let list = value as Record<string, unknown>;
  return (
    typeof list === 'object' &&
    list !== null &&
    list.schema === 'boxel-deck-branch-list-v1' &&
    typeof list.realmRRI === 'string' &&
    list.realmRRI.startsWith('@') &&
    list.realmRRI.endsWith('/') &&
    Array.isArray(list.branches) &&
    list.branches.every(isBranchSummary)
  );
}

function isBranchCreateResult(
  value: unknown,
): value is DeckRealmBranchCreateResult {
  let result = value as Record<string, unknown>;
  return (
    typeof result === 'object' &&
    result !== null &&
    result.schema === 'boxel-deck-branch-create-result-v1' &&
    typeof result.realmRRI === 'string' &&
    result.realmRRI.startsWith('@') &&
    result.realmRRI.endsWith('/') &&
    typeof result.branchName === 'string' &&
    result.branchName !== '' &&
    typeof result.fromBranch === 'string' &&
    result.fromBranch !== '' &&
    typeof result.repositoryHash === 'string' &&
    HASH.test(result.repositoryHash) &&
    typeof result.treeHash === 'string' &&
    HASH.test(result.treeHash) &&
    typeof result.historyHead === 'string' &&
    result.historyHead !== '' &&
    typeof result.indexGenerationHash === 'string' &&
    HASH.test(result.indexGenerationHash) &&
    Number.isSafeInteger(result.refGeneration) &&
    (result.refGeneration as number) >= 1
  );
}

export async function listDeckRealmBranches(options: {
  realmURL: string;
  authenticator: RealmAuthenticator;
}): Promise<DeckRealmBranchList> {
  let response = await options.authenticator.authedRealmFetch(
    branchesURL(options.realmURL),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(
      `Could not list Deck branches: ${response.status} ${response.statusText}`,
    );
  }
  let value: unknown = await response.json();
  if (!isBranchList(value)) {
    throw new Error('Realm returned an invalid Deck branch list');
  }
  return value;
}

export async function createDeckRealmBranch(options: {
  realmURL: string;
  branchName: string;
  fromBranch?: string;
  authenticator: RealmAuthenticator;
}): Promise<DeckRealmBranchCreateResult> {
  let response = await options.authenticator.authedRealmFetch(
    branchesURL(options.realmURL),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema: 'boxel-deck-branch-create-v1',
        branchName: options.branchName,
        fromBranch: options.fromBranch ?? 'main',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? `Deck branch already exists or moved: ${options.branchName}`
        : `Could not create Deck branch ${options.branchName}: ${response.status} ${response.statusText}`,
    );
  }
  let value: unknown = await response.json();
  if (!isBranchCreateResult(value)) {
    throw new Error('Realm returned an invalid Deck branch creation result');
  }
  return value;
}

export async function switchDeckRealmBranch(options: {
  localDir: string;
  branchName: string;
  authenticator: RealmAuthenticator;
}): Promise<{
  snapshot: DeckBranchSnapshot;
  written: string[];
  deleted: string[];
}> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  if (!workspace) {
    throw new Error(
      'Deck branch switch requires an existing .boxel-sync.json workspace; pull the Realm first',
    );
  }
  let local = await hashDeckWorkspaceDirectory(options.localDir);
  if (inventoryTreeHash(local) !== workspace.baseTreeHash) {
    throw new Error(
      `Workspace has unpushed changes on ${workspace.branchName}; push or checkpoint them before switching`,
    );
  }
  let snapshot = await readDeckBranchSnapshot(
    workspace.realmURL,
    options.branchName,
    options.authenticator,
  );
  if (snapshot.realmRRI !== workspace.realmRRI) {
    throw new Error(
      `Branch ${options.branchName} belongs to ${snapshot.realmRRI}, not ${workspace.realmRRI}`,
    );
  }

  let written = Object.entries(snapshot.files)
    .filter(([path, hash]) => local[path] !== hash)
    .map(([path, expectedHash]) => ({ path, expectedHash }));
  let deleted = Object.keys(local).filter((path) => !(path in snapshot.files));
  let downloaded = await Promise.all(
    written.map(async ({ path, expectedHash }) => ({
      path,
      bytes: await readDeckTreeFile({
        realmURL: workspace.realmURL,
        treeHash: snapshot.treeHash,
        path,
        expectedHash,
        authenticator: options.authenticator,
      }),
    })),
  );
  await Promise.all(
    downloaded.map(async ({ path, bytes }) => {
      let destination = join(options.localDir, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }),
  );
  await Promise.all(
    deleted.map((path) => rm(join(options.localDir, path), { force: true })),
  );
  await saveDeckWorkspaceState(
    options.localDir,
    workspaceStateFromBranch(workspace.realmURL, snapshot),
  );
  return {
    snapshot,
    written: written.map(({ path }) => path).sort(),
    deleted: deleted.sort(),
  };
}
