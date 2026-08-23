import type { Command } from 'commander';

import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import {
  createDeckRealmBranch,
  listDeckRealmBranches,
  switchDeckRealmBranch,
} from '../../lib/deck-realm-branches.ts';
import { loadDeckWorkspaceState } from '../../lib/deck-workspace-state.ts';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { detectRealmSyncMode } from '../../lib/realm-sync-mode.ts';

interface BranchAuthOptions {
  profileManager?: ProfileManager;
  realmSecretSeed?: string;
  authenticator?: RealmAuthenticator;
}

function resolveRealmURL(realm: string, options: BranchAuthOptions): string {
  let resolved = resolveRealmIdentifier(realm, {
    profileManager: options.profileManager,
  });
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.url;
}

function authenticatorFor(
  realmURL: string,
  options: BranchAuthOptions,
): RealmAuthenticator {
  let resolution = resolveRealmAuthenticator({
    realmUrl: realmURL,
    realmSecretSeed: options.realmSecretSeed,
    profileManager: options.profileManager,
    authenticator: options.authenticator,
  });
  if (!resolution.ok) throw new Error(resolution.error);
  return resolution.authenticator;
}

async function requireDeck(
  realmURL: string,
  authenticator: RealmAuthenticator,
): Promise<void> {
  let mode = await detectRealmSyncMode(realmURL, authenticator);
  if (mode.mode !== 'deck') {
    throw new Error(
      'This Realm uses legacy mtime sync and has no Deck branches',
    );
  }
}

export async function listRealmBranches(
  realm: string,
  options: BranchAuthOptions = {},
) {
  let realmURL = resolveRealmURL(realm, options);
  let authenticator = authenticatorFor(realmURL, options);
  await requireDeck(realmURL, authenticator);
  return listDeckRealmBranches({ realmURL, authenticator });
}

export async function createRealmBranch(
  realm: string,
  branchName: string,
  options: BranchAuthOptions & { from?: string } = {},
) {
  let realmURL = resolveRealmURL(realm, options);
  let authenticator = authenticatorFor(realmURL, options);
  await requireDeck(realmURL, authenticator);
  return createDeckRealmBranch({
    realmURL,
    branchName,
    fromBranch: options.from,
    authenticator,
  });
}

export async function switchRealmBranch(
  localDir: string,
  branchName: string,
  options: BranchAuthOptions = {},
) {
  let workspace = await loadDeckWorkspaceState(localDir);
  if (!workspace) {
    throw new Error(
      'Deck branch switch requires an existing .boxel-sync.json workspace',
    );
  }
  let realmURL = resolveRealmURL(workspace.realmURL, options);
  let authenticator = authenticatorFor(realmURL, options);
  await requireDeck(realmURL, authenticator);
  return switchDeckRealmBranch({
    localDir,
    branchName,
    authenticator,
  });
}

export function registerBranchCommand(realm: Command): void {
  let branch = realm
    .command('branch')
    .description('List, create, and switch Deck branches for a Realm');

  branch
    .command('list')
    .argument('<realm-url>', 'Realm URL or configured Realm name')
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(
      async (
        realmURL: string,
        options: { json?: boolean; realmSecretSeed?: boolean },
      ) => {
        let result = await listRealmBranches(realmURL, {
          realmSecretSeed: await resolveRealmSecretSeed(
            options.realmSecretSeed === true,
          ),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        for (let item of result.branches) {
          console.log(
            `${item.branchName}\t${item.refGeneration}\t${item.historyHead}`,
          );
        }
      },
    );

  branch
    .command('create')
    .argument('<realm-url>', 'Realm URL or configured Realm name')
    .argument('<branch-name>', 'New branch name, such as ana/button-tone')
    .option('--from <branch>', 'Source branch', 'main')
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(
      async (
        realmURL: string,
        branchName: string,
        options: { from?: string; json?: boolean; realmSecretSeed?: boolean },
      ) => {
        let result = await createRealmBranch(realmURL, branchName, {
          from: options.from,
          realmSecretSeed: await resolveRealmSecretSeed(
            options.realmSecretSeed === true,
          ),
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `Created ${result.branchName} from ${result.fromBranch} at ${result.historyHead}`,
        );
      },
    );

  branch
    .command('switch')
    .argument('<local-dir>', 'Existing Deck workspace')
    .argument('<branch-name>', 'Branch to materialize')
    .option('--json', 'Print structured JSON')
    .option('--realm-secret-seed', 'Authenticate with the Realm secret seed')
    .action(
      async (
        localDir: string,
        branchName: string,
        options: { json?: boolean; realmSecretSeed?: boolean },
      ) => {
        let result = await switchRealmBranch(localDir, branchName, {
          realmSecretSeed: await resolveRealmSecretSeed(
            options.realmSecretSeed === true,
          ),
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `Switched to ${result.snapshot.branchName}: ${result.written.length} written, ${result.deleted.length} deleted`,
        );
      },
    );
}
