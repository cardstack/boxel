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
//   went without running a timer;
// - `wedge` when the main thread froze for 10s or more, attributed to the
//   scripts that blocked it.
//
// This origin holds secrets, so the events are built so they can't carry one:
// a request is reduced to its endpoint label, method, status, timing and size
// (never its URL, query, headers or either body); a page is named by its label
// (never its address or fragment); a freeze is attributed by script URL,
// reduced to its origin and path, and function name; and an error's text is
// scrubbed of anything it quotes, any URL or Matrix ID, and, for a refused
// request, the server's own message, which the page already shows the user.
// The test drives each page with known secrets and checks no beacon carries
// one.
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
// A heartbeat gap this long or longer is a wedge: a freeze a person notices,
// not the jank `keepalive.max_gap_ms` already shows.
const WEDGE_GAP_MS = 10_000;
// A real freeze leaves long-animation-frame or longtask entries that span it,
// but their observer's callback can arrive a little after the heartbeat that
// saw the gap. A wake from OS sleep runs no task during the gap, at most a
// short one as it wakes, so a gap whose entries still span less than this
// share of it after these retries is dropped. A real freeze's entries span
// nearly all of it.
const WEDGE_MIN_COVERAGE = 0.5;
const WEDGE_CORROBORATION_GRACE_MS = 120;
const WEDGE_CORROBORATION_RETRIES = 2;
const MAX_LOAF_SCRIPTS = 10;
// The observer entries kept for attributing a wedge.
const MAX_LOAF_HISTORY = 100;
// What a script URL may end in to be reported: a script file. Anything else
// (the document's own address, a `blob:` or `data:` URL) reports as none.
const SCRIPT_PATH = /\.(?:[cm]?js|ts|gts|gjs)$/;

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

// The host's `wedge` event, without its JS self-profiler stacks: the secure
// origin's pages aren't served with `Document-Policy: js-profiling`. A script
// is named by its URL's origin and path and its function name, never by what
// invoked it (an element or a URL with its query).
export interface WedgeEvent extends BaseEvent {
  event_type: 'wedge';
  duration_ms: number;
  worst_gap_ms: number;
  blocked_ms: number;
  longtask_count: number;
  // The worst blocking script, as flat fields a dashboard can group by: Loki's
  // `| json` doesn't reach into `loaf_scripts`. Empty, and -1 for the offset,
  // when only a longtask entry is available.
  top_frame_function: string;
  top_frame_url: string;
  top_frame_char: number;
  top_frame_blocked_ms: number;
  // The worst three, as `fn @ url:char`.
  top_frames: string;
  loaf_scripts: Array<{
    source_url: string;
    function_name: string;
    char_position: number;
    // How the script was entered: `user-callback`, `event-listener`,
    // `resolve-promise`, `classic-script` and so on.
    invoker_type: string;
    blocking_duration_ms: number;
  }>;
}

export type TelemetryEvent =
  | ServerRequestEvent
  | PageLoadEvent
  | ClientErrorEvent
  | KeepaliveEvent
  | WedgeEvent;

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

interface LoafEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  scripts: Array<Record<string, unknown>>;
}

