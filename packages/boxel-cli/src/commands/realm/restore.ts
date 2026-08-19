import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';

export interface RestoreRealmOptions {
  realmUrl: string;
  profileManager?: ProfileManager;
}

export interface RestoreRealmResult {
  /** Normalized URL the operation targeted (always trailing-slashed). */
  realmUrl: string;
  /** True when POST /_unarchive-realm returned 200. */
  restored: boolean;
  error?: string;
}

/**
 * Restore a previously archived realm via `POST /_unarchive-realm`.
 * Owner-only; the server returns 403 when the caller is not an owner.
 * Server-side this also enqueues a full reindex.
 */
export async function restoreRealm(
  options: RestoreRealmOptions,
): Promise<RestoreRealmResult> {
  let realmUrl = ensureTrailingSlash(options.realmUrl.trim());
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      realmUrl,
      restored: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');
  let response: Response;
  try {
    response = await pm.authedRealmServerFetch(
      `${realmServerUrl}/_unarchive-realm`,
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
      restored: false,
      error: `Failed to reach realm server: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!response.ok) {
    let body = await safeReadResponseText(response);
    let error =
      response.status === 403
        ? `You do not own this realm and cannot restore it. Server returned 403: ${body}`
        : `Realm server returned ${response.status}: ${body}`;
    return {
      realmUrl,
      restored: false,
      error,
    };
  }

  return {
    realmUrl,
    restored: true,
  };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no response body>';
  }
}

export function registerRestoreCommand(realm: Command): void {
  realm
    .command('restore')
    .description(
      'Restore a previously archived realm and trigger a full reindex (owner-only)',
    )
    .argument('<realm-url>', 'realm URL to restore')
    .action(async (realmUrlInput: string) => {
      let normalized = ensureTrailingSlash(realmUrlInput.trim());

      let result = await restoreRealm({ realmUrl: normalized });
      if (result.error || !result.restored) {
        console.error(
          `${FG_RED}Error:${RESET} ${result.error ?? 'Restore did not complete.'}`,
        );
        process.exit(1);
      }

      console.log(
        `${FG_GREEN}Restored:${RESET} ${FG_CYAN}${result.realmUrl}${RESET}`,
      );
    });
}
