import { isIP } from 'node:net';
import { Agent } from 'undici';
import { logger } from '@cardstack/runtime-common';
import {
  BlockedAddressError,
  guardedLookup,
  isAllowedAddress,
  isPublicAddress,
  type ResolveHost,
} from './address-policy.ts';
import { runAsGuardedCall } from './guarded-call-context.ts';
import { scrubError } from './scrub-error.ts';
import { CredentialScrubber } from './scrubber.ts';

// The one client every call that sends a credential to an outside vendor goes
// through. It:
//
// - requires HTTPS, except for hosts the local development allowlist names;
// - refuses a destination that is, or resolves to, a private, loopback,
//   link-local, metadata or other non-public address, and connects to the
//   address it checked rather than resolving the name again;
// - follows redirects itself so every hop is checked the same way, and drops
//   the credential on a hop to another origin;
// - bounds the connection and the whole exchange with timeouts;
// - refuses `X-Boxel-*` request headers, so nothing Boxel-internal reaches a
//   vendor;
// - attaches the credential itself, so the substituted URL exists only here,
//   between substitution and send. Everything it records — log lines, errors —
//   names the key and the URL as the caller gave it, never the value;
// - scrubs every error it throws of the attached credential, and keeps Sentry's
//   fetch instrumentation off its requests (see `guarded-call-context.ts`);
// - streams the response body through, counting its decompressed bytes against
//   a response size cap. The cap is in observe mode: what an enforced cap
//   would have refused is logged and nothing is refused;
// - removes every credential registered with the request's scrubber from the
//   response's status text, headers and decompressed body, as a stream, before
//   the caller reads any of it.
//
// Requests go out through `globalThis.fetch` with a guarded dispatcher, so the
// body is decompressed as a stream by fetch itself and never buffered here.

const log = logger('outbound');

// Which platform setting a response is measured against. The system-key path
// (`_request-forward`, the OpenRouter passthrough, and the generation-cost
// lookup either of them makes) carries image generation, whose responses run
// to megabytes; `callApi` is a card's own declared request.
export type ResponseSizePath = 'system-key' | 'call-api';

export interface OutboundSettings {
  // Hosts that may be reached over plain HTTP and may resolve to a local
  // address. Development and tests only: a deployed server refuses to start
  // with any entry (see `checkOutboundSettings`).
  devAllowlist: string[];
  connectTimeoutMs: number;
  // The whole exchange: every redirect hop, the response headers and reading
  // the body.
  totalTimeoutMs: number;
  maxRedirects: number;
  responseSizeCaps: Record<ResponseSizePath, number>;
  // Resolves a hostname to every address it has. Injectable for tests, which
  // point public-looking names at addresses the guard must refuse.
  resolveHost?: ResolveHost;
}

const MiB = 1024 * 1024;

export const DEFAULT_OUTBOUND_SETTINGS: Readonly<OutboundSettings> =
  Object.freeze({
    devAllowlist: [],
    connectTimeoutMs: 10_000,
    // A streamed model generation or an image generation can run for
    // minutes, so the bound sits well above the longest of those.
    totalTimeoutMs: 10 * 60_000,
    maxRedirects: 5,
    // Observe-mode starting points. The enforced values come from the sizes
    // these paths log in practice.
    responseSizeCaps: { 'system-key': 32 * MiB, 'call-api': 10 * MiB },
  });

let settings: OutboundSettings = { ...DEFAULT_OUTBOUND_SETTINGS };
let dispatcher: Agent | undefined;

export function configureOutbound(overrides: Partial<OutboundSettings>): void {
  settings = {
    ...settings,
    ...overrides,
    devAllowlist: (overrides.devAllowlist ?? settings.devAllowlist).map(
      normalizeHost,
    ),
    responseSizeCaps: {
      ...settings.responseSizeCaps,
      ...overrides.responseSizeCaps,
    },
  };
  resetDispatcher();
}

export function resetOutbound(): void {
  settings = { ...DEFAULT_OUTBOUND_SETTINGS };
  resetDispatcher();
}

export function outboundSettings(): Readonly<OutboundSettings> {
  return settings;
}

