// Streaming CDP `Tracing` capture for prerender pages.
//
// Why a trace stream, when we already have the CPU profiler:
//
//   The CDP `Profiler` only delivers its samples at `Profiler.stop`, and a
//   fully-wedged renderer defeats that stop the same way it defeats
//   `Performance.getMetrics` — the call needs the renderer's own thread to
//   serialize the profile, and that thread is pegged. So the CPU profiler
//   captures heavy-but-completing renders but structurally cannot capture
//   the hard wedge.
//
//   `Tracing` with `transferMode: ReturnAsStream` fixes exactly that. The
//   trace agent and the V8 sampler buffer trace events on their own
//   browser-process threads as the render runs, so the samples leading into
//   (and during) a wedge are already collected out-of-band before the
//   renderer's thread locks. `Tracing.end` and the `IO.read` drain are
//   browser-process operations too, so they return even while the page's
//   main thread is fully pegged — no main-thread `stop` has to succeed.
//
//   Tracing also separates the work by category (JS execution / V8 GC /
//   compile / layout / paint), so it can tell a JS spin apart from GC
//   thrash — something a JS-only CPU profile can't.
//
// Caveat (inherent to any sampler): a hot frame only appears if the wedge
// is actually CPU-spinning. A non-CPU block (a thread idle-waiting on
// something) traces as idle — which is itself the answer, pivoting the
// investigation to "what is it blocked on".
//
// Single-flight: browser-level tracing is a process-wide singleton — only
// one `Tracing.start` can be active per browser, and every prerender page
// shares one browser. This module enforces that with an in-process guard;
// concurrent renders that would collide simply skip their trace (the
// affinity trigger targets one realm, so collisions are rare and a skipped
// trace is not a failure). The guard is released as soon as `Tracing.end`
// completes — the draining of the finished stream runs on its own session
// and does not block the next render's trace.

import type { CDPSession, Page } from 'puppeteer';
import { Readable } from 'stream';
import { logger } from '@cardstack/runtime-common';

const log = logger('prerenderer');

// Trace categories chosen to separate the things a wedge investigation
// needs to tell apart: JS execution + the in-trace CPU sampler, V8 GC, V8
// compile, and the DevTools timeline (layout / paint / frames). `toplevel`
// gives task boundaries; `blink.user_timing` surfaces the host's own
// render-phase marks.
const TRACE_CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'v8',
  'v8.execute',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-v8.gc',
  'disabled-by-default-v8.compile',
  'blink.user_timing',
  'latencyInfo',
];

// Ring-buffer recording: keep capturing into a long wedge, retaining the
// most recent events (the hot loop itself) rather than stopping when an
// early-filled buffer would otherwise drop the wedge.
const RECORD_MODE = 'recordContinuously';

// Bytes per `IO.read` round trip while draining the finished trace.
const IO_READ_CHUNK_BYTES = 1 << 20; // 1 MiB
// Hard ceilings so a wedged or dead session can never stall the pool: the
// trace finalize and the wait for its stream handle are each time-boxed,
// mirroring the CPU profiler's `Profiler.stop` guard.
const TRACING_END_TIMEOUT_MS = 5000;
const TRACING_COMPLETE_TIMEOUT_MS = 5000;

export interface TraceCaptureOptions {
  // Work to trace across. The trace starts, this is awaited (or `maxRunMs`
  // elapses, whichever is first), then the trace ends. `run` must not
  // reject in a way that escapes — pass a never-rejecting observer; the
  // caller retains ownership of the render's own result/rejection.
  run: () => Promise<void>;
  // Upper bound on the trace window. A render can hang past its timeout
  // (the case this targets); without the bound the trace would run until
  // the tab is torn down. When it fires, the trace ends with whatever was
  // buffered. Omitted means "wait for `run`".
  maxRunMs?: number;
}

// Local subset of the CDP shapes used here. As in `cpu-profiler.ts` we
// avoid importing `devtools-protocol` (a transitive, not direct, dep of
// puppeteer) and declare only the fields read.
//   https://chromedevtools.github.io/devtools-protocol/tot/Tracing/
//   https://chromedevtools.github.io/devtools-protocol/tot/IO/
interface TracingCompleteEvent {
  stream?: string;
}
interface IoReadResult {
  data: string;
  eof: boolean;
  base64Encoded?: boolean;
}

// Process-wide guard: at most one active browser trace at a time.
let tracingActive = false;
let tracingBusyLogged = false;

