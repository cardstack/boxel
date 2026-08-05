import { BOXEL_EXECUTION_TRANSPORT_VERSION } from '@cardstack/runtime-common';

import SandboxBoxelRuntimeServer from './sandbox-boxel-runtime-server';
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
  createRuntime: () => BoxelRuntime | Promise<BoxelRuntime>;
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
      try {
        let createdRuntime = await options.createRuntime();
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
        resolve({
          runtime: createdRuntime,
          surface: createdSurface,
          destroy() {
            createdSurface.destroy();
            createdRenderServer.destroy();
            createdRuntimeServer.destroy();
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
    | Pick<
        Extract<SandboxRuntimeControl, { type: 'failed' }>,
        'type' | 'error'
      >,
): void {
  port.postMessage({
    kind: 'boxel-sandbox-control',
    transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
    ...body,
  } satisfies SandboxRuntimeControl);
}

function projectedBootstrapError(error: unknown): {
  name: string;
  message: string;
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'SandboxBootstrapError', message: String(error) };
}
