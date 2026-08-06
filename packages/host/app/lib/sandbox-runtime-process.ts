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
    };

export interface SandboxRuntimeProcessOptions {
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
}

export interface SandboxRenderSlot {
  readonly owner: 'sandbox';
  readonly iframe: HTMLIFrameElement;
  readonly surface: SurfaceHandle;
  /**
   * The process itself, not just its iframe/surface — the presentation slot
   * modifier needs to call `mount()`/`unmount()` on it directly (RP-15.3: a
   * live iframe is never re-parented, so the modifier can't move an iframe
   * that lives elsewhere; the process has to be born in the slot element the
   * modifier owns, and torn down there too).
   */
  readonly process: SandboxRuntimeProcess;
}

function createDetachedSandboxIframe(): HTMLIFrameElement {
  let iframe = document.createElement('iframe');
  iframe.className = 'boxel-sandbox-process';
  iframe.title = 'Boxel Sandbox';
  return iframe;
}

/**
 * One origin-isolated browser process implementing BoxelRuntime, retained
 * per surface identity by the Host's runtime router across compatible
 * renders and format changes.
 *
 * RP-15.3: "a live iframe is never re-parented; the Sandbox mount point is
 * stable for the life of the process." A cross-origin iframe's document
 * reloads on ANY re-parent — including a move meant to "preserve" it (a
 * parking lot) — so there is no way to keep one alive across its slot
 * element's own teardown. This class never appends its iframe anywhere
 * itself: `mount(element)` (called once by the presentation slot modifier,
 * idempotent) is the only thing that ever inserts it into the document, and
 * it is inserted directly into its PERMANENT slot element — born in place,
 * not moved into place. `unmount()` (called by the same modifier's teardown)
 * kills that iframe for good and prepares a fresh, still-detached one for a
 * later remount, reusing this object's already-accumulated module-authority
 * state (no re-classification, no re-observation) rather than discarding it.
 */
export default class SandboxRuntimeProcess implements BoxelRuntime {
  readonly mode = 'sandbox' as const;
  readonly surface: SurfaceHandle;

  private _iframe: HTMLIFrameElement = createDetachedSandboxIframe();
  private mounted = false;
  private pendingRequest?: { card: BoxelInstanceHandle; format: string };
  private client?: Promise<SandboxBoxelRuntimeClient>;
  private renderDiagnosticPort?: MessagePort;
  private paintListeners = new Set<() => void>();
  private painted = false;
  private mountListeners = new Set<() => void>();
  private mountFailedListeners = new Set<(error: Error) => void>();
  private mountError?: Error;
  private surfaceServer?: SandboxSurfaceServer;
  private fetchServer?: SandboxFetchServer;
  private renderClient?: SandboxRenderClient;
  private renderedCard?: BoxelInstanceHandle;
  private cancelConnection?: (error: Error) => void;
  private closed = false;
  private readonly moduleAuthority: SandboxModuleAuthority;

  constructor(private readonly options: SandboxRuntimeProcessOptions) {
    this.surface = options.surfaceService.register(options.identity);
    this.moduleAuthority = new SandboxModuleAuthority(
      options.resolveModuleURL,
      options.isTrustedModuleURL,
    );
  }

  /** The iframe currently owned by this process — detached until `mount()`. */
  get iframe(): HTMLIFrameElement {
    return this._iframe;
  }

  /** Whether the child has reported a render with real visible output. */
  get hasPainted(): boolean {
    return this.painted;
  }

  /**
   * Calls back once, the first time the child reports a render with real
   * visible output (RP-15.3's post-render diagnostic — see
   * sandbox-runtime-host.ts's `postRenderDiagnostic`). Already-painted fires
   * immediately. Used by the Host renderer to know when it is safe to stop
   * showing the prerendered placeholder over the live iframe.
   */
  onFirstPaint(callback: () => void): () => void {
    if (this.painted) {
      callback();
      return () => undefined;
    }
    this.paintListeners.add(callback);
    return () => {
      this.paintListeners.delete(callback);
    };
  }

