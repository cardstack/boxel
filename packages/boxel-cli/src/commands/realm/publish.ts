import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  publishRealm as publishRealmOperation,
  type PublishRealmOutput,
  RealmOperationError,
  waitForReady,
} from '@cardstack/runtime-common/realm-operations';
import { buildCliRealmClient } from '../../lib/realm-client.ts';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { unpublishRealm } from './unpublish.ts';
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
  profileManager?: ProfileManager;
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
 * Speaks the contract documented at
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
  let pm = options.profileManager ?? getProfileManager();
  let client = buildCliRealmClient(pm);

  let normalizedSource = ensureTrailingSlash(sourceRealmURL);
  let normalizedPublished = ensureTrailingSlash(publishedRealmURL);

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
      console.log(
        `Publish returned ${err.status} (${(err.body ?? '').slice(0, 200)}). Unpublishing and retrying.`,
      );
      let unpublishResult = await unpublishRealm(normalizedPublished, {
        profileManager: pm,
        tolerateMissing: true,
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
}

export function publishCliOptsToOptions(
  opts: PublishCliOptions,
): PublishOptions {
  return {
    waitForReady: opts.wait !== false,
    timeoutMs: opts.timeout,
    republish: opts.republish !== false,
  };
}

export function registerPublishCommand(realm: Command): void {
  realm
    .command('publish')
    .description(
      'Publish a source realm to a published-realm URL, polling readiness until ready',
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
    .action(
      async (
        sourceRealmURL: string,
        publishedRealmURL: string,
        opts: PublishCliOptions,
      ) => {
        try {
          let result = await publishRealm(
            sourceRealmURL,
            publishedRealmURL,
            publishCliOptsToOptions(opts),
          );
          console.log(
            `${FG_GREEN}Published:${RESET} ${FG_CYAN}${result.publishedRealmURL}${RESET}`,
          );
        } catch (err) {
          console.error(
            `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
          );
          // Node's fetch surfaces the actual transport error (ECONNRESET,
          // TLS failure, undici socket error, etc.) on `error.cause`. Print
          // it so opaque "fetch failed" messages don't strand the caller.
          // `!= null` rather than a truthy check so we don't drop
          // falsy-but-defined causes (`''`, `0`, `false`, `NaN`).
          if (err instanceof Error && err.cause != null) {
            console.error(`${FG_RED}Caused by:${RESET}`, err.cause);
          }
          process.exit(1);
        }
      },
    );
}

function parseTimeoutOption(value: string): number {
  let n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value.trim()) {
    throw new Error('--timeout must be a non-negative integer (milliseconds).');
  }
  return n;
}
