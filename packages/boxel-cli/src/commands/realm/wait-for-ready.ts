import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors';

export interface WaitForReadyResult {
  ready: boolean;
  error?: string;
}

export interface WaitForReadyCommandOptions {
  timeoutMs?: number;
  profileManager?: ProfileManager;
}

interface WaitForReadyCliOptions {
  realm: string;
  timeout?: string;
}

/**
 * Poll a realm's `_readiness-check` endpoint until it responds OK or the
 * timeout is reached.
 *
 * Uses the per-realm JWT via `ProfileManager.authedRealmFetch`.
 */
export async function waitForReady(
  realmUrl: string,
  options: WaitForReadyCommandOptions = {},
): Promise<WaitForReadyResult> {
  let timeoutMs = options.timeoutMs ?? 30_000;
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ready: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let readinessUrl = `${ensureTrailingSlash(realmUrl)}_readiness-check`;
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await pm.authedRealmFetch(readinessUrl, {
        method: 'GET',
        headers: { Accept: SupportedMimeType.RealmInfo },
      });
      if (response.ok) {
        return { ready: true };
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    ready: false,
    error: `Realm not ready after ${timeoutMs}ms: ${readinessUrl}`,
  };
}

export function registerWaitForReadyCommand(realm: Command): void {
  realm
    .command('wait-for-ready')
    .description(
      'Poll a realm readiness-check endpoint until it responds OK or the timeout is reached',
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to check')
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 30000)')
    .action(async (opts: WaitForReadyCliOptions) => {
      let timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : undefined;

      let result: WaitForReadyResult;
      try {
        result = await waitForReady(opts.realm, { timeoutMs });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (result.ready) {
        console.log(`${FG_GREEN}Realm is ready.${RESET}`);
      } else {
        console.error(
          `${FG_RED}Error:${RESET} ${result.error ?? 'Realm not ready'}`,
        );
        process.exit(1);
      }
    });
}
