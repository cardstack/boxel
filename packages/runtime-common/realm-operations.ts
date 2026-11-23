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
import type { RealmClient, RealmOperation } from './realm-client.ts';

const JSONAPI_MIME = 'application/vnd.api+json';
const JSON_MIME = 'application/json';

const DEFAULT_READINESS_TIMEOUT_MS = 300_000;
const DEFAULT_READINESS_MAX_WAIT_MS = 3_600_000;
const DEFAULT_READINESS_POLL_INTERVAL_MS = 1000;
// Progress is sampled on its own cadence rather than piggy-backing the
// readiness poll: `_readiness-check` holds each request open while it waits on
// the realm's index lane, so a reading taken from that response would only
// arrive as often as that hold expires.
const DEFAULT_PROGRESS_POLL_INTERVAL_MS = 1000;

// Thrown when a realm-server endpoint returns a non-success status. Carries the
// HTTP `status` and response `body` so a wrapper can react to specific codes
// (e.g. the CLI's republish-on-conflict and tolerate-missing-on-unpublish)
// without the operation itself owning that policy.
export class RealmOperationError extends Error {
  readonly status?: number;
  readonly body?: string;
  // The response's `Retry-After` header, when the server sent one.
  readonly retryAfter?: string;

  constructor(
    message: string,
    options?: {
      status?: number;
      body?: string;
      retryAfter?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'RealmOperationError';
    this.status = options?.status;
    this.body = options?.body;
    this.retryAfter = options?.retryAfter;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// Thrown when `waitForReady` gives up before the realm became ready. The work
// it waited on may still finish, unlike a refusal such as a failed boot index.
export class ReadinessTimeoutError extends Error {
  // The `X-Boxel-Not-Ready` stage of the last readiness response, if the last
  // poll got one.
  stage: string | undefined;
  // Whether the wait gave up because progress stopped advancing, rather than
  // at its ceiling or with no progress to read.
  stalled: boolean;
  constructor(
    message: string,
    { stage, stalled = false }: { stage?: string; stalled?: boolean } = {},
  ) {
    super(message);
    this.name = 'ReadinessTimeoutError';
    this.stage = stage;
    this.stalled = stalled;
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

// --- host URLs -------------------------------------------------------------

// A host URL is an address a realm is served at besides its own URL. The
// endpoints under `/_host-urls` list, mount, unmount and mark one canonical.
// See `packages/realm-server/handlers/handle-host-urls.ts`. Only an
// administrator of the realm can use them.

export type HostURLKind = 'boxel-space' | 'site-name' | 'custom-domain';

export interface HostURL {
  id: string;
  realmURL: string;
  url: string;
  kind: HostURLKind;
  isCanonical: boolean;
}

export interface HostURLList {
  hostURLs: HostURL[];
  // The Boxel Space URL the realm can be mounted at, in the Space of the
  // realm owner. Absent when the realm has no owner or the server has no
  // Boxel Space domain.
  boxelSpaceURL?: string;
}

interface HostURLResource {
  type: 'host-url';
  id: string;
  attributes: {
    realmURL: string;
    url: string;
    kind: HostURLKind;
    isCanonical: boolean;
  };
}

// The reason that a realm-server refusal gives. The server sends a refusal as
// `{"errors": [...]}`, where each error is a string or a JSON:API error
// object. A body that is not such a document is the reason itself.
export function refusalReason(body: string): string {
  try {
    let errors: unknown = JSON.parse(body)?.errors;
    if (Array.isArray(errors)) {
      let reasons = errors
        .map((error) =>
          typeof error === 'string' ? error : (error?.detail ?? error?.title),
        )
        .filter(
          (reason): reason is string =>
            typeof reason === 'string' && reason.length > 0,
        );
      if (reasons.length > 0) {
        return reasons.join('; ');
      }
    }
  } catch {
    // The body is not JSON, so the body is the reason.
  }
  return body || 'The request failed';
}

// Sends a request to a host URL or site name endpoint. A refusal throws a
// `RealmOperationError`. Its message is the reason the server gives.
async function hostURLRequest(
  client: RealmClient,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response = await client.authedFetch(url, {
    ...init,
    headers: { Accept: JSONAPI_MIME, 'Content-Type': JSON_MIME },
  });
  if (!response.ok) {
    let body = await safeReadResponseText(response);
    throw new RealmOperationError(truncate(refusalReason(body), 1000), {
      status: response.status,
      body,
      retryAfter: response.headers.get('Retry-After') ?? undefined,
    });
  }
  return response;
}

function hostURLFromResource({ id, attributes }: HostURLResource): HostURL {
  return {
    id,
    realmURL: attributes.realmURL,
    url: attributes.url,
    kind: attributes.kind,
    isCanonical: attributes.isCanonical,
  };
}

function hostURLEndpoint(client: RealmClient, id?: string): string {
  let base = `${client.realmServerURL}_host-urls`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

export interface ListHostURLsInput {
  realmURL: string;
}

// Lists the host URLs of a realm with `GET /_host-urls?realm=`.
export const listHostURLs: RealmOperation<
  ListHostURLsInput,
  HostURLList
> = async (client, input) => {
  let url = new URL(hostURLEndpoint(client));
  url.searchParams.set('realm', ensureTrailingSlash(input.realmURL));
  let response = await hostURLRequest(client, url.href, { method: 'GET' });
  let json = (await response.json()) as {
    data?: HostURLResource[];
    meta?: { boxelSpaceURL?: unknown };
  };
  let boxelSpaceURL = json.meta?.boxelSpaceURL;
  return {
    hostURLs: (json.data ?? []).map(hostURLFromResource),
    ...(typeof boxelSpaceURL === 'string' ? { boxelSpaceURL } : {}),
  };
};

export interface MountHostURLInput {
  realmURL: string;
  url: string;
}

// Mounts a realm at a host URL with `POST /_host-urls`. The server gets the
// kind of host URL from the URL. The first host URL of a realm is canonical.
export const mountHostURL: RealmOperation<MountHostURLInput, HostURL> = async (
  client,
  input,
) => {
  let response = await hostURLRequest(client, hostURLEndpoint(client), {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'host-url',
        attributes: {
          realmURL: ensureTrailingSlash(input.realmURL),
          url: input.url,
        },
      },
    }),
  });
  let json = (await response.json()) as { data: HostURLResource };
  return hostURLFromResource(json.data);
};

export interface HostURLIdInput {
  id: string;
}

// Marks a host URL canonical with `PATCH /_host-urls/:id`. The host URL that
// was canonical before stops being canonical.
export const setCanonicalHostURL: RealmOperation<
  HostURLIdInput,
  HostURL
> = async (client, input) => {
  let response = await hostURLRequest(
    client,
    hostURLEndpoint(client, input.id),
    {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'host-url',
          id: input.id,
          attributes: { isCanonical: true },
        },
      }),
    },
  );
  let json = (await response.json()) as { data: HostURLResource };
  return hostURLFromResource(json.data);
};

