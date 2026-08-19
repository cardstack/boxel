import { InvalidArgumentError, type Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';
import { resolveRealmIdentifier } from '../../lib/resolve-realm-identifier.ts';

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
  timeout?: number;
}

function parseTimeoutOption(value: string): number {
  let n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value.trim()) {
    throw new InvalidArgumentError(
      '--timeout must be a non-negative integer (milliseconds).',
    );
  }
  return n;
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
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return {
      ready: false,
      error: `Invalid timeoutMs: must be a finite, non-negative number (got ${options.timeoutMs}).`,
    };
  }
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      ready: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let resolvedRealm = resolveRealmIdentifier(realmUrl, { profileManager: pm });
  if (!resolvedRealm.ok) {
    return { ready: false, error: resolvedRealm.error };
  }
  realmUrl = resolvedRealm.url;

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
    let remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(1000, remaining)));
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
    .option(
      '--timeout <ms>',
      'Timeout in milliseconds (default: 30000)',
      parseTimeoutOption,
    )
    .action(async (opts: WaitForReadyCliOptions) => {
      let result: WaitForReadyResult;
      try {
        result = await waitForReady(opts.realm, { timeoutMs: opts.timeout });
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
