// The secure origin's client telemetry: what its pages do, beaconed to the
// realm server's `/_client-telemetry` as the host's telemetry is, so the same
// `boxel:client-perf` log lines and dashboard read both. Each batch names
// `client_app: 'secure-origin'`, and the realm server writes that on every
// line.
//
// It records:
// - `server-request` for each request a page makes to the realm server or the
//   Matrix server (`timedFetch` in `security/session.js`), by a fixed endpoint
//   label;
// - `page-load` for each page opened: which page, how long until it first
//   rendered and until its data loaded, and how the load ended;
// - `client-error` for an uncaught throw or unhandled rejection;
// - `keepalive` while the window is quiet, with the longest the main thread
//   went without running a timer.
//
// This origin holds secrets, so the events are built so they can't carry one:
// a request is reduced to its endpoint label, method, status, timing and size
// (never its URL, query, headers or either body); a page is named by its label
// (never its address or fragment); and an error's text is scrubbed of anything
// it quotes, any URL or Matrix ID, and, for a refused request, the server's own
// message, which the page already shows the user. The test drives each page
// with known secrets and checks no beacon carries one.
//
// Nothing here may make a page fail: every hook swallows its own errors, and a
// beacon that fails is dropped.

import { observeRequests } from '../security/session.js';

import {
  reportFromErrorEvent,
  reportFromRejectionEvent,
  type ClientErrorKind,
  type ErrorReport,
} from './error-report.ts';
import { endpointLabel, pageLabel } from './labels.ts';

// The host's cadence and caps: a beat every second sends what has built up, a
// quiet window still beacons every 25s, and a batch stays under the realm
// server's 500 events and inside the browser's ~64KB `fetch(keepalive)`
// budget, measured in UTF-8 bytes.
const FLUSH_INTERVAL_MS = 1_000;
const KEEPALIVE_INTERVAL_MS = 25_000;
const HEARTBEAT_INTERVAL_MS = 100;
const MAX_BUFFERED_EVENTS = 400;
const MAX_EVENTS_PER_FLUSH = 400;
const MAX_FLUSH_BODY_BYTES = 60 * 1024;
// Past this many distinct errors in one beat, further ones fold into a single
// event whose count covers them, so a storm of errors can't crowd out the rest.
const MAX_ERROR_EVENTS_PER_FLUSH = 12;
const MAX_FOLDED_SIGNATURES = 500;
const OVERFLOW_ERROR_KEY = 'overflow';

interface BaseEvent {
  event_type: string;
  ts: number;
  // The page the event happened on (`labels.ts`).
  page: string;
}

export interface ServerRequestEvent extends BaseEvent {
  event_type: 'server-request';
  endpoint: string;
  method: string;
  // 0 when the request never reached the server.
  status: number;
  duration_ms: number;
  resp_bytes: number;
  correlation_id: string | null;
  retried: boolean;
}

// How a page's load ended: its data loaded (or it has none to load), loading
// failed, the window had no session for it, or the user left first.
export type PageOutcome = 'loaded' | 'load-failed' | 'signed-out' | 'left';

export interface PageLoadEvent extends BaseEvent {
  event_type: 'page-load';
  // Whether the page opened with the document or by a move within the shell.
  navigation: 'document' | 'in-app';
  outcome: PageOutcome;
  // From the navigation's start; null when the page never rendered.
  first_render_ms: number | null;
  // From the navigation's start until the page's data loaded; null for a
  // page that loads none, and for an outcome other than `loaded`.
  data_loaded_ms: number | null;
  // For `load-failed`: the endpoint label and status of the last request of
  // this page that failed (status 0: no response), when one did.
  failed_endpoint: string | null;
  failed_status: number | null;
}

export interface ClientErrorEvent extends BaseEvent {
  event_type: 'client-error';
  kind: ClientErrorKind;
  message: string;
  message_key: string;
  stack: string;
  top_frame_function: string;
  source_url: string;
  line: number;
  col: number;
  dedup_count: number;
  folded_signatures: number;
}

export interface KeepaliveEvent extends BaseEvent {
  event_type: 'keepalive';
  window_ms: number;
  max_gap_ms: number;
}

export type TelemetryEvent =
  | ServerRequestEvent
  | PageLoadEvent
  | ClientErrorEvent
  | KeepaliveEvent;