  /**
   * Resolves once this process's iframe has been mounted — immediately if
   * already mounted. `materialize()` needs a live client to create a card
   * before the Host renderer would otherwise ever call `getRenderSlot()`
   * (which is what causes the presentation slot — and therefore `mount()`
   * — to happen at all). A caller that reserves this process early (see
   * `BoxelExecutionService.reserveSandboxProcess()`) and renders its slot
   * ahead of materialize() awaits this to know `mount()` has run — and
   * therefore that `this.client` is set (not necessarily connected yet;
   * `withClient()` awaits it either way) — before letting materialize()
   * proceed.
   */
  whenMounted(): Promise<void> {
    if (this.mounted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.mountListeners.add(resolve);
    });
  }

  /**
   * Calls back once, if this mount's connect (or the render it triggers)
   * fails — most commonly the connect timeout, since the child origin
   * cannot boot. `getRenderSlot()` used to `await` the whole connect+render
   * sequence, so a failure there threw and the Host's own try/catch turned
   * it into the chrome error presentation. Now that the slot resolves
   * immediately (RP-15.3: the iframe must exist before it can mount, and it
   * can't mount before its slot element exists), that failure happens on a
   * background promise nothing else observes — this is how it still
   * reaches the Host instead of becoming a silent, unhandled rejection.
   */
  onMountFailed(callback: (error: Error) => void): () => void {
    if (this.mountError) {
      callback(this.mountError);
      return () => undefined;
    }
    this.mountFailedListeners.add(callback);
    return () => {
      this.mountFailedListeners.delete(callback);
    };
  }

  /**
   * Appends this process's iframe into `element` and starts the child boot
   * IN PLACE. Called once by the presentation slot modifier when its slot
   * element mounts. Idempotent: a Glimmer rerender that re-invokes the
   * modifier with the same slot is a no-op (the iframe is already there and
   * already booting/live — re-appending would re-parent it, which is
   * exactly the reload this design avoids).
   */
  mount(element: HTMLElement): void {
    if (this.closed || this.mounted) {
      return;
    }
    this.mounted = true;
    element.append(this._iframe);
    let client = this.connect();
    this.client = client;
    client.catch((error) => {
      this.notifyMountFailed(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    for (let listener of [...this.mountListeners]) {
      listener();
    }
    this.mountListeners.clear();
    let pending = this.pendingRequest;
    if (pending) {
      this.pendingRequest = undefined;
      void this.requestRender(pending.card, pending.format).catch(() => {
        // Already surfaced above: requestRender awaits this SAME `client`
        // promise, so a connect failure rejects both — the `client.catch`
        // above is the one call site that reports it. This catch exists
        // only so this separate promise object doesn't ALSO count as an
        // unhandled rejection.
      });
    }
  }

  /**
   * Tears down the live iframe/connection without releasing the Surface
   * handle or discarding classification/authority state — called by the
   * presentation slot modifier's own teardown (the slot element is going
   * away, and a live iframe cannot survive that any other way). A later
   * `mount()` call on this SAME process (the runtime router retains it by
   * surface identity) mints a fresh, still-detached iframe and reconnects;
   * `allowModules()` need not be called again.
   */
  unmount(): void {
    if (!this.mounted) {
      return;
    }
    this.mounted = false;
    this.pendingRequest = undefined;
    // A remount gets an independent chance to connect: a failure from the
    // PREVIOUS mount must not immediately fail a brand new one.
    this.mountError = undefined;
    this.mountFailedListeners.clear();
    this.cancelConnection?.(new Error('Sandbox runtime process was unmounted'));
    this.cancelConnection = undefined;
    this.client = undefined;
    this.renderDiagnosticPort?.removeEventListener(
      'message',
      this.receiveRenderDiagnostic,
    );
    this.renderDiagnosticPort = undefined;
    this.surfaceServer?.destroy();
    this.surfaceServer = undefined;
    this.fetchServer?.destroy();
    this.fetchServer = undefined;
    this.renderClient?.destroy();
    this.renderClient = undefined;
    this.renderedCard = undefined;
    // This exact iframe is dead the moment it loses its mount point — a
    // detached iframe's document does not resume, and even if it did, this
    // element can never be re-appended without reloading again. Prepare a
    // fresh one now so the NEXT mount() has something to append.
    this._iframe.src = 'about:blank';
    this._iframe.remove();
    this._iframe = createDetachedSandboxIframe();
    // The dead iframe's paint status does not carry over to its
    // replacement: the next mount() is a brand new child document that
    // hasn't rendered anything yet, so onFirstPaint must wait for it again.
    this.painted = false;
    this.paintListeners.clear();
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

  /**
   * Registers this render request and returns the presentation slot
   * immediately — it does NOT wait for the child to connect or finish
   * rendering. It can't: the slot element the iframe will be born into does
   * not exist until the Host renders the slot this call returns, and the
   * iframe cannot boot before it has a permanent mount point. If the
   * process is already mounted (a format switch or re-render on an
   * already-live process), the render is requested and awaited here as
   * before — the slot element in that case already exists and persists.
   */
  async getRenderSlot(
    card: BoxelInstanceHandle,
    format: string,
  ): Promise<SandboxRenderSlot> {
    if (this.closed) {
      throw new Error('Sandbox runtime process is closed');
    }
    this.options.surfaceService.layout(this.surface, {
      heightMode: format === 'fitted' ? 'allocated' : 'intrinsic',
    });
    if (this.mounted) {
      await this.requestRender(card, format);
    } else {
      this.pendingRequest = { card, format };
    }
    return {
      owner: 'sandbox',
      iframe: this._iframe,
      surface: this.surface,
      process: this,
    };
  }

  /** Permanently tears this process down: releases the Surface handle too. */
  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unmount();
    // A reservation (see BoxelExecutionService.reserveSandboxProcess()) may
    // be awaiting whenMounted() on a process that never actually mounts
    // before it is torn down (e.g. the render that reserved it was itself
    // superseded). Release those waiters rather than leaving them pending
    // forever — the caller is expected to re-check `active`/closed state
    // once it resumes.
    for (let listener of [...this.mountListeners]) {
      listener();
    }
    this.mountListeners.clear();
    this.options.surfaceService.release(this.surface);
  }

  private async requestRender(
    card: BoxelInstanceHandle,
    format: string,
  ): Promise<void> {
    await this.client;
    if (!this.renderClient) {
      throw new Error('Sandbox render transport is unavailable');
    }
    await this.renderClient.render(card, format);
    this.renderedCard = card;
  }

  private notifyMountFailed(error: Error): void {
    if (this.mountError) {
      return;
    }
    this.mountError = error;
    for (let listener of [...this.mountFailedListeners]) {
      listener(error);
    }
    this.mountFailedListeners.clear();
  }

  private withClient<T>(
    callback: (client: SandboxBoxelRuntimeClient) => Promise<T>,
  ): Promise<T> {
    if (this.closed || !this.client) {
      return Promise.reject(new Error('Sandbox runtime process is closed'));
    }
    return this.client.then(callback);
  }

  private receiveRenderDiagnostic = (event: MessageEvent<unknown>): void => {
    let data = event.data as {
      kind?: unknown;
      hasVisibleContent?: unknown;
    } | null;
    if (
      typeof data !== 'object' ||
      data === null ||
      data.kind !== 'boxel-sandbox-render-diagnostic' ||
      this.painted ||
      !data.hasVisibleContent
    ) {
      return;
    }
    this.painted = true;
    for (let listener of [...this.paintListeners]) {
      listener();
    }
    this.paintListeners.clear();
  };

  private connect(): Promise<SandboxBoxelRuntimeClient> {
    let { childOrigin, childURL } = this.options;
    let iframe = this._iframe;
    let bootstrapId = randomBootstrapId();
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
    child.searchParams.set('bootstrapId', bootstrapId);
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
        resolve(client);
      };
      let receive = (event: MessageEvent<unknown>) => {
        if (
          event.origin !== childOrigin ||
          !isSandboxListening(event.data) ||
          event.data.bootstrapId !== bootstrapId
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
        this.renderClient = new SandboxRenderClient(channel.port1);
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
        // Independent of, and outlives, the bootstrap-scoped receiveControl
        // above (which cleanupBootstrap detaches once the handshake
        // completes): the child posts a render diagnostic after every
        // render for the life of the connection, not only during bootstrap.
        this.renderDiagnosticPort = channel.port1;
        channel.port1.addEventListener('message', this.receiveRenderDiagnostic);
        let connect: SandboxConnect = {
          protocol: bootstrapProtocol,
          type: 'connect',
          bootstrapId,
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
    (value.type !== 'ready' && value.type !== 'failed')
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
