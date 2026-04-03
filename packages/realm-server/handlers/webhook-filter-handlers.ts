import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { param, query } from '@cardstack/runtime-common';

export interface WebhookFilterHandler {
  /** Return true if this payload matches the filter configuration. */
  matches(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
    dbAdapter?: DBAdapter,
  ): Promise<boolean>;

  /** Assemble the command input from the webhook payload and filter config. */
  buildCommandInput(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
    dbAdapter?: DBAdapter,
  ): Promise<Record<string, any>>;

  /** Determine the realm URL where the command should run. */
  getRealmURL(
    filter: Record<string, any>,
    commandURL: string,
    payload?: Record<string, any>,
    headers?: Koa.Context['req']['headers'],
    dbAdapter?: DBAdapter,
  ): Promise<string>;
}

/**
 * Extract the realm URL from a Submission Card URL found in a PR body.
 *
 * The PR body contains a line like:
 *   - Submission Card: [https://app.boxel.ai/user/realm/SubmissionCard/uuid](...)
 *
 * The realm is everything before "SubmissionCard/" in that URL.
 */
export function extractRealmFromPrBody(
  prBody: string | undefined | null,
): string | null {
  if (!prBody) return null;

  // Match the Submission Card URL in the PR body markdown link
  let match = prBody.match(/- Submission Card: \[([^\]]+)\]/);
  if (!match) return null;

  let submissionCardUrl = match[1];
  let submissionCardIndex = submissionCardUrl.indexOf('SubmissionCard/');
  if (submissionCardIndex === -1) return null;

  return submissionCardUrl.slice(0, submissionCardIndex);
}

/**
 * Extract the branch name from a GitHub webhook payload.
 * Different event types store the branch name in different locations.
 */
export function extractBranchNameFromPayload(
  payload: Record<string, any>,
): string | null {
  // pull_request, pull_request_review, pull_request_review_comment events
  if (payload.pull_request?.head?.ref != null) {
    return payload.pull_request.head.ref;
  }
  // check_run events
  if (payload.check_run?.check_suite?.head_branch != null) {
    return payload.check_run.check_suite.head_branch;
  }
  // check_suite events
  if (payload.check_suite?.head_branch != null) {
    return payload.check_suite.head_branch;
  }
  return null;
}

/**
 * Extract the PR body from a GitHub webhook payload.
 * Available on pull_request, pull_request_review, and pull_request_review_comment events.
 */
function extractPrBodyFromPayload(payload: Record<string, any>): string | null {
  return (payload.pull_request?.body as string) ?? null;
}

/**
 * Look up the realm URL for a PrCard with the given branch name by querying
 * the card index database.
 *
 * The query restricts results to PrCard instances (URL contains '/PrCard/')
 * to avoid matching GithubEventCard instances which also carry a branchName
 * field but may exist in a different realm.
 */
async function lookupRealmByBranchName(
  dbAdapter: DBAdapter,
  branchName: string,
): Promise<string | null> {
  try {
    let rows = await query(dbAdapter, [
      `SELECT realm_url FROM boxel_index`,
      `WHERE type = 'instance'`,
      `AND (is_deleted = FALSE OR is_deleted IS NULL)`,
      `AND url LIKE '%/PrCard/%'`,
      `AND search_doc->>'branchName' =`,
      param(branchName),
      `ORDER BY indexed_at DESC`,
      `LIMIT 1`,
    ]);
    if (rows.length > 0) {
      return rows[0].realm_url as string;
    }
  } catch (error) {
    console.warn(
      `Failed to look up realm for branch "${branchName}":`,
      error,
    );
  }
  return null;
}

/**
 * Resolve the origin of the realm that a GitHub webhook event belongs to.
 *
 * Strategy:
 * 1. If the payload contains a PR body, extract the origin from the Submission Card URL
 * 2. Look up the PrCard by branchName in the index DB and extract its origin
 *
 * Returns null if the origin cannot be determined.
 */
