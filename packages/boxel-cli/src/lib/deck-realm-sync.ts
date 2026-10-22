import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  hashDeckWorkspaceDirectory,
  loadDeckWorkspaceState,
  planContentAddressedSync,
  saveDeckWorkspaceState,
  inventoryTreeHash,
  workspaceStateFromBranch,
  type DeckBranchSnapshot,
} from './deck-workspace-state.ts';
import { pullDeckBranch } from './deck-realm-pull.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import {
  DeckPathConflictError,
  publishDeckBranchUpdate,
  readDeckBranchSnapshot,
  readDeckTreeFile,
} from './realm-sync-mode.ts';

export const DECK_BRANCH_UPDATE_SPEC = 'boxel-deck-branch-update-v2';

// The realm's main is one HEAD that every boxel-cli user and the Boxel host
// write to, as before Deck. Sync keeps mtime sync's semantics, on content
// hashes instead of mtimes: a file changed on one side moves to the other, a
// file changed on both sides is a conflict that is skipped and reported, and
// --prefer-local or --prefer-remote resolves conflicts. There is no force
// push and no branching: a pushed file names the content it was based on,
// and the realm refuses it if that file moved since.
export type DeckConflictStrategy = 'prefer-local' | 'prefer-remote';

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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A realm that changes a file between the read and the push is caught by the
// file's base; the sync then reads again. Past this many rounds the paths are
// reported as conflicts.
const MAX_ROUNDS = 3;

interface Step {
  path: string;
  // What lands where: push sends local bytes (or a delete), pull writes
  // remote bytes (or deletes the local file).
  kind: 'push' | 'pull';
  hash?: string;
  // For a push, the content the change was made against.
  base?: string;
}

export async function reconcileDeckBranch(options: {
  realmURL: string;
  branchName: string;
  localDir: string;
  authenticator: RealmAuthenticator;
  direction: 'both' | 'push';
  strategy?: DeckConflictStrategy;
  dryRun?: boolean;
}): Promise<DeckSyncResult> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  let requestedRealmURL =
    new URL(options.realmURL).href.replace(/\/+$/, '') + '/';
  if (workspace && workspace.realmURL !== requestedRealmURL) {
    return empty(
      `Workspace tracks ${workspace.realmURL}, not ${options.realmURL}`,
    );
  }
  let pulled: string[] = [];
  let localDeleted: string[] = [];
  for (let round = 1; ; round++) {
    let [snapshot, local] = await Promise.all([
      readDeckBranchSnapshot(
        options.realmURL,
        workspace?.branchName ?? options.branchName,
        options.authenticator,
      ),
      hashDeckWorkspaceDirectory(options.localDir),
    ]);
    if (
      workspace &&
      (workspace.realmRRI !== snapshot.realmRRI ||
        workspace.branchId !== snapshot.branchId)
    ) {
      return empty(
        `Workspace tracks ${workspace.branchId}, not ${snapshot.branchId}`,
      );
    }
    let base = workspace?.files ?? {};
    let plan = planContentAddressedSync({
      base,
      local,
      remote: snapshot.files,
    });
    let steps: Step[] = [];
    let conflicts: string[] = [];
    let canPull = options.direction === 'both';
    for (let entry of plan.entries) {
      let { path, baseHash, localHash, remoteHash } = entry;
      let action = entry.action;
      if (action === 'conflict') {
        if (options.strategy === 'prefer-local') {
          // Based on what the realm holds now, so it applies.
          steps.push({ path, kind: 'push', hash: localHash, base: remoteHash });
        } else if (options.strategy === 'prefer-remote' && canPull) {
          steps.push({ path, kind: 'pull', hash: remoteHash });
        } else {
          conflicts.push(path);
        }
      } else if (action === 'push') {
        steps.push({ path, kind: 'push', hash: localHash, base: baseHash });
      } else if (action === 'pull' && canPull) {
        steps.push({ path, kind: 'pull', hash: remoteHash });
      }
    }
    let pulls = steps.filter((step) => step.kind === 'pull');
    let pushes = steps.filter((step) => step.kind === 'push');
    if (options.dryRun) {
      return {
        pushed: pushes.filter(({ hash }) => hash).map(({ path }) => path),
        pulled: pulls.filter(({ hash }) => hash).map(({ path }) => path),
        remoteDeleted: pushes
          .filter(({ hash }) => !hash)
          .map(({ path }) => path),
        localDeleted: pulls.filter(({ hash }) => !hash).map(({ path }) => path),
        conflicts,
      };
    }

    // The new base: each path at the content both sides now agree on. A
    // path left alone keeps its old base, so its change still shows next
    // time; a pushed path takes its new base only once the realm accepts it.
    let nextBase: Record<string, string> = {};
    for (let entry of plan.entries) {
      if (entry.action === 'noop' && entry.localHash) {
        nextBase[entry.path] = entry.localHash;
      } else if (entry.action !== 'noop' && entry.baseHash) {
        nextBase[entry.path] = entry.baseHash;
      }
    }

    await applyPulls(options, snapshot, pulls);
    for (let { path, hash } of pulls) {
      if (hash) {
        nextBase[path] = hash;
        pulled.push(path);
      } else {
        delete nextBase[path];
        localDeleted.push(path);
      }
    }
    let observed: DeckBranchSnapshot = snapshot;
    if (pushes.length > 0) {
      try {
        observed = await publishPushes(options, snapshot, pushes);
      } catch (error) {
        await saveState(options, observed, nextBase);
        workspace = await loadDeckWorkspaceState(options.localDir);
        if (error instanceof DeckPathConflictError && round < MAX_ROUNDS) {
          continue;
        }
        if (error instanceof DeckPathConflictError) {
          return {
            ...empty(),
            pulled: pulled.sort(),
            localDeleted: localDeleted.sort(),
            conflicts: [...conflicts, ...error.paths].sort(),
          };
        }
        return {
          ...empty(describe(error)),
          pulled: pulled.sort(),
          localDeleted: localDeleted.sort(),
          conflicts,
        };
      }
      for (let { path, hash } of pushes) {
        if (hash) nextBase[path] = hash;
        else delete nextBase[path];
      }
    }
    await saveState(options, observed, nextBase);
    return {
      pushed: pushes
        .filter(({ hash }) => hash)
        .map(({ path }) => path)
        .sort(),
      pulled: pulled.sort(),
      remoteDeleted: pushes
        .filter(({ hash }) => !hash)
        .map(({ path }) => path)
        .sort(),
      localDeleted: localDeleted.sort(),
      conflicts: conflicts.sort(),
    };
  }
}

