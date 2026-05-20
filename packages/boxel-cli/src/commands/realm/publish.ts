import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager';
import { unpublishRealm } from './unpublish';
import { FG_CYAN, FG_GREEN, FG_RED, RESET } from '../../lib/colors';

const DEFAULT_TIMEOUT_MS = 300_000;
const READINESS_POLL_INTERVAL_MS = 1000;

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
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }

  let normalizedSource = ensureTrailingSlash(sourceRealmURL);
  let normalizedPublished = ensureTrailingSlash(publishedRealmURL);
  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');

  let response = await postPublish(
    pm,
    realmServerUrl,
    normalizedSource,
    normalizedPublished,
  );

  if (
    (response.status === 400 || response.status === 409) &&
    options.republish !== false
  ) {
    let conflictBody = await safeReadResponseText(response);
    console.log(
      `Publish returned ${response.status} (${conflictBody.slice(0, 200)}). Unpublishing and retrying.`,
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
    response = await postPublish(
      pm,
      realmServerUrl,
      normalizedSource,
      normalizedPublished,
    );
  }

  if (
    response.status !== 200 &&
    response.status !== 201 &&
    response.status !== 202
  ) {
    let body = await safeReadResponseText(response);
    throw new Error(
      `Publish failed: HTTP ${response.status}: ${body.slice(0, 1000)}`,
    );
  }

  let body = (await response.json()) as PublishResponseBody;
  let attrs = body?.data?.attributes;
  if (!attrs?.publishedRealmURL) {
    throw new Error(
      `Publish response missing data.attributes.publishedRealmURL: ${JSON.stringify(
        body,
      ).slice(0, 500)}`,
    );
  }

  let result: PublishRealmResult = {
    publishedRealmURL: ensureTrailingSlash(attrs.publishedRealmURL),
    publishedRealmId: body.data.id,
    lastPublishedAt: attrs.lastPublishedAt,
    status: attrs.status,
  };

  if (options.waitForReady !== false) {
    let timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let realmToken: string | undefined;
    try {
      let serverToken = await pm.getOrRefreshServerToken();
      realmToken = await pm.fetchAndStoreRealmToken(
        result.publishedRealmURL,
        serverToken,
      );
    } catch {
      // The published realm is permission-public-read; fall through to
      // poll without an Authorization header.
    }
    await waitForPublishedRealmReady(
      result.publishedRealmURL,
      realmToken,
      timeoutMs,
    );
  }

  return result;
}

interface PublishResponseBody {
  data: {
    type: 'published_realm';
    id: string;
    attributes: {
      sourceRealmURL: string;
      publishedRealmURL: string;
      lastPublishedAt: string;
      status: string;
    };
  };
}

async function postPublish(
  pm: ProfileManager,
  realmServerUrl: string,
  sourceRealmURL: string,
  publishedRealmURL: string,
): Promise<Response> {
  return pm.authedRealmServerFetch(`${realmServerUrl}/_publish-realm`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sourceRealmURL, publishedRealmURL }),
  });
}

async function waitForPublishedRealmReady(
  publishedRealmURL: string,
  realmToken: string | undefined,
  timeoutMs: number,
): Promise<void> {
  let readinessUrl = new URL('_readiness-check', publishedRealmURL).href;
  let startedAt = Date.now();
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let headers: Record<string, string> = {
        Accept: 'application/vnd.api+json',
      };
      if (realmToken) {
        headers.Authorization = realmToken;
      }
      let response = await fetch(readinessUrl, { headers });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = describeFetchError(error);
    }
    let remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await new Promise((r) =>
      setTimeout(r, Math.min(READINESS_POLL_INTERVAL_MS, remaining)),
    );
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${publishedRealmURL} to pass readiness check${
      lastError ? `: ${lastError}` : ''
    }`,
  );
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no response body>';
  }
}

// Node's fetch error surface is shallow: the outer error is always
// `TypeError: fetch failed`, and the *real* reason (ECONNRESET, TLS
// failure, undici socket error, etc.) lives on `error.cause`. Inline both
// when summarizing for log output so opaque "fetch failed" lines don't
// reach the operator without context.
function describeFetchError(error: unknown): string {
  let msg = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.cause) {
    let cause = error.cause;
    let causeMsg = cause instanceof Error ? cause.message : String(cause);
    return `${msg} (caused by: ${causeMsg})`;
  }
  return msg;
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
          if (err instanceof Error && err.cause) {
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
