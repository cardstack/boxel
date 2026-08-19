// One-shot stack capture of a wedged prerender via CDP `Debugger.pause`.
//
// Why this exists alongside the CPU profiler / trace stream:
//
//   A hard wedge is a synchronous JS loop pegging the renderer's main
//   thread. The CDP `Profiler` can't capture it — its samples only arrive
//   at `Profiler.stop`, which the pegged thread can't serialize (see
//   `trace-capture.ts`). The out-of-band trace stream CAN capture it, but
//   it samples continuously, so its own overhead can perturb a
//   timing-sensitive wedge enough to dissolve it.
//
//   `Debugger.pause` is the missing tool: it adds ZERO overhead until the
//   single pause, so it cannot mask the wedge — we let the loop run at
//   full native speed and only look once it's already stuck. And it reads
//   a synchronous loop: V8 honors the pause at the next interrupt check (a
//   loop back-edge or call), so it lands inside the spin without the loop
//   yielding — exactly the mechanism behind the DevTools "pause" button on
//   a hung page. The returned `callFrames` name the function the loop is
//   in.
//
//   Limit: if the peg is one long non-yielding NATIVE call (a catastrophic
//   regex, a native sort) there is no back-edge to honor the pause, so it
//   times out (`reason: 'pause-timeout'`) — which is itself a signal,
//   pivoting to the kernel-signal `--prof` sampler that preempts native
//   code too.
//
// Everything here runs in the prerender SERVER (Node) over CDP, never in
// the page, so it uses the real Node timer — the page-side
// render-timer-stub does not apply. It is invoked only on the render
// timeout path, so it costs nothing on a healthy render.

import type { CDPSession, Page } from 'puppeteer';
import { logger } from '@cardstack/runtime-common';

const log = logger('prerenderer');

const TIMED_OUT = Symbol('node-timeout');

export interface PausedStackCapture {
  // Top JS frames, innermost first, formatted `fn @ url:line:col`.
  frames: string[];
  // True when the live stack was deeper than `frames` (recursion depth
  // is itself diagnostic — a runaway recursion shows a huge total).
  truncated: boolean;
  totalFrames: number;
  // V8 used heap at the moment of the wedge. Flat across the peg → a tight
  // compute/recursion loop; climbing → a combinatorial re-build (breadth).
  heapUsedMB: number | null;
  // Set when no usable stack was captured, naming why.
  reason?: string;
}

// Race a Node-side promise against a real Node timer. The prerender server
// process is not the rendered page, so `setTimeout` here is the genuine
// one (the render-timer-stub only replaces the page's timers).
async function raceNodeTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function detachQuietly(client: CDPSession | undefined): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.detach();
  } catch {
    // session already gone / page closing — nothing to do
  }
}

function empty(heapUsedMB: number | null, reason: string): PausedStackCapture {
  return { frames: [], truncated: false, totalFrames: 0, heapUsedMB, reason };
}

export async function capturePausedCallStack(
  page: Page,
  opts?: { budgetMs?: number; maxFrames?: number },
): Promise<PausedStackCapture | null> {
  let budgetMs = opts?.budgetMs ?? 8000;
  let maxFrames = opts?.maxFrames ?? 60;
  if (page.isClosed()) {
    return null;
  }
  let client: CDPSession | undefined;
  try {
    let sessionPromise = page.createCDPSession();
    let session = await raceNodeTimeout(sessionPromise, budgetMs);
    if (session === TIMED_OUT) {
      // We gave up waiting, but the create may still resolve later — detach it
      // then so a slow CDP session isn't orphaned on the page until it closes.
      void sessionPromise.then((s) => detachQuietly(s)).catch(() => {});
      return empty(null, 'cdp-session-timeout');
    }
    client = session;

    // Heap usage first: `Runtime.getHeapUsage` is answered from V8 stats,
    // so it returns even while the JS thread is pegged.
    let heapUsedMB: number | null = null;
    try {
      let usage = (await raceNodeTimeout(
        client.send('Runtime.getHeapUsage'),
        budgetMs,
      )) as { usedSize?: number } | typeof TIMED_OUT;
      if (usage !== TIMED_OUT && typeof usage.usedSize === 'number') {
        heapUsedMB = usage.usedSize / (1024 * 1024);
      }
    } catch {
      // best-effort
    }

    // Arm the paused listener BEFORE requesting the pause so we can't miss
    // the event.
    let pausedFrames = new Promise<any[] | null>((resolve) => {
      client!.once('Debugger.paused', (e: any) =>
        resolve(Array.isArray(e?.callFrames) ? e.callFrames : null),
      );
    });

    let enabled = await raceNodeTimeout(
      client.send('Debugger.enable'),
      budgetMs,
    );
    if (enabled === TIMED_OUT) {
      return empty(heapUsedMB, 'debugger-enable-timeout');
    }
    // Fire-and-forget: the pause lands at the next V8 interrupt check.
    void client.send('Debugger.pause').catch(() => {});

    let callFrames = await raceNodeTimeout(pausedFrames, budgetMs);

    // Best-effort unpause so teardown isn't left in a paused state.
    try {
      await raceNodeTimeout(client.send('Debugger.resume'), 2000);
    } catch {
      // ignore
    }
    try {
      await raceNodeTimeout(client.send('Debugger.disable'), 2000);
    } catch {
      // ignore
    }

    if (callFrames === TIMED_OUT || !Array.isArray(callFrames)) {
      // No back-edge honored the pause within budget — most likely a
      // non-yielding native peg. The `--prof` sampler is the fallback.
      return empty(heapUsedMB, 'pause-timeout');
    }

    let totalFrames = callFrames.length;
    let frames = callFrames.slice(0, maxFrames).map((f: any) => {
      let name =
        typeof f.functionName === 'string' && f.functionName.length > 0
          ? f.functionName
          : '(anonymous)';
      let loc = f.location ?? {};
      let url =
        (typeof f.url === 'string' && f.url.length > 0 && f.url) ||
        f.functionLocation?.scriptId ||
        '<unknown>';
      let line = (loc.lineNumber ?? 0) + 1;
      let col = (loc.columnNumber ?? 0) + 1;
      return `${name} @ ${url}:${line}:${col}`;
    });
    return {
      frames,
      truncated: totalFrames > maxFrames,
      totalFrames,
      heapUsedMB,
    };
  } catch (e) {
    log.debug('paused stack capture failed:', e);
    return null;
  } finally {
    await detachQuietly(client);
  }
}

// Format the capture for a single log line / diagnostics field.
export function formatPausedStack(
  capture: PausedStackCapture | null,
): string | null {
  if (!capture) {
    return null;
  }
  if (capture.frames.length === 0) {
    return `<${capture.reason ?? 'no-frames'}>`;
  }
  let depth = capture.truncated
    ? `${capture.frames.length}/${capture.totalFrames}`
    : `${capture.totalFrames}`;
  return `[depth=${depth}] ` + capture.frames.join('  <-  ');
}
