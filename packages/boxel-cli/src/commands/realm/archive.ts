import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { prompt } from '../../lib/prompt.ts';
import { DIM, FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';

export interface ArchiveRealmOptions {
  realmUrl: string;
  profileManager?: ProfileManager;
}

export interface ArchiveRealmResult {
  /** Normalized URL the operation targeted (always trailing-slashed). */
  realmUrl: string;
  /** True when POST /_archive-realm returned 200. */
  archived: boolean;
  error?: string;
}

/**
 * Archive a realm via `POST /_archive-realm`. Owner-only; the server
 * returns 403 when the caller is not an owner. Programmatic API: returns
 * a result object on every path, never prompts, never calls
 * `process.exit`. The CLI wraps this with a TTY confirmation step (see
 * `registerArchiveCommand`).
 */
export async function archiveRealm(
  options: ArchiveRealmOptions,
): Promise<ArchiveRealmResult> {
  let realmUrl = ensureTrailingSlash(options.realmUrl.trim());
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      realmUrl,
      archived: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
  let response: Response;
  try {
    response = await pm.authedRealmServerFetch(
      `${realmServerUrl}/_archive-realm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: { type: 'realm', id: realmUrl },
        }),
      },
    );
  } catch (err) {
    return {
      realmUrl,
      archived: false,
      error: `Failed to reach realm server: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!response.ok) {
    let body = await safeReadResponseText(response);
    let error =
      response.status === 403
        ? `You do not own this realm and cannot archive it. Server returned 403: ${body}`
        : `Realm server returned ${response.status}: ${body}`;
    return {
      realmUrl,
      archived: false,
      error,
    };
  }

  return {
    realmUrl,
    archived: true,
  };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no response body>';
  }
}

interface ArchiveCliOptions {
  yes?: boolean;
}

export function registerArchiveCommand(realm: Command): void {
  realm
    .command('archive')
    .description(
      'Archive a realm — hides it from enumeration and stops its indexer (owner-only)',
    )
    .argument('<realm-url>', 'realm URL to archive')
    .option('-y, --yes', 'Skip the interactive confirmation prompt')
    .action(async (realmUrlInput: string, opts: ArchiveCliOptions) => {
      let normalized = ensureTrailingSlash(realmUrlInput.trim());

      console.log(`Archive target: ${FG_CYAN}${normalized}${RESET}`);

      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          console.error(
            `${FG_RED}Error:${RESET} stdin is not a TTY. Pass --yes to confirm in non-interactive mode.`,
          );
          process.exit(1);
        }
        let answer = await prompt(
          'This will archive the realm: it will be hidden from your realm list, sealed for content, and its indexer will stop. You can restore it later with `boxel realm restore`. Proceed? (y/N) ',
        );
        if (!/^y/i.test(answer)) {
          console.log(`${DIM}Cancelled.${RESET}`);
          return;
        }
      }

      let result = await archiveRealm({ realmUrl: normalized });
      if (result.error || !result.archived) {
        console.error(
          `${FG_RED}Error:${RESET} ${result.error ?? 'Archive did not complete.'}`,
        );
        process.exit(1);
      }

      console.log(
        `${FG_GREEN}Archived:${RESET} ${FG_CYAN}${result.realmUrl}${RESET}`,
      );
    });
}
