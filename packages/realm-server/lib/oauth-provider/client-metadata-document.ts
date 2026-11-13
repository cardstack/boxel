// Clients identified by a client ID metadata document (ADR 021 §1.4): the
// client ID is an `https://` URL, and the client's metadata is the JSON
// document served there. The library downloads the document when a request
// names the client and keeps it in its in-memory cache (at most 100 per
// process, for the document's `Cache-Control` max-age within the bounds
// below). It is never stored: a restart, or the max-age running out, means
// the next request that names the client downloads it again.
//
// Boxel's part, in the order a request meets it:
//
// 1. `allowFetch`, before a download: a client ID under the registrable
//    domain of any of Boxel's own hosts is refused, since pages name the
//    client by that domain and anyone with an account can make some Boxel
//    host serve JSON. So is one whose scheme isn't written `https://`, which
//    pages wouldn't recognize as a document client. A client ID this process
//    hasn't accepted before counts against the caller's address and network
//    buckets of the new-client limit DCR uses, though not its overall one
//    (`new-client-limit.ts`); one it has accepted gets one download free, then
//    counts until it is accepted again. A download the limit refuses is noted
//    on the request, so the start of a flow tells the caller they were
//    limited rather than that the client is unknown (`authorization.ts`).
//    A cache hit never gets here.
// 2. `fetch`, the download: through the outbound guard, so a client ID can't
//    reach a private address, with no redirect followed and at most
//    `MAX_DOCUMENT_BYTES` read.
// 3. `validate`, as the library builds the client from the document: the
//    rules a registration meets, and the same rewrite, so a document client
//    holds only what a registered one may. Its application type comes from
//    its redirect URIs, so a document listing loopback redirects is native
//    without declaring it, as Claude Code's doesn't.
// 4. `allowClient`, each time the client is used, cached or not: notes the
//    client ID as accepted and most recently used, and logs a cache hit.
//
// Boxel's own checks before the library look a client up too (the start of a
// flow, the error page, consent), outside the library's handling of a request.
// Every provider route runs inside `inMetadataDocumentRequest` (`serve.ts`), so
// the hooks know the caller's address on either path. A request that Boxel's
// check falls through on reaches the library, which may look the client up
// twice more (its client check and its error handler), so each client ID gets
// at most one download decision per request: one download, counted once.
//
// Pages name a document client by its client ID's registrable domain
// (`app-name.ts`), never by what the document says.

import { AsyncLocalStorage } from 'node:async_hooks';
import { errors, type KoaContextWithOIDC } from 'oidc-provider';
import { logger, type RateLimitStore } from '@cardstack/runtime-common';
import {
  OutboundRefusedError,
  OutboundResponseTooLargeError,
  OutboundTimeoutError,
  outboundFetch,
} from '../outbound/client.ts';
import { registrableDomain } from '../secure-window.ts';
import {
  takeNewClientDownload,
  type NewClientLimit,
} from './new-client-limit.ts';
import type { BoxelHosts } from './redirect-uris.ts';
import { checkRegistration } from './registration.ts';

const log = logger('boxel:oauth-provider');

// The library's own limit, set so an upgrade can't change it. A document is
// a few hundred bytes.
export const MAX_DOCUMENT_BYTES = 5 * 1024;

// How long, in seconds, a downloaded document is kept: the document's
// `Cache-Control` max-age, held within these bounds. The library's defaults.
export const DOCUMENT_CACHE_SECONDS = Object.freeze({ min: 30, max: 86400 });

// The client IDs a process remembers having accepted, so a document it
// downloads again (after its max-age, or once the library's cache drops it)
// isn't counted as a new client. Bounded, the least recently used forgotten
// first; a forgotten one is counted again.
const KNOWN_CLIENT_IDS = 1000;

// The library runs `extraClientMetadata.validator` once for each property
// listed, as it builds any client, so one property is listed to run Boxel's
// checks. Registration drops it, as it drops every field it doesn't allow,
// and the checks delete it from a document, so no client ever holds it.
export const CHECKS_PROPERTY = 'boxel_checks';

