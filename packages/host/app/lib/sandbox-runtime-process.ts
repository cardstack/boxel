import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  type BoxelDescription,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type BoxelTypeHandle,
  type CodeRef,
  type JSONValue,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type PatchData,
  type RealmResourceIdentifier,
  type ResolvedField,
  type RuntimeHandle,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import type SurfaceService from '@cardstack/host/services/surface-service';

import type { SurfaceExecutionIdentity } from '@cardstack/host/services/surface-service';

import SandboxBoxelRuntimeClient from './sandbox-boxel-runtime-client';
import { SandboxFetchServer } from './sandbox-fetch-transport';
import SandboxModuleAuthority from './sandbox-module-authority';
import { SandboxRenderClient } from './sandbox-render-transport';
import { SandboxSurfaceServer } from './sandbox-surface-transport';

import type { BoxelRuntime, MaterializationPurpose } from './boxel-runtime';

const bootstrapProtocol = 'boxel-sandbox-bootstrap-v1' as const;

interface SandboxListening {
  protocol: typeof bootstrapProtocol;
  type: 'listening';
  bootstrapId: string;
}

interface SandboxConnect {
  protocol: typeof bootstrapProtocol;
  type: 'connect';
  bootstrapId: string;
  transportVersion: number;
  surface: SurfaceHandle;
}

export type SandboxRuntimeControl =
  | {
      kind: 'boxel-sandbox-control';
      transportVersion: number;
      type: 'ready';
    }
  | {
      kind: 'boxel-sandbox-control';
      transportVersion: number;
      type: 'failed';
      error: { name: string; message: string };
    }
  | {
      kind: 'boxel-sandbox-control';
      transportVersion: number;
      type: 'runtime-error';
      error: { name: string; message: string };
    };

export interface SandboxRuntimeProcessOptions {
  iframe: HTMLIFrameElement;
  childURL: string;
  childOrigin: string;
  surfaceService: SurfaceService;
  fetch: typeof globalThis.fetch;
  /** Collapses virtual Realm aliases onto the exact URL fetched by the Host. */
  resolveModuleURL: (identifier: string) => string;
  /** Trusted framework modules are leaves of the authored module graph. */
  isTrustedModuleURL: (identifier: string) => boolean;
  identity: SurfaceExecutionIdentity;
  connectTimeout?: number;
  /** Bounds how long a mounted child may take to confirm a render (RP-15.3). */
  renderTimeout?: number;
}

export interface SandboxRenderSlot {
  readonly owner: 'sandbox';
  readonly iframe: HTMLIFrameElement;
  readonly surface: SurfaceHandle;
}

/**
 * One persistent, origin-isolated browser process implementing BoxelRuntime.
 * The parent retains this object across compatible renders and format changes;
 * only explicit disposal or idle eviction tears down its MessageChannel.
 */
export default class SandboxRuntimeProcess implements BoxelRuntime {
  readonly mode = 'sandbox' as const;
  readonly surface: SurfaceHandle;

  private readonly bootstrapId = randomBootstrapId();
  private readonly client: Promise<SandboxBoxelRuntimeClient>;
  private surfaceServer?: SandboxSurfaceServer;
  private fetchServer?: SandboxFetchServer;
  private renderClient?: SandboxRenderClient;
  private renderedCard?: BoxelInstanceHandle;
  private cancelConnection?: (error: Error) => void;
  private closed = false;
  private readonly moduleAuthority: SandboxModuleAuthority;
  // RP-15.3: a child error reported after bootstrap (an uncaught exception or
  // unhandled rejection inside the mounted document — see
  // `sandbox-runtime-host.ts`) fails every render this process attempts from
  // then on, rather than leaving a stale successful mount in place while the
  // child is actually broken.
  private childError?: Error;
  private controlPort?: MessagePort;
  private postBootstrapControlListener?: (event: MessageEvent<unknown>) => void;

  constructor(private readonly options: SandboxRuntimeProcessOptions) {
    this.surface = options.surfaceService.register(options.identity);
    this.moduleAuthority = new SandboxModuleAuthority(
      options.resolveModuleURL,
      options.isTrustedModuleURL,
    );
    this.client = this.connect();
  }

  loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle> {
    return this.withClient((client) => client.loadBoxel(ref));
  }

  /** Adds the exact static module graph authorized for this process. */
  allowModules(moduleIdentifiers: readonly string[]): void {
    this.moduleAuthority.allow(moduleIdentifiers);
  }

  createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle> {
    return this.withClient((client) =>
      client.createFromSerialized(resource, document, relativeTo, purpose),
    );
  }

  describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription> {
    return this.withClient((client) => client.describeBoxel(boxel));
  }

  getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]> {
    return this.withClient((client) => client.getFields(boxel));
  }

  getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined> {
    return this.withClient((client) => client.getField(boxel, fieldName));
  }

  buildRenderRecord(card: BoxelInstanceHandle): Promise<BoxelRenderRecord> {
    return this.withClient((client) => client.buildRenderRecord(card));
  }

  serializeCard(card: BoxelInstanceHandle): Promise<LooseSingleCardDocument> {
    return this.withClient((client) => client.serializeCard(card));
  }

  serializeCardPatch(
    card: BoxelInstanceHandle,
    changes: Record<string, JSONValue>,
  ): Promise<PatchData> {
    return this.withClient((client) =>
      client.serializeCardPatch(card, changes),
    );
  }

  async dispose(handle: RuntimeHandle): Promise<void> {
    if (handle === this.renderedCard) {
      await this.renderClient?.clear();
      this.renderedCard = undefined;
    }
    return this.withClient((client) => client.dispose(handle));
  }

  async getRenderSlot(
    card: BoxelInstanceHandle,
    format: string,
  ): Promise<SandboxRenderSlot> {
    if (this.closed) {
      throw new Error('Sandbox runtime process is closed');
    }
    await this.client;
    if (this.childError) {
      throw this.childError;
    }
    if (!this.renderClient) {
      throw new Error('Sandbox render transport is unavailable');
    }
    this.options.surfaceService.layout(this.surface, {
      heightMode: format === 'fitted' ? 'allocated' : 'intrinsic',
    });
    await this.renderClient.render(card, format);
    this.renderedCard = card;
    return {
      owner: 'sandbox',
      iframe: this.options.iframe,
      surface: this.surface,
    };
  }

  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cancelConnection?.(
      new Error('Sandbox runtime process was destroyed during bootstrap'),
    );
    this.cancelConnection = undefined;
    this.surfaceServer?.destroy();
    this.surfaceServer = undefined;
    this.fetchServer?.destroy();
    this.fetchServer = undefined;
    this.renderClient?.destroy();
    this.renderClient = undefined;
    this.renderedCard = undefined;
    if (this.controlPort && this.postBootstrapControlListener) {
      this.controlPort.removeEventListener(
        'message',
        this.postBootstrapControlListener,
      );
    }
    this.controlPort = undefined;
    this.postBootstrapControlListener = undefined;
    this.options.surfaceService.release(this.surface);
    void this.client.then((client) => client.destroy()).catch(() => undefined);
    this.options.iframe.src = 'about:blank';
    this.options.iframe.remove();
  }

  private withClient<T>(
    callback: (client: SandboxBoxelRuntimeClient) => Promise<T>,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Sandbox runtime process is closed'));
    }
    return this.client.then(callback);
  }

  /**
   * Records a post-bootstrap child failure and fails every render this
   * process is currently waiting on (RP-15.3).
   *
   * This is the Sandbox counterpart to the Capsule's synchronous evaluation
   * errors: a child that throws or rejects after it announced readiness is
   * otherwise indistinguishable, from the parent's perspective, from a child
   * that quietly finished rendering nothing. Recording the failure here lets
   * `getRenderSlot` fail closed instead of returning a slot for a mount the
   * child itself has already abandoned.
   */
  private reportChildError(error: Error): void {
    if (this.closed || this.childError) {
      return;
    }
    this.childError = error;
    this.renderClient?.failPending(error);
  }

  private connect(): Promise<SandboxBoxelRuntimeClient> {
    let { iframe, childOrigin, childURL } = this.options;
    let child = new URL(childURL);
    if (child.origin !== childOrigin) {
      return Promise.reject(
        new Error('Sandbox child URL does not match its declared origin'),
      );
    }
    if (childOrigin === globalThis.location.origin) {
      return Promise.reject(
        new Error('Sandbox child must use a distinct origin from the Host'),
      );
    }
    child.searchParams.set('bootstrapId', this.bootstrapId);
    child.searchParams.set('parentOrigin', globalThis.location.origin);
    // The child needs its declared origin for the origin-checked bootstrap and
    // for server-side execution-principal checks. `allow-same-origin` is safe
    // here only because we reject the Host origin above; SOP still prevents
    // the child from reaching the parent document. `credentialless` removes
    // ambient cookies and storage from this otherwise normal child origin.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('credentialless', '');

    return new Promise((resolve, reject) => {
      let client: SandboxBoxelRuntimeClient | undefined;
      let controlPort: MessagePort | undefined;
      let settled = false;
      let timeout = globalThis.setTimeout(() => {
        fail(new Error('Timed out connecting to the Sandbox child'));
      }, this.options.connectTimeout ?? 15_000);
      let cleanupBootstrap = () => {
        globalThis.clearTimeout(timeout);
        globalThis.removeEventListener('message', receive);
        controlPort?.removeEventListener('message', receiveControl);
        this.cancelConnection = undefined;
      };
      let fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupBootstrap();
        client?.destroy(error.message);
        this.renderClient?.destroy(error.message);
        this.renderClient = undefined;
        this.surfaceServer?.destroy();
        this.surfaceServer = undefined;
        this.fetchServer?.destroy();
        this.fetchServer = undefined;
        reject(error);
      };
      let receiveControl = (event: MessageEvent<unknown>) => {
        if (!isSandboxRuntimeControl(event.data)) {
          return;
        }
        if (event.data.type === 'failed') {
          fail(runtimeControlError(event.data.error));
          return;
        }
        if (settled || !client) {
          return;
        }
        settled = true;
        cleanupBootstrap();
        // Bootstrap's own listener is removed by `cleanupBootstrap` above.
        // A successfully bootstrapped child may still fail later — an
        // uncaught exception or unhandled rejection reported by
        // `sandbox-runtime-host.ts` after it posted `ready` — so this
        // process keeps a persistent listener on the same control port for
        // the rest of its lifetime (torn down in `destroy`).
        if (controlPort) {
          this.controlPort = controlPort;
          this.postBootstrapControlListener = (
            postEvent: MessageEvent<unknown>,
          ) => {
            if (!isSandboxRuntimeControl(postEvent.data)) {
              return;
            }
            if (
              postEvent.data.type === 'failed' ||
              postEvent.data.type === 'runtime-error'
            ) {
              this.reportChildError(runtimeControlError(postEvent.data.error));
            }
          };
          controlPort.addEventListener(
            'message',
            this.postBootstrapControlListener,
          );
        }
        resolve(client);
      };
      let receive = (event: MessageEvent<unknown>) => {
        if (
          event.origin !== childOrigin ||
          !isSandboxListening(event.data) ||
          event.data.bootstrapId !== this.bootstrapId
        ) {
          return;
        }
        // A credentialless cross-origin iframe's WindowProxy is not required
        // to compare equal to a later `contentWindow` lookup. Exact origin,
        // protocol, and the per-process unguessable bootstrap id bind this
        // inert announcement to the child. Authority is transferred only to
        // this iframe's current `contentWindow` over the private port below.
        let channel = new MessageChannel();
        controlPort = channel.port1;
        client = new SandboxBoxelRuntimeClient(channel.port1);
        this.renderClient = new SandboxRenderClient(
          channel.port1,
          this.options.renderTimeout,
        );
        this.surfaceServer = new SandboxSurfaceServer(
          channel.port1,
          this.options.surfaceService,
          this.surface,
        );
        this.fetchServer = new SandboxFetchServer(
          channel.port1,
          this.options.fetch,
          (url) => this.moduleAuthority.has(url),
          (url, contentType, body) =>
            this.moduleAuthority.observe(url, contentType, body),
        );
        let connect: SandboxConnect = {
          protocol: bootstrapProtocol,
          type: 'connect',
          bootstrapId: this.bootstrapId,
          transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
          surface: this.surface,
        };
        channel.port1.addEventListener('message', receiveControl);
        channel.port1.start();
        let contentWindow = iframe.contentWindow;
        if (!contentWindow) {
          fail(new Error('Sandbox child window is unavailable'));
          return;
        }
        contentWindow.postMessage(connect, childOrigin, [channel.port2]);
        // The child now has the only ambient bootstrap listener. Runtime
        // readiness and all later authority travel over the transferred port.
        globalThis.removeEventListener('message', receive);
      };
      this.cancelConnection = fail;
      globalThis.addEventListener('message', receive);
      iframe.src = child.href;
    });
  }
}

