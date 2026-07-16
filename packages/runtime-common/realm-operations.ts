// Portable realm-server publishing behavior, written once and adapted by both
// the host (as commands) and boxel-cli (as handlers). Each operation is a
// `RealmOperation` — pure logic plus an injected `RealmClient` — with plain-TS
// I/O so each wrapper owns its own serialization. See `realm-client.ts`.

import { ensureTrailingSlash } from './paths.ts';
import type {
  PublishabilityResult,
  PublishabilityViolation,
  PublishabilityWarningType,
} from './publishability.ts';
import type { RealmOperation } from './realm-client.ts';

const JSONAPI_MIME = 'application/vnd.api+json';
const JSON_MIME = 'application/json';

const DEFAULT_READINESS_TIMEOUT_MS = 300_000;
const DEFAULT_READINESS_POLL_INTERVAL_MS = 1000;

// Thrown when a realm-server endpoint returns a non-success status. Carries the
// HTTP `status` and response `body` so a wrapper can react to specific codes
// (e.g. the CLI's republish-on-conflict and tolerate-missing-on-unpublish)
// without the operation itself owning that policy.
export class RealmOperationError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(
    message: string,
    options?: { status?: number; body?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'RealmOperationError';
    this.status = options?.status;
    this.body = options?.body;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// --- publishRealm ----------------------------------------------------------

export interface PublishRealmInput {
  sourceRealmURL: string;
  publishedRealmURL: string;
}

export interface PublishRealmOutput {
  sourceRealmURL: string;
  publishedRealmURL: string;
  publishedRealmId: string;
  lastPublishedAt: string;
  status: string;
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

// Publishes a source realm to a published-realm URL via `POST /_publish-realm`.
// The server accepts the publish and returns `202 Accepted` with
// `status: "pending"`; 200/201 are accepted too so this survives any future
// move back to a synchronous handler. Callers that need the realm
// indexed-and-viewable poll with `waitForReady`.
export const publishRealm: RealmOperation<
  PublishRealmInput,
  PublishRealmOutput
> = async (client, input) => {
  let sourceRealmURL = ensureTrailingSlash(input.sourceRealmURL);
  let publishedRealmURL = ensureTrailingSlash(input.publishedRealmURL);

  let response = await client.authedFetch(
    `${client.realmServerURL}_publish-realm`,
    {
      method: 'POST',
      headers: { Accept: JSONAPI_MIME, 'Content-Type': JSON_MIME },
      body: JSON.stringify({ sourceRealmURL, publishedRealmURL }),
    },
  );

  if (
    response.status !== 200 &&
    response.status !== 201 &&
    response.status !== 202
  ) {
    let body = await safeReadResponseText(response);
    throw new RealmOperationError(
      `Publish failed: HTTP ${response.status}: ${truncate(body, 1000)}`,
      { status: response.status, body },
    );
  }

  let body = (await response.json()) as PublishResponseBody;
  let attrs = body?.data?.attributes;
  if (!attrs?.publishedRealmURL) {
    throw new RealmOperationError(
      `Publish response missing data.attributes.publishedRealmURL: ${truncate(
        JSON.stringify(body),
        500,
      )}`,
    );
  }

  return {
    sourceRealmURL: attrs.sourceRealmURL,
    publishedRealmURL: ensureTrailingSlash(attrs.publishedRealmURL),
    publishedRealmId: body.data.id,
    lastPublishedAt: attrs.lastPublishedAt,
    status: attrs.status,
  };
};

// --- unpublishRealm --------------------------------------------------------

export interface UnpublishRealmInput {
  publishedRealmURL: string;
}

export interface UnpublishRealmOutput {
  sourceRealmURL: string | null;
  publishedRealmURL: string;
  lastPublishedAt: string | number | null;
}

interface UnpublishResponseBody {
  data: {
    type: 'unpublished_realm';
    id: string;
    attributes: {
      sourceRealmURL: string | null;
      publishedRealmURL: string;
      lastPublishedAt: string | number | null;
    };
  };
}

// Unpublishes a published realm via `POST /_unpublish-realm`. Throws a
// `RealmOperationError` (with `status`/`body`) on failure — the server returns
// 404, or 422 with a "not found" body, when the URL isn't currently published,
// which a wrapper can special-case for idempotent cleanup.
export const unpublishRealm: RealmOperation<
  UnpublishRealmInput,
  UnpublishRealmOutput
> = async (client, input) => {
  let publishedRealmURL = ensureTrailingSlash(input.publishedRealmURL);

  let response = await client.authedFetch(
    `${client.realmServerURL}_unpublish-realm`,
    {
      method: 'POST',
      headers: { Accept: JSONAPI_MIME, 'Content-Type': JSON_MIME },
      body: JSON.stringify({ publishedRealmURL }),
    },
  );

  if (!response.ok) {
    let body = await safeReadResponseText(response);
    throw new RealmOperationError(
      `Unpublish failed: HTTP ${response.status}: ${truncate(body, 1000)}`,
      { status: response.status, body },
    );
  }

  let body = (await response.json()) as UnpublishResponseBody;
  let attrs = body?.data?.attributes;
  return {
    sourceRealmURL: attrs?.sourceRealmURL ?? null,
    publishedRealmURL: attrs?.publishedRealmURL
      ? ensureTrailingSlash(attrs.publishedRealmURL)
      : publishedRealmURL,
    lastPublishedAt: attrs?.lastPublishedAt ?? null,
  };
};

// --- checkDomainAvailability -----------------------------------------------

export interface CheckDomainAvailabilityInput {
  subdomain: string;
}

export interface DomainAvailability {
  available: boolean;
  hostname: string;
  // Validation message when the subdomain is rejected (e.g. punycode); absent
  // when the name is simply already taken.
  error?: string;
}

// Checks whether a Boxel Space subdomain is available via
// `GET /_check-boxel-domain-availability?subdomain=`.
export const checkDomainAvailability: RealmOperation<
  CheckDomainAvailabilityInput,
  DomainAvailability
> = async (client, input) => {
  let url = new URL(`${client.realmServerURL}_check-boxel-domain-availability`);
  url.searchParams.set('subdomain', input.subdomain);

  let response = await client.authedFetch(url.href, {
    method: 'GET',
    headers: { Accept: JSON_MIME },
  });

  if (!response.ok) {
    let body = await safeReadResponseText(response);
    throw new RealmOperationError(
      `Check domain availability failed: HTTP ${response.status}: ${truncate(
        body,
        1000,
      )}`,
      { status: response.status, body },
    );
  }

  return (await response.json()) as DomainAvailability;
};

// --- fetchPublishabilityReport ---------------------------------------------

// The `_publishability` endpoint serializes a `PublishabilityResult` (see
// `publishability.ts`) plus the realm URL it describes. Reusing those types
// keeps the wire contract in one place.
export interface RealmPublishabilityReport extends PublishabilityResult {
  realmURL: string;
}

export interface FetchPublishabilityReportInput {
  realmURL: string;
}

interface PublishabilityResponseBody {
  data: {
    attributes: {
      publishable: boolean;
      realmURL: string;
      violations: PublishabilityViolation[];
      warningTypes?: PublishabilityWarningType[];
    };
  };
}

// Fetches the realm's publishability report via `GET <realmURL>_publishability`.
export const fetchPublishabilityReport: RealmOperation<
  FetchPublishabilityReportInput,
  RealmPublishabilityReport
> = async (client, input) => {
  let realmURL = ensureTrailingSlash(input.realmURL);

  let response = await client.authedFetch(`${realmURL}_publishability`, {
    headers: { Accept: JSONAPI_MIME },
  });

  if (response.status !== 200) {
    let body = await safeReadResponseText(response);
    throw new RealmOperationError(
      `Failed to check private dependencies for ${realmURL}: ${response.status}`,
      { status: response.status, body },
    );
  }

  let json = (await response.json()) as PublishabilityResponseBody;
  let attributes = json.data.attributes;

  return {
    publishable: attributes.publishable,
    realmURL: attributes.realmURL,
    violations: attributes.violations ?? [],
    warningTypes: attributes.warningTypes ?? [],
  };
};

// --- waitForReady ----------------------------------------------------------

export interface WaitForReadyInput {
  publishedRealmURL: string;
  // Defaults to 300_000ms.
  timeoutMs?: number;
  // Defaults to 1000ms.
  pollIntervalMs?: number;
  // When true, hold readiness until the realm's published HTML is live for its
  // current generation, not just the index. A published realm's rendered HTML
  // is its deliverable (served to visitors), so publish callers set this;
  // index-only readiness (e.g. createRealm) leaves it off to stay fast.
  awaitPrerenderHtml?: boolean;
}

// Polls `<publishedRealmURL>_readiness-check` until it returns ok (the realm is
// mounted and indexed) or the timeout elapses. Pure HTTP, so it works in any
// environment — including the run-command/prerender context where matrix
// `index` events aren't delivered. The injected `authedFetch` attaches the
// realm token when one is obtainable; published realms are public-read, so a
// missing token still polls successfully.
export const waitForReady: RealmOperation<WaitForReadyInput, void> = async (
  client,
  input,
) => {
  let publishedRealmURL = ensureTrailingSlash(input.publishedRealmURL);
  let timeoutMs = input.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  let pollIntervalMs =
    input.pollIntervalMs ?? DEFAULT_READINESS_POLL_INTERVAL_MS;
  let readinessUrlObj = new URL('_readiness-check', publishedRealmURL);
  if (input.awaitPrerenderHtml) {
    readinessUrlObj.searchParams.set('awaitPrerenderHtml', 'true');
  }
  let readinessUrl = readinessUrlObj.href;
  let startedAt = Date.now();
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await client.authedFetch(readinessUrl, {
        headers: { Accept: JSONAPI_MIME },
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    let remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
    );
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${publishedRealmURL} to pass readiness check${
      lastError ? `: ${lastError}` : ''
    }`,
  );
};

// --- helpers ---------------------------------------------------------------

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no response body>';
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
