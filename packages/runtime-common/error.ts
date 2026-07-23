import { getReasonPhrase } from 'http-status-codes';
import status from 'statuses';
import { createResponse } from './create-response.ts';
import type { RequestContext } from './realm.ts';
import type { SearchResultError } from './realm-index-query-engine.ts';

export interface ErrorDetails {
  status?: number;
  title?: string;
  responseText?: string;
  detail?: string;
  id?: string | null;
  source?: {
    pointer?: string;
    header?: string;
    parameter?: string;
  };
}

export interface SerializedError {
  message: string;
  status: number;
  title?: string;
  id?: string | null;
  source?: ErrorDetails['source'];
  additionalErrors: any[] | null;
  isCardError?: true;
  deps?: string[];
  stack?: string;
  // Structured render-timeout diagnostics (e.g. launchMs, waits,
  // renderStage, queryLoadsInFlight). The source of truth is the
  // `boxel_index.diagnostics` column; the IndexWriter copies
  // the payload onto this field when persisting an error row so the
  // existing UI read path (formattedError → CardErrorJSONAPI.meta.
  // diagnostics) continues to work unchanged.
  diagnostics?: Record<string, unknown>;
  // Set when the failure describes the visit's own request — it aborted or
  // errored before any response document existed — rather than a verdict
  // about the content. A `prerendered_html` error row carrying this marker
  // is eligible for the reconcile sweep's bounded retry lane, unlike a
  // deterministic render error.
  visitRequestFailure?: true;
  // How many consecutive `visitRequestFailure` rows this URL has recorded,
  // maintained by the prerendered-html writer: incremented while each
  // successive write carries the marker, cleared whenever a render
  // succeeds (the error row is simply replaced). The reconcile sweep stops
  // retrying once this reaches its cap, making the row terminal so a
  // persistently failing visit cannot keep consuming its realm's prerender
  // affinity lane.
  consecutiveVisitFailures?: number;
}

// A persisted error document: the `SerializedError` plus the index metadata
// that rode with the row that failed. Stored in the `error_doc` column and
// carried on the wire by anything that stands in for a card/module/file that
// failed to render or index.
export interface ErrorEntry {
  type: 'instance-error' | 'module-error' | 'file-error';
  error: SerializedError;
  types?: string[];
  searchData?: Record<string, any>;
  cardType?: string;
}

// Postgres `jsonb` containers store child offsets in 28 bits, so a
// single jsonb array's elements must total < 256 MiB — a format-level
// constraint baked into jsonb, not a column setting we can raise.
// `clampSerializedError` is the chokepoint that guarantees an
// error_doc never reaches that ceiling on the upsert path.
//
// In normal operation it is a pure pass-through: if the doc already
// serializes under `ERROR_DOC_MAX_BYTES` we hand the input back
// unchanged. Only when over budget do we progressively shed
// structure, in this order, stopping as soon as we fit:
//
//   1. truncate each `additionalErrors[i].stack` to ~64 KiB
//   2. truncate the top-level `stack` to ~64 KiB
//   3. truncate each `additionalErrors[i].message` to ~16 KiB
//   4. collapse nested `additionalErrors` of inherited entries
//      (drop only the second level of nesting)
//   5. cap the array length to MAX_ADDITIONAL_ERRORS, with a
//      sentinel entry recording how many were omitted
//   6. drop `additionalErrors` entirely with a sentinel — last
//      resort, only reached if even one entry's scalars overflow
//   7. aggressively shrink the top-level `stack`/`message` if even
//      the bare envelope is still too big
//
// The budget is set to 8 MiB: 32× under the jsonb limit, plenty of
// debug headroom for healthy errors, and small enough to leave room
// for the rest of the row (`pristine_doc` / `search_doc` etc.).
// Postgres rejects the NUL character (`22P05`) and unpaired UTF-16
// surrogate halves inside a `jsonb` value's text. A single such code
// point — e.g. raw binary folded into an error message — aborts the
// whole upsert batch, so `sanitizeForJsonb` replaces them before write.
/* eslint-disable no-control-regex -- matching the NUL control character is the whole point */
const JSONB_ILLEGAL_CODE_POINTS =
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/* eslint-enable no-control-regex */

