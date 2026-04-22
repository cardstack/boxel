import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_RED, DIM, RESET } from '../../lib/colors';

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

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
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
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  let response: Response;
  try {
    response = await pm.authedRealmFetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/vnd.card+source' },
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
        console.log(JSON.stringify(result, null, 2));
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
