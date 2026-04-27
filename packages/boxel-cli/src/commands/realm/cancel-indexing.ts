import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors';

export interface CancelIndexingCommandOptions {
  profileManager?: ProfileManager;
}

export interface CancelIndexingResult {
  ok: boolean;
  error?: string;
}

interface CancelIndexingCliOptions {
  realm: string;
  json?: boolean;
}

/**
 * Cancel all indexing jobs (running + pending) for a realm.
 * Sends a POST to `<realmUrl>/_cancel-indexing-job` with `{ cancelPending: true }`.
 */
export async function cancelIndexing(
  realmUrl: string,
  options?: CancelIndexingCommandOptions,
): Promise<CancelIndexingResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ok: false,
      error: NO_ACTIVE_PROFILE_ERROR,
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
      let body = await response.text().catch(() => '(no body)');
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

export function registerCancelIndexingCommand(realm: Command): void {
  realm
    .command('cancel-indexing')
    .description('Cancel all indexing jobs (running + pending) for a realm')
    .requiredOption(
      '--realm <realm-url>',
      'URL of the realm to cancel indexing for',
    )
    .option('--json', 'Output raw JSON response')
    .action(async (opts: CancelIndexingCliOptions) => {
      let result = await cancelIndexing(opts.realm);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) {
          process.exit(1);
        }
      } else if (result.ok) {
        console.log(
          `${FG_GREEN}Cancelled indexing jobs for ${opts.realm}${RESET}`,
        );
      } else {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }
    });
}
