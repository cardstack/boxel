import Koa from 'koa';
import Router from '@koa/router';
import type { Server } from 'http';
import { createServer } from 'http';
import * as Sentry from '@sentry/node';
import {
  Deferred,
  type AffinityType,
  logger,
  isScreenshotFormat,
  parseScreenshotCaptureSpec,
  SCREENSHOT_FORMATS,
  type PrerenderVisitType,
  type RenderRouteOptions,
  type ModuleRenderResponse,
  type RenderVisitResponse,
  type RunCommandResponse,
  type ScreenshotCaptureSpec,
  type ScreenshotCaptureSpecParse,
  type ScreenshotFormat,
  type ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';
import {
  ecsMetadata,
  fullRequestURL,
  livenessCheck,
  fetchRequestFromContext,
} from '../middleware/index.ts';
import { Prerenderer } from './index.ts';
import type { Timings } from './render-runner.ts';
import { resolvePrerenderManagerURL } from './config.ts';
import { heapTelemetry } from './heap-telemetry.ts';
import { captureHeapSnapshot } from './heap-snapshot.ts';
import {
  PRERENDER_HOST_SHELL_HASH_HEADER,
  PRERENDER_JOB_ID_HEADER,
  PRERENDER_REQUEST_ID_HEADER,
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
  sanitizePrerenderJobId,
  sanitizePrerenderRequestId,
} from './prerender-constants.ts';
import { randomUUID } from 'crypto';
import { isMissingExportMessage } from '@cardstack/runtime-common/package-shim-handler';

type PrerenderServer = Server & {
  __stopPrerenderer?: () => Promise<void>;
};

let log = logger('prerender-server');
const defaultPrerenderServerPort = 4221;

// Stamp the per-request `requestId` onto `response.meta.requestId`
// so it flows through the same channel as timings / host-side
// diagnostics and ends up on `boxel_index.diagnostics` for
// cross-log grepping. The launch/waits/render/total timings are
// already attached inside Prerenderer (regardless of HTTP vs
// in-process); this layer just adds the HTTP-only correlation id.
// Exported so the diagnostics-persistence regression tests can
// exercise it directly.
export function decorateRenderErrorDiagnostics(
  response: any,
  requestId: string,
): void {
  if (!response || typeof response !== 'object') {
    return;
  }
  response.meta = {
    ...(response.meta ?? {}),
    requestId,
  };
}

// Pure decision for the host-shell recycle reconcile. Given the token the
// manager last reported (`reported`, null when it doesn't know one yet) and
// the token this server warmed against (`warmed`, undefined before the first
// report), decide whether to recycle and what the baseline token becomes:
//   - no report            → keep the current baseline, don't recycle
//   - matches the baseline → no-op
//   - anything else        → recycle and adopt the reported token
//
// "Anything else" covers the first token a fresh process sees, and that case
// is the whole point rather than an edge: a prerender server has no way to
// know which host shell its pages loaded, and the shell it warmed against is
// most likely stale precisely when it boots. The deploy train restarts
// prerender BEFORE the realm server, and a page loads its shell FROM the
// realm server, so a server coming up mid-train warms against the outgoing
// bundle. Adopting the first reported token as a silent baseline would take
// that warm to be current and never reload it — the pages then render
// post-deploy realm source against the pre-deploy bundle, which surfaces as
// `has no exported member` module errors and persists as error docs served
// from cache. Recycling once per prerender restart is the cheaper side of
// that trade: the standbys are re-warmed either way.
//
// Exported for unit testing; the live caller layers the draining / in-flight
// guards and the async recycle on top.
export function decideHostShellRecycle(
  reported: string | null,
  warmed: string | undefined,
): { recycle: boolean; nextWarmed: string | undefined } {
  if (!reported) {
    return { recycle: false, nextWarmed: warmed };
  }
  if (warmed === reported) {
    return { recycle: false, nextWarmed: reported };
  }
  return { recycle: true, nextWarmed: reported };
}

// The answer a visit gives when shutdown wins the race: the manager reads this
// status, marks the server draining and routes the visit elsewhere. Shared by
// both render attempts so a caller can't tell which one was interrupted.
function respondDraining(ctxt: Koa.Context): void {
  ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
  ctxt.set(PRERENDER_SERVER_STATUS_HEADER, PRERENDER_SERVER_STATUS_DRAINING);
  ctxt.body = {
    errors: [
      {
        status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
        message: 'Prerender server draining',
      },
    ],
  };
}

// Whether a visit's result should be re-rendered rather than believed.
//
// The two tokens are what this server had adopted when the render started and
// when its response came back. A render that straddled a change between them
// ran on a page whose bundle the realm server may already have stopped
// serving. On its own that is unremarkable — most renders spanning a deploy
// still produce correct output — and it matters for one class of failure:
// `has no exported member`, which is exactly what a page resolving current
// realm source against the previous bundle throws.
//
// That failure is worth one more render because of what happens to it
// downstream. The indexer stores a failed render as the card's content, so a
// transient bundle mismatch becomes an error document served from cache to
// every anonymous reader until an unrelated reindex revisits the row.
// Re-rendering on a page warmed against the current shell costs one render;
// believing it costs an outage that lasts until something else repairs it.
export function shouldRerenderForShellChange({
  response,
  shellAtStart,
  shellAtCompletion,
}: {
  response: RenderVisitResponse;
  shellAtStart: string | undefined;
  shellAtCompletion: string | undefined;
}): boolean {
  // Nothing reported by the end of the render: this server has never been told
  // which shell is current, so it has no grounds in either direction.
  if (shellAtCompletion === undefined) {
    return false;
  }
  // `undefined -> X` counts as a change, and it is the deploy shape this
  // exists for. The train restarts prerender before the realm server, so a
  // server booting mid-train warms against the outgoing bundle and the first
  // token it ever hears is the new one — on such a server there is no
  // `X -> Y` to observe until some later deploy. `decideHostShellRecycle`
  // treats that first token as a definite change for the same reason.
  if (shellAtStart === shellAtCompletion) {
    return false;
  }
  return hasMissingExportError(response);
}

function hasMissingExportError(response: RenderVisitResponse): boolean {
  // Every sub-response that can carry a render failure, because every one of
  // them is persisted the same way: `prerender-html-visit` writes
  // `fileRender.error` as a cached `file-error` row exactly as the card path
  // writes `instance-error`, so a FileDef render (Markdown and friends) stays
  // poisoned on the same terms if it is left out.
  for (let candidate of [
    response.card?.error,
    response.fileExtract?.error,
    response.fileRender?.error,
    response.pageUnusableError,
  ]) {
    let error = candidate?.error;
    if (!error) {
      continue;
    }
    // The visit's own message, plus the console errors `RenderRunner` merges
    // onto `additionalErrors`: a render whose own failure is a timeout or a
    // wedge can carry the module error only in that array, and it is
    // persisted with the row either way. Absent when `clampSerializedError`
    // dropped the array from an oversized error, which is a coverage limit
    // rather than a signal that the render was clean.
    for (let message of [
      error.message,
      ...(error.additionalErrors ?? []).map((e) => e?.message),
    ]) {
      if (typeof message === 'string' && isMissingExportMessage(message)) {
        return true;
      }
    }
  }
  return false;
}

// Record which host shell produced this response. Kept whether or not the
// render failed: on a failure it is the evidence for how the failure should be
// read, and on a success it is what lets an operator attribute a render to a
// bundle without matching timestamps against deploy logs.
export function stampHostShellTokens(
  response: RenderVisitResponse,
  tokens: { atStart: string | undefined; atCompletion: string | undefined },
): void {
  if (tokens.atStart === undefined && tokens.atCompletion === undefined) {
    return;
  }
  // Under `diagnostics` rather than beside it: `flattenPrerenderMeta` carries
  // that key onto `boxel_index.diagnostics` (and its prerender-html twin onto
  // `prerendered_html.diagnostics`) and drops every other meta key, so a
  // token stamped anywhere else never reaches the row an operator inspects.
  response.meta = {
    ...(response.meta ?? {}),
    diagnostics: {
      ...(response.meta?.diagnostics ?? {}),
      ...(tokens.atStart !== undefined
        ? { hostShellHash: tokens.atStart }
        : {}),
      ...(tokens.atCompletion !== undefined
        ? { hostShellHashAtCompletion: tokens.atCompletion }
        : {}),
    },
  };
}

// A one-shot notification that shutdown has begun, which the holder releases
// when it no longer needs it.
type DrainSubscription = {
  promise: Promise<{ draining: true }>;
  dispose: () => void;
};
// What a caller needs in order to wait: `raceAgainstDrain` only calls this, so
// it asks for nothing more.
type SubscribeToDrain = () => DrainSubscription;

// What `createDrainSubscriber` hands back. `waiterCount` is the one thing it
// exposes beyond subscribing, so the release property can be asserted against
// this implementation rather than against a stand-in that reimplements it.
type DrainSubscriber = SubscribeToDrain & { waiterCount: () => number };

// Fans one settlement of the shutdown promise out to per-request subscribers.
//
// Latched rather than only broadcast: a subscriber taken after the broadcast
// has happened would otherwise join a set nobody iterates again, leaving its
// promise pending forever. The race in `raceAgainstDrain` would then quietly
// degrade to a plain await, and the request would render on instead of
// reporting that the server is going away — which can hold `server.close()`
// open for the length of a render. Requests do arrive after draining starts:
// the guard ahead of the routes only turns away POSTs to `/prerender-*`, so
// `/run-command` and `/release-batch` reach their handlers regardless, and
// even a guarded path can cross the line between that check and its
// subscription.
export function createDrainSubscriber(
  drainingPromise: Promise<void>,
): DrainSubscriber {
  let waiters = new Set<() => void>();
  let drained = false;
  let settle = () => {
    drained = true;
    for (let notify of waiters) {
      notify();
    }
    waiters.clear();
  };
  // Both settlements latch. Nothing rejects the deferred the server wires in,
  // but this is exported and takes any promise, and an unhandled rejection
  // here reaches the handler that exits the process. A shutdown signal that
  // errored is still a shutdown signal.
  drainingPromise.then(settle, settle);
  let subscribe = (() => {
    if (drained) {
      return {
        promise: Promise.resolve({ draining: true as const }),
        dispose: () => {},
      };
    }
    let notify!: () => void;
    let promise = new Promise<{ draining: true }>((resolve) => {
      notify = () => resolve({ draining: true });
    });
    waiters.add(notify);
    return { promise, dispose: () => waiters.delete(notify) };
  }) as DrainSubscriber;
  subscribe.waiterCount = () => waiters.size;
  return subscribe;
}

// Run `execPromise`, giving up early if the server starts draining.
//
// The subscription is released in `finally` because the alternative — each
// request calling `.then()` on a promise that only settles at shutdown —
// leaks far more than the reaction itself. The shutdown promise holds that
// reaction forever; the reaction holds the promise `.then()` derived from it;
// that derived promise never settles either. `Promise.race` chains onto it,
// so it holds the race's resolve capability, which holds the race promise —
// and the race promise is fulfilled with this request's render output. One
// render's worth of HTML therefore stays reachable per render, for the life
// of the process. Taking a waiter and dropping it leaves nothing behind.
//
// The handler passed to `.then()` captured nothing, so blaming the closure
// would point at a rule that already held: measured over 2000 renders, that
// shape alone costs ~0.4 MB, while the same shape fed into a race costs the
// full ~196 MB of payload.
export async function raceAgainstDrain<T>(
  execPromise: Promise<T>,
  subscribeToDrain: SubscribeToDrain | undefined,
): Promise<T | { draining: true }> {
  if (!subscribeToDrain) {
    return await execPromise;
  }
  let drain = subscribeToDrain();
  try {
    return await Promise.race([execPromise, drain.promise]);
  } finally {
    drain.dispose();
  }
}

export function buildPrerenderApp(options: {
  serverURL: string;
  maxPages?: number;
  isDraining?: () => boolean;
  drainingPromise?: Promise<void>;
  // The host-shell token the manager last *reported*, read at render start and
  // again at render end so a visit can tell whether the shell moved under it.
  // Deliberately the reported token rather than the one the pool has adopted:
  // the adopted value only advances once `recycle()` resolves, and a recycle
  // cannot resolve until every in-flight visit has released its tab lease — so
  // a render that was running when the shell changed would sample the same
  // value twice and read as steady, which is precisely the case worth
  // catching. Owned by the HTTP server, which learns it from the heartbeat.
  getHostShellHash?: () => string | undefined;
  // The recycle triggered by the last token change, if one is still running.
  // A re-render awaits it so it lands on a page warmed against the current
  // shell instead of racing the teardown. Always resolves — the caller
  // handles recycle failure by leaving its own baseline alone.
  awaitHostShellRecycle?: () => Promise<void> | undefined;
}): {
  app: Koa<Koa.DefaultState, Koa.Context>;
  prerenderer: Prerenderer;
} {
  let app = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();
  let maxPages = options?.maxPages ?? 5;
  let prerenderer = new Prerenderer({
    maxPages,
    serverURL: options.serverURL,
  });

  // One reaction on the shutdown promise for the whole process. Requests take
  // a waiter and drop it when they finish, so what accumulates is bounded by
  // the number of renders in flight rather than by the number ever served.
  let subscribeToDrain: SubscribeToDrain | undefined = options.drainingPromise
    ? createDrainSubscriber(options.drainingPromise)
    : undefined;

  router.head('/', (ctxt: Koa.Context) => {
    if (options.isDraining?.()) {
      ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
      ctxt.set(
        PRERENDER_SERVER_STATUS_HEADER,
        PRERENDER_SERVER_STATUS_DRAINING,
      );
      return;
    }
    return livenessCheck(ctxt, async () => undefined);
  });
  router.get('/', async (ctxt: Koa.Context) => {
    if (options.isDraining?.()) {
      ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
      ctxt.set(
        PRERENDER_SERVER_STATUS_HEADER,
        PRERENDER_SERVER_STATUS_DRAINING,
      );
      ctxt.set('Content-Type', 'application/json');
      ctxt.body = JSON.stringify({
        ready: false,
        draining: true,
        memory: heapTelemetry(),
      });
      return;
    }
    ctxt.set('Content-Type', 'application/json');
    // `memory` makes a single task's heap readable on demand — including
    // `heapLimitMB`, which is the only way to confirm from outside what
    // `--max-old-space-size` a running process actually took. The Docker
    // HEALTHCHECK discards this body, so the extra fields cost it nothing.
    ctxt.body = JSON.stringify({ ready: true, memory: heapTelemetry() });
    ctxt.status = 200;
  });

  // Dumps this process's heap to the artifact sink, for working out what is
  // holding memory across renders. Off unless `PRERENDER_HEAP_SNAPSHOT` is
  // set, because the write stops the world for its whole duration.
  //
  // The same capture also fires on its own once an instance's heap crosses
  // the auto-capture threshold, which is how it is normally reached: a leak
  // takes hours to develop and any deploy resets it, so waiting to be asked
  // means usually not being asked in time. This route is the override for
  // choosing the moment instead — at a particular heap size, or on an
  // instance that has already spent its one automatic capture. Reach it the
  // way any VPC-internal endpoint is reached: SSM port-forward, then POST.
  router.post('/heap-snapshot', async (ctxt: Koa.Context) => {
    let outcome = await captureHeapSnapshot();
    ctxt.set('Content-Type', 'application/json');
    ctxt.body = JSON.stringify(outcome);
    switch (outcome.status) {
      case 'captured':
        ctxt.status = 200;
        break;
      case 'disabled':
      case 'no-sink':
        // Not an error in the caller's request — the capability is simply
        // switched off on this instance, which is the resting state.
        ctxt.status = 404;
        break;
      case 'busy':
        ctxt.status = 409;
        break;
      default:
        ctxt.status = 500;
    }
  });

  type RouteBaseArgs = {
    auth: string;
    renderOptions: RenderRouteOptions;
    // Worker-job priority threaded from the producer side. Stamped
    // onto the diagnostics blob and used by the per-tab queue / per-
    // affinity admission semaphore / global render semaphore for
    // priority-aware dequeue.
    priority?: number;
  };

  type PrerenderArgs = RouteBaseArgs & {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
  };

  type RunCommandRouteArgs = RouteBaseArgs & {
    affinityType: 'user';
    affinityValue: string;
    command: string;
    commandInput?: unknown;
  };

  type ScreenshotRouteArgs = RouteBaseArgs & {
    affinityType: 'realm';
    affinityValue: string;
    realm: string;
    url: string;
    format: ScreenshotFormat;
    // Pass-through of the caller's per-capture overrides. Already validated by
    // the realm-server handler; the capture path guards the one hard invariant
    // (fullPage + clip) defensively.
    captureSpec?: ScreenshotCaptureSpec;
  };

  type RouteParseResult<A extends RouteBaseArgs> = {
    args?: A;
    missing: string[];
    missingMessage: string;
    logTarget: string;
    responseId: string;
    rejectionLogDetails: string;
  };

  type PrerenderExecResult<R> = {
    response: R;
    timings: Timings;
    pool: {
      pageId: string;
      affinityType: AffinityType;
      affinityValue: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  };

  let isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  let parseRenderOptions = (attrs: any): RenderRouteOptions =>
    attrs.renderOptions &&
    typeof attrs.renderOptions === 'object' &&
    !Array.isArray(attrs.renderOptions)
      ? (attrs.renderOptions as RenderRouteOptions)
      : {};

  // Optional `priority` from the wire format. Coerce to a finite
  // number; reject non-numeric values silently (defaults to undefined,
  // server treats as 0).
  let parsePriority = (attrs: any): number | undefined => {
    let raw = attrs?.priority;
    if (raw === undefined || raw === null) return undefined;
    let n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  let missingAttrs = (attrsToCheck: { value: unknown; name: string }[]) =>
    attrsToCheck
      .filter(({ value }) => !isNonEmptyString(value))
      .map(({ name }) => name);

  let parseDefaultPrerenderAttributes = (
    attrs: any,
  ): RouteParseResult<PrerenderArgs> => {
    let rawUrl = attrs.url;
    let rawAuth = attrs.auth;
    let rawRealm = attrs.realm;
    let rawAffinityType = attrs.affinityType;
    let rawAffinityValue = attrs.affinityValue;
    let renderOptions = parseRenderOptions(attrs);
    let missing = missingAttrs([
      { value: rawUrl, name: 'url' },
      { value: rawRealm, name: 'realm' },
      { value: rawAuth, name: 'auth' },
      {
        value: rawAffinityType === 'realm' ? rawAffinityType : undefined,
        name: 'affinityType',
      },
      { value: rawAffinityValue, name: 'affinityValue' },
    ]);
    let priority = parsePriority(attrs);
    return {
      args:
        missing.length > 0
          ? undefined
          : {
              affinityType: rawAffinityType as AffinityType,
              affinityValue: rawAffinityValue as string,
              realm: rawRealm as string,
              url: rawUrl as string,
              auth: rawAuth as string,
              renderOptions,
              ...(priority !== undefined ? { priority } : {}),
            },
      missing,
      missingMessage:
        'Missing or invalid required attributes: url, auth, realm, affinityType, affinityValue',
      logTarget: (rawUrl as string | undefined) ?? '<missing>',
      responseId: (rawUrl as string | undefined) ?? 'unknown',
      rejectionLogDetails: `affinityType=${
        (rawAffinityType as string | undefined) ?? '<missing>'
      } affinityValue=${(rawAffinityValue as string | undefined) ?? '<missing>'} realm=${
        (rawRealm as string | undefined) ?? '<missing>'
      } url=${(rawUrl as string | undefined) ?? '<missing>'} authProvided=${
        typeof rawAuth === 'string' && rawAuth.trim().length > 0
      }`,
    };
  };

  let parseRunCommandAttributes = (
    attrs: any,
  ): RouteParseResult<RunCommandRouteArgs> => {
    let rawAuth = attrs.auth;
    let rawAffinityType = attrs.affinityType;
    let rawAffinityValue = attrs.affinityValue;
    let command = attrs.command;
    let commandInput = attrs.commandInput;
    let renderOptions = parseRenderOptions(attrs);
    let missing: string[] = [];
    if (!isNonEmptyString(rawAuth)) missing.push('auth');
    if (rawAffinityType !== 'user') missing.push('affinityType');
    if (!isNonEmptyString(rawAffinityValue)) missing.push('affinityValue');
    if (!isNonEmptyString(command)) missing.push('command');
    let commandValue = isNonEmptyString(command) ? command : undefined;
    let priority = parsePriority(attrs);
    return {
      args:
        missing.length > 0
          ? undefined
          : {
              affinityType: rawAffinityType as 'user',
              affinityValue: rawAffinityValue as string,
              auth: rawAuth as string,
              command: command as string,
              commandInput,
              renderOptions,
              ...(priority !== undefined ? { priority } : {}),
            },
      missing,
      missingMessage:
        'Missing or invalid required attributes: auth, command, affinityType, affinityValue',
      logTarget: commandValue ?? '<unknown>',
      responseId: commandValue ?? 'command',
      rejectionLogDetails: `affinityType=${
        (rawAffinityType as string | undefined) ?? '<missing>'
      } affinityValue=${(rawAffinityValue as string | undefined) ?? '<missing>'} authProvided=${
        typeof rawAuth === 'string' && rawAuth.trim().length > 0
      } commandProvided=${Boolean(commandValue)}`,
    };
  };

  let parseScreenshotAttributes = (
    attrs: any,
  ): RouteParseResult<ScreenshotRouteArgs> => {
    let rawUrl = attrs.url;
    let rawAuth = attrs.auth;
    let rawRealm = attrs.realm;
    let rawAffinityType = attrs.affinityType;
    let rawAffinityValue = attrs.affinityValue;
    let rawFormat = attrs.format;
    let renderOptions = parseRenderOptions(attrs);
    let priority = parsePriority(attrs);
    let formatIsValid = isScreenshotFormat(rawFormat);
    // Same strict parse + bounds as the realm-server's POST /_screenshot-card
    // body: this route is its own HTTP surface, and an unvalidated spec here
    // would reach `page.setViewport` on a pooled page with none of the cost
    // caps applied. The parse also normalizes (defaults elided, empty spec
    // -> null), so the capture path sees one canonical shape from every
    // caller. It is format-aware (fitted requires an envelope), so it
    // runs only once the format itself is valid.
    let captureSpecParse: ScreenshotCaptureSpecParse = formatIsValid
      ? parseScreenshotCaptureSpec(attrs.captureSpec, rawFormat)
      : { captureSpec: null };
    let missing = missingAttrs([
      { value: rawUrl, name: 'url' },
      { value: rawRealm, name: 'realm' },
      { value: rawAuth, name: 'auth' },
      {
        value: rawAffinityType === 'realm' ? rawAffinityType : undefined,
        name: 'affinityType',
      },
      { value: rawAffinityValue, name: 'affinityValue' },
      {
        value: formatIsValid ? rawFormat : undefined,
        name: 'format',
      },
    ]);
    if (captureSpecParse.error !== undefined) {
      missing = [...missing, 'captureSpec'];
    }
    return {
      args:
        missing.length > 0
          ? undefined
          : {
              affinityType: 'realm',
              affinityValue: rawAffinityValue as string,
              realm: rawRealm as string,
              url: rawUrl as string,
              auth: rawAuth as string,
              format: rawFormat as ScreenshotFormat,
              renderOptions,
              ...(captureSpecParse.captureSpec
                ? { captureSpec: captureSpecParse.captureSpec }
                : {}),
              ...(priority !== undefined ? { priority } : {}),
            },
      missing,
      missingMessage:
        captureSpecParse.error !== undefined
          ? captureSpecParse.error
          : `Missing or invalid required attributes: url, auth, realm, affinityType, affinityValue, format (${SCREENSHOT_FORMATS.join('|')})`,
      logTarget: (rawUrl as string | undefined) ?? '<missing>',
      responseId: (rawUrl as string | undefined) ?? 'unknown',
      rejectionLogDetails: `affinityType=${
        (rawAffinityType as string | undefined) ?? '<missing>'
      } affinityValue=${(rawAffinityValue as string | undefined) ?? '<missing>'} realm=${
        (rawRealm as string | undefined) ?? '<missing>'
      } url=${(rawUrl as string | undefined) ?? '<missing>'} format=${
        (rawFormat as string | undefined) ?? '<missing>'
      } authProvided=${
        typeof rawAuth === 'string' && rawAuth.trim().length > 0
      }`,
    };
  };

  function registerPrerenderRoute<R, A extends RouteBaseArgs = PrerenderArgs>(
    path: string,
    options: {
      requestDescription: string;
      responseType: string;
      infoLabel: string;
      warnTimeoutMessage: (target: string) => string;
      errorContext: string;
      execute: (
        args: A,
        opts: { signal: AbortSignal },
      ) => Promise<PrerenderExecResult<R>>;
      afterResponse?: (target: string, response: R) => void;
      parseAttributes: (attrs: any) => RouteParseResult<A>;
      errorMessage?: string | ((err: any) => string);
    },
  ) {
    router.post(path, async (ctxt: Koa.Context) => {
      // CS-10872: echo manager's correlation ID so operators can grep
      // one ID across client → manager → prerender-server. Fall back
      // to a mint if the caller didn't supply one (direct calls, tests).
      // CS-10872: sanitize to keep grepable IDs in logs & headers.
      let requestId =
        sanitizePrerenderRequestId(ctxt.get(PRERENDER_REQUEST_ID_HEADER)) ??
        randomUUID();
      ctxt.set(PRERENDER_REQUEST_ID_HEADER, requestId);
      // Propagate client-disconnect through to the Prerenderer so a
      // queued render can bail out of the semaphore / tab-queue wait
      // instead of finishing work no one is waiting for. The manager
      // aborts its upstream `fetch` on client close, which closes
      // this request's socket. We listen on `ctxt.res` (not
      // `ctxt.req`) because Node 17+ auto-destroys IncomingMessage
      // after the body is consumed, firing `req.close` during normal
      // flow; `res.close` fires after flushing on success or on
      // real connection tear-down before the response is sent.
      let ac = new AbortController();
      const onClientClose = () => {
        if (ctxt.res.writableEnded) return;
        // The reason string rides on `PrerenderCancelledError.message`
        // so cancel log lines say why the render was interrupted.
        ac.abort('client disconnected');
      };
      ctxt.res.on('close', onClientClose);
      try {
        let request = await fetchRequestFromContext(ctxt);
        let raw = await request.text();
        let body: any;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          ctxt.status = 400;
          ctxt.body = {
            errors: [
              {
                status: 400,
                message: 'Invalid JSON body',
              },
            ],
          };
          return;
        }

        let attrs = body?.data?.attributes ?? {};
        let parsed = options.parseAttributes(attrs);
        let routeArgs = parsed.args;
        let realmForLog =
          (routeArgs as { realm?: string } | undefined)?.realm ??
          (attrs.realm as string | undefined) ??
          '<none>';
        let affinityTypeForLog =
          (routeArgs as { affinityType?: string } | undefined)?.affinityType ??
          (attrs.affinityType as string);
        let affinityValueForLog =
          (routeArgs as { affinityValue?: string } | undefined)
            ?.affinityValue ?? (attrs.affinityValue as string);
        let renderOptionsForLog = routeArgs?.renderOptions ?? {};
        let priorityForLog =
          (routeArgs as { priority?: number } | undefined)?.priority ??
          (typeof attrs.priority === 'number' ? attrs.priority : 0);

        log.debug(
          `received ${options.requestDescription} ${parsed.logTarget}: affinityType=${affinityTypeForLog} affinityValue=${affinityValueForLog} realm=${realmForLog} priority=${priorityForLog} options=${JSON.stringify(renderOptionsForLog)}`,
        );
        if (parsed.missing.length > 0 || !routeArgs) {
          log.warn(
            'Rejecting %s due to missing attributes (%s); %s',
            options.requestDescription,
            parsed.missing.join(', '),
            parsed.rejectionLogDetails,
          );
          ctxt.status = 400;
          ctxt.body = {
            errors: [
              {
                status: 400,
                message: parsed.missingMessage,
              },
            ],
          };
          return;
        }

        let start = Date.now();
        let execPromise = options
          .execute(routeArgs, { signal: ac.signal })
          .then((result) => ({ result }));
        let raceResult = await raceAgainstDrain(execPromise, subscribeToDrain);
        if ('draining' in raceResult) {
          // Ensure execute completion does not raise unhandled rejections after we respond.
          execPromise.catch((e) =>
            log.debug('prerender execute settled after drain (ignored):', e),
          );
          ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
          ctxt.set(
            PRERENDER_SERVER_STATUS_HEADER,
            PRERENDER_SERVER_STATUS_DRAINING,
          );
          ctxt.body = {
            errors: [
              {
                status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
                message: 'Prerender server draining',
              },
            ],
          };
          return;
        }
        let { response, timings, pool } = raceResult.result;
        let totalMs = Date.now() - start;
        let poolFlags = Object.entries({
          reused: pool.reused,
          evicted: pool.evicted,
          timedOut: pool.timedOut,
        })
          .filter(([, value]) => value === true)
          .map(([key]) => key)
          .join(', ');
        let poolFlagSuffix =
          poolFlags.length > 0 ? ` flags=[${poolFlags}]` : '';
        log.info(
          '%s %s requestId=%s priority=%d total=%dms launch=%dms (semaphore=%dms, tabQueue=%dms, tabStartup=%dms, tabProbe=%dms) render=%dms pageId=%s affinityType=%s affinityValue=%s%s',
          options.infoLabel,
          parsed.logTarget,
          requestId,
          priorityForLog,
          totalMs,
          timings.launchMs,
          timings.waits.semaphoreMs,
          timings.waits.tabQueueMs,
          timings.waits.tabStartupMs,
          timings.waits.tabProbeMs,
          timings.renderMs,
          pool.pageId,
          pool.affinityType,
          pool.affinityValue,
          poolFlagSuffix,
        );
        decorateRenderErrorDiagnostics(response, requestId);
        // Timings are already embedded inside `response.meta.diagnostics`
        // by `Prerenderer.decorateRenderErrorsWithTimings` — the indexer
        // reads them from there. Keep the envelope `meta.timing`
        // populated (at the JSON:API envelope level) so existing
        // log/telemetry consumers that read the envelope don't have
        // to migrate.
        let envelopeTiming = {
          launchMs: timings.launchMs,
          renderMs: timings.renderMs,
          totalMs,
          waits: timings.waits,
        };
        ctxt.status = 201;
        ctxt.set('Content-Type', 'application/vnd.api+json');
        ctxt.body = {
          data: {
            type: options.responseType,
            id: parsed.responseId,
            attributes: response,
          },
          meta: {
            timing: envelopeTiming,
            pool,
          },
        };
        if (pool.timedOut) {
          log.warn(options.warnTimeoutMessage(parsed.logTarget));
        }
        options.afterResponse?.(parsed.logTarget, response);
      } catch (err: any) {
        // Swallow caller-cancelled: the socket is already closed,
        // nothing to report to them, no error metric to emit.
        if ((err as { name?: string })?.name === 'PrerenderCancelledError') {
          log.debug(
            `prerender cancelled before completion requestId=${requestId}`,
          );
          return;
        }
        Sentry.captureException(err);
        log.error(`Unhandled error in ${options.errorContext}:`, err);
        ctxt.status = 500;
        let message =
          typeof options.errorMessage === 'function'
            ? options.errorMessage(err)
            : (options.errorMessage ?? err?.message ?? 'Unknown error');
        ctxt.body = {
          errors: [
            {
              status: 500,
              message,
            },
          ],
        };
      } finally {
        ctxt.res.off('close', onClientClose);
      }
    });
  }

  registerPrerenderRoute('/prerender-module', {
    requestDescription: 'module prerender request',
    responseType: 'prerender-module-result',
    infoLabel: 'module prerendered',
    warnTimeoutMessage: (url) => `module render of ${url} timed out`,
    errorContext: '/prerender-module',
    parseAttributes: parseDefaultPrerenderAttributes,
    execute: (args, { signal }) =>
      prerenderer.prerenderModule({ ...args, signal }),
    afterResponse: (url, response) => {
      const moduleResponse = response as ModuleRenderResponse;
      if (moduleResponse.status === 'error' && moduleResponse.error) {
        log.debug(
          `module render of ${url} resulted in error doc:\n${JSON.stringify(moduleResponse.error, null, 2)}`,
        );
      }
    },
  });

  registerPrerenderRoute<RunCommandResponse, RunCommandRouteArgs>(
    '/run-command',
    {
      requestDescription: 'command-runner',
      responseType: 'command-result',
      infoLabel: 'command-runner',
      warnTimeoutMessage: (target) => `command run of ${target} timed out`,
      errorContext: '/run-command',
      errorMessage: 'Error running command',
      parseAttributes: parseRunCommandAttributes,
      execute: (args, { signal }) =>
        prerenderer.runCommand({
          userId: args.affinityValue,
          auth: args.auth,
          command: args.command,
          commandInput: args.commandInput as Record<string, unknown> | null,
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          signal,
        }),
    },
  );

  registerPrerenderRoute<ScreenshotPrerenderResponse, ScreenshotRouteArgs>(
    '/prerender-screenshot',
    {
      requestDescription: 'screenshot prerender request',
      responseType: 'screenshot-result',
      infoLabel: 'card screenshotted',
      warnTimeoutMessage: (url) => `screenshot of ${url} timed out`,
      errorContext: '/prerender-screenshot',
      parseAttributes: parseScreenshotAttributes,
      execute: (args, { signal }) =>
        prerenderer.prerenderScreenshot({
          realm: args.realm,
          url: args.url,
          auth: args.auth,
          format: args.format,
          ...(args.captureSpec ? { captureSpec: args.captureSpec } : {}),
          priority: args.priority,
          signal,
        }),
    },
  );

  // Composite visit prerender: runs a caller-selected subset of
  // {fileExtract, cardRender, fileRender} on a single page acquisition.
  router.post('/prerender-visit', async (ctxt: Koa.Context) => {
    // CS-10872: sanitize to keep grepable IDs in logs & headers —
    // same contract as the shared `registerPrerenderRoute` wrapper
    // used by /prerender-module, /prerender-file-extract, etc.
    let requestId =
      sanitizePrerenderRequestId(ctxt.get(PRERENDER_REQUEST_ID_HEADER)) ??
      randomUUID();
    ctxt.set(PRERENDER_REQUEST_ID_HEADER, requestId);
    // Client-disconnect → cancel the render. See the note on the
    // shared `registerPrerenderRoute` wrapper above.
    let ac = new AbortController();
    const onClientClose = () => {
      if (ctxt.res.writableEnded) return;
      // The reason string rides on `PrerenderCancelledError.message`
      // so cancel log lines say why the render was interrupted.
      ac.abort('client disconnected');
    };
    ctxt.res.on('close', onClientClose);
    try {
      let request = await fetchRequestFromContext(ctxt);
      let raw = await request.text();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: 'Invalid JSON body' }],
        };
        return;
      }

      let attrs = body?.data?.attributes ?? {};
      let rawUrl = attrs.url;
      let rawAuth = attrs.auth;
      let rawRealm = attrs.realm;
      let rawAffinityType = attrs.affinityType;
      let rawAffinityValue = attrs.affinityValue;
      let renderOptions: RenderRouteOptions =
        attrs.renderOptions &&
        typeof attrs.renderOptions === 'object' &&
        !Array.isArray(attrs.renderOptions)
          ? (attrs.renderOptions as RenderRouteOptions)
          : {};
      let fileData = attrs.fileData;
      let types = attrs.types;
      let rawVisitType = attrs.visitType;
      let visitType: PrerenderVisitType | undefined =
        rawVisitType === 'index' || rawVisitType === 'prerender-html'
          ? rawVisitType
          : undefined;
      let cardTypes = Array.isArray(attrs.cardTypes)
        ? (attrs.cardTypes as unknown[]).filter(
            (t): t is string => typeof t === 'string',
          )
        : undefined;

      let isNonEmptyString = (value: unknown): value is string =>
        typeof value === 'string' && value.trim().length > 0;

      let missing = [
        { value: rawUrl, name: 'url' },
        { value: rawRealm, name: 'realm' },
        { value: rawAuth, name: 'auth' },
        {
          value: rawAffinityType === 'realm' ? rawAffinityType : undefined,
          name: 'affinityType',
        },
        { value: rawAffinityValue, name: 'affinityValue' },
      ]
        .filter(({ value }) => !isNonEmptyString(value))
        .map(({ name }) => name);

      // A visitType value the server doesn't recognize would silently run
      // the fused visit; reject instead so a caller skew is loud.
      if (rawVisitType != null && visitType === undefined) {
        missing.push(`visitType ('index' or 'prerender-html')`);
      }

      // At least one pass must be requested
      if (
        !renderOptions.fileExtract &&
        !renderOptions.cardRender &&
        !renderOptions.fileRender
      ) {
        missing.push('renderOptions.{fileExtract|cardRender|fileRender}');
      }

      // If fileRender is requested without fileData, we need fileExtract so
      // the composite can chain the extract's resource into render — a
      // prerender-html visit included: requesting the extract is what makes
      // the standalone visit self-sufficient, resolving the file's resource
      // + types from source. When fileExtract isn't requested AND fileData
      // isn't supplied, reject — the host route model hook requires fileData
      // to populate its model.
      if (renderOptions.fileRender && !fileData && !renderOptions.fileExtract) {
        missing.push(
          'fileData (required when fileRender pass is requested without fileExtract)',
        );
      }
      // Chaining fileExtract → fileRender also needs fileDefCodeRef so the
      // renderer can resolve the file definition for the extracted resource.
      // Catch this at the HTTP boundary rather than failing mid-render.
      if (
        renderOptions.fileRender &&
        !fileData &&
        renderOptions.fileExtract &&
        !renderOptions.fileDefCodeRef
      ) {
        missing.push(
          'renderOptions.fileDefCodeRef (required when fileRender chains off fileExtract)',
        );
      }

      let priority = parsePriority(attrs);
      log.debug(
        `received visit prerender request ${rawUrl}: affinityType=${rawAffinityType} affinityValue=${rawAffinityValue} realm=${rawRealm} visitType=${visitType ?? 'fused'} priority=${priority ?? 0} options=${JSON.stringify(renderOptions)}`,
      );
      if (missing.length > 0) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message: `Missing or invalid required attributes: ${missing.join(', ')}`,
            },
          ],
        };
        return;
      }

      let realm = rawRealm as string;
      let affinityType = rawAffinityType as AffinityType;
      let affinityValue = rawAffinityValue as string;
      let url = rawUrl as string;
      let auth = rawAuth as string;
      // Optional batch id (CS-10758 step 3). If absent or not a non-empty
      // string the prerenderer treats the visit as batch-less and strips
      // any `clearCache: true` when an active batch owns the affinity.
      let rawBatchId = attrs.batchId;
      let batchId =
        typeof rawBatchId === 'string' && rawBatchId.trim().length > 0
          ? rawBatchId
          : undefined;

      // Indexer job correlation id. Already carried on the inbound
      // `x-boxel-job-id` header for log-tagging; forward it to the
      // prerenderer so it can be exposed to the host SPA via a global
      // (`__boxelJobId`) — the host's `_federated-search` fetch
      // wrapper reads it and re-stamps the header on outbound calls
      // so `handle-search` can gate the job-scoped search cache.
      let jobId = sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER));

      // The realm view this visit renders against. An index pass and the
      // prerender-html job it spawned are separate queue jobs over one view, so
      // the page keys reusable state on this rather than on the job id. Absent
      // for a visit that carries no scope (an on-demand render); the page then
      // falls back to the job id, which is narrower and so never unsound.
      let rawRenderScope = attrs.renderScope;
      let renderScope =
        typeof rawRenderScope === 'string' && rawRenderScope.trim().length > 0
          ? rawRenderScope
          : undefined;

      let start = Date.now();
      // Hoisted so a re-render after a host-shell change replays the same
      // visit rather than an approximation of it.
      let visitArgs: Parameters<typeof prerenderer.prerenderVisit>[0] = {
        affinityType,
        affinityValue,
        realm,
        url,
        auth,
        ...(visitType ? { visitType } : {}),
        renderOptions,
        ...(fileData ? { fileData } : {}),
        ...(Array.isArray(types) ? { types } : {}),
        ...(cardTypes?.length ? { cardTypes } : {}),
        ...(batchId ? { batchId } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(jobId ? { jobId } : {}),
        ...(renderScope ? { renderScope } : {}),
        signal: ac.signal,
      };
      let shellAtStart = options.getHostShellHash?.();
      let execPromise = prerenderer
        .prerenderVisit(visitArgs)
        .then((result) => ({ result }));
      let raceResult = await raceAgainstDrain(execPromise, subscribeToDrain);
      if ('draining' in raceResult) {
        execPromise.catch((e) =>
          log.debug(
            'visit prerender execute settled after drain (ignored):',
            e,
          ),
        );
        respondDraining(ctxt);
        return;
      }
      let { response, timings, pool } = raceResult.result;
      let shellAtCompletion = options.getHostShellHash?.();
      if (
        !options.isDraining?.() &&
        shouldRerenderForShellChange({
          response,
          shellAtStart,
          shellAtCompletion,
        })
      ) {
        log.warn(
          'visit of %s failed to resolve a module while the reported host shell moved from %s to %s; re-rendering before returning that failure',
          url,
          shellAtStart ?? 'none',
          shellAtCompletion,
        );
        // The token moved because `reconcileHostShell` saw it move, so the
        // browser is being recycled around now and this visit lands on a page
        // warmed against the current shell. One attempt only: if it fails
        // again the failure is the card's, and the caller is owed an answer.
        //
        // Waits for the recycle the token change triggered before rendering
        // again. The reported token moves the moment the change is learned,
        // while the pool is still tearing down, so rendering immediately would
        // race `closeAll` and pay a browser restart inside `prerenderVisit`'s
        // own recovery lane. Awaiting it is what makes "lands on a page warmed
        // against the current shell" true rather than aspirational.
        //
        // Both waits sit inside the drain race, not merely behind the
        // `isDraining` check above: a signal arriving after that check would
        // otherwise let this hold `server.close()` open for a browser restart
        // plus a full render. Draining winning is reported as such rather than
        // answered with the stale-shell failure — the manager routes the visit
        // to another server, which is a better outcome than persisting a
        // result this server has already decided it doesn't trust.
        //
        // A rejection is deliberately not caught. It unwinds to the route's
        // outer handler and answers 500, which `remote-prerenderer` maps to a
        // retryable error, so the visit is retried elsewhere — the same
        // disposition as draining, and better than returning a failure this
        // server distrusts. A recycle is exactly when a visit is most likely
        // to reject, so this is the expected path rather than a corner.
        let discardedMs = Date.now() - start;
        let retryPromise = (async () => {
          await options.awaitHostShellRecycle?.();
          return { result: await prerenderer.prerenderVisit(visitArgs) };
        })();
        let retryResult = await raceAgainstDrain(
          retryPromise,
          subscribeToDrain,
        );
        if ('draining' in retryResult) {
          retryPromise.catch((e) =>
            log.debug(
              'visit re-render settled after drain (ignored):',
              e as any,
            ),
          );
          respondDraining(ctxt);
          return;
        }
        ({ response, timings, pool } = retryResult.result);
        // The clock restarts with the render the response actually came from,
        // so `totalMs` and `timings` describe the same attempt. The discarded
        // attempt's cost is logged rather than folded into either.
        start = Date.now();
        shellAtStart = shellAtCompletion;
        shellAtCompletion = options.getHostShellHash?.();
        log.info(
          'visit of %s re-rendered on host shell %s after discarding a %dms attempt on %s',
          url,
          shellAtCompletion,
          discardedMs,
          shellAtStart,
        );
      }
      let totalMs = Date.now() - start;
      let poolFlags = Object.entries({
        reused: pool.reused,
        evicted: pool.evicted,
        timedOut: pool.timedOut,
      })
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .join(', ');
      let poolFlagSuffix = poolFlags.length > 0 ? ` flags=[${poolFlags}]` : '';
      log.info(
        'visit prerendered %s requestId=%s priority=%d total=%dms launch=%dms (semaphore=%dms, tabQueue=%dms, tabStartup=%dms, tabProbe=%dms) render=%dms pageId=%s affinityType=%s affinityValue=%s%s',
        url,
        requestId,
        priority ?? 0,
        totalMs,
        timings.launchMs,
        timings.waits.semaphoreMs,
        timings.waits.tabQueueMs,
        timings.waits.tabStartupMs,
        timings.waits.tabProbeMs,
        timings.renderMs,
        pool.pageId,
        pool.affinityType,
        pool.affinityValue,
        poolFlagSuffix,
      );
      decorateRenderErrorDiagnostics(response, requestId);
      stampHostShellTokens(response, {
        atStart: shellAtStart,
        atCompletion: shellAtCompletion,
      });
      // Timings are already inside `response.meta.diagnostics`. Here
      // we just populate the JSON:API envelope `meta.timing` that
      // existing telemetry consumers still read.
      let envelopeTiming = {
        launchMs: timings.launchMs,
        renderMs: timings.renderMs,
        totalMs,
        waits: timings.waits,
      };
      ctxt.status = 201;
      ctxt.set('Content-Type', 'application/vnd.api+json');
      ctxt.body = {
        data: {
          type: 'prerender-visit-result',
          id: url,
          attributes: response,
        },
        meta: {
          timing: envelopeTiming,
          pool,
        },
      };
      if (pool.timedOut) {
        log.warn(`visit render of ${url} timed out`);
      }
      if (response.pageUnusableError) {
        log.debug(
          `visit of ${url} hit pageUnusableError:\n${JSON.stringify(response.pageUnusableError, null, 2)}`,
        );
      }
    } catch (err: any) {
      if ((err as { name?: string })?.name === 'PrerenderCancelledError') {
        log.debug(
          `prerender-visit cancelled before completion requestId=${requestId}`,
        );
        return;
      }
      Sentry.captureException(err);
      log.error('Unhandled error in /prerender-visit:', err);
      ctxt.status = 500;
      ctxt.body = {
        errors: [
          {
            status: 500,
            message: err?.message ?? 'Unknown error',
          },
        ],
      };
    } finally {
      ctxt.res.off('close', onClientClose);
    }
  });

  // Release an indexing batch's ownership of an affinity's warm loader
  // (CS-10758 step 3). Called by the indexer's `finally` block via the
  // manager's broadcast proxy. No-op if this server isn't the current
  // owner — safe to broadcast to servers that never saw the batch.
  router.post('/release-batch', async (ctxt: Koa.Context) => {
    try {
      let request = await fetchRequestFromContext(ctxt);
      let raw = await request.text();
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [{ status: 400, message: 'Invalid JSON body' }],
        };
        return;
      }
      let attrs = body?.data?.attributes ?? {};
      let batchId = attrs.batchId;
      let affinityType = attrs.affinityType;
      let affinityValue = attrs.affinityValue;
      let missing: string[] = [];
      if (typeof batchId !== 'string' || batchId.trim().length === 0) {
        missing.push('batchId');
      }
      if (affinityType !== 'realm' && affinityType !== 'user') {
        missing.push('affinityType');
      }
      if (
        typeof affinityValue !== 'string' ||
        affinityValue.trim().length === 0
      ) {
        missing.push('affinityValue');
      }
      if (missing.length > 0) {
        ctxt.status = 400;
        ctxt.body = {
          errors: [
            {
              status: 400,
              message: `Missing or invalid attributes: ${missing.join(', ')}`,
            },
          ],
        };
        return;
      }
      await prerenderer.releaseBatch({
        batchId,
        affinityType: affinityType as AffinityType,
        affinityValue,
      });
      ctxt.status = 204;
    } catch (err: any) {
      Sentry.captureException(err);
      log.error('Unhandled error in /release-batch:', err);
      ctxt.status = 500;
      ctxt.body = {
        errors: [{ status: 500, message: err?.message ?? 'Unknown error' }],
      };
    }
  });

  app
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      if (
        options.isDraining?.() &&
        ctxt.method === 'POST' &&
        ctxt.path.startsWith('/prerender-')
      ) {
        ctxt.status = PRERENDER_SERVER_DRAINING_STATUS_CODE;
        ctxt.set(
          PRERENDER_SERVER_STATUS_HEADER,
          PRERENDER_SERVER_STATUS_DRAINING,
        );
        ctxt.body = {
          errors: [
            {
              status: PRERENDER_SERVER_DRAINING_STATUS_CODE,
              message: 'Prerender server draining',
            },
          ],
        };
        return;
      }
      return next();
    })
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      let jobId = sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER));
      let jobTag = jobId ? ` [job: ${jobId}]` : '';
      log.info(
        `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}${jobTag}`,
      );
      ctxt.res.on('finish', () => {
        log.info(
          `--> ${ctxt.method} ${ctxt.req.headers.accept} ${fullRequestURL(ctxt).href}: ${ctxt.status}${jobTag}`,
        );
        log.debug(JSON.stringify(ctxt.req.headers));
      });
      return next();
    })
    .use(ecsMetadata)
    .use(router.routes());

  app.on('error', (err: any) => {
    log.error(`prerender server HTTP error: ${err.message}`);
  });

  return { app, prerenderer };
}

