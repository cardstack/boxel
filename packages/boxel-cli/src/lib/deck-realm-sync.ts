import {
  hashDeckWorkspaceDirectory,
  loadDeckWorkspaceState,
  planContentAddressedSync,
} from './deck-workspace-state.ts';
import { pullDeckBranch } from './deck-realm-pull.ts';
import { pushDeckBranch } from './deck-realm-push.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { readDeckBranchSnapshot } from './realm-sync-mode.ts';

export interface DeckSyncResult {
  pushed: string[];
  pulled: string[];
  remoteDeleted: string[];
  localDeleted: string[];
  conflicts: string[];
  error?: string;
}

function empty(error?: string): DeckSyncResult {
  return {
    pushed: [],
    pulled: [],
    remoteDeleted: [],
    localDeleted: [],
    conflicts: [],
    ...(error ? { error } : {}),
  };
}

export async function syncDeckBranch(options: {
  realmURL: string;
  branchName: string;
  localDir: string;
  authenticator: RealmAuthenticator;
  dryRun?: boolean;
}): Promise<DeckSyncResult> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  if (options.dryRun && !workspace) {
    let pull = await pullDeckBranch({
      realmURL: options.realmURL,
      branchName: options.branchName,
      localDir: options.localDir,
      authenticator: options.authenticator,
      dryRun: true,
    });
    return {
      ...empty(pull.error),
      pulled: pull.files,
      localDeleted: pull.deleted,
      conflicts: pull.conflicts,
    };
  }
  if (options.dryRun && workspace) {
    let [local, remote] = await Promise.all([
      hashDeckWorkspaceDirectory(options.localDir),
      readDeckBranchSnapshot(
        workspace.realmURL,
        workspace.branchName,
        options.authenticator,
      ),
    ]);
    let plan = planContentAddressedSync({
      base: workspace.files,
      local,
      remote: remote.files,
    });
    return {
      pushed: plan.entries
        .filter(({ action, localHash }) => action === 'push' && localHash)
        .map(({ path }) => path),
      pulled: plan.entries
        .filter(({ action, remoteHash }) => action === 'pull' && remoteHash)
        .map(({ path }) => path),
      remoteDeleted: plan.entries
        .filter(({ action, localHash }) => action === 'push' && !localHash)
        .map(({ path }) => path),
      localDeleted: plan.entries
        .filter(({ action, remoteHash }) => action === 'pull' && !remoteHash)
        .map(({ path }) => path),
      conflicts: plan.conflicts.map(({ path }) => path),
      ...(plan.canPublish
        ? {}
        : { error: `${plan.conflicts.length} Deck content conflict(s)` }),
    };
  }
  let pull = await pullDeckBranch({
    realmURL: options.realmURL,
    branchName: workspace?.branchName ?? options.branchName,
    localDir: options.localDir,
    authenticator: options.authenticator,
  });
  if (pull.error) {
    return {
      ...empty(pull.error),
      conflicts: pull.conflicts,
    };
  }
  let push = await pushDeckBranch({
    realmURL: options.realmURL,
    localDir: options.localDir,
    authenticator: options.authenticator,
  });
  if (push.error) {
    return {
      ...empty(push.error),
      pulled: pull.files,
      localDeleted: pull.deleted,
    };
  }
  return {
    pushed: push.files,
    pulled: pull.files,
    remoteDeleted: push.deleted,
    localDeleted: pull.deleted,
    conflicts: [],
  };
}
