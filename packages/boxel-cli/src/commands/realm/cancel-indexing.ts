import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors';

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export interface CancelIndexingCommandOptions {
  profileManager?: ProfileManager;
}

export interface CancelIndexingResult {
  ok: boolean;
  error?: string;
}

export function registerCancelIndexingCommand(realm: Command): void {
  realm
    .command('cancel-indexing')
    .description('Cancel all indexing jobs (running + pending) for a realm')
    .requiredOption('--realm <realm-url>', 'URL of the realm to cancel indexing for')
    .action(async (options: { realm: string }) => {
      let result = await cancelIndexing(options.realm);
      if (result.ok) {
        console.log(
          `${FG_GREEN}Cancelled indexing jobs for ${options.realm}${RESET}`,
        );
      } else {
        console.error(
          `${FG_RED}Error: ${result.error}${RESET}`,
        );
        process.exit(1);
      }
    });
}

/**
 * Cancel all indexing jobs (running + pending) for a realm.
 * Sends a POST to `<realmUrl>/_cancel-indexing-job` with `{ cancelPending: true }`.
 */
export async function cancelIndexing(
  realmUrl: string,
  options: CancelIndexingCommandOptions = {},
): Promise<CancelIndexingResult> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: 'No active profile. Run `boxel profile add` to create one.',
    };
  }

  let cancelUrl = `${ensureTrailingSlash(realmUrl)}_cancel-indexing-job`;

  try {
    let response = await pm.authedRealmFetch(cancelUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cancelPending: true }),
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
