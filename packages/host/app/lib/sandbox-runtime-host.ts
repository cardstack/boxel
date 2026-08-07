import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  type SandboxProjectedError,
} from '@cardstack/runtime-common';

import SandboxBoxelRuntimeServer from './sandbox-boxel-runtime-server';
import { SandboxFetchClient } from './sandbox-fetch-transport';
import {
  SandboxRenderServer,
  projectedError,
  type SandboxRenderTarget,
} from './sandbox-render-transport';

import {
  isSandboxConnect,
  sandboxRuntimeBootstrapProtocol,
} from './sandbox-runtime-process';

import { SandboxSurfaceClient } from './sandbox-surface-transport';
import { SandboxWriteClient } from './sandbox-write-transport';

import type { BoxelRuntime } from './boxel-runtime';
import type { SandboxRuntimeControl } from './sandbox-runtime-process';

export interface SandboxRuntimeHost {
  readonly runtime: BoxelRuntime;
  readonly surface: SandboxSurfaceClient;
  destroy(): void;
}

/**
 * Installs the inert bootstrap listener in the isolated child document.
 * It accepts exactly one origin-checked transferred port, then removes all
 * ambient window-message listeners. Subsequent authority is port-scoped.
 */
export function installSandboxRuntimeHost(options: {
  parentOrigin: string;
  bootstrapId: string;
  createRuntime: (
    fetch: typeof globalThis.fetch,
    fetchMedia: (url: string) => Promise<Response>,
  ) => BoxelRuntime | Promise<BoxelRuntime>;
  createRenderTarget: (
    runtime: BoxelRuntime,
    surface: SandboxSurfaceClient,
    reportRenderDiagnostic: (diagnostic: SandboxRenderDiagnostic) => void,
    /**
     * RP-20.6 child→parent write leg: the sender the render target's owner
     * uses to propose the rendered instance's new state after an authored
     * mutation — see `SandboxWriteClient`.
     */
    writeClient: SandboxWriteClient,
  ) => SandboxRenderTarget | Promise<SandboxRenderTarget>;
  announceInterval?: number;
  signal?: AbortSignal;
}): Promise<SandboxRuntimeHost> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup = () => {
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('message', receive);
      options.signal?.removeEventListener('abort', abort);
    };
    let abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new DOMException('Sandbox bootstrap aborted', 'AbortError'));
    };
    let announcedOnce = false;
    let announce = () => {
      if (!announcedOnce) {
        // Breadcrumb 2/7: logged once (not on every 250ms tick, which would
        // be spam) — confirms the bootstrap listener is actually up and
        // trying to reach the parent.
        announcedOnce = true;
        console.warn('[sandbox-child] listening posted', {
          bootstrapId: options.bootstrapId,
          parentOrigin: options.parentOrigin,
        });
      }
      globalThis.parent.postMessage(
        {
          protocol: sandboxRuntimeBootstrapProtocol,
          type: 'listening',
          bootstrapId: options.bootstrapId,
        },
        options.parentOrigin,
      );
    };
    let interval = globalThis.setInterval(
      announce,
      options.announceInterval ?? 250,
    );
    let receive = async (event: MessageEvent<unknown>) => {
      if (
        event.source !== globalThis.parent ||
        event.origin !== options.parentOrigin ||
        !isSandboxConnect(event.data) ||
        event.data.bootstrapId !== options.bootstrapId ||
        event.ports.length !== 1
      ) {
        return;
      }
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('message', receive);
      options.signal?.removeEventListener('abort', abort);
      settled = true;
      let port = event.ports[0];
      port.start();
      // Breadcrumb 3/7: the origin/bootstrapId-checked connect arrived and
      // its port was accepted. If this never logs, the parent's connect
      // either never reached this frame or failed one of the checks above
      // (wrong origin, stale bootstrapId, wrong port count).
      console.warn('[sandbox-child] connect received', {
        bootstrapId: options.bootstrapId,
      });
      // Installed before module evaluation starts (createRuntime below is
      // what fetches and evaluates the authored module graph), not after
      // 'ready'. A module's own top-level side effects, or an eagerly
      // rejected promise from something it kicks off, can fail in a
      // microtask before this bootstrap try block ever reaches 'ready'.
      // Reporting is held (see `SandboxRuntimeErrorReporter.release`) until
      // 'ready' actually posts, so a genuine bootstrap failure still
      // surfaces once, as 'failed' below — not as a redundant early
      // 'runtime-error'. It also logs at CAPTURE time (not just at post
      // time) — see installSandboxRuntimeErrorReporter — so a spurious
      // app-level error/rejection unrelated to this render (the child boots
      // the full host application; anything in it can trip these listeners)
      // is distinguishable from a real one without waiting for release().
      let errorReporter = installSandboxRuntimeErrorReporter(port);
      let runtime: BoxelRuntime | undefined;
      let runtimeServer: SandboxBoxelRuntimeServer | undefined;
      let surface: SandboxSurfaceClient | undefined;
      let renderServer: SandboxRenderServer | undefined;
      let fetchClient: SandboxFetchClient | undefined;
      let writeClient: SandboxWriteClient | undefined;
      try {
        fetchClient = new SandboxFetchClient(port);
        console.warn('[sandbox-child] createRuntime begun');
        let createdRuntime = await options.createRuntime(
          fetchClient.fetch,
          fetchClient.fetchMedia,
        );
        runtime = createdRuntime;
        console.warn('[sandbox-child] createRuntime completed', {
          mode: createdRuntime.mode,
        });
        let createdRuntimeServer = new SandboxBoxelRuntimeServer(
          port,
          createdRuntime,
        );
        runtimeServer = createdRuntimeServer;
        let createdSurface = new SandboxSurfaceClient(port, event.data.surface);
        surface = createdSurface;
        console.warn('[sandbox-child] createRenderTarget begun');
        let createdWriteClient = new SandboxWriteClient(port);
        writeClient = createdWriteClient;
        let renderTarget = await options.createRenderTarget(
          createdRuntime,
          createdSurface,
          (diagnostic) => postRenderDiagnostic(port, diagnostic),
          createdWriteClient,
        );
        console.warn('[sandbox-child] createRenderTarget completed');
        let createdRenderServer = new SandboxRenderServer(port, renderTarget);
        renderServer = createdRenderServer;
        // Sandbox HMR (RP-17.1 un-deferral): gives the target a live check
        // against every generation this server has SEEN ARRIVE — not just
        // ones already dispatched through its own serialized queue — so it
        // can bail out of an in-flight render/draft early once a newer one
        // is already queued behind it (dossier: "re-check generation
        // post-await").
        renderTarget.setStaleCheck?.((generation) =>
          createdRenderServer.isStale(generation),
        );
        postControl(port, { type: 'ready' });
        // Breadcrumb 4/7: bootstrap fully completed and 'ready' is on the
        // wire. Everything from here on is RPC-driven — no more of the
        // child's own boot sequencing runs.
        console.warn('[sandbox-child] ready posted');
        // RP-15.3: a live iframe is never re-parented and render() acks are
        // request-scoped, so neither channel can report a failure that
        // surfaces after a render has already resolved (an async modifier
        // effect, a WebGL context loss, a rejected texture/loader promise).
        // Silence in that case is a protocol violation: the parent must be
        // told explicitly so it can fail the in-flight render and close the
        // process, instead of leaving stale content on screen. Releasing
        // here flushes anything the reporter buffered during module
        // evaluation/bootstrap; anything after this point posts as it
        // happens.
        errorReporter.release();
        resolve({
          runtime: createdRuntime,
          surface: createdSurface,
          destroy() {
            errorReporter.stop();
            createdSurface.destroy();
            createdRenderServer.destroy();
            createdRuntimeServer.destroy();
            createdWriteClient.destroy();
            fetchClient?.destroy();
            if (
              'destroy' in createdRuntime &&
              typeof createdRuntime.destroy === 'function'
            ) {
              createdRuntime.destroy();
            }
            port.close();
          },
        });
      } catch (error) {
        // Never released: a bootstrap failure is already reported below as
        // 'failed'. Stop rather than release so a buffered pre-ready error
        // (if the same failure also tripped the window error/unhandled-
        // rejection listeners) doesn't also post as a redundant
        // 'runtime-error' right after.
        errorReporter.stop();
        renderServer?.destroy();
        surface?.destroy();
        runtimeServer?.destroy();
        writeClient?.destroy();
        fetchClient?.destroy();
        if (
          runtime &&
          'destroy' in runtime &&
          typeof runtime.destroy === 'function'
        ) {
          runtime.destroy();
        }
        postControl(port, {
          type: 'failed',
          error: projectedBootstrapError(error),
        });
        port.close();
        reject(error);
      }
    };
    globalThis.addEventListener('message', receive);
    options.signal?.addEventListener('abort', abort, { once: true });
    announce();
  });
}