// Whether a client ID names a metadata document rather than a registered
// client, as the library decides it: any letter case of the scheme. The
// library also checks the rest of the URL's form before it downloads.
export function isMetadataDocumentClientId(id: unknown): id is string {
  return typeof id === 'string' && /^https:\/\//i.test(id);
}

// How a log line names a client: a document client by its client ID's host
// alone, since the rest of the URL is the client's to choose and can carry
// anything, a token included; a registered client by its generated ID.
export function clientIdForLogs(clientId: string): string {
  if (!isMetadataDocumentClientId(clientId)) {
    return clientId;
  }
  let host = URL.parse(clientId)?.host;
  return host ? `metadata document on ${host}` : 'a metadata document';
}

// The registrable domains of Boxel's own hosts, the way pages name a document
// client (`app-name.ts`).
export function boxelDomains(hosts: BoxelHosts): ReadonlySet<string> {
  return new Set(
    [...hosts.exact, ...hosts.domains].map((host) => registrableDomain(host)),
  );
}

interface MetadataDocumentRequest {
  // The `CLIENT_IP_HEADER` value.
  address: string | undefined;
  // The client IDs a download was decided for in this request.
  asked: Set<string>;
  // Whether the new-client limit refused a download in this request.
  limited: boolean;
}

const currentRequest = new AsyncLocalStorage<MetadataDocumentRequest>();

// Runs one request to the provider's routes, so the hooks below know who is
// asking whichever path looks a client up.
export function inMetadataDocumentRequest<T>(
  address: string | undefined,
  handle: () => Promise<T>,
): Promise<T> {
  return currentRequest.run(
    { address, asked: new Set(), limited: false },
    handle,
  );
}

// Whether the new-client limit refused a download in the current request. The
// library reports such a client as unknown, so the start of a flow asks this
// to show the caller they were limited, and can try again later.
export function metadataDocumentLimited(): boolean {
  return currentRequest.getStore()?.limited ?? false;
}

export interface ClientMetadataDocuments {
  allowFetch: (
    ctx: KoaContextWithOIDC | undefined,
    clientId: string,
  ) => Promise<boolean>;
  allowClient: (
    ctx: KoaContextWithOIDC | undefined,
    client: { clientId: string },
  ) => Promise<boolean>;
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  validate: (
    ctx: KoaContextWithOIDC | undefined,
    key: string,
    value: unknown,
    metadata: Record<string, unknown>,
  ) => void;
}