async function resolveOriginFromPayload(
  payload: Record<string, any>,
  dbAdapter?: DBAdapter,
): Promise<string | null> {
  // Strategy 1: Extract from PR body (available on pull_request, pull_request_review events)
  let prBody = extractPrBodyFromPayload(payload);
  let realm = extractRealmFromPrBody(prBody);
  if (realm) {
    try {
      return new URL(realm).origin;
    } catch {
      // fall through
    }
  }

  // Strategy 2: Look up PrCard by branchName (reliable — branchName is always set on PrCards)
  if (dbAdapter) {
    let branchName = extractBranchNameFromPayload(payload);
    if (branchName) {
      let realmUrl = await lookupRealmByBranchName(dbAdapter, branchName);
      if (realmUrl) {
        try {
          return new URL(realmUrl).origin;
        } catch {
          // fall through
        }
      }
    }
  }

  return null;
}

/**
 * Handler for GitHub webhook events. Supports filtering by event type
 * (from X-GitHub-Event header) and dynamically resolves the target realm
 * from the PR body's Submission Card URL or by looking up the PrCard.
 */
class GithubEventFilterHandler implements WebhookFilterHandler {
  async matches(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
    dbAdapter?: DBAdapter,
  ): Promise<boolean> {
    let eventType = headers['x-github-event'] as string | undefined;

    if (filter.eventType && filter.eventType !== eventType) {
      return false;
    }

    // If the filter has a configured realm, check that the event's realm
    // belongs to the same server/origin. This ensures each environment
    // only processes events from PRs that originated in that environment.
    //
    // First try the cheap path: extract realm from the PR body (no DB query).
    // If that's not available, fall back to the full resolution strategy
    // (which may query the DB for check_run/check_suite events).
    if (filter.realm) {
      let resolvedOrigin = await resolveOriginFromPayload(payload, dbAdapter);

      if (resolvedOrigin) {
        try {
          let filterOrigin = new URL(filter.realm as string).origin;
          if (filterOrigin !== resolvedOrigin) {
            return false;
          }
        } catch {
          // filter.realm is malformed — reject to avoid bypassing origin check
          console.warn(
            `Failed to parse filter.realm URL (${filter.realm}), rejecting match`,
          );
          return false;
        }
      } else {
        // Could not resolve origin from payload — reject the match to prevent
        // cross-environment broadcast. This is the safer default: if we can't
        // determine which environment the PR belongs to, don't process it.
        let branchName = extractBranchNameFromPayload(payload);
        console.warn(
          `Could not resolve realm origin from webhook payload ` +
            `(eventType=${eventType}, branchName=${branchName ?? 'unknown'}), ` +
            `rejecting match`,
        );
        return false;
      }
    }

    return true;
  }

  async buildCommandInput(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
  ): Promise<Record<string, any>> {
    let eventType = (headers['x-github-event'] as string) ?? '';

    // Always use the static filter.realm (the submissions realm) for the
    // command input. The dynamic origin check in matches() already ensures
    // we only reach here for the correct environment.
    let realm = filter.realm as string | undefined;
    if (!realm) {
      throw new Error(
        'realm must be provided in the filter for github-event webhook commands',
      );
    }

    return {
      eventType,
      realm,
      payload,
    };
  }

  async getRealmURL(
    filter: Record<string, any>,
    commandURL: string,
  ): Promise<string> {
    // Always use the static filter.realm. The dynamic origin check in
    // matches() already ensures we only reach here for the correct environment.
    return (
      (filter.realm as string | undefined) ??
      new URL('/submissions/', commandURL).href
    );
  }
}

/**
 * Default pass-through handler used when no filter type is specified or the
 * type is unrecognised. Always matches and passes the raw payload as the
 * command input.
 */
class DefaultFilterHandler implements WebhookFilterHandler {
  async matches(): Promise<boolean> {
    return true;
  }

  async buildCommandInput(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    return { payload };
  }

  async getRealmURL(
    filter: Record<string, any>,
    commandURL: string,
  ): Promise<string> {
    return (
      (filter.realmUrl as string | undefined) ?? new URL('/', commandURL).href
    );
  }
}

const filterHandlerRegistry: Record<string, WebhookFilterHandler> = {
  'github-event': new GithubEventFilterHandler(),
  default: new DefaultFilterHandler(),
};

/**
 * Look up the filter handler for the given filter configuration. The filter
 * should include a `type` key (e.g. `"github-event"`). When no type is
 * present the default pass-through handler is returned.
 */
export function getFilterHandler(
  filter: Record<string, any> | null,
): WebhookFilterHandler {
  let type = filter?.type as string | undefined;
  return (
    filterHandlerRegistry[type ?? 'default'] ?? filterHandlerRegistry.default
  );
}