// Unmounts a host URL with `DELETE /_host-urls/:id`. The server refuses to
// remove the canonical host URL while the realm has other host URLs.
export const unmountHostURL: RealmOperation<HostURLIdInput, void> = async (
  client,
  input,
) => {
  await hostURLRequest(client, hostURLEndpoint(client, input.id), {
    method: 'DELETE',
  });
};

// --- site names ------------------------------------------------------------

// A site name that a user claimed for a realm. A realm can be mounted at a
// site name only after the name is claimed.
export interface ClaimedSiteName {
  id: string;
  hostname: string;
  sourceRealmURL: string;
}

interface ClaimedDomainResource {
  type: 'claimed-domain';
  id: string;
  attributes: { hostname: string; sourceRealmURL: string };
}

function claimedSiteNameFromResource({
  id,
  attributes,
}: ClaimedDomainResource): ClaimedSiteName {
  return {
    id,
    hostname: attributes.hostname,
    sourceRealmURL: attributes.sourceRealmURL,
  };
}

export interface FetchClaimedSiteNameInput {
  realmURL: string;
}

// The site name that the caller claimed for a realm, from
// `GET /_boxel-claimed-domains?source_realm_url=`. Undefined when the server
// answers 404. The server does this when the caller has no claim for the
// realm.
export const fetchClaimedSiteName: RealmOperation<
  FetchClaimedSiteNameInput,
  ClaimedSiteName | undefined
