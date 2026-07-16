import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  fetchPublishabilityReport,
  publishRealm as publishRealmOperation,
  type PublishRealmOutput,
  RealmOperationError,
  waitForReady,
} from '@cardstack/runtime-common/realm-operations';
import type { PublishabilityViolation } from '@cardstack/runtime-common/publishability';
import { buildCliRealmClient } from '../../lib/realm-client.ts';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import {
  deriveOwnerUserId,
  deriveRealmServerUrl,
} from '../../lib/seed-auth.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { unpublishRealm } from './unpublish.ts';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors.ts';

const DEFAULT_TIMEOUT_MS = 300_000;

export interface PublishOptions {
  /** Wait for the published realm to pass readiness check (default: true). */
  waitForReady?: boolean;
  /** Readiness-poll timeout in milliseconds (default: 300_000). */
  timeoutMs?: number;
  /**
   * When the server returns 400/409 (e.g. an existing publication conflicts),
   * unpublish the target URL first and retry once. Default: true.
   */
  republish?: boolean;
  /**
   * Skip the publishability gate (private-dependency / error-document check).
   * Default: false — the gate runs and blocks publishing on violations.
   */
  force?: boolean;
  profileManager?: ProfileManager;
  /** Seed-mode admin auth — mints an owner-scoped realm-server token. */
  realmSecretSeed?: string;
  /**
   * Owner Matrix id for the seed-minted server token. Defaults to the owner
   * derived from the source realm URL (`@<owner>:<domain>`).
   */
  asUser?: string;
}

export interface PublishRealmResult {
  publishedRealmURL: string;
  publishedRealmId: string;
  lastPublishedAt: string;
  status: string;
}

/**
 * Publish a source realm to a published-realm URL.
 *
 * Before publishing, runs the publishability gate (private-dependency /
 * error-document check) and refuses to publish on violations unless `force`
 * is set. Then speaks the contract documented at
 * `packages/realm-server/handlers/handle-publish-realm.ts`: the server
 * accepts the publish, returns `202 Accepted` with `status: "pending"`,
 * and the client polls `/<publishedRealmURL>/_readiness-check` until
 * the realm is mounted and indexed. 200/201 are accepted too so this
 * function survives any future move back to a synchronous handler.
 */
export async function publishRealm(
  sourceRealmURL: string,
  publishedRealmURL: string,
  options: PublishOptions = {},
): Promise<PublishRealmResult> {
  let normalizedSource = ensureTrailingSlash(sourceRealmURL);
  let normalizedPublished = ensureTrailingSlash(publishedRealmURL);

  // Seed mode mints an owner-scoped realm-server token; the owner defaults to
  // the one derived from the source realm URL. `pm` stays defined for the
  // profile path (and threads into the conflict-retry unpublish below).
  let realmServerURL = deriveRealmServerUrl(normalizedSource);
  let asUser =
    options.asUser ??
    (options.realmSecretSeed ? deriveOwnerUserId(normalizedSource) : undefined);
  let pm = options.realmSecretSeed
    ? undefined
    : (options.profileManager ?? getProfileManager());
  let client = options.realmSecretSeed
    ? buildCliRealmClient({
        realmSecretSeed: options.realmSecretSeed,
        realmServerURL,
        asUser: asUser!,
      })
    : buildCliRealmClient(pm!);

  // Pre-publish gate: refuse to publish a realm with private-dependency or
  // error-document violations (which would break the published site) unless
  // the caller forces it.
  if (!options.force) {
    let report = await fetchPublishabilityReport(client, {
      realmURL: normalizedSource,
    });
    if (!report.publishable) {
      throw new Error(describeViolations(report.violations));
    }
  }

  let output: PublishRealmOutput;
  try {
    output = await publishRealmOperation(client, {
      sourceRealmURL: normalizedSource,
      publishedRealmURL: normalizedPublished,
    });
  } catch (err) {
    // The server returns 400/409 when an existing publication conflicts;
    // unpublish the target and retry once before giving up.
    if (
      err instanceof RealmOperationError &&
      (err.status === 400 || err.status === 409) &&
      options.republish !== false
    ) {
      // Progress, not payload: route to stderr via cliLog.info so it never
      // corrupts stdout when the caller passed --json (stdout is JSON-only).
      cliLog.info(
        `Publish returned ${err.status} (${(err.body ?? '').slice(0, 200)}). Unpublishing and retrying.`,
      );
      let unpublishResult = await unpublishRealm(normalizedPublished, {
        profileManager: pm,
        tolerateMissing: true,
        realmSecretSeed: options.realmSecretSeed,
        realmServerURL,
        asUser,
      });
      if (!unpublishResult.unpublished && !unpublishResult.notFound) {
        throw new Error(
          `Conflict on publish; unpublish-then-retry also failed: ${
            unpublishResult.error ?? 'unknown'
          }`,
        );
      }
      output = await publishRealmOperation(client, {
        sourceRealmURL: normalizedSource,
        publishedRealmURL: normalizedPublished,
      });
    } else {
      throw err;
    }
  }

  let result: PublishRealmResult = {
    publishedRealmURL: output.publishedRealmURL,
    publishedRealmId: output.publishedRealmId,
    lastPublishedAt: output.lastPublishedAt,
    status: output.status,
  };

  if (options.waitForReady !== false) {
    await waitForReady(client, {
      publishedRealmURL: result.publishedRealmURL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      // A published realm's rendered HTML is its deliverable, so wait until it
      // is live (not just indexed) before reporting the publish complete.
      awaitPrerenderHtml: true,
    });
  }

  return result;
}