export function sanitizeForJsonb<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(JSONB_ILLEGAL_CODE_POINTS, '\uFFFD') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJsonb(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    let result: Record<string, unknown> = {};
    for (let [key, val] of Object.entries(value)) {
      result[sanitizeForJsonb(key)] = sanitizeForJsonb(val);
    }
    return result as T;
  }
  return value;
}

export const ERROR_DOC_MAX_BYTES = 8 * 1024 * 1024;
export const ERROR_DOC_MAX_ADDITIONAL_ERRORS = 200;
const ENTRY_STACK_BUDGET = 64 * 1024;
const ENTRY_MESSAGE_BUDGET = 16 * 1024;

function clampString(s: string, maxBytes: number): string {
  // Per-character clamp — UTF-16 code units are a close-enough proxy
  // for byte budgeting at this scale. The goal is "stay under 256 MB
  // of jsonb", not byte-exact.
  if (s.length <= maxBytes) return s;
  let suffix = ' …[truncated]';
  return s.slice(0, Math.max(0, maxBytes - suffix.length)) + suffix;
}

function jsonByteSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function clampSerializedError(error: SerializedError): SerializedError {
  if (jsonByteSize(error) <= ERROR_DOC_MAX_BYTES) {
    return error;
  }

  // Deep-copy so the input remains untouched. JSON round-trip is
  // safe here because SerializedError is already a JSON-shape value
  // (it is what we persist into a jsonb column).
  let working: SerializedError = JSON.parse(JSON.stringify(error));

  let entries = (): any[] | null =>
    Array.isArray(working.additionalErrors) ? working.additionalErrors : null;

  // Capture once up front so the omitted-sentinel messages emitted by
  // steps 5 and 6 can report the *original* count even after step 5
  // has already replaced the array with a (preserved + sentinel)
  // shorter form.
  let originalAdditionalCount = entries()?.length ?? 0;

  // 1. Per-entry stacks.
  let arr = entries();
  if (arr) {
    for (let entry of arr) {
      if (typeof entry?.stack === 'string') {
        entry.stack = clampString(entry.stack, ENTRY_STACK_BUDGET);
      }
    }
  }
  if (jsonByteSize(working) <= ERROR_DOC_MAX_BYTES) return working;

  // 2. Top-level stack.
  if (typeof working.stack === 'string') {
    working.stack = clampString(working.stack, ENTRY_STACK_BUDGET);
  }
  if (jsonByteSize(working) <= ERROR_DOC_MAX_BYTES) return working;

  // 3. Per-entry messages.
  arr = entries();
  if (arr) {
    for (let entry of arr) {
      if (typeof entry?.message === 'string') {
        entry.message = clampString(entry.message, ENTRY_MESSAGE_BUDGET);
      }
    }
  }
  if (jsonByteSize(working) <= ERROR_DOC_MAX_BYTES) return working;

  // 4. Collapse nested additionalErrors on inherited entries — only
  //    the second level of nesting is dropped, not the parent's
  //    flat list of contributors.
  arr = entries();
  if (arr) {
    for (let entry of arr) {
      if (
        Array.isArray(entry?.additionalErrors) &&
        entry.additionalErrors.length > 0
      ) {
        entry.additionalErrors = null;
      }
    }
  }
  if (jsonByteSize(working) <= ERROR_DOC_MAX_BYTES) return working;

  // 5. Cap entry count. The final array length is exactly
  //    ERROR_DOC_MAX_ADDITIONAL_ERRORS — `MAX - 1` real entries plus
  //    one sentinel summarising the rest — so the constant name and
  //    the resulting array length agree.
  arr = entries();
  if (arr && arr.length > ERROR_DOC_MAX_ADDITIONAL_ERRORS) {
    let preservedCount = Math.max(ERROR_DOC_MAX_ADDITIONAL_ERRORS - 1, 0);
    working.additionalErrors =
      preservedCount > 0
        ? [
            ...arr.slice(0, preservedCount),
            omittedSentinel(originalAdditionalCount - preservedCount),
          ]
        : [omittedSentinel(originalAdditionalCount - preservedCount)];
  }
  if (jsonByteSize(working) <= ERROR_DOC_MAX_BYTES) return working;

  // 6. Drop additionalErrors entirely. The sentinel reports the
  //    original count regardless of how many entries step 5 left
  //    behind.
  working.additionalErrors =
    originalAdditionalCount > 0
      ? [omittedSentinel(originalAdditionalCount)]
      : null;
  if (jsonByteSize(working) <= ERROR_DOC_MAX_BYTES) return working;

  // 7. Aggressively shrink the envelope itself.
  if (typeof working.stack === 'string') {
    working.stack = clampString(working.stack, 1024);
  }
  working.message = clampString(working.message ?? '', 1024);
  return working;
}

