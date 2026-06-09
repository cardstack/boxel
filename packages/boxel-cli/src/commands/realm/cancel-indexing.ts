import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';
import { cliLog } from '../../lib/cli-log.ts';

export interface CancelIndexingCommandOptions {
  profileManager?: ProfileManager;
  /** Also cancel queued/pending jobs. Defaults to false (running-only). */
  cancelPending?: boolean;
}

export interface CancelIndexingResult {
  ok: boolean;
  error?: string;
}

interface CancelIndexingCliOptions {
  realm: string;
  cancelPending?: boolean;
  json?: boolean;
}

/**
 * Cancel indexing jobs for a realm.
 *
 * Sends a POST to `<realmUrl>/_cancel-indexing-job` with `{ cancelPending }`.
 * By default cancels only running jobs; pass `cancelPending: true` to also
 * cancel queued/pending jobs.
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

  let cancelPending = options?.cancelPending ?? false;
  let cancelUrl = `${ensureTrailingSlash(realmUrl)}_cancel-indexing-job`;

  try {
    let response = await pm.authedRealmFetch(cancelUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cancelPending }),
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
    .description(
      'Cancel running indexing jobs for a realm (use --cancel-pending to also cancel queued jobs)',
    )
    .requiredOption(
      '--realm <realm-url>',
      'URL of the realm to cancel indexing for',
    )
    .option(
      '--cancel-pending',
      'Also cancel queued/pending indexing jobs (default: cancel running only)',
    )
    .option('--json', 'Output raw JSON response')
    .action(async (opts: CancelIndexingCliOptions) => {
      let result = await cancelIndexing(opts.realm, {
        cancelPending: opts.cancelPending,
      });

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (!result.ok) {
          process.exit(1);
        }
      } else if (result.ok) {
        let scope = opts.cancelPending ? 'running and pending' : 'running';
        console.log(
          `${FG_GREEN}Cancelled ${scope} indexing jobs for ${opts.realm}${RESET}`,
        );
      } else {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }
    });
}