async function applyPulls(
  options: {
    realmURL: string;
    localDir: string;
    authenticator: RealmAuthenticator;
  },
  snapshot: DeckBranchSnapshot,
  pulls: Step[],
): Promise<void> {
  let downloaded = await Promise.all(
    pulls
      .filter(({ hash }) => hash)
      .map(async ({ path, hash }) => ({
        path,
        bytes: await readDeckTreeFile({
          realmURL: options.realmURL,
          treeHash: snapshot.treeHash,
          path,
          expectedHash: hash!,
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
    pulls
      .filter(({ hash }) => !hash)
      .map(({ path }) => rm(join(options.localDir, path), { force: true })),
  );
}

async function publishPushes(
  options: {
    realmURL: string;
    localDir: string;
    authenticator: RealmAuthenticator;
  },
  snapshot: DeckBranchSnapshot,
  pushes: Step[],
): Promise<DeckBranchSnapshot> {
  let operations = await Promise.all(
    pushes.map(async ({ path, hash, base }) =>
      hash
        ? {
            path,
            sha256: hash,
            contentBase64: (
              await readFile(join(options.localDir, path))
            ).toString('base64'),
            base: base ?? null,
          }
        : { path, sha256: null, base: base ?? null },
    ),
  );
  let paths = pushes.map(({ path }) => path).sort();
  let preview = paths.slice(0, 3).join(', ');
  let extra = paths.length > 3 ? ` (+${paths.length - 3} more)` : '';
  return publishDeckBranchUpdate({
    realmURL: options.realmURL,
    branchName: snapshot.branchName,
    authenticator: options.authenticator,
    body: {
      schema: DECK_BRANCH_UPDATE_SPEC,
      message: `save: ${preview}${extra}`,
      // Informational: a per-file update does not need the whole branch to
      // be where this workspace last saw it.
      expected: {
        repositoryHash: snapshot.repositoryHash,
        treeHash: snapshot.treeHash,
        lockHash: snapshot.lockHash,
        refGeneration: snapshot.refGeneration,
      },
      operations,
    },
  });
}

// The workspace base is per file, so it can differ from the tree the realm
// served: a skipped conflict keeps its old base. The base tree hash names the
// base inventory itself; the observed head names where the realm was.
async function saveState(
  options: { realmURL: string; localDir: string },
  observed: DeckBranchSnapshot,
  files: Record<string, string>,
): Promise<void> {
  await saveDeckWorkspaceState(
    options.localDir,
    workspaceStateFromBranch(options.realmURL, {
      ...observed,
      treeHash: inventoryTreeHash(files),
      files,
    }),
  );
}

export async function syncDeckBranch(options: {
  realmURL: string;
  branchName: string;
  localDir: string;
  authenticator: RealmAuthenticator;
  strategy?: DeckConflictStrategy;
  dryRun?: boolean;
}): Promise<DeckSyncResult> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  if (!workspace) {
    // A first sync is a pull: nothing local is tracked yet.
    let pull = await pullDeckBranch({
      realmURL: options.realmURL,
      branchName: options.branchName,
      localDir: options.localDir,
      authenticator: options.authenticator,
      dryRun: options.dryRun,
    });
    if (pull.error || options.dryRun) {
      return {
        ...empty(pull.error),
        pulled: pull.files,
        localDeleted: pull.deleted,
        conflicts: pull.conflicts,
      };
    }
  }
  return reconcileDeckBranch({ ...options, direction: 'both' });
}