function omittedSentinel(count: number): {
  status: number;
  title: string;
  message: string;
  additionalErrors: null;
} {
  return {
    status: 500,
    title: 'Errors omitted',
    message: `${count} additional error${
      count === 1 ? '' : 's'
    } omitted to satisfy error_doc size budget`,
    additionalErrors: null,
  };
}

// Identity used to dedupe error documents when folding one into another —
// two documents describing the same failure (same target, message, status)
// are the same error even if one rode in via a different path.
function errorDocIdentity(error: {
  id?: string | null;
  message?: string;
  status?: number;
}): string {
  return JSON.stringify({
    id: error.id ?? null,
    message: error.message ?? null,
    status: error.status ?? null,
  });
}

// Fold `secondary`'s error detail into `primary` without changing which
// document is authoritative: `primary` keeps its message / status / stack
// (the reader-facing text), and `secondary`'s detail is added to
// `primary.additionalErrors` so a dependency error only one document captured
// survives. `secondary`'s own top-level error is added as a flat entry (its
// nested `additionalErrors` are spread in alongside rather than nested), and
// `deps` are unioned. Entries are deduped by (id, message, status).
export function mergeErrorDetail(
  primary: SerializedError,
  secondary: SerializedError,
): SerializedError {
  let merged = Array.isArray(primary.additionalErrors)
    ? [...primary.additionalErrors]
    : [];
  let seen = new Set<string>([
    errorDocIdentity(primary),
    ...merged.map(errorDocIdentity),
  ]);
  let candidates = [
    { ...secondary, additionalErrors: null },
    ...(Array.isArray(secondary.additionalErrors)
      ? secondary.additionalErrors
      : []),
  ];
  for (let candidate of candidates) {
    let key = errorDocIdentity(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(candidate);
    }
  }
  let deps =
    primary.deps || secondary.deps
      ? [...new Set([...(primary.deps ?? []), ...(secondary.deps ?? [])])]
      : undefined;
  return {
    ...primary,
    additionalErrors: merged.length > 0 ? merged : null,
    ...(deps ? { deps } : {}),
  };
}

// Combine two error documents for the same indexed entry, using their index
// generation as the authority. A higher generation is more recent, so it wins
// outright: the lower-generation document may be stale — the dependency graph
// it recorded may have changed since. At the same generation neither
// supersedes the other (e.g. the two prerender visits of a single indexing
// job): keep `a` as the authoritative envelope and fold `b`'s detail into it
// via `mergeErrorDetail`.
export function mergeErrorsByGeneration(
  a: SerializedError,
  aGeneration: number,
  b: SerializedError,
  bGeneration: number,
): SerializedError {
  if (aGeneration > bGeneration) {
    return a;
  }
  if (bGeneration > aGeneration) {
    return b;
  }
  return mergeErrorDetail(a, b);
}

export interface CardErrorJSONAPI {
  id?: string; // 404 errors won't necessarily have an id
  status: number;
  title: string;
  message: string;
  realm: string | undefined;
  meta: {
    lastKnownGoodHtml: string | null;
    cardTitle: string | null;
    scopedCssUrls: string[];
    stack: string | null;
    isCreationError?: true;
    responseHeaders?: { [header: string]: string };
    remoteId?: string;
    // CS-10872: structured prerender-timeout diagnostics carried over
    // from the persisted error document so the in-UI error banner can
    // surface launchMs/waits/renderStage/in-flight loads without
    // operators having to hit the DB. Absent for non-timeout errors.
    diagnostics?: Record<string, unknown>;
  };
  additionalErrors?: (CardError | SearchResultError['error'] | Error)[] | null;
}

