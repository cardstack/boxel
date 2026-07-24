import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { v4 as uuidv4 } from 'uuid';

import {
  hasExecutableExtension,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  type FetcherMiddlewareHandler,
  type LooseCardResource,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type MatrixService from './matrix-service';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmServerService from './realm-server';
import type { SessionParticipant } from './session';
import type SessionService from './session';
import type StoreService from './store';

// ── Event schema ───────────────────────────────────────────────────────────
// These shapes are consumed verbatim by the realm-server ingest endpoint and
// the downstream dashboard. Field names are load-bearing — do not rename.

type TelemetryRealm = string | null;

interface BaseEvent {
  event_type: string;
  ts: number; // epoch ms
  realm?: TelemetryRealm;
}

export interface ServerRequestEvent extends BaseEvent {
  event_type: 'server-request';
  endpoint: string;
  method: string;
  status: number;
  duration_ms: number;
  resp_bytes: number;
  correlation_id: string | null;
  retried: boolean;
  realm: TelemetryRealm;
}

export interface DeserializeEvent extends BaseEvent {
  event_type: 'deserialize';
  duration_ms: number;
  doc_bytes: number;
  included_count: number;
  card_type: string | null;
  realm: TelemetryRealm;
}

export interface CardLoadEvent extends BaseEvent {
  event_type: 'card-load';
  card_id: string;
  realm: TelemetryRealm;
  loading_ms: number;
  settle_ms: number;
  num_loads: number;
  loaded_ids: string[];
  slowest_loads: Array<{ id: string; ms: number; outcome: 'ok' | 'error' }>;
}

export interface WedgeEvent extends BaseEvent {
  event_type: 'wedge';
  duration_ms: number;
  worst_gap_ms: number;
  blocked_ms: number;
  longtask_count: number;
  // Scalar summary of the worst blocking script, surfaced as flat fields so the
  // dashboard can group by the wedging frame — Loki's `| json` does not extract
  // elements of the nested `loaf_scripts` array. Empty when no LoAF attribution
  // is available (e.g. the longtask fallback).
  top_frame_function: string;
  top_frame_url: string;
  // Source character offset of the worst frame — with a source map this
  // resolves to a line/column even for minified builds, where the function
  // name alone is unusable.
  top_frame_char: number;
  top_frame_blocked_ms: number;
  // A readable multi-frame summary (worst few blocking scripts,
  // `fn @ url:char`) so the frame can be reasoned about beyond a single name.
  top_frames: string;
  loaf_scripts: Array<{
    source_url: string;
    function_name: string;
    char_position: number;
    invoker: string;
    blocking_duration_ms: number;
  }>;
  profiler_stacks?: Array<{ sample_ms: number; frames: string[] }>;
}

export interface RebuildEvent extends BaseEvent {
  event_type: 'rebuild';
  duration_ms: number;
  trigger_modules: string[];
  // Scalar grouping key (the first trigger module) — the dashboard groups
  // rebuild cost by this, since `| json` does not extract array elements.
  trigger_module: string;
  modules_refetched: number;
  cards_reloaded: number;
}

export interface RealmEvent extends BaseEvent {
  event_type: 'realm-event';
  realm: TelemetryRealm;
  index_type: 'incremental' | 'full';
  invalidations_count: number;
  invalidated_ids: string[];
  reloads_triggered: number;
  own_write: boolean;
  processing_ms: number;
}

export interface KeepaliveEvent extends BaseEvent {
  event_type: 'keepalive';
  window_ms: number;
  max_gap_ms: number;
}

export type TelemetryEvent =
  | ServerRequestEvent
  | DeserializeEvent
  | CardLoadEvent
  | WedgeEvent
  | RebuildEvent
  | RealmEvent
  | KeepaliveEvent;

// Distributive omit of `ts` — callers hand us the event minus its timestamp,
// which the service stamps as it enters the ring buffer.
type WithoutTs<T> = T extends unknown ? Omit<T, 'ts'> : never;
export type TelemetryEventInput = WithoutTs<TelemetryEvent>;

// ── Tunables ─────────────────────────────────────────────────────────────
const FLUSH_INTERVAL_MS = 1_000;
// A quiet tab still beacons its liveness on this cadence.
const KEEPALIVE_INTERVAL_MS = 25_000;
// Main-thread liveness probe; a callback arriving this late implies the thread
// was busy in between.
const HEARTBEAT_INTERVAL_MS = 100;
// A heartbeat gap this large or larger counts as a wedge: an incident-grade
// main-thread freeze, not the sub-second jank a keepalive's max_gap_ms already
// captures.
const WEDGE_GAP_MS = 10_000;
// Keep the buffer under the server's per-request event cap so a single flush
// never exceeds it; the flush also chunks by count and serialized-body size.
const MAX_BUFFERED_EVENTS = 400;
const MAX_EVENTS_PER_FLUSH = 400;
// `fetch(keepalive)` bodies share a ~64KB per-origin browser budget, so a flush
// must stay under that (it is also well under the server's 256KB cap). Measured
// in UTF-8 bytes, not UTF-16 code units.
const MAX_FLUSH_BODY_BYTES = 60 * 1024;
const MAX_LOADED_IDS = 50;
const MAX_SLOWEST_LOADS = 10;
const MAX_LOAF_SCRIPTS = 10;
const MAX_PROFILER_STACKS = 12;
const MAX_PROFILER_FRAMES = 32;
// Bounded ring of raw observer entries kept for wedge attribution.
const MAX_LOAF_HISTORY = 100;
const MAX_PROFILER_SAMPLES = 400;
// JS self-profiler sampling + harvest cadence.
const PROFILER_SAMPLE_INTERVAL_MS = 50;
const PROFILER_HARVEST_INTERVAL_MS = 2_000;

interface LoafEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  scripts: Array<Record<string, unknown>>;
}

