import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { isProtectedFile } from '../../lib/realm-sync-base.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export interface DeleteCommandOptions {
  profileManager?: ProfileManager;
}

interface DeleteCliOptions {
  realm: string;
  json?: boolean;
}

/**
 * Delete a file from a realm.
 *
 * Sends an HTTP DELETE request for the given path within the realm.
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function deleteFile(
  realmUrl: string,
  path: string,
  options?: DeleteCommandOptions,
): Promise<DeleteResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  if (isProtectedFile(path)) {
    return {
      ok: false,
      error: `Cannot delete protected file: ${path}`,
    };
  }

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  let response: Response;
  try {
    response = await pm.authedRealmFetch(url, {
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
    .description('Delete a file from a realm')
    .argument('<path>', 'Realm-relative file path to delete')
    .requiredOption('--realm <realm-url>', 'The realm URL to delete from')
    .option('--json', 'Output raw JSON response')
    .action(async (filePath: string, opts: DeleteCliOptions) => {
      let result: DeleteResult;
      try {
        result = await deleteFile(opts.realm, filePath);
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
