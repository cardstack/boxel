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
  /** True only when both server delete and Matrix unlink completed. */
  removed: boolean;
  /** True when DELETE /_delete-realm returned 204. */
  serverDeleted: boolean;
  /** True when Matrix `app.boxel.realms` was rewritten without the URL. */
  unlinked: boolean;
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
 * Remove a realm: delete server-side files / index / registry via
 * `DELETE /_delete-realm`, then unlink the URL from the active profile's
 * `app.boxel.realms` Matrix account_data list. Mirrors the host UI's
 * workspace delete flow and inverts `boxel realm create`.
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
      serverDeleted: false,
      unlinked: false,
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
      serverDeleted: false,
      unlinked: false,
      previousCount: 0,
      nextCount: 0,
      error: `Failed to load realm list: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  let normalized = existing.map(ensureTrailingSlash);
  let previousCount = normalized.length;
  let matchCount = normalized.filter((u) => u === realmUrl).length;

  if (matchCount === 0) {
    return {
      realmUrl,
      removed: false,
      serverDeleted: false,
      unlinked: false,
      previousCount,
      nextCount: previousCount,
      notInList: true,
      error: 'Realm is not in app.boxel.realms. Nothing to remove.',
    };
  }

  let nextCount = previousCount - matchCount;

  if (options.dryRun) {
    return {
      realmUrl,
      removed: false,
      serverDeleted: false,
      unlinked: false,
      previousCount,
      nextCount,
    };
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
  let response: Response;
  try {
    response = await pm.authedRealmServerFetch(
      `${realmServerUrl}/_delete-realm`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'realm', id: realmUrl },
        }),
      },
    );
  } catch (err) {
    return {
      realmUrl,
      removed: false,
      serverDeleted: false,
      unlinked: false,
      previousCount,
      nextCount: previousCount,
      error: `Failed to reach realm server: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!response.ok) {
    let body = await safeReadResponseText(response);
    let error =
      response.status === 403
        ? `You do not own this realm and cannot delete it on the server. Server returned 403: ${body}`
        : `Realm server returned ${response.status}: ${body}`;
    return {
      realmUrl,
      removed: false,
      serverDeleted: false,
      unlinked: false,
      previousCount,
      nextCount: previousCount,
      error,
    };
  }

  let unlinked: boolean;
  try {
    unlinked = await pm.removeFromUserRealms(realmUrl);
  } catch (err) {
    return {
      realmUrl,
      removed: false,
      serverDeleted: true,
      unlinked: false,
      previousCount,
      nextCount: previousCount,
      error: `Server delete succeeded, but Matrix unlink failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!unlinked) {
    return {
      realmUrl,
      removed: false,
      serverDeleted: true,
      unlinked: false,
      previousCount,
      nextCount: previousCount,
      error:
        'Server delete succeeded, but Matrix account_data did not contain the URL by the time we PUT (concurrent edit?). Server-side files are gone; please refresh and check your realm list.',
    };
  }

  return {
    realmUrl,
    removed: true,
    serverDeleted: true,
    unlinked,
    previousCount,
    nextCount,
  };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no response body>';
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
      'Remove a realm — deletes server-side files and unlinks it from your realm list',
    )
    .argument('<realm-url>', 'realm URL to remove')
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

      console.log(`Remove target: ${FG_CYAN}${preview.realmUrl}${RESET}`);
      console.log(
        `${DIM}app.boxel.realms: ${preview.previousCount} -> ${preview.nextCount}${RESET}`,
      );

      if (opts.dryRun) {
        console.log(
          `${DIM}[DRY RUN] No server delete or Matrix changes sent.${RESET}`,
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
          'This will permanently delete the realm files, indexer state, and registry entry on the server. Proceed? (y/N) ',
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
        if (result.serverDeleted && !result.unlinked) {
          console.error(
            `${DIM}The realm is gone, but your account_data still references ${result.realmUrl}.${RESET}`,
          );
        }
        process.exit(1);
      }

      console.log(
        `${FG_GREEN}Removed:${RESET} ${FG_CYAN}${result.realmUrl}${RESET}`,
      );
    });
}
