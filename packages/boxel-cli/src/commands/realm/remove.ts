import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { prompt } from '../../lib/prompt';
import { DIM, FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors';

export interface RemoveRealmOptions {
  realmUrl: string;
  dryRun?: boolean;
  profileManager?: ProfileManager;
}

export interface RemoveRealmResult {
  /** Normalized URL the operation targeted (always trailing-slashed). */
  realmUrl: string;
  /** True when account_data was modified. False for dry-run or not-in-list. */
  removed: boolean;
  /** Number of entries before the change. */
  previousCount: number;
  /** Number of entries the next list would contain (computed even on dry-run). */
  nextCount: number;
  /**
   * True when the URL was not present in `app.boxel.realms`. Mutually
   * exclusive with a successful real removal.
   */
  notInList?: boolean;
  error?: string;
}

/**
 * Soft-remove a realm URL from the active profile's `app.boxel.realms`
 * Matrix account_data list. Server-side files are untouched.
 *
 * Programmatic API. Returns a result object on every code path; never
 * prompts and never calls `process.exit`. The CLI wraps this with a TTY
 * confirmation step (see `registerRemoveCommand`).
 */
export async function removeRealm(
  options: RemoveRealmOptions,
): Promise<RemoveRealmResult> {
  let realmUrl = ensureTrailingSlash(options.realmUrl.trim());
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      realmUrl,
      removed: false,
      previousCount: 0,
      nextCount: 0,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let existing: string[];
  try {
    existing = await pm.getUserRealms();
  } catch (err) {
    return {
      realmUrl,
      removed: false,
      previousCount: 0,
      nextCount: 0,
      error: `Failed to load realm list: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  let normalized = existing.map(ensureTrailingSlash);
  let previousCount = normalized.length;

  if (!normalized.includes(realmUrl)) {
    return {
      realmUrl,
      removed: false,
      previousCount,
      nextCount: previousCount,
      notInList: true,
      error: 'Realm is not in app.boxel.realms. Nothing to remove.',
    };
  }

  let nextCount = previousCount - 1;

  if (options.dryRun) {
    return { realmUrl, removed: false, previousCount, nextCount };
  }

  try {
    let removed = await pm.removeFromUserRealms(realmUrl);
    return { realmUrl, removed, previousCount, nextCount };
  } catch (err) {
    return {
      realmUrl,
      removed: false,
      previousCount,
      nextCount: previousCount,
      error: `Failed to update Matrix account data: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

interface RemoveCliOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export function registerRemoveCommand(realm: Command): void {
  realm
    .command('remove')
    .description(
      "Soft-remove a realm from the active profile's UI realm list (does not delete server files)",
    )
    .argument('<realm-url>', 'realm URL to remove from app.boxel.realms')
    .option('-y, --yes', 'Skip the interactive confirmation prompt')
    .option('--dry-run', 'Preview the change without writing to Matrix')
    .action(async (realmUrlInput: string, opts: RemoveCliOptions) => {
      let normalized = ensureTrailingSlash(realmUrlInput.trim());

      let preview = await removeRealm({
        realmUrl: normalized,
        dryRun: true,
      });

      if (preview.error && !preview.notInList) {
        console.error(`${FG_RED}Error:${RESET} ${preview.error}`);
        process.exit(1);
      }

      if (preview.notInList) {
        console.error(`${FG_RED}Error:${RESET} ${preview.error}`);
        process.exit(1);
      }

      console.log(`Soft remove target: ${FG_CYAN}${preview.realmUrl}${RESET}`);
      console.log(
        `${DIM}app.boxel.realms: ${preview.previousCount} -> ${preview.nextCount}${RESET}`,
      );

      if (opts.dryRun) {
        console.log(
          `${DIM}[DRY RUN] No Matrix account data changes sent.${RESET}`,
        );
        return;
      }

      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          console.error(
            `${FG_RED}Error:${RESET} stdin is not a TTY. Pass --yes to confirm in non-interactive mode.`,
          );
          process.exit(1);
        }
        let answer = await prompt(
          'Proceed with soft remove from your realm list? (y/N) ',
        );
        if (!/^y/i.test(answer)) {
          console.log(`${DIM}Cancelled.${RESET}`);
          return;
        }
      }

      let result = await removeRealm({ realmUrl: normalized });
      if (result.error || !result.removed) {
        console.error(
          `${FG_RED}Error:${RESET} ${result.error ?? 'Removal did not complete.'}`,
        );
        process.exit(1);
      }

      console.log(
        `${FG_GREEN}Removed:${RESET} ${FG_CYAN}${result.realmUrl}${RESET}`,
      );
      console.log(
        `${DIM}Note: server files are not deleted by this command.${RESET}`,
      );
    });
}