// Starts a browser trace across the window defined by `run` (or `maxRunMs`),
// ends it, and returns a `Readable` that drains the finished trace from the
// CDP `IO` stream — ready to hand straight to the artifact sink's streaming
// upload. Returns `null` (never throws) when a trace is already active, or
// on any CDP error / timeout. The returned stream owns its CDP session and
// closes the `IO` handle + detaches when fully drained or destroyed.
export async function captureTraceStream(
  page: Page,
  options: TraceCaptureOptions,
): Promise<Readable | null> {
  if (tracingActive) {
    if (!tracingBusyLogged) {
      tracingBusyLogged = true;
      log.debug(
        'trace capture skipped: a browser trace is already active ' +
          '(browser-wide tracing is single-flight)',
      );
    }
    return null;
  }
  tracingActive = true;

  let client: CDPSession | undefined;
  let released = false;
  // Release the single-flight guard exactly once. Called after
  // `Tracing.end` so the next render can trace while this trace's stream
  // drains independently, and on every failure path so a guard is never
  // leaked.
  let releaseTracing = () => {
    if (!released) {
      released = true;
      tracingActive = false;
      tracingBusyLogged = false;
    }
  };

  try {
    client = await page.createCDPSession();
    // Register the completion listener before ending: `Tracing.end` only
    // signals that finalization started; the stream handle arrives on the
    // `tracingComplete` event.
    let completed = waitForTracingComplete(client);
    await client.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: {
        recordMode: RECORD_MODE,
        includedCategories: TRACE_CATEGORIES,
      },
    });

    await waitForRunOrBound(options.run(), options.maxRunMs);

    await withTimeout(
      client.send('Tracing.end'),
      TRACING_END_TIMEOUT_MS,
      undefined,
    );
    let event = await withTimeout(
      completed,
      TRACING_COMPLETE_TIMEOUT_MS,
      null as TracingCompleteEvent | null,
    );
    // The browser trace is finalized — free the guard so the next render's
    // trace can start while this one's bytes stream out below.
    releaseTracing();

    let handle = event?.stream;
    if (!handle) {
      await detachQuietly(client);
      return null;
    }
    return drainTraceStream(client, handle);
  } catch (e) {
    log.debug('trace capture failed:', e);
    await detachQuietly(client);
    releaseTracing();
    return null;
  }
}

// Resolves with the `tracingComplete` event (carrying the `IO` stream
// handle), or rejects if the session errors first. Bounded by the caller.
function waitForTracingComplete(
  client: CDPSession,
): Promise<TracingCompleteEvent> {
  return new Promise<TracingCompleteEvent>((resolve) => {
    client.once('Tracing.tracingComplete', (event: unknown) =>
      resolve((event ?? {}) as TracingCompleteEvent),
    );
  });
}

// Wraps the finished trace's `IO` stream as a `Readable`, pulling one
// `IO.read` chunk per `_read` so backpressure from a slow S3 upload
// naturally throttles the drain. Closes the handle and detaches the session
// on EOF, error, or destroy.
function drainTraceStream(client: CDPSession, handle: string): Readable {
  let reading = false;
  let cleanedUp = false;
  let cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    try {
      await client.send('IO.close', { handle });
    } catch {
      // Handle may already be gone with the session; ignore.
    }
    await detachQuietly(client);
  };

  return new Readable({
    read() {
      if (reading) {
        return;
      }
      reading = true;
      void (async () => {
        try {
          let result = (await client.send('IO.read', {
            handle,
            size: IO_READ_CHUNK_BYTES,
          })) as IoReadResult;
          if (result.data) {
            this.push(
              Buffer.from(
                result.data,
                result.base64Encoded ? 'base64' : 'utf8',
              ),
            );
          }
          if (result.eof) {
            this.push(null);
            await cleanup();
          }
        } catch (e) {
          await cleanup();
          this.destroy(e as Error);
        } finally {
          reading = false;
        }
      })();
    },
    destroy(err, callback) {
      void cleanup().finally(() => callback(err));
    },
  });
}

// Resolves when `run` settles or `maxRunMs` elapses, whichever is first;
// reflects `run` so its rejection resolves (not throws) here — the caller
// owns that rejection. Mirrors the CPU profiler's window wait.
async function waitForRunOrBound(
  run: Promise<void>,
  maxRunMs: number | undefined,
): Promise<void> {
  let reflected = run.then(
    () => undefined,
    () => undefined,
  );
  if (typeof maxRunMs !== 'number' || maxRunMs <= 0) {
    await reflected;
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reflected,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxRunMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Races a CDP command against a hard timeout, resolving to `fallback` if it
// doesn't return in time. Never throws — a wedged or dead session can't
// stall the pool here.
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function detachQuietly(client: CDPSession | undefined): Promise<void> {
  try {
    await client?.detach();
  } catch {
    // Session may already be gone with the page; ignore.
  }
}

// Test-only: clear the single-flight guard between cases.
export function __resetTraceCaptureForTests(): void {
  tracingActive = false;
  tracingBusyLogged = false;
}