export interface PublishCliOptions {
  // Commander exposes `--no-wait` / `--no-republish` on the positive
  // keys (`wait` / `republish`), defaulting to `true` and flipping to
  // `false` when the negated flag is passed.
  wait?: boolean;
  timeout?: number;
  republish?: boolean;
  force?: boolean;
  json?: boolean;
  realmSecretSeed?: boolean;
  asUser?: string;
}

export function publishCliOptsToOptions(
  opts: PublishCliOptions,
): PublishOptions {
  return {
    waitForReady: opts.wait !== false,
    timeoutMs: opts.timeout,
    republish: opts.republish !== false,
    force: opts.force === true,
  };
}

export function registerPublishCommand(realm: Command): void {
  realm
    .command('publish')
    .description(
      'Publish a source realm to a published-realm URL: runs the publishability gate (use --force to skip), then polls readiness until ready',
    )
    .argument('<source-realm-url>', 'URL of the source realm to publish')
    .argument(
      '<published-realm-url>',
      'Public-facing URL the published copy will serve at',
    )
    .option('--no-wait', 'Return as soon as the server accepts the publish')
    .option(
      '--timeout <ms>',
      `Readiness-poll timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
      parseTimeoutOption,
    )
    .option(
      '--no-republish',
      'Do not auto-unpublish + retry when the server returns 400/409',
    )
    .option(
      '--force',
      'Publish even if the realm has publishability violations (skips the gate)',
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint an owner-scoped JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)',
    )
    .option(
      '--as-user <matrix-id>',
      'Owner Matrix id to authorize as in seed mode (defaults to the owner derived from the source realm URL)',
    )
    .option('--json', 'Output the result as JSON')
    .action(
      async (
        sourceRealmURL: string,
        publishedRealmURL: string,
        opts: PublishCliOptions,
      ) => {
        try {
          let realmSecretSeed = await resolveRealmSecretSeed(
            opts.realmSecretSeed === true,
          );
          let result = await publishRealm(sourceRealmURL, publishedRealmURL, {
            ...publishCliOptsToOptions(opts),
            realmSecretSeed,
            asUser: opts.asUser,
          });
          if (opts.json) {
            cliLog.output(JSON.stringify(result, null, 2));
          } else {
            console.log(
              `${FG_GREEN}Published:${RESET} ${FG_CYAN}${result.publishedRealmURL}${RESET}`,
            );
          }
        } catch (err) {
          let message = err instanceof Error ? err.message : String(err);
          if (opts.json) {
            cliLog.output(JSON.stringify({ error: message }, null, 2));
          } else {
            console.error(`${FG_RED}Error:${RESET} ${message}`);
            // Node's fetch surfaces the actual transport error (ECONNRESET,
            // TLS failure, undici socket error, etc.) on `error.cause`. Print
            // it so opaque "fetch failed" messages don't strand the caller.
            // `!= null` rather than a truthy check so we don't drop
            // falsy-but-defined causes (`''`, `0`, `false`, `NaN`).
            if (err instanceof Error && err.cause != null) {
              console.error(`${FG_RED}Caused by:${RESET}`, err.cause);
            }
          }
          process.exit(1);
        }
      },
    );
}

// Summarizes publishability violations into a single actionable error message.
// Mirrors the host PublishRealmCommand's gate messaging.
export function describeViolations(
  violations: PublishabilityViolation[],
): string {
  let privateCount = violations.filter(
    (v) => v.kind === 'private-dependency',
  ).length;
  let errorCount = violations.filter((v) => v.kind === 'error-document').length;

  let parts: string[] = [];
  if (privateCount) {
    parts.push(`${privateCount} private-dependency violation(s)`);
  }
  if (errorCount) {
    parts.push(`${errorCount} error-document violation(s)`);
  }
  let summary = parts.length
    ? parts.join(', ')
    : `${violations.length} violation(s)`;

  let resources = violations
    .map((v) => v.resource)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');

  return `Realm is not publishable (${summary}). Resolve them or pass --force to override.${
    resources ? ` Affected: ${resources}` : ''
  }`;
}

function parseTimeoutOption(value: string): number {
  let n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value.trim()) {
    throw new Error('--timeout must be a non-negative integer (milliseconds).');
  }
  return n;
}