> = async (client, input) => {
  let url = new URL(`${client.realmServerURL}_boxel-claimed-domains`);
  url.searchParams.set('source_realm_url', ensureTrailingSlash(input.realmURL));
  let response: Response;
  try {
    response = await hostURLRequest(client, url.href, { method: 'GET' });
  } catch (error) {
    if (error instanceof RealmOperationError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
  let json = (await response.json()) as { data: ClaimedDomainResource };
  return claimedSiteNameFromResource(json.data);
};

export interface ClaimSiteNameInput {
  realmURL: string;
  // The hostname of the site name, for example `mango.boxel.site`.
  hostname: string;
}

// Claims a site name for a realm with `POST /_boxel-claimed-domains`. The
// server refuses a name that has a claim already.
export const claimSiteName: RealmOperation<
  ClaimSiteNameInput,
  ClaimedSiteName
> = async (client, input) => {
  let response = await hostURLRequest(
    client,
    `${client.realmServerURL}_boxel-claimed-domains`,
    {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'claimed-domain',
          attributes: {
            source_realm_url: ensureTrailingSlash(input.realmURL),
            hostname: input.hostname,
          },
        },
      }),
    },
  );
  let json = (await response.json()) as { data: ClaimedDomainResource };
  return claimedSiteNameFromResource(json.data);
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

// --- fetchPublishProgress --------------------------------------------------

// Where a published realm is in the two passes a publish waits on. `index`
// while its index lane still holds work, `render` until the prerendered HTML
// for the current generation is live, `done` once both have settled — the same
// order `_readiness-check?awaitPrerenderHtml=true` gates on. `queued` means
// work is outstanding but no worker holds it, which is worth distinguishing:
// otherwise a stalled queue is indistinguishable from a slow pass.
//
// The counts describe the pass named by `phase` and reset between them: 40/270
// under `index` is files indexed, under `render` it is pages rendered. Both are
// 0 under `queued`, and 0 for a pass whose worker hasn't reported its first
// event yet, which reads as "starting" rather than as no work.
export interface PublishProgress {
  phase: 'queued' | 'index' | 'render' | 'done';
  filesCompleted: number;
  totalFiles: number;
}

export interface FetchPublishProgressInput {
  publishedRealmURL: string;
  // Abandons the request. A progress read is advisory and short-lived, so a
  // caller that has stopped caring needs to be able to drop one that is still
  // outstanding rather than wait on it.
  signal?: AbortSignal;
}

interface PublishProgressResponseBody {
  data: {
    type: 'publish-progress';
    id: string;
    attributes: PublishProgress;
  };
}

// Reads a published realm's in-flight indexing/prerendering progress from
// `GET {realmServerURL}_publish-progress`. Served by the realm server (not the
// published realm) and authorized against the caller administering the realm
// it was published from, so it carries the realm-server token like
// `publishRealm` does.
export const fetchPublishProgress: RealmOperation<
  FetchPublishProgressInput,
  PublishProgress