function isSandboxListening(value: unknown): value is SandboxListening {
  return (
    typeof value === 'object' &&
    value !== null &&
    'protocol' in value &&
    value.protocol === bootstrapProtocol &&
    'type' in value &&
    value.type === 'listening' &&
    'bootstrapId' in value &&
    typeof value.bootstrapId === 'string'
  );
}

export function isSandboxConnect(value: unknown): value is SandboxConnect {
  return (
    typeof value === 'object' &&
    value !== null &&
    'protocol' in value &&
    value.protocol === bootstrapProtocol &&
    'type' in value &&
    value.type === 'connect' &&
    'bootstrapId' in value &&
    typeof value.bootstrapId === 'string' &&
    'transportVersion' in value &&
    value.transportVersion === BOXEL_EXECUTION_TRANSPORT_VERSION &&
    'surface' in value &&
    typeof value.surface === 'string'
  );
}

export function isSandboxRuntimeControl(
  value: unknown,
): value is SandboxRuntimeControl {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'boxel-sandbox-control' ||
    !('transportVersion' in value) ||
    value.transportVersion !== BOXEL_EXECUTION_TRANSPORT_VERSION ||
    !('type' in value) ||
    (value.type !== 'ready' &&
      value.type !== 'failed' &&
      value.type !== 'runtime-error')
  ) {
    return false;
  }
  return (
    value.type === 'ready' ||
    ('error' in value &&
      typeof value.error === 'object' &&
      value.error !== null &&
      'name' in value.error &&
      typeof value.error.name === 'string' &&
      'message' in value.error &&
      typeof value.error.message === 'string')
  );
}

function runtimeControlError(error: { name: string; message: string }): Error {
  let result = new Error(error.message);
  result.name = error.name;
  return result;
}

function randomBootstrapId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  let bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join(
    '',
  );
}

export { bootstrapProtocol as sandboxRuntimeBootstrapProtocol };
