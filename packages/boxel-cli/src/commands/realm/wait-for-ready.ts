import type { Command } from 'commander';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors';

export interface WaitForReadyCommandOptions {
  timeoutMs?: number;
  profileManager?: ProfileManager;
}

export interface WaitForReadyResult {
  ready: boolean;
  error?: string;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Poll `_readiness-check` until the realm is ready or the timeout is reached.
 *
 * Suitable for both CLI and programmatic use — no console output or
 * process.exit. The CLI wrapper (`registerWaitForReadyCommand`) handles
 * formatting and exit codes.
 */
export async function waitForReady(
  realmUrl: string,
  options: WaitForReadyCommandOptions = {},
): Promise<WaitForReadyResult> {
  let timeoutMs = options.timeoutMs ?? 30_000;
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let readinessUrl = `${ensureTrailingSlash(realmUrl)}_readiness-check`;
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await pm.authedRealmFetch(readinessUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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

interface WaitForReadyCliOptions {
  realm: string;
  timeout?: string;
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
        console.error(`${FG_RED}${result.error ?? 'Realm not ready'}${RESET}`);
        process.exit(1);
      }
    });
}
