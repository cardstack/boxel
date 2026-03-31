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
 * Extract the PR number from a GitHub webhook payload.
 * Different event types store the PR number in different locations.
 */
export function extractPrNumberFromPayload(
  payload: Record<string, any>,
): number | null {
  // pull_request, pull_request_review, pull_request_review_comment events
  if (payload.pull_request?.number != null) {
    return payload.pull_request.number;
  }
  // check_run events
  if (payload.check_run?.pull_requests?.[0]?.number != null) {
    return payload.check_run.pull_requests[0].number;
  }
  // check_suite events
  if (payload.check_suite?.pull_requests?.[0]?.number != null) {
    return payload.check_suite.pull_requests[0].number;
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
 * Look up the realm URL for a PrCard with the given PR number by querying
 * the card index database.
 */
async function lookupRealmByPrNumber(
  dbAdapter: DBAdapter,
  prNumber: number,
): Promise<string | null> {
  try {
    let rows = await query(dbAdapter, [
      `SELECT realm_url FROM boxel_index`,
      `WHERE type = 'instance'`,
      `AND is_deleted = FALSE`,
      `AND search_doc->>'prNumber' =`,
      param(String(prNumber)),
      `LIMIT 1`,
    ]);
    if (rows.length > 0) {
      return rows[0].realm_url as string;
    }
  } catch (error) {
    console.warn(`Failed to look up realm for PR #${prNumber}:`, error);
  }
  return null;
}

/**
 * Resolve the realm URL dynamically from the GitHub webhook payload.
 *
 * Strategy:
 * 1. If the payload contains a PR body, extract the realm from the Submission Card URL
 * 2. Otherwise, look up the PrCard by prNumber in the index DB
 * 3. Fall back to the static filter.realm if neither works
 */
async function resolveRealmFromPayload(
  payload: Record<string, any>,
  filter: Record<string, any>,
  dbAdapter?: DBAdapter,
): Promise<string | null> {
  // Strategy 1: Extract from PR body (available on pull_request, pull_request_review events)
  let prBody = extractPrBodyFromPayload(payload);
  let realm = extractRealmFromPrBody(prBody);
  if (realm) return realm;

  // Strategy 2: Look up PrCard by prNumber (for check_run, check_suite events)
  if (dbAdapter) {
    let prNumber = extractPrNumberFromPayload(payload);
    if (prNumber != null) {
      realm = await lookupRealmByPrNumber(dbAdapter, prNumber);
      if (realm) return realm;
    }
  }

  // Strategy 3: Fall back to static filter.realm
  return (filter.realm as string) ?? null;
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
      let prBody = extractPrBodyFromPayload(payload);
      let resolvedRealm = extractRealmFromPrBody(prBody);

      if (!resolvedRealm && dbAdapter) {
        let prNumber = extractPrNumberFromPayload(payload);
        if (prNumber != null) {
          resolvedRealm = await lookupRealmByPrNumber(dbAdapter, prNumber);
        }
      }

      if (resolvedRealm) {
        try {
          let filterOrigin = new URL(filter.realm as string).origin;
          let resolvedOrigin = new URL(resolvedRealm).origin;
          if (filterOrigin !== resolvedOrigin) {
            return false;
          }
        } catch {
          console.warn(
            `Failed to compare realm origins for webhook filter ` +
              `(filter.realm=${filter.realm}, resolvedRealm=${resolvedRealm}), ` +
              `allowing match as fallback`,
          );
        }
      } else {
        let prNumber = extractPrNumberFromPayload(payload);
        console.warn(
          `Could not resolve realm from webhook payload ` +
            `(eventType=${eventType}, prNumber=${prNumber ?? 'unknown'}). ` +
            `Falling back to broadcast — event will be processed by all environments.`,
        );
      }
    }

    return true;
  }

  async buildCommandInput(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
    dbAdapter?: DBAdapter,
  ): Promise<Record<string, any>> {
    let eventType = (headers['x-github-event'] as string) ?? '';

    let realm = await resolveRealmFromPayload(payload, filter, dbAdapter);
    if (!realm) {
      throw new Error(
        'Could not determine realm for github-event webhook command: ' +
          'no Submission Card URL found in PR body, no PrCard found in index, ' +
          'and no static realm configured in filter',
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
    payload?: Record<string, any>,
    _headers?: Koa.Context['req']['headers'],
    dbAdapter?: DBAdapter,
  ): Promise<string> {
    if (payload) {
      let realm = await resolveRealmFromPayload(payload, filter, dbAdapter);
      if (realm) return realm;
    }
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