interface ProfilerSample {
  sample_ms: number;
  frames: string[];
}

function now(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
  );
}

// UTF-8 byte length, matching the realm-server's TextEncoder-based size check.
function byteLength(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length;
  }
}

export default class ClientTelemetryService
  extends Service
  implements SessionParticipant
{
  @service declare private realmServer: RealmServerService;
  @service declare private matrixService: MatrixService;
  @service declare private session: SessionService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  // Stable for the tab's lifetime; deliberately survives logout so a single
  // browsing session reads as one session server-side.
  #sessionId = uuidv4();
  #matrixUserId: string | null = null;

  #buffer: TelemetryEvent[] = [];
  #started = false;
  #testOptIn = false;

  // Timers / observers / listeners — all created only while started and all
  // torn down in stop().
  #flushTimer: ReturnType<typeof setInterval> | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #profilerHarvestTimer: ReturnType<typeof setInterval> | undefined;
  #loafObserver: PerformanceObserver | undefined;
  #longtaskObserver: PerformanceObserver | undefined;
  #profiler: { stop(): Promise<unknown> } | undefined;
  #profilerSampled: boolean | undefined;
  #visibilityHandler: (() => void) | undefined;
  #pagehideHandler: (() => void) | undefined;

  // Flush gating.
  #lastKeepaliveAt = now();
  #maxGapSinceKeepalive = 0;

  // Heartbeat / wedge state.
  #lastHeartbeatAt = now();
  #loafHistory: LoafEntry[] = [];
  #longtaskHistory: Array<{ startTime: number; duration: number }> = [];
  #profilerSamples: ProfilerSample[] = [];

  // Card-load window tracking.
  #lastLoadGeneration = 0;
  #cardLoadWindowOpen = false;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    this.start();
    registerDestructor(this, () => this.teardown());
  }

  // Idempotent final teardown: flush anything buffered, then release every
  // timer / observer / listener. Safe to call more than once (the service's
  // own destructor and the instance initializer both invoke it).
  teardown(): void {
    this.#flush('teardown');
    this.stop();
  }

  // Whether the instrument is currently armed. Hooks read this to stay a
  // no-op when telemetry is off (tests, prerender, unsupported browser).
  get isEnabled(): boolean {
    return this.#started;
  }

  // Opt-in used by the instrument's own tests, which are otherwise gated off
  // by isTesting().
  enableForTest(): void {
    this.#testOptIn = true;
    this.start();
  }

  // Test-only: return and clear the buffered events so a test can assert on the
  // event shapes the hooks produced without depending on the flush timer,
  // session token, or network.
  drainBufferForTest(): TelemetryEvent[] {
    let events = this.#buffer;
    this.#buffer = [];
    return events;
  }

  // ── SessionParticipant ───────────────────────────────────────────────────
  sessionStarted(): void {
    this.#captureMatrixUserId();
    this.start();
  }

  resetState(): void {
    this.#flush('reset');
    this.#matrixUserId = null;
    this.stop();
  }

  // ── Public emit API ────────────────────────────────────────────────────
  recordEvent(evt: TelemetryEventInput): void {
    if (!this.#started) {
      return;
    }
    try {
      this.#push({ ...evt, ts: Date.now() } as TelemetryEvent);
    } catch (e) {
      // Telemetry must never break the path that emitted the event.
      console.error('client-telemetry recordEvent failed', e);
    }
  }

  // Builds and records a server-request event from a completed fetch. Called
  // by the passive timing middleware in the authed-fetch stack.
  recordServerRequestTiming(
    req: Request,
    response: Response,
    durationMs: number,
    retried: boolean,
  ): void {
    if (!this.#started) {
      return;
    }
    try {
      let realm = response.headers.get('x-boxel-realm-url') || null;
      let contentLength = response.headers.get('content-length');
      let respBytes = contentLength ? Number(contentLength) : 0;
      this.recordEvent({
        event_type: 'server-request',
        endpoint: normalizeEndpoint(req.url, req.method),
        method: req.method,
        status: response.status,
        duration_ms: Math.round(durationMs),
        resp_bytes: Number.isFinite(respBytes) ? respBytes : 0,
        correlation_id:
          req.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER) || null,
        retried,
        realm,
      });
    } catch (e) {
      console.error('client-telemetry recordServerRequestTiming failed', e);
    }
  }

  // Builds and records a deserialize event from a completed
  // createFromSerialized call in the store.
  recordDeserialize(args: {
    durationMs: number;
    doc: unknown;
    resource: LooseCardResource;
  }): void {
    if (!this.#started) {
      return;
    }
    try {
      let { durationMs, doc, resource } = args;
      let docBytes = 0;
      try {
        docBytes = JSON.stringify(doc).length;
      } catch {
        docBytes = 0;
      }
      let included = (doc as { included?: unknown[] } | undefined)?.included;
      let realm =
        typeof resource?.meta?.realmURL === 'string'
          ? resource.meta.realmURL
          : null;
      this.recordEvent({
        event_type: 'deserialize',
        duration_ms: Math.round(durationMs),
        doc_bytes: docBytes,
        included_count: Array.isArray(included) ? included.length : 0,
        card_type: codeRefName(resource?.meta?.adoptsFrom),
        realm,
      });
    } catch (e) {
      console.error('client-telemetry recordDeserialize failed', e);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  private start(): void {
    if (this.#started || !this.#isAllowed()) {
      return;
    }
    this.#started = true;
    this.#captureMatrixUserId();
    this.#lastLoadGeneration = this.#safeLoadGeneration();
    let n = now();
    this.#lastKeepaliveAt = n;
    this.#lastHeartbeatAt = n;
    this.#maxGapSinceKeepalive = 0;
    this.#startFlushLoop();
    this.#startHeartbeat();
    this.#startWedgeObservers();
    this.#startProfiler();
    this.#attachLifecycleListeners();
  }

  private stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    if (this.#flushTimer !== undefined) {
      clearInterval(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    if (this.#profilerHarvestTimer !== undefined) {
      clearInterval(this.#profilerHarvestTimer);
      this.#profilerHarvestTimer = undefined;
    }
    if (this.#loafObserver) {
      try {
        this.#loafObserver.disconnect();
      } catch {
        // ignore
      }
      this.#loafObserver = undefined;
    }
    if (this.#longtaskObserver) {
      try {
        this.#longtaskObserver.disconnect();
      } catch {
        // ignore
      }
      this.#longtaskObserver = undefined;
    }
    if (this.#profiler) {
      // Detach without awaiting — a stopped profiler's trace is not harvested
      // during teardown.
      let p = this.#profiler;
      this.#profiler = undefined;
      Promise.resolve()
        .then(() => p.stop())
        .catch(() => {});
    }
    this.#detachLifecycleListeners();
    this.#loafHistory = [];
    this.#longtaskHistory = [];
    this.#profilerSamples = [];
    this.#cardLoadWindowOpen = false;
  }

  #isAllowed(): boolean {
    // Never instrument a prerender tab — the render path is hot and headless.
    if (
      (globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext
    ) {
      return false;
    }
    // Off under tests unless a test opts in explicitly.
    if (isTesting() && !this.#testOptIn) {
      return false;
    }
    // Needs a working timer/window baseline.
    if (typeof window === 'undefined' || typeof setInterval !== 'function') {
      return false;
    }
    return true;
  }

  #captureMatrixUserId(): void {
    try {
      this.#matrixUserId = this.matrixService.userId ?? null;
    } catch {
      // Matrix SDK not loaded yet / anonymous.
      this.#matrixUserId = null;
    }
  }

  #safeLoadGeneration(): number {
    try {
      return this.store.loadGeneration ?? 0;
    } catch {
      return 0;
    }
  }

  // ── Flush loop ───────────────────────────────────────────────────────────
  #startFlushLoop(): void {
    this.#flushTimer = setInterval(() => {
      try {
        this.#onFlushTick();
      } catch (e) {
        console.error('client-telemetry flush tick failed', e);
      }
    }, FLUSH_INTERVAL_MS);
  }

  #onFlushTick(): void {
    let hasSignal = this.#buffer.some((e) => e.event_type !== 'keepalive');
    if (hasSignal) {
      this.#flush('signal');
      // A real transmission resets the keepalive window: the beacon only fires
      // after a genuinely quiet stretch, not a fixed period after the last one.
      this.#lastKeepaliveAt = now();
      this.#maxGapSinceKeepalive = 0;
      return;
    }
    // Quiet: beacon a compact keepalive on its own cadence.
    let elapsed = now() - this.#lastKeepaliveAt;
    if (elapsed >= KEEPALIVE_INTERVAL_MS) {
      this.recordEvent({
        event_type: 'keepalive',
        window_ms: Math.round(elapsed),
        max_gap_ms: Math.round(this.#maxGapSinceKeepalive),
      });
      this.#lastKeepaliveAt = now();
      this.#maxGapSinceKeepalive = 0;
      this.#flush('keepalive');
    }
  }

  #flush(_reason: string): void {
    if (this.#buffer.length === 0) {
      return;
    }
    let token: string | undefined;
    try {
      token = this.realmServer.token;
    } catch {
      token = undefined;
    }
    if (!token) {
      // Hold events until a session token exists; the buffer is bounded so it
      // cannot grow without limit.
      return;
    }
    let origin: string;
    try {
      origin = this.realmServer.url.origin;
    } catch {
      return;
    }
    // Send a single chunk that respects the server's per-request event-count
    // and byte caps; the remainder stays buffered for the next flush tick.
    let chunk = this.#buffer.slice(0, MAX_EVENTS_PER_FLUSH);
    let body = this.#buildBody(chunk);
    while (chunk.length > 1 && byteLength(body) > MAX_FLUSH_BODY_BYTES) {
      chunk = chunk.slice(0, Math.ceil(chunk.length / 2));
      body = this.#buildBody(chunk);
    }
    this.#buffer.splice(0, chunk.length);
    try {
      // Raw fetch (not authedFetch) so the telemetry POST is neither timed by
      // our own middleware nor rewritten by the auth stack. keepalive lets the
      // final flush complete during page unload.
      void globalThis
        .fetch(`${origin}/_client-telemetry`, {
          method: 'POST',
          keepalive: true,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body,
        })
        .catch(() => {});
    } catch {
      // ignore — telemetry loss is acceptable.
    }
  }

  #buildBody(events: TelemetryEvent[]): string {
    let appVersion =
      typeof config.APP?.version === 'string' ? config.APP.version : undefined;
    return JSON.stringify({
      v: 1,
      session_id: this.#sessionId,
      matrix_user_id: this.#matrixUserId,
      env: config.environment,
      ...(appVersion ? { app_version: appVersion } : {}),
      events,
    });
  }

  #push(evt: TelemetryEvent): void {
    this.#buffer.push(evt);
    if (this.#buffer.length > MAX_BUFFERED_EVENTS) {
      this.#buffer.splice(0, this.#buffer.length - MAX_BUFFERED_EVENTS);
    }
  }

  // ── Heartbeat: wedge detection + card-load windows ─────────────────────
  #startHeartbeat(): void {
    this.#lastHeartbeatAt = now();
    this.#heartbeatTimer = setInterval(() => {
      try {
        this.#onHeartbeat();
      } catch (e) {
        console.error('client-telemetry heartbeat failed', e);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  #onHeartbeat(): void {
    let n = now();
    let gap = n - this.#lastHeartbeatAt;
    this.#lastHeartbeatAt = n;
    // A hidden/backgrounded tab has its timers throttled (clamped to ~1s, then
    // to ~60s), so a large gap there is throttling, not a main-thread wedge.
    // Don't emit wedges or measure card-load windows while hidden — just keep
    // the heartbeat clock current so the first post-resume tick isn't misread
    // as a stall.
    if (isDocumentHidden()) {
      return;
    }
    if (gap > this.#maxGapSinceKeepalive) {
      this.#maxGapSinceKeepalive = gap;
    }
    if (gap >= WEDGE_GAP_MS) {
      this.#emitWedge(n - gap, n, gap);
    }
    this.#pollCardLoad();
  }

  #emitWedge(windowStart: number, windowEnd: number, gap: number): void {
    let loafInWindow = this.#loafHistory.filter(
      (e) => e.startTime >= windowStart && e.startTime <= windowEnd,
    );
    let longtasksInWindow = this.#longtaskHistory.filter(
      (e) => e.startTime >= windowStart && e.startTime <= windowEnd,
    );
    let blockedMs = 0;
    let scripts: WedgeEvent['loaf_scripts'] = [];
    for (let entry of loafInWindow) {
      blockedMs += entry.blockingDuration || 0;
      for (let s of entry.scripts) {
        scripts.push({
          source_url: String(s.sourceURL ?? s.name ?? ''),
          function_name: String(s.sourceFunctionName ?? ''),
          char_position: Number(s.sourceCharPosition ?? -1),
          invoker: String(s.invoker ?? ''),
          blocking_duration_ms: Math.round(Number(s.duration ?? 0)),
        });
      }
    }
    if (loafInWindow.length === 0) {
      for (let entry of longtasksInWindow) {
        blockedMs += entry.duration || 0;
      }
    }
    scripts.sort((a, b) => b.blocking_duration_ms - a.blocking_duration_ms);
    let topFrame = scripts[0];
    let topFrames = scripts
      .slice(0, 3)
      .map(
        (s) =>
          `${s.function_name || '(anonymous)'} @ ${s.source_url || '?'}:${
            s.char_position
          }`,
      )
      .join('  |  ');
    let longtaskCount =
      loafInWindow.length > 0 ? loafInWindow.length : longtasksInWindow.length;
    let profilerStacks = this.#profilerSamplesInWindow(windowStart, windowEnd);
    this.recordEvent({
      event_type: 'wedge',
      duration_ms: Math.round(gap),
      worst_gap_ms: Math.round(gap),
      blocked_ms: Math.round(blockedMs),
      longtask_count: longtaskCount,
      top_frame_function: topFrame?.function_name ?? '',
      top_frame_url: topFrame?.source_url ?? '',
      top_frame_char: topFrame?.char_position ?? -1,
      top_frame_blocked_ms: topFrame?.blocking_duration_ms ?? 0,
      top_frames: topFrames,
      loaf_scripts: scripts.slice(0, MAX_LOAF_SCRIPTS),
      ...(profilerStacks.length > 0
        ? { profiler_stacks: profilerStacks.slice(0, MAX_PROFILER_STACKS) }
        : {}),
    });
  }

  #pollCardLoad(): void {
    let gen = this.#safeLoadGeneration();
    if (gen < this.#lastLoadGeneration) {
      // store.reset() / loadGeneration→0 is a boundary: abandon any open
      // window rather than emitting a spurious span across the reset.
      this.#lastLoadGeneration = gen;
      this.#cardLoadWindowOpen = false;
      return;
    }
    if (gen > this.#lastLoadGeneration) {
      let startGeneration = this.#lastLoadGeneration;
      this.#lastLoadGeneration = gen;
      if (!this.#cardLoadWindowOpen) {
        this.#openCardLoadWindow(startGeneration);
      }
    }
  }

  #openCardLoadWindow(startGeneration: number): void {
    this.#cardLoadWindowOpen = true;
    let startedAt = now();
    let { cardId, realm } = this.#currentCardContext();
    void this.#awaitCardLoad(startGeneration, startedAt, cardId, realm);
  }

  async #awaitCardLoad(
    startGeneration: number,
    startedAt: number,
    cardId: string,
    realm: TelemetryRealm,
  ): Promise<void> {
    try {
      await this.store.loaded();
      let loadingMs = now() - startedAt;
      await nextTick();
      let settleMs = now() - startedAt;
      let endGeneration = this.#safeLoadGeneration();
      let numLoads = Math.max(0, endGeneration - startGeneration);
      let recent = this.#recentCardDocLoads();
      let loadedIds = recent.map((r) => r.url).slice(0, MAX_LOADED_IDS);
      let slowest = [...recent]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, MAX_SLOWEST_LOADS)
        .map((r) => ({
          id: r.url,
          ms: Math.round(r.ms),
          outcome: r.outcome ?? 'ok',
        }));
      this.recordEvent({
        event_type: 'card-load',
        card_id: cardId,
        realm,
        loading_ms: Math.round(loadingMs),
        settle_ms: Math.round(settleMs),
        num_loads: numLoads,
        loaded_ids: loadedIds,
        slowest_loads: slowest,
      });
    } catch (e) {
      console.error('client-telemetry card-load window failed', e);
    } finally {
      this.#cardLoadWindowOpen = false;
    }
  }

  #currentCardContext(): { cardId: string; realm: TelemetryRealm } {
    let cardId = '';
    let realm: TelemetryRealm = null;
    try {
      let items = this.operatorModeStateService.topMostStackItems();
      let top = items[items.length - 1];
      cardId = top?.id ?? '';
    } catch {
      cardId = '';
    }
    try {
      realm = this.operatorModeStateService.realmURL ?? null;
    } catch {
      realm = null;
    }
    return { cardId, realm };
  }

  #recentCardDocLoads(): Array<{
    url: string;
    ms: number;
    outcome?: 'ok' | 'error';
  }> {
    try {
      return this.store.recentCardDocLoads();
    } catch {
      return [];
    }
  }

  // ── Wedge observers ──────────────────────────────────────────────────────
  #startWedgeObservers(): void {
    if (typeof PerformanceObserver === 'undefined') {
      return;
    }
    let supported = supportedEntryTypes();
    if (supported.includes('long-animation-frame')) {
      try {
        this.#loafObserver = new PerformanceObserver((list) => {
          for (let entry of list.getEntries()) {
            let e = entry as unknown as {
              startTime: number;
              duration: number;
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
          if (this.#loafHistory.length > MAX_LOAF_HISTORY) {
            this.#loafHistory.splice(
              0,
              this.#loafHistory.length - MAX_LOAF_HISTORY,
            );
          }
        });
        this.#loafObserver.observe({
          type: 'long-animation-frame',
          buffered: true,
        } as PerformanceObserverInit);
      } catch {
        this.#loafObserver = undefined;
      }
    } else if (supported.includes('longtask')) {
      // Fallback attribution when LoAF is unavailable.
      try {
        this.#longtaskObserver = new PerformanceObserver((list) => {
          for (let entry of list.getEntries()) {
            this.#longtaskHistory.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
          if (this.#longtaskHistory.length > MAX_LOAF_HISTORY) {
            this.#longtaskHistory.splice(
              0,
              this.#longtaskHistory.length - MAX_LOAF_HISTORY,
            );
          }
        });
        this.#longtaskObserver.observe({
          type: 'longtask',
          buffered: true,
        } as PerformanceObserverInit);
      } catch {
        this.#longtaskObserver = undefined;
      }
    }
  }

  // ── Tier-2 JS self-profiling (opt-out) ─────────────────────────────────
  // Decide once per tab whether this session runs the profiler.
  #profilerSampledIn(): boolean {
    if (this.#profilerSampled === undefined) {
      let cfg = config as {
        clientTelemetryProfiler?: boolean;
        clientTelemetryProfilerSampleRate?: number;
      };
      if (cfg.clientTelemetryProfiler === false) {
        this.#profilerSampled = false;
      } else {
        let rate =
          typeof cfg.clientTelemetryProfilerSampleRate === 'number'
            ? cfg.clientTelemetryProfilerSampleRate
            : config.environment === 'production'
              ? 0.05
              : 1;
        this.#profilerSampled =
          rate >= 1 ? true : rate <= 0 ? false : Math.random() < rate;
      }
    }
    return this.#profilerSampled;
  }

  #startProfiler(): void {
    // The JS self-profiler is opt-out but sampled per session: continuous
    // sampling has real CPU cost, so only a fraction of sessions run it (all in
    // dev, a small fraction in production), and `clientTelemetryProfiler: false`
    // is a hard kill switch. Decided once per tab so it doesn't flip across
    // session edges.
    if (!this.#profilerSampledIn()) {
      return;
    }
    let ProfilerCtor = (
      globalThis as {
        Profiler?: new (opts: {
          sampleInterval: number;
          maxBufferSize: number;
        }) => { stop(): Promise<unknown> };
      }
    ).Profiler;
    if (typeof ProfilerCtor !== 'function') {
      return;
    }
    if (!this.#spawnProfiler(ProfilerCtor)) {
      return;
    }
    this.#profilerHarvestTimer = setInterval(() => {
      void this.#harvestProfiler(ProfilerCtor);
    }, PROFILER_HARVEST_INTERVAL_MS);
  }

  #spawnProfiler(
    ProfilerCtor: new (opts: {
      sampleInterval: number;
      maxBufferSize: number;
    }) => { stop(): Promise<unknown> },
  ): boolean {
    try {
      this.#profiler = new ProfilerCtor({
        sampleInterval: PROFILER_SAMPLE_INTERVAL_MS,
        maxBufferSize: 10_000,
      });
      return true;
    } catch {
      // No js-profiling document policy — stay dormant.
      this.#profiler = undefined;
      return false;
    }
  }

  async #harvestProfiler(
    ProfilerCtor: new (opts: {
      sampleInterval: number;
      maxBufferSize: number;
    }) => { stop(): Promise<unknown> },
  ): Promise<void> {
    if (!this.#profiler) {
      return;
    }
    let old = this.#profiler;
    // Restart before awaiting the old trace so sampling has minimal gaps.
    this.#spawnProfiler(ProfilerCtor);
    try {
      let trace = await old.stop();
      this.#ingestProfilerTrace(trace);
    } catch {
      // ignore — a failed harvest just drops that window's samples.
    }
  }

  #ingestProfilerTrace(trace: unknown): void {
    if (!this.#started) {
      return;
    }
    let t = trace as
      | {
          frames?: Array<{ name?: string }>;
          stacks?: Array<{ frameId: number; parentId?: number }>;
          samples?: Array<{ timestamp: number; stackId?: number }>;
        }
      | undefined;
    if (!t?.samples || !t.stacks || !t.frames) {
      return;
    }
    let { frames, stacks, samples } = t;
    for (let sample of samples) {
      let stackFrames: string[] = [];
      let stackId = sample.stackId;
      let guard = 0;
      while (stackId != null && guard++ < MAX_PROFILER_FRAMES) {
        let stack = stacks[stackId];
        if (!stack) {
          break;
        }
        let frame = frames[stack.frameId];
        stackFrames.push(frame?.name || '(anonymous)');
        stackId = stack.parentId;
      }
      this.#profilerSamples.push({
        sample_ms: sample.timestamp,
        frames: stackFrames,
      });
    }
    if (this.#profilerSamples.length > MAX_PROFILER_SAMPLES) {
      this.#profilerSamples.splice(
        0,
        this.#profilerSamples.length - MAX_PROFILER_SAMPLES,
      );
    }
  }

  #profilerSamplesInWindow(
    windowStart: number,
    windowEnd: number,
  ): ProfilerSample[] {
    return this.#profilerSamples.filter(
      (s) => s.sample_ms >= windowStart && s.sample_ms <= windowEnd,
    );
  }

  // ── Page lifecycle ───────────────────────────────────────────────────────
  #attachLifecycleListeners(): void {
    if (typeof window === 'undefined' || !window.addEventListener) {
      return;
    }
    this.#pagehideHandler = () => this.#flush('pagehide');
    this.#visibilityHandler = () => {
      if (typeof document === 'undefined') {
        return;
      }
      if (document.visibilityState === 'hidden') {
        this.#flush('hidden');
      } else {
        // Resuming: discard the throttled hidden interval so the first visible
        // heartbeat gap isn't misread as a wedge.
        this.#lastHeartbeatAt = now();
      }
    };
    window.addEventListener('pagehide', this.#pagehideHandler);
    window.addEventListener('visibilitychange', this.#visibilityHandler);
  }

  #detachLifecycleListeners(): void {
    if (typeof window === 'undefined' || !window.removeEventListener) {
      return;
    }
    if (this.#pagehideHandler) {
      window.removeEventListener('pagehide', this.#pagehideHandler);
      this.#pagehideHandler = undefined;
    }
    if (this.#visibilityHandler) {
      window.removeEventListener('visibilitychange', this.#visibilityHandler);
      this.#visibilityHandler = undefined;
    }
  }
}

// ── Passive server-request timing middleware ─────────────────────────────
// Kept in module scope so a retried request (the auth middleware re-runs the
// inner chain on a 401 with the same Request object) is counted across the two
// attempts.
const requestAttemptCounts = new WeakMap<Request, number>();

export function createServerRequestTimingMiddleware(
  owner: Owner,
): FetcherMiddlewareHandler {
  return async (req, next) => {
    if (
      (globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext
    ) {
      return next(req);
    }
    // A late-settling fetch can run against a torn-down owner (common in tests);
    // a throwing lookup must not reject the fetch chain.
    let telemetry: ClientTelemetryService | undefined;
    try {
      telemetry = owner.lookup('service:client-telemetry') as
        | ClientTelemetryService
        | undefined;
    } catch {
      return next(req);
    }
    if (!telemetry?.isEnabled) {
      return next(req);
    }
    let attempt = (requestAttemptCounts.get(req) ?? 0) + 1;
    requestAttemptCounts.set(req, attempt);
    let start = now();
    let response = await next(req);
    telemetry.recordServerRequestTiming(
      req,
      response,
      now() - start,
      attempt > 1,
    );
    return response;
  };
}

// Normalize a realm-server URL to a low-cardinality endpoint label: bare
// underscore-endpoints (`_search`, `_catalog-realms`) collapse to the endpoint
// name; everything else (card / source / file requests) collapses to
// `<METHOD> <kind>` (e.g. "GET card").
function normalizeEndpoint(rawUrl: string, method: string): string {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  let segments = pathname.split('/').filter(Boolean);
  let endpointSegment = segments.find((s) => s.startsWith('_'));
  if (endpointSegment) {
    return endpointSegment;
  }
  let last = segments[segments.length - 1] ?? '';
  let kind: string;
  if (last.endsWith('.json')) {
    kind = 'file-meta';
  } else if (hasExecutableExtension(last)) {
    kind = 'source';
  } else if (last.includes('.')) {
    kind = 'file';
  } else {
    kind = 'card';
  }
  return `${method} ${kind}`;
}

// A CodeRef is usually `{ module, name }`; other shapes (fieldOf / ancestorOf)
// have no direct name, so we surface null there.
function codeRefName(adoptsFrom: unknown): string | null {
  if (
    adoptsFrom &&
    typeof adoptsFrom === 'object' &&
    'name' in adoptsFrom &&
    typeof (adoptsFrom as { name: unknown }).name === 'string'
  ) {
    return (adoptsFrom as { name: string }).name;
  }
  return null;
}

function supportedEntryTypes(): readonly string[] {
  let ctor = PerformanceObserver as unknown as {
    supportedEntryTypes?: readonly string[];
  };
  return ctor.supportedEntryTypes ?? [];
}

// A short macrotask tick used to fold a settling tail into the card-load
// window measurement (the difference between loading_ms and settle_ms).
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

declare module '@ember/service' {
  interface Registry {
    'client-telemetry': ClientTelemetryService;
  }
}