export interface CardErrorsJSONAPI {
  errors: CardErrorJSONAPI[];
}

export function formattedError(
  url: string | undefined,
  error: any,
  err?: CardError | Partial<CardErrorJSONAPI>,
): CardErrorsJSONAPI {
  if (isCardError(err)) {
    let cardError;
    let meta: CardErrorJSONAPI['meta'] | undefined;
    let message: string | undefined;
    let additionalError = err.additionalErrors?.[0];

    let remoteId = err?.id;

    if (additionalError && 'errorDetail' in additionalError) {
      cardError = additionalError.errorDetail;
      let { lastKnownGoodHtml, scopedCssUrls, cardTitle } = additionalError;
      let diagnostics =
        (cardError as any)?.diagnostics ?? (err as any)?.diagnostics;
      meta = {
        lastKnownGoodHtml,
        scopedCssUrls,
        stack: cardError.stack ?? err.stack ?? error?.stack ?? null,
        cardTitle,
        ...(remoteId ? { remoteId } : {}),
        ...(diagnostics && typeof diagnostics === 'object'
          ? { diagnostics }
          : {}),
      };
    } else if (isCardError(additionalError)) {
      cardError = additionalError;
    } else {
      message = additionalError?.message;
      cardError = err;
    }

    remoteId = remoteId ?? cardError?.id;

    return {
      errors: [
        {
          id: url,
          message: message ?? cardError.message,
          status: cardError.status,
          title:
            cardError.title ??
            status.message[cardError.status] ??
            cardError.message,
          realm: error?.responseHeaders?.get('X-Boxel-Realm-Url'),
          meta:
            meta ??
            (() => {
              let diagnostics =
                (cardError as any)?.diagnostics ?? (err as any)?.diagnostics;
              return {
                lastKnownGoodHtml: null,
                scopedCssUrls: [],
                stack: cardError.stack ?? err.stack ?? error?.stack ?? null,
                cardTitle: null,
                ...(cardError.id ? { isCreationError: true } : {}),
                ...(remoteId ? { remoteId } : {}),
                ...(diagnostics && typeof diagnostics === 'object'
                  ? { diagnostics }
                  : {}),
              };
            })(),
          additionalErrors:
            cardError.additionalErrors as CardErrorJSONAPI['additionalErrors'],
        },
      ],
    };
  }

  let responseHeaders = error.responseHeaders
    ? Object.fromEntries<string>(error.responseHeaders.entries())
    : undefined;

  let errorStatus = err?.status ?? error.status;
  let errorMessage =
    err?.message ??
    (errorStatus
      ? `Received HTTP ${errorStatus} from server ${
          error.responseText ?? ''
        }`.trim()
      : error.message);

  return {
    errors: [
      {
        id: url,
        status: errorStatus ?? 500,
        title: err?.title ?? status.message[errorStatus] ?? errorMessage,
        message: errorMessage,
        realm: err?.realm ?? error.responseHeaders?.get('X-Boxel-Realm-Url'),
        meta:
          err?.meta ??
          (() => {
            let diagnostics = (error as any)?.diagnostics;
            return {
              lastKnownGoodHtml: null,
              scopedCssUrls: [],
              stack: error.stack ?? null,
              cardTitle: null,
              ...(err?.id ? { isCreationError: true } : {}),
              ...(responseHeaders ? { responseHeaders } : {}),
              ...(err?.id ? { remoteId: err.id } : {}),
              ...(diagnostics && typeof diagnostics === 'object'
                ? { diagnostics }
                : {}),
            };
          })(),
      },
    ],
  };
}

export class CardError extends Error implements SerializedError {
  message: string;
  status: number;
  title?: string;
  id?: string | null;
  source?: ErrorDetails['source'];
  responseText?: string;
  isCardError: true = true;
  additionalErrors:
    | (CardError | SearchResultError['error'] | Error | CardErrorJSONAPI)[]
    | null = null;
  deps?: string[];