export interface TelemetryDeps {
  window: Window;
  // The realm server, whose `/_client-telemetry` the beacons go to.
  serverURL: URL;
  // The window's own session, when it has one: a beacon sent with it is
  // attributed to its user. Without one the realm server accepts the beacon
  // and attributes it to nobody.
  session: () => { token: string; user: string } | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

// How a page that loads data reports how its load ended (`pageAwaitsData`).
export interface PageVisit {
  loaded(): void;
  loadFailed(error?: unknown): void;
  signedOut(): void;
}

const IGNORED_VISIT: PageVisit = {
  loaded() {},
  loadFailed() {},
  signedOut() {},
};

interface Visit {
  page: string;
  navigation: PageLoadEvent['navigation'];
  start: number;
  firstRender: number | null;
  awaitsData: boolean;
  settled: boolean;
  lastFailure: { endpoint: string; status: number } | null;
}

export class SecureTelemetry {
  // One per window.
  readonly sessionId = crypto.randomUUID();
  #deps: TelemetryDeps;
  #now: () => number;
  #buffer: TelemetryEvent[] = [];
  #started = false;
  #release: Array<() => void> = [];
  #lastKeepaliveAt = 0;
  #lastHeartbeatAt = 0;
  #maxGapSinceKeepalive = 0;
  #visit: Visit | undefined;
  #visits = 0;
  #errorDedup = new Map<string, ClientErrorEvent>();
  #foldedSignatures = new Set<string>();
  #errorEventsSinceFlush = 0;
  #reportingError = false;