function postControl(
  port: MessagePort,
  body:
    | Pick<Extract<SandboxRuntimeControl, { type: 'ready' }>, 'type'>
    | Pick<Extract<SandboxRuntimeControl, { type: 'failed' }>, 'type' | 'error'>
    | Pick<
        Extract<SandboxRuntimeControl, { type: 'runtime-error' }>,
        'type' | 'error'
      >,
): void {
  port.postMessage({
    kind: 'boxel-sandbox-control',
    transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
    ...body,
  } satisfies SandboxRuntimeControl);
}

/**
 * A bounded measurement of what a completed render actually put in the DOM.
 * The render-request/response ack (sandbox-render-transport.ts, parent-owned)
 * only proves `render()` resolved — it says nothing about whether the
 * rendered card produced any visible output. This is the child's only way to
 * make "acked but painted nothing" observable without a screenshot: measured
 * right after the render's `afterRender()` settles, so it reflects the
 * committed DOM, not a scheduled-but-not-yet-flushed one.
 *
 * The `body*`/`root*`/`documentVisibilityState` fields exist specifically to
 * distinguish "content exists but isn't painted" from "content never
 * rendered": `hasVisibleContent` already requires non-zero on-screen size,
 * but these let a human (or the parent) see WHY it might not have one — an
 * unexpected element stacked over the render root, a detached/zero-size
 * ancestor (`rootHasOffsetParent: false`), or the document not actually
 * visible.
 */
