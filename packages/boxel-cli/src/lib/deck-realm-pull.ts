import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  hashDeckWorkspaceDirectory,
  loadDeckWorkspaceState,
  planContentAddressedSync,
  saveDeckWorkspaceState,
  workspaceStateFromBranch,
} from './deck-workspace-state.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { readDeckBranchSnapshot, readDeckTreeFile } from './realm-sync-mode.ts';

export interface DeckPullResult {
  files: string[];
  deleted: string[];
  conflicts: string[];
  error?: string;
}

export async function pullDeckBranch(options: {
  realmURL: string;
  branchName: string;
  localDir: string;
  authenticator: RealmAuthenticator;
  dryRun?: boolean;
}): Promise<DeckPullResult> {
  let [snapshot, existingState, local] = await Promise.all([
    readDeckBranchSnapshot(
      options.realmURL,
      options.branchName,
      options.authenticator,
    ),
    loadDeckWorkspaceState(options.localDir),
    hashDeckWorkspaceDirectory(options.localDir),
  ]);
  if (
    existingState &&
    (existingState.realmRRI !== snapshot.realmRRI ||
      existingState.branchId !== snapshot.branchId)
  ) {
    return {
      files: [],
      deleted: [],
      conflicts: [],
      error: `Workspace tracks ${existingState.branchId}, not ${snapshot.branchId}`,
    };
  }
  let plan = planContentAddressedSync({
    base: existingState?.files ?? {},
    local,
    remote: snapshot.files,
  });
  if (!plan.canPublish) {
    return {
      files: [],
      deleted: [],
      conflicts: plan.conflicts.map(({ path }) => path),
      error: `Pull has ${plan.conflicts.length} content conflict(s); local files were not changed`,
    };
  }
  let pulled = plan.entries.filter(
    ({ action, remoteHash }) => action === 'pull' && remoteHash,
  );
  let deleted = plan.entries.filter(
    ({ action, remoteHash }) => action === 'pull' && !remoteHash,
  );
  if (!options.dryRun) {
    let downloaded = await Promise.all(
      pulled.map(async ({ path, remoteHash }) => ({
        path,
        bytes: await readDeckTreeFile({
          realmURL: options.realmURL,
          treeHash: snapshot.treeHash,
          path,
          expectedHash: remoteHash!,
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
      deleted.map(({ path }) =>
        rm(join(options.localDir, path), { force: true }),
      ),
    );
    await saveDeckWorkspaceState(
      options.localDir,
      workspaceStateFromBranch(options.realmURL, snapshot),
    );
  }
  return {
    files: pulled.map(({ path }) => path).sort(),
    deleted: deleted.map(({ path }) => path).sort(),
    conflicts: [],
  };
}
