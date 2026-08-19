import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  unpublishRealm as unpublishRealmOperation,
  RealmOperationError,
} from '@cardstack/runtime-common/realm-operations';
import { buildCliRealmClient } from '../../lib/realm-client.ts';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { deriveRealmServerUrl } from '../../lib/seed-auth.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';
import { describeFetchError } from '../../lib/describe-fetch-error.ts';

export interface UnpublishOptions {
  /**
   * When true, do not fail if the server reports the realm was already
   * unpublished. Useful for cleanup paths that must be idempotent (e.g.
   * a PR-close hook that runs even if a previous close already unpublished).
   * Default: false.
   */
  tolerateMissing?: boolean;
  profileManager?: ProfileManager;
  /** Seed-mode admin auth — mints an owner-scoped realm-server token. */
  realmSecretSeed?: string;
  /** Realm-server origin for seed mode; defaults to the published URL origin. */
  realmServerURL?: string;
  /** Owner Matrix id for the seed-minted server token (required in seed mode). */
  asUser?: string;
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
  let client: ReturnType<typeof buildCliRealmClient>;
  if (options.realmSecretSeed) {
    if (!options.asUser) {
      return {
        publishedRealmURL: normalized,
        unpublished: false,
        error:
          'Seed-mode unpublish requires asUser (the realm owner Matrix id).',
      };
    }
    client = buildCliRealmClient({
      realmSecretSeed: options.realmSecretSeed,
      realmServerURL:
        options.realmServerURL ?? deriveRealmServerUrl(normalized),
      asUser: options.asUser,
    });
  } else {
    let pm = options.profileManager ?? getProfileManager();
    if (!pm.getActiveProfile()) {
      return {
        publishedRealmURL: normalized,
        unpublished: false,
        error: NO_ACTIVE_PROFILE_ERROR,
      };
    }
    client = buildCliRealmClient(pm);
  }

  try {
    await unpublishRealmOperation(client, {
      publishedRealmURL: normalized,
    });
    return { publishedRealmURL: normalized, unpublished: true };
  } catch (err) {
    if (err instanceof RealmOperationError) {
      let body = err.body ?? '';
      let looksLikeNotFound =
        err.status === 404 || (err.status === 422 && /not found/i.test(body));

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
        error: `Realm server returned ${err.status}: ${body.slice(0, 500)}`,
      };
    }

    // A non-HTTP failure (e.g. the realm server was unreachable).
    return {
      publishedRealmURL: normalized,
      unpublished: false,
      error: `Failed to reach realm server: ${describeFetchError(err)}`,
    };
  }
}

interface UnpublishCliOptions {
  tolerateMissing?: boolean;
  json?: boolean;
  realmSecretSeed?: boolean;
  asUser?: string;
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
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint an owner-scoped JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .option(
      '--as-user <matrix-id>',
      'Owner Matrix id to authorize as (required with --realm-secret-seed)',
    )
    .option('--json', 'Output the result as JSON')
    .action(async (publishedRealmURL: string, opts: UnpublishCliOptions) => {
      let realmSecretSeed: string | undefined;
      try {
        realmSecretSeed = await resolveRealmSecretSeed(
          opts.realmSecretSeed === true,
        );
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      let result = await unpublishRealm(publishedRealmURL, {
        tolerateMissing: opts.tolerateMissing === true,
        realmSecretSeed,
        asUser: opts.asUser,
      });

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (result.error) {
          process.exit(1);
        }
        return;
      }

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