export interface SandboxRenderDiagnostic {
  format: string;
  elementCount: number;
  textLength: number;
  hasVisibleContent: boolean;
  bodyChildElementCount: number;
  bodyChildren: { tag: string; id: string; className: string }[];
  rootRect: { width: number; height: number; top: number; left: number };
  rootHasOffsetParent: boolean;
  documentVisibilityState: string;
}

interface SandboxRenderDiagnosticMessage extends SandboxRenderDiagnostic {
  kind: 'boxel-sandbox-render-diagnostic';
  transportVersion: number;
}

/**
 * Posts a render diagnostic on the control port and, when nothing visible
 * came out of a render, also logs it — the dev-server console the child's
 * own logs already reach (unlike the parent's `SandboxRenderClient`, which
 * only recognizes the render-response envelope today and silently ignores
 * this one; the message is posted anyway so a parent-side consumer can be
 * added without a further child-side change).
 */
export function postRenderDiagnostic(
  port: MessagePort,
  diagnostic: SandboxRenderDiagnostic,
): void {
  port.postMessage({
    kind: 'boxel-sandbox-render-diagnostic',
    transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
    ...diagnostic,
  } satisfies SandboxRenderDiagnosticMessage);
  if (diagnostic.hasVisibleContent) {
    console.warn('[sandbox-child] render diagnostic', diagnostic);
  } else {
    console.warn(
      '[sandbox-child] render acked but produced no visible output',
      diagnostic,
    );
  }
}