interface LongtaskEntry {
  startTime: number;
  duration: number;
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
  #observingFrames = false;
  #loafHistory: LoafEntry[] = [];
  #longtaskHistory: LongtaskEntry[] = [];
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
      this.#observeFrames(),
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
      this.#loafHistory = [];
      this.#longtaskHistory = [];
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
    if (gap >= WEDGE_GAP_MS) {
      // A macrotask later, so the observer callbacks for the frames that
      // blocked, queued behind them, have run.
      let windowStart = n - gap;
      this.#deps.window.setTimeout(
        () => this.#guard(() => this.#emitWedge(windowStart, n, gap)),
        0,
      );
    }
  }

  // ── Wedges ───────────────────────────────────────────────────────────────

  #emitWedge(
    windowStart: number,
    windowEnd: number,
    gap: number,
    retriesLeft = WEDGE_CORROBORATION_RETRIES,
  ): void {
    if (!this.#started) {
      return;
    }
    // What of an entry falls inside the gap. A frame can open before the
    // gap does, with the heartbeat that ran just before the freeze, so an
    // entry counts by how much of it overlaps the gap, not by where it
    // starts.
    let overlap = (e: { startTime: number; duration: number }) =>
      Math.max(
        0,
        Math.min(e.startTime + e.duration, windowEnd) -
          Math.max(e.startTime, windowStart),
      );
    let loafs = this.#loafHistory.filter((e) => overlap(e) > 0);
    let longtasks = this.#longtaskHistory.filter((e) => overlap(e) > 0);
    let spanned = 0;
    for (let entry of [...loafs, ...longtasks]) {
      spanned += overlap(entry);
    }
    // Without an observer the heartbeat is the only signal, so the gap is
    // reported as it is.
    if (this.#observingFrames && spanned < gap * WEDGE_MIN_COVERAGE) {
      if (retriesLeft > 0) {
        this.#deps.window.setTimeout(
          () =>
            this.#guard(() =>
              this.#emitWedge(windowStart, windowEnd, gap, retriesLeft - 1),
            ),
          WEDGE_CORROBORATION_GRACE_MS,
        );
      }
      return;
    }
    let blockedMs = 0;
    let scripts: WedgeEvent['loaf_scripts'] = [];
    for (let entry of loafs) {
      blockedMs += entry.blockingDuration;
      for (let script of entry.scripts) {
        scripts.push({
          source_url: scriptURL(script.sourceURL),
          function_name: String(script.sourceFunctionName ?? ''),
          char_position: Number(script.sourceCharPosition ?? -1),
          invoker_type: String(script.invokerType ?? ''),
          blocking_duration_ms: Math.round(Number(script.duration ?? 0)),
        });
      }
    }
    if (loafs.length === 0) {
      for (let entry of longtasks) {
        blockedMs += entry.duration;
      }
    }
    scripts.sort((a, b) => b.blocking_duration_ms - a.blocking_duration_ms);
    let top = scripts[0];
    this.#record({
      event_type: 'wedge',
      duration_ms: Math.round(gap),
      worst_gap_ms: Math.round(gap),
      blocked_ms: Math.round(blockedMs),
      longtask_count: loafs.length > 0 ? loafs.length : longtasks.length,
      top_frame_function: top?.function_name ?? '',
      top_frame_url: top?.source_url ?? '',
      top_frame_char: top?.char_position ?? -1,
      top_frame_blocked_ms: top?.blocking_duration_ms ?? 0,
      top_frames: scripts
        .slice(0, 3)
        .map(
          (s) =>
            `${s.function_name || '(anonymous)'} @ ${s.source_url || '?'}:${
              s.char_position
            }`,
        )
        .join('  |  '),
      loaf_scripts: scripts.slice(0, MAX_LOAF_SCRIPTS),
    });
  }

  // Keeps the window's recent long-animation-frame entries, or its longtask
  // entries where the browser has no LoAF, for attributing a wedge. Returns
  // what stops it.
  #observeFrames(): () => void {
    try {
      return this.#startObservingFrames();
    } catch {
      // Without an observer a wedge is still reported, unattributed.
      return () => {};
    }
  }

  #startObservingFrames(): () => void {
    let Observer = (this.#deps.window as Window & typeof globalThis)
      .PerformanceObserver;
    let supported = Observer?.supportedEntryTypes ?? [];
    let observer: PerformanceObserver;
    if (supported.includes('long-animation-frame')) {
      observer = new Observer((list) =>
        this.#guard(() => {
          for (let entry of list.getEntries()) {
            let e = entry as PerformanceEntry & {
              blockingDuration?: number;
              scripts?: Array<Record<string, unknown>>;
            };
            this.#loafHistory.push({
              startTime: e.startTime,
              duration: e.duration,
              blockingDuration: e.blockingDuration ?? 0,
              scripts: Array.isArray(e.scripts) ? e.scripts : [],
            });
          }
          this.#loafHistory.splice(
            0,
            Math.max(0, this.#loafHistory.length - MAX_LOAF_HISTORY),
          );
        }),
      );
      observer.observe({
        type: 'long-animation-frame',
        buffered: true,
      });
    } else if (supported.includes('longtask')) {
      observer = new Observer((list) =>
        this.#guard(() => {
          for (let entry of list.getEntries()) {
            this.#longtaskHistory.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
          this.#longtaskHistory.splice(
            0,
            Math.max(0, this.#longtaskHistory.length - MAX_LOAF_HISTORY),
          );
        }),
      );
      observer.observe({ type: 'longtask', buffered: true });
    } else {
      return () => {};
    }
    this.#observingFrames = true;
    return () => {
      this.#observingFrames = false;
      observer.disconnect();
    };
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

// A script's URL as a wedge reports it: its origin and path, when the path is a
// script file's, and otherwise none. Never its query or fragment, and never the
// document's own address, which names the page's key and carries what the page
// was told.
export function scriptURL(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    let url = new URL(value);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      !SCRIPT_PATH.test(url.pathname)
    ) {
      return '';
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
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
