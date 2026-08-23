import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertObservedBranchHead,
  hashDeckWorkspaceDirectory,
  loadDeckWorkspaceState,
  planContentAddressedSync,
  saveDeckWorkspaceState,
  workspaceStateFromBranch,
} from './deck-workspace-state.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import {
  publishDeckBranchUpdate,
  readDeckBranchSnapshot,
} from './realm-sync-mode.ts';

export const DECK_BRANCH_UPDATE_SPEC = 'boxel-deck-branch-update-v1';

export interface DeckPushResult {
  files: string[];
  deleted: string[];
  error?: string;
}

export async function pushDeckBranch(options: {
  realmURL: string;
  localDir: string;
  authenticator: RealmAuthenticator;
  dryRun?: boolean;
}): Promise<DeckPushResult> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  if (!workspace) {
    return {
      files: [],
      deleted: [],
      error: 'Deck push requires a workspace created by realm pull',
    };
  }
  let requestedRealmURL =
    new URL(options.realmURL).href.replace(/\/+$/, '') + '/';
  if (workspace.realmURL !== requestedRealmURL) {
    return {
      files: [],
      deleted: [],
      error: `Workspace tracks ${workspace.realmURL}, not ${options.realmURL}`,
    };
  }
  let [remote, local] = await Promise.all([
    readDeckBranchSnapshot(
      workspace.realmURL,
      workspace.branchName,
      options.authenticator,
    ),
    hashDeckWorkspaceDirectory(options.localDir),
  ]);
  try {
    assertObservedBranchHead(workspace, remote);
  } catch (error) {
    return {
      files: [],
      deleted: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let plan = planContentAddressedSync({
    base: workspace.files,
    local,
    remote: remote.files,
  });
  let changed = plan.entries.filter(({ action }) => action === 'push');
  let written = changed.filter(({ localHash }) => localHash);
  let deleted = changed.filter(({ localHash }) => !localHash);
  if (changed.length === 0 || options.dryRun) {
    return {
      files: written.map(({ path }) => path).sort(),
      deleted: deleted.map(({ path }) => path).sort(),
    };
  }
  let operations = await Promise.all(
    changed.map(async ({ path, localHash }) =>
      localHash
        ? {
            path,
            sha256: localHash,
            contentBase64: (
              await readFile(join(options.localDir, path))
            ).toString('base64'),
          }
        : { path, sha256: null },
    ),
  );
  let next = await publishDeckBranchUpdate({
    realmURL: workspace.realmURL,
    branchName: workspace.branchName,
    authenticator: options.authenticator,
    body: {
      schema: DECK_BRANCH_UPDATE_SPEC,
      expected: {
        repositoryHash: workspace.baseRepositoryHash,
        treeHash: workspace.baseTreeHash,
        lockHash: workspace.baseLockHash,
        refGeneration: workspace.observedRefGeneration,
      },
      operations,
    },
  });
  await saveDeckWorkspaceState(
    options.localDir,
    workspaceStateFromBranch(workspace.realmURL, next),
  );
  return {
    files: written.map(({ path }) => path).sort(),
    deleted: deleted.map(({ path }) => path).sort(),
  };
}