> = async (client, input) => {
  let url = new URL(`${client.realmServerURL}_publish-progress`);
  url.searchParams.set(
    'published_realm_url',
    ensureTrailingSlash(input.publishedRealmURL),
  );

  let response = await client.authedFetch(url.href, {
    headers: { Accept: JSONAPI_MIME },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    let body = await safeReadResponseText(response);
    throw new RealmOperationError(
      `Fetch publish progress failed: HTTP ${response.status}: ${truncate(
        body,
        1000,
      )}`,
      { status: response.status, body },
    );
  }

  let body = (await response.json()) as PublishProgressResponseBody;
  let attrs = body?.data?.attributes;
  if (!attrs?.phase) {
    throw new RealmOperationError(
      `Publish progress response missing data.attributes.phase: ${truncate(
        JSON.stringify(body),
        500,
      )}`,
    );
  }
  return {
    phase: attrs.phase,
    filesCompleted: Number(attrs.filesCompleted ?? 0),
    totalFiles: Number(attrs.totalFiles ?? 0),
  };
};

// --- waitForReady ----------------------------------------------------------

export interface WaitForReadyInput {
  publishedRealmURL: string;
  // How long the wait goes on without the realm becoming ready. While progress
  // is sampled (`onProgress`), it counts from the last change in the reading,
  // so a publish that is still advancing keeps waiting. Defaults to 300_000ms.
  timeoutMs?: number;
  // Bounds a wait that `timeoutMs` keeps extending, so only consulted when
  // `onProgress` is supplied. Defaults to 3_600_000ms.
  maxWaitMs?: number;
  // Defaults to 1000ms.
  pollIntervalMs?: number;
  // Called with a fresh reading whenever the realm's publish progress changes,
  // so a caller can render real progress across the minutes indexing and
  // prerendering take. Sampled on its own interval alongside the readiness
  // poll, and stops when this operation settles. Progress is advisory: a
  // failing sample is swallowed rather than failing the wait, so the worst case
  // is a display that stops advancing while readiness continues normally.
  onProgress?: (progress: PublishProgress) => void;
  // Defaults to 1000ms. Only consulted when `onProgress` is supplied.
  progressPollIntervalMs?: number;
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
  let maxWaitMs = input.maxWaitMs ?? DEFAULT_READINESS_MAX_WAIT_MS;
  let pollIntervalMs =
    input.pollIntervalMs ?? DEFAULT_READINESS_POLL_INTERVAL_MS;
  let readinessUrlObj = new URL('_readiness-check', publishedRealmURL);
  if (input.awaitPrerenderHtml) {
    readinessUrlObj.searchParams.set('awaitPrerenderHtml', 'true');
  }
  let readinessUrl = readinessUrlObj.href;
  let startedAt = Date.now();
  let lastAdvancedAt = startedAt;
  // The most files completed in each pass seen so far, keyed by phase and
  // total, since every indexing or render job starts its counts from zero.
  let furthest = new Map<string, number>();
  let lastError: string | undefined;
  let lastStage: string | undefined;
  let terminalFailure: string | undefined;
  let onProgress = input.onProgress;
  let deadline = () =>
    onProgress
      ? Math.min(startedAt + maxWaitMs, lastAdvancedAt + timeoutMs)
      : startedAt + timeoutMs;

  let stopSamplingProgress = onProgress
    ? sampleProgress(
        client,
        publishedRealmURL,
        (progress) => {
          let pass = `${progress.phase}:${progress.totalFiles}`;
          let best = furthest.get(pass);
          if (best === undefined || progress.filesCompleted > best) {
            // The first reading is only a baseline.
            if (furthest.size > 0) {
              lastAdvancedAt = Date.now();
            }
            furthest.set(pass, progress.filesCompleted);
          }
          onProgress(progress);
        },
        input.progressPollIntervalMs ?? DEFAULT_PROGRESS_POLL_INTERVAL_MS,
      )
    : undefined;

  try {
    while (Date.now() < deadline()) {
      // The readiness check holds the request open, so abort it at the
      // deadline rather than letting a held request carry the wait past it.
      let controller = new AbortController();
      let abortTimer = setTimeout(
        () => controller.abort(),
        Math.max(0, deadline() - Date.now()),
      );
      try {
        let response = await client.authedFetch(readinessUrl, {
          headers: { Accept: JSONAPI_MIME },
          signal: controller.signal,
        });
        if (response.ok) {
          return;
        }
        // `X-Boxel-Not-Ready` names the outstanding stage (index vs
        // prerender-html); it's a header because pollers discard the body.
        let stage = response.headers.get('X-Boxel-Not-Ready');
        if (stage === 'index-failed') {
          // Terminal: the realm's boot index failed, so no amount of polling
          // makes it ready. This response carries the reason in its body.
          let detail = await response.text().catch(() => '');
          terminalFailure = `${publishedRealmURL} cannot become ready: its boot index failed${
            detail ? ` — ${detail}` : ''
          }`;
          break;
        }
        lastError = `HTTP ${response.status}${stage ? ` (not ready: ${stage})` : ''}`;
        lastStage = stage ?? undefined;
      } catch (error) {
        if (controller.signal.aborted) {
          continue;
        }
        // Node's fetch reports transport failures as a bare "fetch failed" and
        // puts the real reason (DNS, TLS, ECONNRESET) on `cause`, so the timeout
        // message needs both to be attributable.
        lastError = error instanceof Error ? error.message : String(error);
        // Cast: `cause` predates this package's lib target. `!= null` keeps
        // falsy-but-defined causes.
        let cause = (error as { cause?: unknown })?.cause;
        if (cause != null) {
          lastError += ` (cause: ${
            cause instanceof Error ? cause.message : String(cause)
          })`;
        }
        lastStage = undefined;
      } finally {
        clearTimeout(abortTimer);
      }
      let remaining = deadline() - Date.now();
      if (remaining <= 0) {
        break;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
      );
    }
  } finally {
    stopSamplingProgress?.();
  }

  if (terminalFailure) {
    throw new Error(terminalFailure);
  }
  let waitedMs = Date.now() - startedAt;
  let stalled =
    furthest.size > 0 && lastAdvancedAt + timeoutMs <= startedAt + maxWaitMs;
  throw new ReadinessTimeoutError(
    `Timed out after ${onProgress ? waitedMs : timeoutMs}ms waiting for ${publishedRealmURL} to pass readiness check${
      stalled ? `, with no progress for the last ${timeoutMs}ms` : ''
    }${lastError ? `: ${lastError}` : ''}`,
    { stage: lastStage, stalled },
  );
};

// Polls publish progress until stopped, reporting only when the reading
// changes so a consumer can redraw (or log) per update rather than per poll.
//
// Stopping is synchronous and cannot block. It would be tidier to await the
// loop so teardown is fully ordered, but that hands an advisory channel the
// power to hold up the wait it decorates: a progress request that never settles
// — a server that accepts the connection and then goes silent — would keep
// `waitForReady` from returning even after readiness had already passed, which
// is exactly the freeze this whole feature exists to make visible. The
// `stopped` re-check after each await is what actually enforces the contract
// that no reading lands after the wait settles; the loop is then free to unwind
// on its own.
function sampleProgress(
  client: RealmClient,
  publishedRealmURL: string,
  onProgress: (progress: PublishProgress) => void,
  intervalMs: number,
): () => void {
  let stopped = false;
  let wake: (() => void) | undefined;
  let inFlight: AbortController | undefined;
  let lastReading: string | undefined;

  void (async () => {
    while (!stopped) {
      // Per-request, so stopping abandons the outstanding read rather than
      // leaving a socket open — which in Node would hold the event loop past
      // the end of the publish.
      inFlight = new AbortController();
      try {
        let progress = await fetchPublishProgress(client, {
          publishedRealmURL,
          signal: inFlight.signal,
        });
        let reading = `${progress.phase}:${progress.filesCompleted}/${progress.totalFiles}`;
        if (!stopped && reading !== lastReading) {
          lastReading = reading;
          onProgress(progress);
        }
      } catch (_error) {
        // Advisory: a failed sample (an older realm server without the route, a
        // transient error, the abort above) must never disturb the readiness
        // wait it decorates.
      }
      if (stopped) {
        return;
      }
      // Waking clears the timer rather than just resolving ahead of it: a
      // pending timer holds Node's event loop open, which would leave the CLI
      // sitting for up to an interval after its publish had finished.
      await new Promise<void>((resolve) => {
        let timer = setTimeout(resolve, intervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  })();

  return () => {
    stopped = true;
    inFlight?.abort();
    wake?.();
  };
}

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