export function clientMetadataDocuments({
  hosts,
  scopes,
  rateLimitStore,
  newClientLimit,
  testOnlyDocumentOrigins,
}: {
  hosts: BoxelHosts;
  scopes: readonly string[];
  rateLimitStore: RateLimitStore;
  newClientLimit: NewClientLimit;
  // Tests only: each `https://` origin named here is downloaded from the
  // plain HTTP origin it maps to, a stub on loopback, still through the
  // outbound guard. Nothing in production sets it.
  testOnlyDocumentOrigins?: ReadonlyMap<string, string>;
}): ClientMetadataDocuments {
  let ownDomains = boxelDomains(hosts);
  let known = new BoundedSet(KNOWN_CLIENT_IDS);
  // The client IDs downloaded and not yet used, so `allowClient` can tell a
  // download from a cache hit. Bounded, since a download that fails after it
  // is read (a document the library refuses) is never used.
  let downloading = new BoundedSet(KNOWN_CLIENT_IDS);

  async function allowFetch(
    _ctx: KoaContextWithOIDC | undefined,
    clientId: string,
  ): Promise<boolean> {
    let request = currentRequest.getStore();
    if (request) {
      if (request.asked.has(clientId)) {
        return false;
      }
      request.asked.add(clientId);
    }
    let url = URL.parse(clientId);
    if (!url) {
      return false;
    }
    if (!clientId.startsWith('https://')) {
      note('refused', url, 'scheme-case');
      return false;
    }
    if (ownDomains.has(registrableDomain(url.hostname))) {
      note('refused', url, 'boxel-domain');
      return false;
    }
    // A client accepted before gets this download free. It counts again
    // until it is accepted again, so a document that stopped loading can't
    // be downloaded for free over and over.
    if (!known.delete(clientId)) {
      let outcome = await takeNewClientDownload(
        rateLimitStore,
        request?.address,
        newClientLimit,
      );
      if (!outcome.admitted) {
        if (request) {
          request.limited = true;
        }
        note('refused', url, outcome.reason);
        return false;
      }
    }
    downloading.add(clientId);
    return true;
  }

  async function allowClient(
    _ctx: KoaContextWithOIDC | undefined,
    client: { clientId: string },
  ): Promise<boolean> {
    let { clientId } = client;
    // Known clients are ordered by last use, so one in use stays known.
    known.add(clientId);
    if (!downloading.delete(clientId)) {
      let url = URL.parse(clientId);
      if (url) {
        note('cache-hit', url);
      }
    }
    return true;
  }

  async function fetchDocument(
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> {
    // The library passes the client ID exactly as the request gave it, the
    // same string `allowFetch` was asked about. Anything else would be a
    // normalized form that no longer matches it.
    if (typeof input !== 'string') {
      throw new TypeError(
        'a client metadata document is fetched by its client ID',
      );
    }
    let clientId = input;
    let url = new URL(clientId);
    let mapped = testOnlyDocumentOrigins?.get(url.origin);
    let target = mapped ? `${mapped}${url.pathname}${url.search}` : clientId;
    let response: Response;
    try {
      response = await outboundFetch({
        url: target,
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: init.signal ?? undefined,
        sizePath: 'call-api',
        responseSizeCap: MAX_DOCUMENT_BYTES,
        destinationSetBy: 'user',
        noRedirects: true,
      });
    } catch (error) {
      downloading.delete(clientId);
      note('failed', url, failureReason(error));
      throw error;
    }
    if (response.status !== 200) {
      downloading.delete(clientId);
      note('failed', url, `status-${response.status}`);
    } else {
      note('downloaded', url);
    }
    return response;
  }

  function validate(
    _ctx: KoaContextWithOIDC | undefined,
    _key: string,
    _value: unknown,
    metadata: Record<string, unknown>,
  ): void {
    // A registered client met these checks when it registered, and is
    // stored as they left it.
    if (!isMetadataDocumentClientId(metadata.client_id)) {
      return;
    }
    let check = checkRegistration({ ...metadata }, { hosts, scopes });
    if (!check.allowed) {
      downloading.delete(metadata.client_id);
      let url = URL.parse(metadata.client_id);
      if (url) {
        note('refused', url, check.error);
      }
      throw new errors.InvalidClientMetadata(check.description);
    }
    // Only what a registration may set is kept, as Boxel rewrote it. Every
    // other field is deleted, and the library fills in its default for any
    // field it has one for.
    for (let field of Object.keys(metadata)) {
      if (field !== 'client_id' && !(field in check.registration)) {
        delete metadata[field];
      }
    }
    Object.assign(metadata, check.registration);
  }

  return {
    allowFetch,
    allowClient,
    fetch: fetchDocument,
    validate,
  };
}

// One line per download, refusal, failure and cache hit, naming only the
// client ID's host: its path is the client's own, and logs need no more.
function note(
  outcome: 'downloaded' | 'refused' | 'failed' | 'cache-hit',
  url: URL,
  reason?: string,
) {
  log.info(
    `client metadata document: outcome=${outcome}${
      reason ? ` reason=${reason}` : ''
    } host=${url.host}`,
  );
}

function failureReason(error: unknown): string {
  if (error instanceof OutboundRefusedError) {
    return `guard-${error.reason}`;
  }
  if (error instanceof OutboundTimeoutError) {
    return 'timeout';
  }
  if (error instanceof OutboundResponseTooLargeError) {
    return 'too-large';
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'timeout';
  }
  return 'error';
}

// A set that forgets its oldest member once it holds `limit`.
class BoundedSet {
  #members = new Set<string>();
  #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  has(member: string): boolean {
    return this.#members.has(member);
  }

  add(member: string): void {
    this.#members.delete(member);
    this.#members.add(member);
    if (this.#members.size > this.#limit) {
      let oldest = this.#members.values().next().value;
      if (oldest !== undefined) {
        this.#members.delete(oldest);
      }
    }
  }

  delete(member: string): boolean {
    return this.#members.delete(member);
  }
}
