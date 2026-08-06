import { BOXEL_EXECUTION_TRANSPORT_VERSION } from '@cardstack/runtime-common';

import SandboxBoxelRuntimeServer from './sandbox-boxel-runtime-server';
import { SandboxFetchClient } from './sandbox-fetch-transport';
import {
  SandboxRenderServer,
  type SandboxRenderTarget,
} from './sandbox-render-transport';

import {
  isSandboxConnect,
  sandboxRuntimeBootstrapProtocol,
} from './sandbox-runtime-process';

import { SandboxSurfaceClient } from './sandbox-surface-transport';

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
  ) => BoxelRuntime | Promise<BoxelRuntime>;
  createRenderTarget: (
    runtime: BoxelRuntime,
    surface: SandboxSurfaceClient,
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
    let announce = () => {
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
      let runtime: BoxelRuntime | undefined;
      let runtimeServer: SandboxBoxelRuntimeServer | undefined;
      let surface: SandboxSurfaceClient | undefined;
      let renderServer: SandboxRenderServer | undefined;
      let fetchClient: SandboxFetchClient | undefined;
      try {
        fetchClient = new SandboxFetchClient(port);
        let createdRuntime = await options.createRuntime(fetchClient.fetch);
        runtime = createdRuntime;
        let createdRuntimeServer = new SandboxBoxelRuntimeServer(
          port,
          createdRuntime,
        );
        runtimeServer = createdRuntimeServer;
        let createdSurface = new SandboxSurfaceClient(port, event.data.surface);
        surface = createdSurface;
        let renderTarget = await options.createRenderTarget(
          createdRuntime,
          createdSurface,
        );
        let createdRenderServer = new SandboxRenderServer(port, renderTarget);
        renderServer = createdRenderServer;
        postControl(port, { type: 'ready' });
        // RP-15.3: a live iframe is never re-parented and render() acks are
        // request-scoped, so neither channel can report a failure that
        // surfaces after a render has already resolved (an async modifier
        // effect, a WebGL context loss, a rejected texture/loader promise).
        // Silence in that case is a protocol violation: the parent must be
        // told explicitly so it can fail the in-flight render and close the
        // process, instead of leaving stale content on screen.
        let stopErrorReporter = installSandboxRuntimeErrorReporter(port);
        resolve({
          runtime: createdRuntime,
          surface: createdSurface,
          destroy() {
            stopErrorReporter();
            createdSurface.destroy();
            createdRenderServer.destroy();
            createdRuntimeServer.destroy();
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
        renderServer?.destroy();
        surface?.destroy();
        runtimeServer?.destroy();
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

// The parent's `SandboxRuntimeControl` union (sandbox-runtime-process.ts,
// parent-side) is expected to grow a `'runtime-error'` variant alongside
// `'ready'`/`'failed'` so a persistent post-bootstrap listener can fail an
// in-flight render and close future render slots. This file only owns the
// child side of that contract, so the shape is declared locally rather than
// imported: it must satisfy the same envelope validator the parent already
// applies to `'ready'`/`'failed'` (`kind`, `transportVersion`, `type`).
interface SandboxRuntimeErrorControl {
  kind: 'boxel-sandbox-control';
  transportVersion: number;
  type: 'runtime-error';
  error: { name: string; message: string };
}

function postControl(
  port: MessagePort,
  body:
    | Pick<Extract<SandboxRuntimeControl, { type: 'ready' }>, 'type'>
    | Pick<Extract<SandboxRuntimeControl, { type: 'failed' }>, 'type' | 'error'>
    | Pick<SandboxRuntimeErrorControl, 'type' | 'error'>,
): void {
  port.postMessage({
    kind: 'boxel-sandbox-control',
    transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
    ...body,
  } satisfies SandboxRuntimeControl | SandboxRuntimeErrorControl);
}

/**
 * RP-15.3: reports the child's first post-`ready` uncaught error or
 * unhandled rejection to the parent's control port. This is the sandbox's
 * only way to signal a failure that happens after a render has already
 * acked — for example a modifier's asynchronous WebGL/Three.js setup, a
 * rejected texture or loader promise, or any other effect that runs outside
 * the render-request/response cycle. Silence in that case is a protocol
 * violation, not a legitimate success.
 *
 * Reports at most once: a `runtime-error` is a terminal signal to the
 * parent (it fails the in-flight render and closes future render slots), so
 * a storm of window `error`/`unhandledrejection` events collapses to a
 * single control message.
 */
export function installSandboxRuntimeErrorReporter(
  port: MessagePort,
): () => void {
  let reported = false;
  let report = (error: unknown) => {
    if (reported) {
      return;
    }
    reported = true;
    postControl(port, {
      type: 'runtime-error',
      error: projectedBootstrapError(error),
    });
  };
  let onWindowError = (event: ErrorEvent) => {
    report(event.error ?? new Error(event.message));
  };
  let onUnhandledRejection = (event: PromiseRejectionEvent) => {
    report(event.reason);
  };
  globalThis.addEventListener('error', onWindowError);
  globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    globalThis.removeEventListener('error', onWindowError);
    globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}

function projectedBootstrapError(error: unknown): {
  name: string;
  message: string;
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'SandboxBootstrapError', message: String(error) };
}