export interface SandboxRuntimeErrorReporter {
  /**
   * Ends the pre-ready buffering window: a report already captured while
   * held posts immediately; any report from here on posts as it happens.
   * Call this right after 'ready' posts.
   */
  release(): void;
  /** Detaches the listeners. Any buffered-but-unreleased report is discarded. */
  stop(): void;
}

/**
 * RP-15.3: reports the child's first uncaught error or unhandled rejection
 * to the parent's control port. This is the sandbox's only way to signal a
 * failure that happens after a render has already acked — for example a
 * modifier's asynchronous WebGL/Three.js setup, a rejected texture or
 * loader promise, or any other effect that runs outside the render-request/
 * response cycle. Silence in that case is a protocol violation, not a
 * legitimate success.
 *
 * Listeners are installed immediately (the caller attaches this before
 * module evaluation begins, not after 'ready'): a module's own top-level
 * side effects, or a promise it eagerly kicks off, can reject in a
 * microtask before bootstrap ever reaches 'ready'. A report captured before
 * `release()` is called is held rather than posted immediately — posting it
 * early, ahead of 'ready', would race the parent's own bootstrap-vs-failure
 * handling and could be mistaken for a transport-level `failed`. `release()`
 * flushes exactly one held report (if any) and switches to posting
 * immediately from then on.
 *
 * Reports at most once total: a `runtime-error` is a terminal signal to the
 * parent (it fails the in-flight render and closes future render slots), so
 * a storm of window `error`/`unhandledrejection` events collapses to a
 * single control message.
 */
export function installSandboxRuntimeErrorReporter(
  port: MessagePort,
  // The event source is the child window in production. Injectable so a
  // test can drive the reporter from its own EventTarget without dispatching
  // real ErrorEvents on `window`, which the test runner's global error
  // handler would (correctly) also observe and fail the test on.
  events: EventTarget = globalThis,
): SandboxRuntimeErrorReporter {
  let released = false;
  let reported = false;
  let held: { error: unknown } | undefined;
  let post = (error: unknown) => {
    reported = true;
    postControl(port, {
      type: 'runtime-error',
      error: projectedBootstrapError(error),
    });
  };
  let report = (error: unknown) => {
    if (reported || held) {
      return;
    }
    // Logged at CAPTURE time, before the held/post branch: the child boots
    // the full host application (RP-15.3), so `error`/`unhandledrejection`
    // can fire from anything in it, not only from the render pipeline. This
    // makes that distinction visible immediately, regardless of whether the
    // report ends up held (pre-ready) or posted right away.
    console.warn('[sandbox-child] error/rejection captured', {
      released,
      error: projectedBootstrapError(error),
    });
    if (released) {
      post(error);
    } else {
      held = { error };
    }
  };
  let onWindowError = (event: Event) => {
    let errorEvent = event as ErrorEvent;
    report(errorEvent.error ?? new Error(errorEvent.message));
  };
  let onUnhandledRejection = (event: Event) => {
    report((event as PromiseRejectionEvent).reason);
  };
  events.addEventListener('error', onWindowError);
  events.addEventListener('unhandledrejection', onUnhandledRejection);
  return {
    release() {
      released = true;
      if (held && !reported) {
        post(held.error);
      }
    },
    stop() {
      events.removeEventListener('error', onWindowError);
      events.removeEventListener('unhandledrejection', onUnhandledRejection);
    },
  };
}

function projectedBootstrapError(error: unknown): SandboxProjectedError {
  // Full projection (stack + depth-bounded cause chain) so the Host's error
  // presentation can show the ROOT cause; only the fallback name for a
  // non-Error throw differs from the render transport's projection.
  return error instanceof Error
    ? projectedError(error)
    : { name: 'SandboxBootstrapError', message: String(error) };
}
