import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors';

export interface UnpublishOptions {
  /**
   * When true, do not fail if the server reports the realm was already
   * unpublished. Useful for cleanup paths that must be idempotent (e.g.
   * a PR-close hook that runs even if a previous close already unpublished).
   * Default: false.
   */
  tolerateMissing?: boolean;
  profileManager?: ProfileManager;
}

export interface UnpublishRealmResult {
  publishedRealmURL: string;
  unpublished: boolean;
  notFound?: boolean;
  error?: string;
}

/**
 * Unpublish a published realm. Mirrors `boxel realm publish`'s contract
 * with `/_unpublish-realm`.
 *
 * The realm-server returns 200 on success and 422 with a "not found" body
 * when the URL isn't currently published. We special-case the latter (and
 * 404, defensively) so cleanup callers can run unconditionally.
 */
export async function unpublishRealm(
  publishedRealmURL: string,
  options: UnpublishOptions = {},
): Promise<UnpublishRealmResult> {
  let normalized = ensureTrailingSlash(publishedRealmURL);
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return {
      publishedRealmURL: normalized,
      unpublished: false,
      error: NO_ACTIVE_PROFILE_ERROR,
    };
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');

  let response: Response;
  try {
    response = await pm.authedRealmServerFetch(
      `${realmServerUrl}/_unpublish-realm`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publishedRealmURL: normalized }),
      },
    );
  } catch (err) {
    // Node's fetch error surface is shallow: the outer error is always
    // `TypeError: fetch failed`, and the *real* reason (ECONNRESET, TLS
    // failure, undici socket error, etc.) lives on `error.cause`. Include
    // it inline so opaque "fetch failed" lines don't reach the operator
    // without context.
    let msg = err instanceof Error ? err.message : String(err);
    // `err.cause != null` rather than a truthy check so we don't drop
    // falsy-but-defined causes (`''`, `0`, `false`, `NaN`). `!= null`
    // matches both `null` and `undefined`.
    if (err instanceof Error && err.cause != null) {
      let cause = err.cause;
      let causeMsg = cause instanceof Error ? cause.message : String(cause);
      msg = `${msg} (caused by: ${causeMsg})`;
    }
    return {
      publishedRealmURL: normalized,
      unpublished: false,
      error: `Failed to reach realm server: ${msg}`,
    };
  }

  if (response.ok) {
    return { publishedRealmURL: normalized, unpublished: true };
  }

  let body = await safeReadResponseText(response);
  let looksLikeNotFound =
    response.status === 404 ||
    (response.status === 422 && /not found/i.test(body));

  if (looksLikeNotFound) {
    if (options.tolerateMissing) {
      return {
        publishedRealmURL: normalized,
        unpublished: false,
        notFound: true,
      };
    }
    return {
      publishedRealmURL: normalized,
      unpublished: false,
      notFound: true,
      error: `Published realm ${normalized} is not currently published`,
    };
  }

  return {
    publishedRealmURL: normalized,
    unpublished: false,
    error: `Realm server returned ${response.status}: ${body.slice(0, 500)}`,
  };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no response body>';
  }
}

interface UnpublishCliOptions {
  tolerateMissing?: boolean;
}

export function registerUnpublishCommand(realm: Command): void {
  realm
    .command('unpublish')
    .description('Unpublish a published realm by its public-facing URL')
    .argument('<published-realm-url>', 'URL of the published realm to remove')
    .option(
      '--tolerate-missing',
      'Exit successfully when the realm is already unpublished',
    )
    .action(async (publishedRealmURL: string, opts: UnpublishCliOptions) => {
      let result = await unpublishRealm(publishedRealmURL, {
        tolerateMissing: opts.tolerateMissing === true,
      });

      if (result.error) {
        console.error(`${FG_RED}Error:${RESET} ${result.error}`);
        process.exit(1);
      }

      if (result.notFound) {
        console.log(
          `Already unpublished: ${FG_CYAN}${result.publishedRealmURL}${RESET}`,
        );
        return;
      }

      console.log(
        `${FG_GREEN}Unpublished:${RESET} ${FG_CYAN}${result.publishedRealmURL}${RESET}`,
      );
    });
}