  constructor(deps: TelemetryDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => performance.now());
  }

  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    let win = this.#deps.window;
    let n = this.#now();
    this.#lastKeepaliveAt = n;
    this.#lastHeartbeatAt = n;
    this.#maxGapSinceKeepalive = 0;
    let flushTimer = win.setInterval(
      () => this.#guard(() => this.#onFlushTick()),
      FLUSH_INTERVAL_MS,
    );
    let heartbeatTimer = win.setInterval(
      () => this.#guard(() => this.#onHeartbeat()),
      HEARTBEAT_INTERVAL_MS,
    );
    let onPagehide = () => this.#guard(() => this.flushAll('pagehide'));
    let onVisibility = () =>
      this.#guard(() => {
        if (win.document.visibilityState === 'hidden') {
          this.flushAll('hidden');
        } else {
          // A hidden window's timers are throttled; its gap isn't the main
          // thread's.
          this.#lastHeartbeatAt = this.#now();
        }
      });
    // Passive: neither handler consumes the event, so the browser's own
    // reporting is unaffected. Registered without `capture`, so a failed
    // subresource's plain `error` event never reaches it.
    let onError = (event: Event) => {
      if (event instanceof ErrorEvent) {
        this.#reportError(() => reportFromErrorEvent(event, { scrubMessage }));
      }
    };
    let onRejection = (event: Event) =>
      this.#reportError(() =>
        reportFromRejectionEvent(event, { scrubMessage }),
      );
    win.addEventListener('pagehide', onPagehide);
    win.document.addEventListener('visibilitychange', onVisibility);
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    let stopObserving = observeRequests(
      (request: {
        url: string;
        method: string;
        status: number;
        durationMs: number;
        respBytes: number;
        correlationId: string | null;
      }) => this.#guard(() => this.#onRequest(request)),
    );
    this.#release = [
      () => win.clearInterval(flushTimer),
      () => win.clearInterval(heartbeatTimer),
      () => win.removeEventListener('pagehide', onPagehide),
      () => win.document.removeEventListener('visibilitychange', onVisibility),
      () => win.removeEventListener('error', onError),
      () => win.removeEventListener('unhandledrejection', onRejection),
      stopObserving,
    ];
  }

  stop(): void {
    if (!this.#started) {
      return;
    }
    try {
      this.flushAll('stop');
    } finally {
      this.#started = false;
      for (let release of this.#release) {
        release();
      }
      this.#release = [];
    }
  }

  // Sends everything buffered now, as many batches as it takes: the window may
  // be about to close, and the next beat would never come. The page that is
  // open, if its load hasn't ended, ends as `left` when the window is going.
  flushAll(reason: string): void {
    if (!this.#started) {
      return;
    }
    if (reason === 'pagehide' || reason === 'close' || reason === 'stop') {
      this.#settle(this.#visit, 'left');
    }
    while (this.#buffer.length > 0) {
      this.#flushChunk();
    }
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  // The shell's router calls `pageOpened` as a move to a page starts, and
  // `pageRendered` once it has rendered. A page that loads data (the key
  // pages) says so while rendering, with `pageAwaitsData`, and reports how its
  // load ended through the visit that answers. A visit reports only its own
  // page: a page left mid-load whose load ends later reports nothing, since
  // its visit already ended as `left`. Any other page has loaded once it
  // renders.

  pageOpened(routeName: string | undefined): void {
    this.#guard(() => {
      this.#settle(this.#visit, 'left');
      let first = this.#visits++ === 0;
      this.#visit = {
        page: pageLabel(routeName),
        navigation: first ? 'document' : 'in-app',
        // The document's own navigation starts at time zero.
        start: first ? 0 : this.#now(),
        firstRender: null,
        awaitsData: false,
        settled: false,
        lastFailure: null,
      };
    });
  }

  pageAwaitsData(): PageVisit {
    let visit = this.#visit;
    if (!visit) {
      return IGNORED_VISIT;
    }
    visit.awaitsData = true;
    return {
      loaded: () => this.#guard(() => this.#settle(visit, 'loaded')),
      // `error` is what the load failed with; its status stands in when no
      // request of the page failed (it threw before or after its requests).
      loadFailed: (error?: unknown) =>
        this.#guard(() => {
          let status = (error as { status?: unknown } | undefined)?.status;
          this.#settle(
            visit,
            'load-failed',
            typeof status === 'number' ? status : null,
          );
        }),
      signedOut: () => this.#guard(() => this.#settle(visit, 'signed-out')),
    };
  }

  pageRendered(): void {
    this.#guard(() => {
      let visit = this.#visit;
      if (!visit || visit.firstRender !== null) {
        return;
      }
      visit.firstRender = this.#now() - visit.start;
      if (!visit.awaitsData) {
        this.#settle(visit, 'loaded');
      }
    });
  }

  #settle(
    visit: Visit | undefined,
    outcome: PageOutcome,
    errorStatus: number | null = null,
  ): void {
    if (!visit || visit.settled) {
      return;
    }
    visit.settled = true;
    let failure = outcome === 'load-failed' ? visit.lastFailure : null;
    this.#record(
      {
        event_type: 'page-load',
        navigation: visit.navigation,
        outcome,
        first_render_ms: round(visit.firstRender),
        data_loaded_ms:
          outcome === 'loaded' && visit.awaitsData
            ? round(this.#now() - visit.start)
            : null,
        failed_endpoint: failure?.endpoint ?? null,
        failed_status:
          failure?.status ?? (outcome === 'load-failed' ? errorStatus : null),
      },
      visit.page,
    );
  }

  // ── Requests ─────────────────────────────────────────────────────────────

  #onRequest(request: {
    url: string;
    method: string;
    status: number;
    durationMs: number;
    respBytes: number;
    correlationId: string | null;
  }): void {
    let endpoint = endpointLabel(request.url);
    if (request.status === 0 || request.status >= 400) {
      if (this.#visit && !this.#visit.settled) {
        this.#visit.lastFailure = { endpoint, status: request.status };
      }
    }
    this.#record({
      event_type: 'server-request',
      endpoint,
      method: request.method,
      status: request.status,
      duration_ms: Math.round(request.durationMs),
      resp_bytes: request.respBytes,
      correlation_id: request.correlationId,
      retried: false,
    });
  }

  // ── Errors ───────────────────────────────────────────────────────────────

  #reportError(buildReport: () => ErrorReport): void {
    // A throw from inside this handler would itself dispatch `error` and
    // recurse.
    if (!this.#started || this.#reportingError) {
      return;
    }
    this.#reportingError = true;
    try {
      let { signature, ...fields } = buildReport();
      let key = signature;
      let folded = 0;
      let pending = this.#errorDedup.get(signature);
      if (pending) {
        pending.dedup_count++;
        return;
      }
      if (this.#errorEventsSinceFlush >= MAX_ERROR_EVENTS_PER_FLUSH - 1) {
        let overflow = this.#errorDedup.get(OVERFLOW_ERROR_KEY);
        if (overflow) {
          overflow.dedup_count++;
          if (
            !this.#foldedSignatures.has(signature) &&
            this.#foldedSignatures.size < MAX_FOLDED_SIGNATURES
          ) {
            this.#foldedSignatures.add(signature);
            overflow.folded_signatures = this.#foldedSignatures.size;
          }
          return;
        }
        key = OVERFLOW_ERROR_KEY;
        this.#foldedSignatures.clear();
        this.#foldedSignatures.add(signature);
        folded = 1;
      }
      let event: ClientErrorEvent = {
        event_type: 'client-error',
        ts: Date.now(),
        page: this.#visit?.page ?? pageLabel(undefined),
        ...fields,
        dedup_count: 1,
        folded_signatures: folded,
      };
      this.#push(event);
      this.#errorDedup.set(key, event);
      this.#errorEventsSinceFlush++;
    } catch {
      // Telemetry never adds an error of its own.
    } finally {
      this.#reportingError = false;
    }
  }

  // The dedup map holds exactly the error events still buffered, so a hit on
  // it means "not sent yet".
  #forgetErrorEvents(departed: TelemetryEvent[]): void {
    if (this.#errorDedup.size > 0 && departed.length > 0) {
      let gone = new Set<TelemetryEvent>(departed);
      for (let [key, event] of this.#errorDedup) {
        if (gone.has(event)) {
          this.#errorDedup.delete(key);
        }
      }
    }
    this.#errorEventsSinceFlush = this.#errorDedup.size;
  }

  // ── Beats ────────────────────────────────────────────────────────────────

  #onFlushTick(): void {
    if (this.#buffer.some((e) => e.event_type !== 'keepalive')) {
      this.#flushChunk();
      this.#lastKeepaliveAt = this.#now();
      this.#maxGapSinceKeepalive = 0;
      return;
    }
    let elapsed = this.#now() - this.#lastKeepaliveAt;
    if (elapsed >= KEEPALIVE_INTERVAL_MS) {
      this.#record({
        event_type: 'keepalive',
        window_ms: Math.round(elapsed),
        max_gap_ms: Math.round(this.#maxGapSinceKeepalive),
      });
      this.#lastKeepaliveAt = this.#now();
      this.#maxGapSinceKeepalive = 0;
      this.#flushChunk();
    }
  }

  #onHeartbeat(): void {
    let n = this.#now();
    let gap = n - this.#lastHeartbeatAt;
    this.#lastHeartbeatAt = n;
    if (this.#deps.window.document.visibilityState === 'hidden') {
      return;
    }
    if (gap > this.#maxGapSinceKeepalive) {
      this.#maxGapSinceKeepalive = gap;
    }
  }

  // Sends one batch from the front of the buffer, as large as fits the caps.
  #flushChunk(): void {
    if (this.#buffer.length === 0) {
      return;
    }
    let session: ReturnType<TelemetryDeps['session']>;
    try {
      session = this.#deps.session();
    } catch {
      session = undefined;
    }
    let chunk = this.#buffer.slice(0, MAX_EVENTS_PER_FLUSH);
    let body = this.#body(chunk);
    while (chunk.length > 1 && byteLength(body) > MAX_FLUSH_BODY_BYTES) {
      chunk = chunk.slice(0, Math.ceil(chunk.length / 2));
      body = this.#body(chunk);
    }
    this.#buffer.splice(0, chunk.length);
    // A sent event can't absorb a repeat, and the shared slot never spans
    // beats.
    this.#errorDedup.delete(OVERFLOW_ERROR_KEY);
    this.#foldedSignatures.clear();
    this.#forgetErrorEvents(chunk);
    let send = this.#deps.fetch ?? globalThis.fetch;
    try {
      // `keepalive` lets the last batch finish while the window closes.
      void send(new URL('_client-telemetry', this.#deps.serverURL), {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }).catch(() => {});
    } catch {
      // A lost beacon is acceptable; a page that fails because of one isn't.
    }
  }

  // No user: the realm server attributes a beacon to the session it is sent
  // with, never to a user the body names, so the body names none.
  #body(events: TelemetryEvent[]): string {
    return JSON.stringify({
      v: 1,
      client_app: 'secure-origin',
      session_id: this.sessionId,
      events,
    });
  }

  // ── Buffer ───────────────────────────────────────────────────────────────

  // `page` defaults to the page open now.
  #record(
    event: DistributiveOmit<TelemetryEvent, 'ts' | 'page'>,
    page = this.#visit?.page ?? pageLabel(undefined),
  ): void {
    if (!this.#started) {
      return;
    }
    this.#push({ ...event, ts: Date.now(), page } as TelemetryEvent);
  }

  #push(event: TelemetryEvent): void {
    this.#buffer.push(event);
    if (this.#buffer.length > MAX_BUFFERED_EVENTS) {
      this.#forgetErrorEvents(
        this.#buffer.splice(0, this.#buffer.length - MAX_BUFFERED_EVENTS),
      );
    }
  }

  #guard(work: () => void): void {
    try {
      work();
    } catch {
      // Telemetry never breaks the page it watches.
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

function round(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// What an error's message may say on this origin. A refused request's message
// is the server's own (a `SecureSessionError` or `MatrixError`, which carry
// the response's status), so it is replaced by the status and code alone.
// Anything else keeps its words but loses whatever it quotes (a parse error
// quotes its input), any URL and any Matrix ID or email address, each
// becoming `*`.
export function scrubMessage(message: string, thrown?: unknown): string {
  let { status, code, errcode } = (thrown ?? {}) as {
    status?: unknown;
    code?: unknown;
    errcode?: unknown;
  };
  if (typeof status === 'number') {
    let reason = [code, errcode].find(
      (value): value is string =>
        typeof value === 'string' && /^[\w-]{1,64}$/.test(value),
    );
    return `request failed: status ${status}${reason ? ` (${reason})` : ''}`;
  }
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '*')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, '*')
    .replace(/[^\s@]*@[^\s@]+/g, '*');
}