  constructor(
    message: string,
    { status, title, source, responseText, id }: ErrorDetails = {},
  ) {
    super(message);
    this.id = id || null;
    this.message = message;
    this.status = status || 500;
    this.title = title || getReasonPhrase(this.status);
    this.responseText = responseText;
    this.source = source;
  }
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      message: this.message,
      code: this.status,
      status: this.status,
      source: this.source,
      stack: this.stack,
    };
  }

  static fromSerializableError(err: any): any {
    if (!err || typeof err !== 'object' || !isCardError(err)) {
      return err;
    }
    let result = new CardError(err.message, {
      status: err.status,
      title: err.title,
      source: err.source,
      id: err.id,
    });
    result.stack = err.stack;
    if (err.additionalErrors) {
      result.additionalErrors = err.additionalErrors.map((inner) =>
        CardError.fromSerializableError(inner),
      );
    }
    return result;
  }

  static fromCardErrorJsonAPI(
    errorJSONAPI: CardErrorJSONAPI,
    url?: string,
    httpStatus?: number,
  ) {
    let error = CardError.fromSerializableError(errorJSONAPI);
    if (url && httpStatus != null && [404, 406].includes(httpStatus)) {
      error.deps = [url];
    }
    error.stack = errorJSONAPI.meta.stack;

    return error;
  }

  static async fromFetchResponse(
    url: string,
    response: Response,
  ): Promise<CardError> {
    if (!response.ok) {
      let text = await response.text();
      let maybeErrorJSON: any;
      try {
        maybeErrorJSON = text ? JSON.parse(text) : undefined;
      } catch (err) {
        /* it's ok if we can't parse it*/
      }
      // TODO probably we should refactor this--i don't think our errors follow
      // this shape anymore
      if (
        maybeErrorJSON &&
        typeof maybeErrorJSON === 'object' &&
        'errors' in maybeErrorJSON &&
        Array.isArray(maybeErrorJSON.errors) &&
        maybeErrorJSON.errors.length > 0
      ) {
        let error = CardError.fromSerializableError(maybeErrorJSON.errors[0]);
        if ([404, 406].includes(response.status)) {
          error.deps = [response.url];
        }

        return error;
      }
      let error = new CardError(
        `unable to fetch ${url}${!maybeErrorJSON ? ': ' + text : ''}`,
        {
          id: url,
          title: response.statusText,
          status: response.status,
          responseText: text,
        },
      );
      // 406 errors matter to us because in the scenario were you are depending on a
      // module that is depending on another module, like a -> b -> c. if module c
      // doesn't exist then module b is in an error state. when module a asks for
      // module b, we return an error code, 406, meaning that we know about module b,
      // but we can't give it to you because it is in an error state.
      if ([404, 406].includes(response.status)) {
        error.deps = [response.url];
      }
      return error;
    }
    throw new CardError(
      `tried to create a card error from a successful fetch response from ${url}, status ${
        response.status
      }, with body: ${await response.text()}`,
    );
  }
}

// The import map (host network.ts) resolves every `@cardstack/boxel-icons/<name>`
// import to `<iconsURL>/@cardstack/boxel-icons/v1/icons/<name>.js`. This path
// segment is the same in every environment (local http-server, per-slug
// Traefik host, and the production CDN), so a path match is a reliable,
// config-free way to recognize an icon module from inside runtime-common.
const BOXEL_ICONS_MODULE_PATH = '/@cardstack/boxel-icons/v1/icons/';

// A missing icon key returns 403 from the production S3-backed CDN (the bucket
// withholds `s3:ListBucket` from the public principal, so absent keys 403
// instead of 404) and 404 from the local http-server. Either way it means the
// named icon does not exist. Translate that into a message that points the user
// at the real fix — correcting the import — instead of surfacing the raw S3
// AccessDenied XML. Returns undefined when `moduleHref`/`status` are not a
// missing-icon fetch, so callers fall back to their normal error handling.
export function iconNotFoundMessage(
  moduleHref: string,
  status: number,
): string | undefined {
  if (status !== 403 && status !== 404) {
    return undefined;
  }
  let pathname: string;
  try {
    pathname = new URL(moduleHref).pathname;
  } catch {
    return undefined;
  }
  let index = pathname.indexOf(BOXEL_ICONS_MODULE_PATH);
  if (index === -1) {
    return undefined;
  }
  let rest = pathname.slice(index + BOXEL_ICONS_MODULE_PATH.length);
  if (!rest.endsWith('.js')) {
    return undefined;
  }
  let iconName = rest.slice(0, -'.js'.length);
  if (!iconName) {
    return undefined;
  }
  return `Icon "${iconName}" was not found in @cardstack/boxel-icons. Check the import path against the available icons.`;
}

