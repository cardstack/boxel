import type * as JSONTypes from 'json-typescript';

import {
  ensureFullMatrixUserId,
  ensureTrailingSlash,
  fetchRealmPermissions,
  fetchUserPermissions,
  type DBAdapter,
  type RealmPermissions,
} from './index.ts';

// Everything a run-command invocation needs to reach the prerenderer.
export interface PreparedRunCommand {
  // The runner's full matrix user id. Also the prerender page-pool affinity
  // value, so commands run by the same user share a tab.
  userId: string;
  // Per-realm JWT bundle covering every realm the runner can reach.
  auth: string;
  // Absolute module specifier of the command's exported class.
  command: string;
  commandInput: Record<string, unknown> | undefined;
}

export type PrepareRunCommandResult =
  | { ok: true; prepared: PreparedRunCommand }
  | {
      ok: false;
      error: string;
      // The rejected inputs, for a caller that logs structured context
      // alongside the message.
      context: { command: string; realmURL: string };
    };

/**
 * Resolves the permission gate, the prerender auth, and the command
 * specifier for one run-command invocation. Shared by the `/_run-command`
 * endpoint and the queued `run-command` job so both enforce the same gate
 * and accept the same command spellings.
 *
 * The auth bundle spans every realm the runner has permissions in, not just
 * the realm the command runs against: a card the command touches can link
 * across realms, and the Loader needs auth for each realm it fetches a
 * module from. The realm the command names is folded in explicitly because
 * the per-user enumeration omits published and archived realms, either of
 * which a command can legitimately be run against.
 */
export async function prepareRunCommand({
  dbAdapter,
  matrixURL,
  createPrerenderAuth,
  realmURL,
  runAs,
  command,
  commandInput,
}: {
  dbAdapter: DBAdapter;
  matrixURL: string;
  createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
  realmURL: string;
  runAs: string;
  command: string;
  commandInput?: JSONTypes.Object | null;
}): Promise<PrepareRunCommandResult> {
  let normalizedRealmURL = ensureTrailingSlash(realmURL);
  let context = { command, realmURL: normalizedRealmURL };
  let realmPermissions = await fetchRealmPermissions(
    dbAdapter,
    new URL(normalizedRealmURL),
  );
  let runAsUserId = ensureFullMatrixUserId(runAs, matrixURL);
  let userPermissions = realmPermissions[runAsUserId];
  if (!userPermissions || userPermissions.length === 0) {
    return {
      ok: false,
      error: `${runAs} does not have permissions in ${normalizedRealmURL}`,
      context,
    };
  }

  let allUserPermissions = await fetchUserPermissions(dbAdapter, {
    userId: runAsUserId,
  });
  allUserPermissions[normalizedRealmURL] = userPermissions;
  let auth = createPrerenderAuth(runAsUserId, allUserPermissions);
  let accessibleRealms = Object.keys(allUserPermissions);

  let normalizedCommand = normalizeCommandSpecifier(
    command,
    normalizedRealmURL,
  );
  if (!normalizedCommand) {
    return {
      ok: false,
      error: `invalid command specifier: ${command}`,
      context,
    };
  }

  return {
    ok: true,
    prepared: {
      userId: runAsUserId,
      auth,
      command: normalizedCommand,
      // `accessibleRealms` lets a command discover which realms it may read
      // without re-deriving the permission set itself.
      commandInput: commandInput
        ? { ...commandInput, accessibleRealms }
        : undefined,
    },
  };
}

function normalizeCommandSpecifier(
  command: string,
  realmURL: string,
): string | undefined {
  let specifier = command.trim();
  if (!specifier) {
    return undefined;
  }

  // Bot command URLs address a command as `/commands/<name>/<export>` on the
  // realm server host, which names a command in the target realm — resolve
  // those against that realm. Every other spelling is already a module
  // specifier the host can resolve as-is.
  let path = toPathname(specifier);
  if (!path || !path.startsWith('/commands/')) {
    return specifier;
  }

  let [commandName, exportName = 'default'] = path
    .slice('/commands/'.length)
    .split('/');
  if (!commandName) {
    return undefined;
  }
  return `${ensureTrailingSlash(realmURL)}commands/${commandName}/${exportName || 'default'}`;
}

function toPathname(commandSpecifier: string): string | undefined {
  try {
    return new URL(commandSpecifier).pathname;
  } catch {
    return undefined;
  }
}