function resolvePrerenderServerURL(port?: number): string {
  let hostname = process.env.HOSTNAME ?? 'localhost';
  let resolvedPort = port ?? defaultPrerenderServerPort;
  return `http://${hostname}:${resolvedPort}`.replace(/\/$/, '');
}

async function unregisterWithManager(serverURL: string) {
  try {
    const managerURL = resolvePrerenderManagerURL();
    let target = new URL(`${managerURL}/prerender-servers`);
    target.searchParams.set('url', serverURL);
    await fetch(target.toString(), { method: 'DELETE' }).catch((e) => {
      log.debug('Prerender manager unregister request failed:', e);
    });
  } catch (e) {
    log.debug(
      'Error while attempting to unregister with prerender manager:',
      e,
    );
  }
}

export function createPrerenderHttpServer(options?: {
  maxPages?: number;
  port?: number;
  // Default true. Gates the process-wide uncaughtException AND
  // unhandledRejection handlers, both of which call process.exit(1). In tests
  // pass false so the qunit runner isn't torn down before teardown hooks can
  // release hardcoded test ports (CS-10813).
  fatalExitOnUncaught?: boolean;
}): Server {
  let draining = false;
  let drainingResolved = false;
  let drainingDeferred = new Deferred<void>();
  let heartbeatTimer: NodeJS.Timeout | undefined;
  // Host-shell token the standbys were last warmed against, learned from the
  // manager's heartbeat responses (PRERENDER_HOST_SHELL_HASH_HEADER). When the
  // manager reports a different token — the host was redeployed and the realm
  // server is now serving a new shell — the browser is recycled so pages
  // reload it. Undefined until the first heartbeat that carries a token.
  let warmedHostShellHash: string | undefined;
  // The token the manager last reported, recorded the moment it arrives. Kept
  // separate from `warmedHostShellHash`, which must keep meaning "the shell
  // the pool has actually been re-warmed against" so a failed recycle still
  // retries on the next heartbeat. A visit samples this one, because it moves
  // when the change is learned rather than when the teardown finishes.
  let reportedHostShellHash: string | undefined;
  // The recycle in flight for the last token change, so a visit can wait for
  // the pool to be replaced before rendering again. Never rejects.
  let hostShellRecycle: Promise<void> | undefined;
  let recyclingForHostChange = false;
  let isClosing = false;
  let fatalExitOnUncaught = options?.fatalExitOnUncaught ?? true;
  let serverURL = resolvePrerenderServerURL(options?.port);
  let { app, prerenderer } = buildPrerenderApp({
    getHostShellHash: () => reportedHostShellHash,
    awaitHostShellRecycle: () => hostShellRecycle,
    maxPages: options?.maxPages,
    serverURL,
    isDraining: () => draining,
    drainingPromise: drainingDeferred.promise,
  });
  let stopPromise: Promise<void> | null = null;

  async function stopPrerendererOnce(): Promise<void> {
    if (!stopPromise) {
      stopPromise = (async () => {
        try {
          await prerenderer.stop();
        } catch (e: any) {
          // Best-effort shutdown; log and continue
          log.warn(
            'Error stopping prerenderer on server close:',
            e?.message ?? e,
          );
        }
      })();
    }
    await stopPromise;
  }
  const heartbeatIntervalMs = Math.max(
    1000,
    Number(process.env.PRERENDER_HEARTBEAT_INTERVAL_MS ?? 5000),
  );
  const shutdownGraceMs = Math.max(
    0,
    Number(process.env.PRERENDER_SHUTDOWN_GRACE_MS ?? 10000),
  );

  async function sendHeartbeat(status?: 'active' | 'draining') {
    try {
      const managerURL = resolvePrerenderManagerURL();
      const capacity = prerenderer.currentPoolCapacity;
      let body = {
        data: {
          type: 'prerender-server',
          attributes: {
            capacity,
            url: serverURL,
            status: status ?? (draining ? 'draining' : 'active'),
            warmedAffinities: prerenderer.getWarmAffinities(),
            // Per-affinity vacancy snapshot. Consumed by the prerender
            // manager's warm-vacancy-first routing (CS-10758). Additive to
            // warmedAffinities for rolling-deploy back-compat.
            affinityVacancy: prerenderer.getVacancySnapshot(),
          },
        },
      };
      log.debug(
        `POST heartbeat to ${managerURL}/prerender-servers with body:\n${JSON.stringify(body, null, 2)}`,
      );
      let response = await fetch(`${managerURL}/prerender-servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify(body),
      }).catch((e) => {
        log.debug('Prerender manager heartbeat request failed:', e);
        return undefined;
      });
      if (response) {
        reconcileHostShell(
          response.headers.get(PRERENDER_HOST_SHELL_HASH_HEADER),
        );
      }
    } catch (e) {
      // best-effort, but log for visibility
      log.debug('Error while attempting heartbeat with prerender manager:', e);
    }
  }

  // Compare the manager's current host-shell token against the one we warmed
  // against. A change means the host was redeployed, so recycle the browser
  // (fire-and-forget; the heartbeat itself must not block on the restart).
  //
  // This can fire on the very first heartbeat, while the pool's initial
  // standby warm is still running: the heartbeat loop starts as soon as the
  // server is listening, and that warm is deliberately not awaited. The
  // restart serializes behind the warm rather than racing it — `closeAll`
  // awaits any in-flight standby refill before closing — so pages the warm is
  // mid-way through creating can't outlive the browser the restart replaces.
  function reconcileHostShell(hash: string | null) {
    // Recorded before the guards below, because what the manager reported is
    // true whether or not this server is in a position to act on it.
    if (hash) {
      reportedHostShellHash = hash;
    }
    if (draining || recyclingForHostChange) {
      return;
    }
    let { recycle, nextWarmed } = decideHostShellRecycle(
      hash,
      warmedHostShellHash,
    );
    if (!recycle) {
      // Either nothing was reported or the token matches the baseline —
      // record it and we're done.
      warmedHostShellHash = nextWarmed;
      return;
    }
    recyclingForHostChange = true;
    log.info(
      warmedHostShellHash === undefined
        ? `host shell token first seen (${hash}); recycling prerender browser, which may have warmed against an earlier shell`
        : `host shell changed (${warmedHostShellHash} -> ${hash}); recycling prerender browser`,
    );
    hostShellRecycle = prerenderer
      .recycle()
      .then(() => {
        warmedHostShellHash = nextWarmed;
      })
      .catch((e) => {
        // Leave warmedHostShellHash unchanged so the next heartbeat retries.
        log.error('Failed to recycle prerender browser on host change:', e);
      })
      .finally(() => {
        recyclingForHostChange = false;
      });
    void hostShellRecycle;
  }

  function startHeartbeatLoop() {
    if (heartbeatTimer) return;
    void sendHeartbeat();
    heartbeatTimer = setInterval(() => {
      void sendHeartbeat();
    }, heartbeatIntervalMs);
    (heartbeatTimer as any).unref?.();
  }

  function stopHeartbeatLoop() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  }

  let server = createServer(app.callback()) as PrerenderServer;
  server.__stopPrerenderer = stopPrerendererOnce;

  server.on('close', async () => {
    stopHeartbeatLoop();
    await stopPrerendererOnce();
    try {
      await unregisterWithManager(serverURL);
    } catch (e) {
      log.debug(
        'Error scheduling unregister with prerender manager:',
        e as any,
      );
    }
  });
  // best-effort registration (async, non-blocking)
  server.on('listening', () => {
    try {
      // When port=0 (e.g. multiple prerender servers), resolve the actual port
      let addr = server.address() as import('net').AddressInfo | null;
      if (addr && typeof addr !== 'string' && addr.port !== options?.port) {
        let actualURL = resolvePrerenderServerURL(addr.port);
        serverURL = actualURL;
        prerenderer.serverURL = actualURL;
      }
      startHeartbeatLoop();
    } catch (e) {
      log.debug('Error scheduling registration with prerender manager:', e);
    }
  });
  let shutdownHandler = (signal: NodeJS.Signals) => {
    if (draining) return;
    log.info(`Received ${signal}; marking prerender server as draining`);
    draining = true;
    if (!drainingResolved) {
      drainingResolved = true;
      drainingDeferred.fulfill();
    }
    stopHeartbeatLoop();
    void sendHeartbeat('draining');
    const shutdownTimer = setTimeout(() => {
      if (isClosing) return;
      isClosing = true;
      clearTimeout(shutdownTimer);
      server.close(() => {
        log.info(
          `prerender server HTTP on port ${options?.port ?? defaultPrerenderServerPort} has stopped.`,
        );
      });
    }, shutdownGraceMs);
    shutdownTimer.unref();
  };
  process.on('SIGTERM', shutdownHandler);
  process.on('SIGINT', shutdownHandler);

  let uncaughtExceptionHandler: ((err: unknown) => void) | undefined;
  let unhandledRejectionHandler: ((err: unknown) => void) | undefined;
  if (fatalExitOnUncaught) {
    let fatalExitInProgress = false;
    const handleFatal = async (
      type: 'uncaughtException' | 'unhandledRejection',
      err: any,
    ) => {
      if (fatalExitInProgress) return;
      fatalExitInProgress = true;
      log.error(`Fatal ${type}; shutting down prerenderer`, err);
      try {
        await prerenderer.stop();
      } catch (e: any) {
        log.warn('Error stopping prerenderer during fatal shutdown:', e);
      }
      try {
        server.close();
      } catch (e: any) {
        log.warn('Error closing server during fatal shutdown:', e);
      }
      setTimeout(() => process.exit(1), 100);
    };

    uncaughtExceptionHandler = (err: unknown) =>
      handleFatal('uncaughtException', err);
    unhandledRejectionHandler = (err: unknown) =>
      handleFatal('unhandledRejection', err);
    process.on('uncaughtException', uncaughtExceptionHandler);
    process.on('unhandledRejection', unhandledRejectionHandler);
  }
  server.on('close', () => {
    process.off('SIGTERM', shutdownHandler);
    process.off('SIGINT', shutdownHandler);
    if (uncaughtExceptionHandler) {
      process.off('uncaughtException', uncaughtExceptionHandler);
    }
    if (unhandledRejectionHandler) {
      process.off('unhandledRejection', unhandledRejectionHandler);
    }
  });
  return server;
}