export function isCardErrorJSONAPI(err: any): err is CardErrorJSONAPI {
  return (
    err != null &&
    typeof err === 'object' &&
    err.status &&
    err.title &&
    err.meta
  );
}

export function isCardError(err: any): err is CardError {
  return err != null && typeof err === 'object' && err.isCardError;
}

export function printCompilerError(err: any) {
  if (isAcceptableError(err)) {
    return String(err);
  }

  return `${err.message}\n\n${err.stack}`;
}

function isAcceptableError(err: any) {
  return err.isCardstackError || err.code === 'BABEL_PARSE_ERROR';
}

export function serializableError(err: any): any {
  if (!err || typeof err !== 'object' || !isCardError(err)) {
    // rely on the best-effort serialization that we'll get from, for example,
    // "pg" as it puts this object into jsonb
    return err;
  }

  let result = Object.assign({}, err, {
    stack: err.stack,
    message: err.message,
  });
  result.additionalErrors =
    result.additionalErrors?.map((inner) => serializableError(inner)) ?? null;
  return result;
}

// Coerce an arbitrary thrown / serialized value into a non-empty
// human-readable string. Used to guarantee the `message` of an
// instance-/file-/module-error row carries enough text to debug.
// Order of preference:
//   1. err.message (if a non-empty string)
//   2. err.title (if a non-empty string)
//   3. err.stack first line (if available)
//   4. For object-shaped errors, String(err) — but only if it's not
//      the useless default Object.prototype.toString output. A class
//      with a custom toString() (or some host-provided error wrapper)
//      may surface real failure text here even when message/title/
//      stack are absent. The "[object Object]" / "[object …]" output
//      from the default toString is filtered out: it carries no
//      diagnostic value, and the placeholder (which names the URL)
//      is strictly more informative.
//   5. For primitives, String(err) (numbers, booleans, symbols).
//   6. the supplied placeholder
export function coerceErrorMessage(err: unknown, placeholder: string): string {
  let candidates: unknown[] = [];
  if (err != null && typeof err === 'object') {
    candidates.push(
      (err as { message?: unknown }).message,
      (err as { title?: unknown }).title,
    );
    let stack = (err as { stack?: unknown }).stack;
    if (typeof stack === 'string') {
      let firstLine = stack.split('\n', 1)[0]?.trim();
      if (firstLine) {
        candidates.push(firstLine);
      }
    }
    let stringified: string;
    try {
      stringified = String(err);
    } catch {
      stringified = '';
    }
    if (stringified && !/^\[object [^\]]*\]$/.test(stringified)) {
      candidates.push(stringified);
    }
  } else if (typeof err === 'string') {
    candidates.push(err);
  } else if (err !== undefined && err !== null) {
    candidates.push(String(err));
  }
  for (let candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return placeholder;
}

// Render an unknown error as a single log-safe string. Passing an Error (or any
// object) as a console argument serializes to "[object Object]" in
// text-captured console output (e.g. CI test logs), and `JSON.stringify` of an
// Error yields "{}" because its `message`/`stack` are non-enumerable — both
// drop the stack, which is the detail that localizes a transient failure.
// Prefer the stack for Errors, a JSON dump for plain / JSON:API error objects,
// and fall back to `coerceErrorMessage` for everything else.
export function stringifyErrorForLog(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  if (err != null && typeof err === 'object') {
    try {
      let json = JSON.stringify(err);
      if (json && json !== '{}') {
        return json;
      }
    } catch {
      // not serializable (e.g. circular references) — fall through
    }
  }
  return coerceErrorMessage(err, '(no error detail available)');
}