function resetDispatcher() {
  let previous = dispatcher;
  dispatcher = undefined;
  // Calls already under way keep their sockets until they finish.
  previous?.close().catch(() => undefined);
}

function guardedDispatcher(): Agent {
  return (dispatcher ??= new Agent({
    connect: {
      timeout: settings.connectTimeoutMs,
      lookup: guardedLookup({
        resolveHost: settings.resolveHost,
        isAllowlisted,
      }),
    },
  }));
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isAllowlisted(hostname: string): boolean {
  return settings.devAllowlist.includes(normalizeHost(hostname));
}

// Whether the local development allowlist names `hostname`, so the client
// would send to it over plain http.
export function isOutboundDevAllowlisted(hostname: string): boolean {
  return isAllowlisted(hostname);
}

// --- Settings from the environment and the startup self-check ---------------

export class OutboundSettingsError extends Error {}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
): number | undefined {
  let raw = env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  let value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OutboundSettingsError(
      `${name} must be a positive whole number, not "${raw}"`,
    );
  }
  return value;
}

export function outboundSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Partial<OutboundSettings> {
  let result: Partial<OutboundSettings> = {
    devAllowlist: (env.OUTBOUND_DEV_ALLOWLIST ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
  let connectTimeoutMs = readPositiveInteger(
    env,
    'OUTBOUND_CONNECT_TIMEOUT_MS',
  );
  if (connectTimeoutMs !== undefined) {
    result.connectTimeoutMs = connectTimeoutMs;
  }
  let totalTimeoutMs = readPositiveInteger(env, 'OUTBOUND_TOTAL_TIMEOUT_MS');
  if (totalTimeoutMs !== undefined) {
    result.totalTimeoutMs = totalTimeoutMs;
  }
  let systemKeyCap = readPositiveInteger(
    env,
    'OUTBOUND_RESPONSE_CAP_SYSTEM_KEY_BYTES',
  );
  let callApiCap = readPositiveInteger(
    env,
    'OUTBOUND_RESPONSE_CAP_CALL_API_BYTES',
  );
  if (systemKeyCap !== undefined || callApiCap !== undefined) {
    result.responseSizeCaps = {
      ...DEFAULT_OUTBOUND_SETTINGS.responseSizeCaps,
      ...(systemKeyCap !== undefined ? { 'system-key': systemKeyCap } : {}),
      ...(callApiCap !== undefined ? { 'call-api': callApiCap } : {}),
    };
  }
  return result;
}

const LOCAL_HOSTNAME_RE = /(^|\.)localhost$/;

function isLocalHostname(hostname: string): boolean {
  let host = normalizeHost(hostname);
  return (
    LOCAL_HOSTNAME_RE.test(host) || (isIP(host) !== 0 && !isPublicAddress(host))
  );
}

// A server is deployed unless its own URL names a local host. Deciding from
// the server's URL rather than from a flag means a deployment can't be
// mistaken for development by leaving something unset.
export function isDeployedServerURL(serverURL: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(serverURL).hostname;
  } catch {
    return true;
  }
  return !isLocalHostname(hostname);
}

// Throws when the settings would weaken the guard where they must not: a
// wildcard or malformed allowlist entry anywhere, and any allowlist entry at
// all on a deployed server.
export function checkOutboundSettings(
  candidate: Partial<OutboundSettings>,
  { deployed }: { deployed: boolean },
): void {
  let allowlist = candidate.devAllowlist ?? [];
  for (let entry of allowlist) {
    let host = normalizeHost(entry);
    // A colon is a port unless the entry is an IPv6 literal.
    let hasPort = host.includes(':') && isIP(host) !== 6;
    if (!host || hasPort || /[*/\s@?#]/.test(host)) {
      throw new OutboundSettingsError(
        `OUTBOUND_DEV_ALLOWLIST entry "${entry}" is not a single host name; wildcards, paths and ports are refused`,
      );
    }
  }
  if (deployed && allowlist.length > 0) {
    throw new OutboundSettingsError(
      `OUTBOUND_DEV_ALLOWLIST must be empty on a deployed server, but names ${allowlist.join(', ')}`,
    );
  }
}

// Run once at startup: reads the settings from the environment, refuses a
// permissive allowlist on a deployed server, applies the settings and reports
// what is in effect.
export function startOutboundGuard({
  serverURL,
  env = process.env,
}: {
  serverURL: string;
  env?: NodeJS.ProcessEnv;
}): void {
  let candidate = outboundSettingsFromEnv(env);
  let deployed = isDeployedServerURL(serverURL);
  checkOutboundSettings(candidate, { deployed });
  configureOutbound(candidate);
  let effective = outboundSettings();
  log.info(
    `outbound guard: deployed=${deployed} devAllowlist=${
      effective.devAllowlist.length > 0
        ? effective.devAllowlist.join(',')
        : '(none)'
    } connectTimeoutMs=${effective.connectTimeoutMs} totalTimeoutMs=${
      effective.totalTimeoutMs
    } maxRedirects=${effective.maxRedirects} responseSizeCap.system-key=${
      effective.responseSizeCaps['system-key']
    } responseSizeCap.call-api=${
      effective.responseSizeCaps['call-api']
    } responseSizeCapMode=observe`,
  );
}

// --- Errors ---------------------------------------------------------------

// What an error from a send identifies the call by: the key's name and the
// origin and path of the URL the caller gave, before the credential was
// attached. Never a value, and never the caller's query string or userinfo.
export interface OutboundErrorContext {
  keyName?: string;
  url: string;
}

// The part of a URL a send records: its origin and path. The query string and
// any userinfo are the caller's, and may carry a token or user content, so
// they are not ours to record.
export function recordedURL(url: string): string {
  try {
    let parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

// The context a send's errors and log lines carry. Build every one through
// this, so the URL is always the recorded form.
export function sendContext(
  keyName: string | undefined,
  url: string,
): OutboundErrorContext {
  return { keyName, url: recordedURL(url) };
}

export type OutboundRefusal =
  | 'invalid-url'
  | 'scheme'
  | 'address'
  | 'forbidden-header'
  | 'too-many-redirects';

// The guard refused the call. The message names the host at most, never the
// full URL, which may carry a credential in its query string.
export class OutboundRefusedError extends Error {
  readonly reason: OutboundRefusal;
  context?: OutboundErrorContext;
  constructor(reason: OutboundRefusal, message: string) {
    super(message);
    this.name = 'OutboundRefusedError';
    this.reason = reason;
  }
}

export class OutboundTimeoutError extends Error {
  readonly phase: 'connect' | 'total';
  context?: OutboundErrorContext;
  constructor(phase: 'connect' | 'total', options?: { cause?: unknown }) {
    super(
      phase === 'connect'
        ? 'Timed out connecting to the destination'
        : 'The destination did not answer in time',
      options,
    );
    this.name = 'OutboundTimeoutError';
    this.phase = phase;
  }
}

// Any other failure of a send: the request could not be built, the connection
// failed, the body stream broke. The message names the key and the
// recorded URL (see `recordedURL`); `cause` is the original error, scrubbed.
export class OutboundSendError extends Error {
  readonly context: OutboundErrorContext;
  constructor(context: OutboundErrorContext, cause: unknown) {
    let detail =
      cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
    super(
      `Sending to ${context.url}${
        context.keyName ? ` with key ${context.keyName}` : ''
      } failed: ${detail}`,
      { cause },
    );
    this.name = 'OutboundSendError';
    this.context = context;
  }
}

export function outboundErrorContext(
  error: unknown,
): OutboundErrorContext | undefined {
  if (
    error instanceof OutboundRefusedError ||
    error instanceof OutboundTimeoutError ||
    error instanceof OutboundSendError
  ) {
    return error.context;
  }
  return undefined;
}

// `key=<name> url=<recorded URL>` for a log line: the error's own
// context when the outbound client threw it, else `fallback` — what the caller
// knows of the call it was making — else ''.
export function describeOutboundError(
  error: unknown,
  fallback?: OutboundErrorContext,
): string {
  let context = outboundErrorContext(error) ?? fallback;
  if (!context) {
    return '';
  }
  return `${context.keyName ? `key=${context.keyName} ` : ''}url=${context.url}`;
}

const MAX_CAUSE_DEPTH = 8;

function findInCauseChain(
  error: unknown,
  match: (candidate: any) => boolean,
): any {
  let cursor: unknown = error;
  for (let depth = 0; cursor != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (match(cursor)) {
      return cursor;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

// Puts a fetch failure in the guard's terms. A caller's own cancellation is
// passed through untouched, so the caller still recognizes its abort.
function translateError(
  error: unknown,
  timeout: AbortSignal,
  hostname: string,
): unknown {
  if (timeout.aborted) {
    return new OutboundTimeoutError('total', { cause: error });
  }
  if (findInCauseChain(error, (e) => e instanceof BlockedAddressError)) {
    return new OutboundRefusedError(
      'address',
      `${hostname} resolves to a private or reserved address`,
    );
  }
  if (findInCauseChain(error, (e) => e?.code === 'UND_ERR_CONNECT_TIMEOUT')) {
    return new OutboundTimeoutError('connect', { cause: error });
  }
  return error;
}

// Every error leaving the client: scrubbed of the attached credential and
// identified by the key's name and the recorded URL. A caller's own
// abort keeps its identity.
function finalizeError(
  error: unknown,
  scrubber: CredentialScrubber,
  context: OutboundErrorContext,
  callerSignal: AbortSignal | undefined,
): unknown {
  scrubError(error, scrubber);
  if (
    error instanceof OutboundRefusedError ||
    error instanceof OutboundTimeoutError
  ) {
    error.context ??= context;
    return error;
  }
  if (error instanceof OutboundSendError) {
    return error;
  }
  if (callerSignal?.aborted || (error as any)?.name === 'AbortError') {
    return error;
  }
  return new OutboundSendError(context, error);
}

// --- Requests ---------------------------------------------------------------

// Where the outbound client attaches a credential. `header` sets the named
// header to the value, after `scheme` and a space when one is given; `query`
// sets the named query parameter.
export type CredentialPlacement =
  | { in: 'header'; header: string; scheme?: string }
  | { in: 'query'; parameter: string };

export interface OutboundCredential {
  // How logs and errors identify the key. Never the value.
  name: string;
  value: string;
  placement: CredentialPlacement;
}

export interface OutboundRequest {
  // The URL before any credential is attached. It is what every log line and
  // error records.
  url: string;
  method: string;
  // Exactly the headers that go out. Nothing from the request that led to
  // this call is added.
  headers: Record<string, string>;
  body?: BodyInit;
  // The caller's cancellation, e.g. its client going away.
  signal?: AbortSignal;
  sizePath: ResponseSizePath;
  // The credential to attach. A redirect to another origin drops it.
  credential?: OutboundCredential;
  // Values filled into the request where their tokens stand, once the request
  // as given has passed the destination check. A request carrying any is not
  // followed across a redirect to another origin: the redirect itself is the
  // response, since a filled value can sit in the body or a header that a
  // redirect would carry on.
  substitutions?: OutboundSubstitution[];
  // Never follow a redirect to another origin: the redirect itself is the
  // response. For a request whose body or headers carry a secret the caller
  // put there itself, such as a token request's client secret or refresh
  // token, which a 307 or 308 would otherwise resend wherever it points.
  sameOriginOnly?: boolean;
  // Every form of the attached credential is registered here, and the
  // response comes back with each registered value removed. A caller that
  // sends a credential some other way (substituted into the body, or a
  // transform of one) registers it here itself. A caller that keeps handling
  // the call after `outboundFetch` returns passes its own and scrubs with it.
  scrubber?: CredentialScrubber;
}

// A value the client fills into a request at send time. `token` is text the
// request carries in the URL, a header value or the body wherever the value
// goes, chosen from characters every one of those encodings leaves alone, so
// it reads the same in each. The value is encoded for where it lands: as a
// URL component in the URL, as a JSON string's contents in the body, and as
// itself in a header.
export interface OutboundSubstitution {
  token: string;
  value: string;
}

const SUBSTITUTION_TOKEN = /^[A-Za-z0-9_]+$/;

function substituteInto(
  text: string,
  substitutions: OutboundSubstitution[],
  encode: (value: string) => string,
): string {
  let result = text;
  for (let { token, value } of substitutions) {
    result = result.split(token).join(encode(value));
  }
  return result;
}

// Fills every substitution into the request, registering each value with the
// scrubber first so nothing the response echoes carries one back. The URL is
// filled after it was checked as given, and has to keep its origin: a value
// may fill a path segment or a query value, never the destination. A value
// filled into the path stays within its segment, to the URL and to a vendor
// that decodes the path before routing alike: it may not hold `/` or `\`
// (sent as `%2F` and `%5C`), nor be a dot segment the URL resolves away.
function applySubstitutions(
  url: URL,
  headers: Record<string, string>,
  body: BodyInit | undefined,
  substitutions: OutboundSubstitution[] | undefined,
  scrubber: CredentialScrubber,
): { url: URL; body: BodyInit | undefined } {
  if (!substitutions || substitutions.length === 0) {
    return { url, body };
  }
  for (let { token, value } of substitutions) {
    if (!SUBSTITUTION_TOKEN.test(token)) {
      throw new Error(`A substitution token must be letters, digits and _`);
    }
    scrubber.register(value);
    if (url.pathname.includes(token) && /[/\\]/.test(value)) {
      throw new OutboundRefusedError(
        'invalid-url',
        'A value filled into the path holds a path separator',
      );
    }
  }
  let filled: URL;
  let path: string;
  try {
    filled = new URL(
      substituteInto(url.href, substitutions, encodeURIComponent),
    );
    path = substituteInto(url.pathname, substitutions, encodeURIComponent);
  } catch {
    throw new OutboundRefusedError('invalid-url', 'The URL is not valid');
  }
  if (filled.origin !== url.origin) {
    throw new OutboundRefusedError(
      'invalid-url',
      `A filled value may not change where ${normalizeHost(url.hostname)} is reached`,
    );
  }
  if (filled.pathname !== path) {
    throw new OutboundRefusedError(
      'invalid-url',
      'A value filled into the path is a dot segment, which the URL resolves away',
    );
  }
  for (let [name, value] of Object.entries(headers)) {
    headers[name] = substituteInto(value, substitutions, (v) => v);
  }
  if (body !== undefined && typeof body !== 'string') {
    throw new Error(`A request with substitutions carries a string body`);
  }
  return {
    url: filled,
    body:
      body === undefined
        ? undefined
        : substituteInto(body, substitutions, (v) =>
            JSON.stringify(v).slice(1, -1),
          ),
  };
}

const FORBIDDEN_HEADER_PREFIX = 'x-boxel-';

// The header names a caller may not send to a vendor.
export function forbiddenOutboundHeaders(
  headers: Record<string, string> | undefined,
): string[] {
  return Object.keys(headers ?? {}).filter((name) =>
    name.toLowerCase().startsWith(FORBIDDEN_HEADER_PREFIX),
  );
}

// Refuses a destination the guard can judge before connecting: an
// unparseable URL, a scheme other than HTTPS for a host the allowlist doesn't
// name, and an IP literal that isn't allowed. A hostname is judged when the
// socket resolves it.
function checkDestination(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OutboundRefusedError('invalid-url', 'The URL is not valid');
  }
  let hostname = normalizeHost(parsed.hostname);
  let allowlisted = isAllowlisted(hostname);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && allowlisted)
  ) {
    throw new OutboundRefusedError(
      'scheme',
      `Only https URLs are allowed (got ${parsed.protocol.replace(/:$/, '')} for ${hostname})`,
    );
  }
  if (isIP(hostname) !== 0 && !isAllowedAddress(hostname, allowlisted)) {
    throw new OutboundRefusedError(
      'address',
      `${hostname} is a private or reserved address`,
    );
  }
  return parsed;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function withoutHeaders(
  headers: Record<string, string>,
  names: string[],
): Record<string, string> {
  let drop = new Set(names.map((name) => name.toLowerCase()));
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !drop.has(name.toLowerCase())),
  );
}

// fetch strips HTTP whitespace from both ends of a header value before it
// validates it, and an invalid value is quoted in that stripped form.
const HTTP_WHITESPACE_EDGES = /^[\t\n\r ]+|[\t\n\r ]+$/g;

// Attaches `credential` to the request, registering each form it is attached
// in with `scrubber`. Returns the URL to send to, and the headers that carry
// the credential, which a redirect to another origin drops.
function attachCredential(
  url: URL,
  headers: Record<string, string>,
  credential: OutboundCredential | undefined,
  scrubber: CredentialScrubber,
): { url: string; credentialHeaders: string[] } {
  if (!credential) {
    return { url: url.href, credentialHeaders: [] };
  }
  scrubber.register(credential.value);
  let { placement } = credential;
  if (placement.in === 'query') {
    let substituted = new URL(url.href);
    substituted.searchParams.set(placement.parameter, credential.value);
    return { url: substituted.href, credentialHeaders: [] };
  }
  let value = placement.scheme
    ? `${placement.scheme} ${credential.value}`
    : credential.value;
  // Only the credential, never the `<scheme> <value>` header value around it:
  // the scrubber matches partial runs, and a run of the scheme and the key's
  // public prefix would redact text that holds no credential.
  scrubber.register(credential.value.replace(HTTP_WHITESPACE_EDGES, ''));
  for (let name of Object.keys(headers)) {
    if (name.toLowerCase() === placement.header.toLowerCase()) {
      delete headers[name];
    }
  }
  headers[placement.header] = value;
  return { url: url.href, credentialHeaders: [placement.header] };
}

export async function outboundFetch(
  request: OutboundRequest,
): Promise<Response> {
  let scrubber = request.scrubber ?? new CredentialScrubber();
  let context = sendContext(request.credential?.name, request.url);
  try {
    return await send(request, scrubber, context);
  } catch (error) {
    throw finalizeError(error, scrubber, context, request.signal);
  }
}

async function send(
  request: OutboundRequest,
  scrubber: CredentialScrubber,
  context: OutboundErrorContext,
): Promise<Response> {
  let forbidden = forbiddenOutboundHeaders(request.headers);
  if (forbidden.length > 0) {
    throw new OutboundRefusedError(
      'forbidden-header',
      `Header ${forbidden.join(', ')} may not be sent to an outside destination`,
    );
  }

  let timeout = AbortSignal.timeout(settings.totalTimeoutMs);
  let signal = request.signal
    ? AbortSignal.any([request.signal, timeout])
    : timeout;

  let method = request.method;
  let headers = { ...request.headers };
  let checked = checkDestination(request.url);
  let filled = applySubstitutions(
    checked,
    headers,
    request.body,
    request.substitutions,
    scrubber,
  );
  let body = filled.body;
  let attached = attachCredential(
    filled.url,
    headers,
    request.credential,
    scrubber,
  );
  let url = attached.url;
  let staysOnOrigin =
    (request.substitutions?.length ?? 0) > 0 || request.sameOriginOnly === true;

  for (let hop = 0; ; hop++) {
    let current = checkDestination(url);
    let hostname = normalizeHost(current.hostname);
    let init: RequestInit & { dispatcher: Agent } = {
      method,
      headers,
      signal,
      redirect: 'manual',
      dispatcher: guardedDispatcher(),
    };
    if (body !== undefined) {
      init.body = body;
    }

    let response: Response;
    try {
      response = await runAsGuardedCall(() => globalThis.fetch(url, init));
    } catch (error) {
      throw translateError(error, timeout, hostname);
    }

    let location = response.headers.get('location');
    if (
      !REDIRECT_STATUSES.has(response.status) ||
      !location ||
      (staysOnOrigin && leavesOrigin(location, current))
    ) {
      let observed = observeResponseSize(response, {
        destination: recordedURL(request.url),
        sizePath: request.sizePath,
        timeout,
        hostname,
        callerSignal: request.signal,
        scrubber,
        context,
      });
      return scrubResponse(observed, scrubber);
    }

    await response.body?.cancel().catch(() => undefined);
    if (hop >= settings.maxRedirects) {
      throw new OutboundRefusedError(
        'too-many-redirects',
        `${hostname} redirected more than ${settings.maxRedirects} times`,
      );
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new OutboundRefusedError(
        'invalid-url',
        `${hostname} redirected to a URL that is not valid`,
      );
    }
    if (next.origin !== current.origin) {
      headers = withoutHeaders(headers, attached.credentialHeaders);
    }
    // As fetch itself does: a 303, and a 301 or 302 answering a POST, turn
    // into a GET without a body.
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method.toUpperCase() === 'POST')
    ) {
      if (method.toUpperCase() !== 'HEAD') {
        method = 'GET';
      }
      body = undefined;
      headers = withoutHeaders(headers, ['content-type', 'content-length']);
    }
    url = next.href;
  }
}

// Whether a redirect's `location` names another origin. One that does not
// parse is judged as leaving: following it is refused below either way.
function leavesOrigin(location: string, current: URL): boolean {
  try {
    return new URL(location, current).origin !== current.origin;
  } catch {
    return true;
  }
}

// --- Response size, observe mode --------------------------------------------

// Hands back `response` with its body counted as it streams. Decompression
// has already happened inside fetch, chunk by chunk, so the count is of
// decompressed bytes and nothing is held beyond the chunk in hand.
//
// Each response logs its size once it ends. A declared length over the cap,
// and a body whose count passes the cap, each log what an enforced cap would
// have refused; the body still streams on unchanged.
function observeResponseSize(
  response: Response,
  {
    destination,
    sizePath,
    timeout,
    hostname,
    callerSignal,
    scrubber,
    context,
  }: {
    destination: string;
    sizePath: ResponseSizePath;
    timeout: AbortSignal;
    hostname: string;
    callerSignal: AbortSignal | undefined;
    scrubber: CredentialScrubber;
    context: OutboundErrorContext;
  },
): Response {
  let cap = settings.responseSizeCaps[sizePath];
  let describe = `path=${sizePath} destination=${destination} status=${response.status} cap=${cap}`;

  let declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    log.warn(
      `outbound response over size cap (observe): ${describe} declaredBytes=${declared} wouldRefuse=declared-length`,
    );
  }

  let source = response.body;
  if (!source) {
    log.info(`outbound response size: ${describe} bytes=0`);
    return response;
  }

  let reader = source.getReader();
  let bytes = 0;
  let reachedCap = false;
  let ended = false;
  let finish = (outcome: string) => {
    if (ended) {
      return;
    }
    ended = true;
    log.info(
      `outbound response size: ${describe} bytes=${bytes} outcome=${outcome}${
        reachedCap ? ' overCap=true' : ''
      }`,
    );
  };

  let counted = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        finish('error');
        controller.error(
          finalizeError(
            translateError(error, timeout, hostname),
            scrubber,
            context,
            callerSignal,
          ),
        );
        return;
      }
      if (result.done) {
        finish('complete');
        controller.close();
        return;
      }
      bytes += result.value.byteLength;
      if (!reachedCap && bytes > cap) {
        reachedCap = true;
        log.warn(
          `outbound response over size cap (observe): ${describe} bytesRead=${bytes} wouldRefuse=stream-reached-cap`,
        );
      }
      controller.enqueue(result.value);
    },
    async cancel(reason) {
      finish('cancelled');
      await reader.cancel(reason);
    },
  });

  return new Response(counted, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// --- Scrubbing ---------------------------------------------------------------

// Hands back `response` with every registered credential removed. The body
// is scrubbed after the size count, so it is the decompressed bytes that are
// searched, and a stream that fails partway delivers nothing the scrubber was
// still holding back.
function scrubResponse(
  response: Response,
  scrubber: CredentialScrubber,
): Response {
  if (scrubber.isEmpty) {
    return response;
  }
  let headers = scrubber.scrubHeaders(response.headers);
  // Removing a credential changes the body's length.
  headers.delete('content-length');
  return new Response(
    response.body ? scrubber.scrubStream(response.body) : null,
    {
      status: response.status,
      statusText: scrubber.scrubText(response.statusText),
      headers,
    },
  );
}
