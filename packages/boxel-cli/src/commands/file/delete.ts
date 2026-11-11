import type { Command } from 'commander';
import type { ProfileManager } from '../../lib/profile-manager.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { isProtectedFile } from '../../lib/realm-sync-base.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export interface DeleteCommandOptions {
  profileManager?: ProfileManager;
  /** Pre-resolved realm secret seed for administrative (seed) auth. */
  realmSecretSeed?: string;
  /** @internal Test hook: supply an already-constructed authenticator. */
  authenticator?: RealmAuthenticator;
}

interface DeleteCliOptions {
  realm: string;
  json?: boolean;
  realmSecretSeed?: boolean;
}

/**
 * Delete a file from a realm.
 *
 * Sends an HTTP DELETE request for the given path within the realm. The realm
 * removes the file at exactly that path when one exists; only when none does
 * does it fall back to the path plus a source extension (`.gts`, `.json`, …).
 *
 * Auth is resolved via `resolveRealmAuthenticator`: a realm secret seed (when
 * supplied) mints a JWT locally as the realm-server bot, which may write to
 * any realm on that server; otherwise the active Matrix profile's per-realm
 * JWT is used.
 */
export async function deleteFile(
  realmUrl: string,
  path: string,
  options?: DeleteCommandOptions,
): Promise<DeleteResult> {
  if (isProtectedFile(path)) {
    return {
      ok: false,
      error: `Cannot delete protected file: ${path}`,
    };
  }

  let resolvedRealm = await resolveRealmIdentifier(realmUrl, {
    profileManager: options?.profileManager,
  });
  if (!resolvedRealm.ok) {
    return { ok: false, error: resolvedRealm.error };
  }
  realmUrl = resolvedRealm.url;
  let resolution = resolveRealmAuthenticator({
    realmUrl,
    realmSecretSeed: options?.realmSecretSeed,
    profileManager: options?.profileManager,
    authenticator: options?.authenticator,
  });
  if (!resolution.ok) {
    return { ok: false, error: resolution.error };
  }
  let authenticator = resolution.authenticator;

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  let response: Response;
  try {
    response = await authenticator.authedRealmFetch(url, {
      method: 'DELETE',
      headers: { Accept: SupportedMimeType.CardSource },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    let body = await response.text().catch(() => '(no body)');
    return {
      ok: false,
      error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  return { ok: true };
}

export function registerDeleteCommand(parent: Command): void {
  parent
    .command('delete')
    .description(
      'Delete a file from a realm. When no file exists at <path>, the realm deletes <path> plus the first of .js, .gjs, .ts, .gts, .json that exists instead, so deleting an extensionless path twice removes the card beside it.',
    )
    .argument('<path>', 'Realm-relative file path to delete')
    .requiredOption('--realm <realm-url>', 'The realm URL to delete from')
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED; names the paired Matrix server from MATRIX_SERVER_NAME)',
    )
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: DeleteCliOptions) => {
      let result: DeleteResult;
      try {
        let realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
        result = await deleteFile(opts.realm, filePath, { realmSecretSeed });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        console.log(`${DIM}Deleted:${RESET} ${filePath}`);
      } else {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
      }

      if (!result.ok) {
        process.exit(1);
      }
    });
}