export function responseWithError(
  error: CardError,
  requestContext: RequestContext,
): Response;
export function responseWithError(
  body: Record<string, any> | undefined,
  error: CardError,
  requestContext: RequestContext,
): Response;
export function responseWithError(
  bodyOrError: CardError | Record<string, any> | undefined,
  errorOrRequestContext: RequestContext | CardError,
  maybeRequestContext?: RequestContext,
): Response {
  let body: Record<string, any> | undefined;
  let error: CardError | undefined;
  let requestContext: RequestContext | undefined;
  if (bodyOrError instanceof CardError) {
    error = bodyOrError;
  } else {
    body = bodyOrError;
  }
  if (errorOrRequestContext instanceof CardError) {
    error = errorOrRequestContext;
  } else {
    requestContext = errorOrRequestContext;
  }
  if (maybeRequestContext) {
    requestContext = maybeRequestContext;
  }
  if (!error) {
    throw new Error(`Could not fashion error response, error is missing`);
  }
  if (!requestContext) {
    throw new Error(
      `Could not fashion error response, requestContext is missing`,
    );
  }
  let realmURL = requestContext.realm?.url;
  let responseBody = body ? { ...body } : serializableError(error);
  if (realmURL && responseBody.realm === undefined) {
    responseBody.realm = realmURL;
  }
  return createResponse({
    body: JSON.stringify({ errors: [responseBody] }),
    init: {
      status: error.status,
      statusText: error.title,
      headers: { 'content-type': 'application/json' },
    },
    requestContext,
  });
}

export function methodNotAllowed(
  request: Request,
  requestContext: RequestContext,
): Response {
  return responseWithError(
    new CardError(`${request.method} not allowed for ${request.url}`, {
      status: 405,
    }),
    requestContext,
  );
}

export function unsupportedMediaType(
  request: Request,
  requestContext: RequestContext,
): Response {
  return responseWithError(
    new CardError(
      `request for ${request.url} can't be fulfilled for accept header ${request.headers.get('accept')}`,
      {
        status: 415,
      },
    ),
    requestContext,
  );
}

export function notFound(
  request: Request,
  requestContext: RequestContext,
  message = `Could not find ${request.url}`,
): Response {
  return responseWithError(
    new CardError(message, { status: 404, id: request.url }),
    requestContext,
  );
}

export function notAcceptable(
  request: Request,
  requestContext: RequestContext,
  message = `No representation available for ${request.url} that matches accept header ${request.headers.get('accept')}`,
): Response {
  return responseWithError(
    new CardError(message, { status: 406, id: request.url }),
    requestContext,
  );
}

export function badRequest({
  message,
  requestContext,
  id,
  lid,
}: {
  message: string;
  requestContext: RequestContext;
  id?: string;
  lid?: string;
}): Response {
  return responseWithError(
    new CardError(message, {
      status: 400,
      ...(id ? { id } : {}),
      ...(lid ? { lid } : {}),
    }),
    requestContext,
  );
}

export function systemUnavailable(
  message: string,
  requestContext: RequestContext,
): Response {
  return responseWithError(
    new CardError(message, { status: 503 }),
    requestContext,
  );
}

export function systemError({
  requestContext,
  message,
  additionalError,
  body,
  id,
  lid,
  status: httpStatus = 500,
}: {
  requestContext: RequestContext;
  message: string;
  additionalError?: CardError | Error;
  body?: Record<string, any>;
  id?: string;
  lid?: string;
  // HTTP status for the response. Defaults to 500; callers serving an
  // index error row pass the underlying error's status so a card whose
  // recorded failure is, say, an auth or validation error returns that
  // status rather than masquerading as a realm outage.
  status?: number;
}): Response {
  let err = new CardError(message, {
    status: httpStatus,
    // Supply a title explicitly so the CardError constructor never falls
    // back to `getReasonPhrase`, which throws for unregistered codes — a
    // mirrored upstream status (e.g. a proxied 520/499) would otherwise
    // turn the error response itself into an unhandled failure. The
    // `statuses` lookup returns undefined for unknown codes rather than
    // throwing, and we backstop that with a generic phrase.
    title: status.message[httpStatus] || `HTTP ${httpStatus}`,
    ...(id ? { id } : {}),
    ...(lid ? { lid } : {}),
  });
  if (additionalError) {
    err.additionalErrors = [additionalError];
  }
  return responseWithError(body, err, requestContext);
}
