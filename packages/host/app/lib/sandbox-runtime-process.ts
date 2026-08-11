import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  type BoxelDescription,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type BoxelTypeHandle,
  type CodeRef,
  surfaceHeightModeFor,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type RealmResourceIdentifier,
  type ResolvedField,
  type RuntimeHandle,
  type SandboxProjectedError,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import type SurfaceService from '@cardstack/host/services/surface-service';

import type { SurfaceExecutionIdentity } from '@cardstack/host/services/surface-service';

import SandboxBoxelRuntimeClient from './sandbox-boxel-runtime-client';
import { SandboxFetchServer } from './sandbox-fetch-transport';
import SandboxModuleAuthority from './sandbox-module-authority';
import {
  SandboxRenderClient,
  reconstructedError,
} from './sandbox-render-transport';
import { SandboxSurfaceServer } from './sandbox-surface-transport';
import {
  SandboxViewCardServer,
  type SandboxViewCardOptions,
} from './sandbox-view-card-transport';
import { SandboxWriteServer } from './sandbox-write-transport';

import type { BoxelRuntime, MaterializationPurpose } from './boxel-runtime';

const bootstrapProtocol = 'boxel-sandbox-bootstrap-v1' as const;
export const sandboxRenderDiagnosticAcceptedKind =
  'boxel-sandbox-render-diagnostic-accepted' as const;

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
      error: SandboxProjectedError;
    }
  | {
      /**
       * RP-15.3: the child's report of an uncaught error or unhandled
       * rejection AFTER bootstrap succeeded — a failure that happens outside
       * any render-request/response cycle (an async modifier effect, a
       * rejected loader promise). Terminal for the mounted render: the
       * parent fails any in-flight render request and surfaces the error
       * through the same channel a mount failure uses, so the Host's error
       * presentation shows it instead of a silently blank iframe.
       */
      kind: 'boxel-sandbox-control';
      transportVersion: number;
      type: 'runtime-error';
      error: SandboxProjectedError;
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
  /** Maximum time for the child document and its module graph to load. */
  loadTimeout?: number;
  /** Maximum time for the transport handshake after the child has loaded. */
  connectTimeout?: number;
  /** Retain post-paint DOM diagnostics for explicit performance debugging. */
  keepRenderDiagnostics?: boolean;
}

export interface SandboxRenderSlot {
  readonly owner: 'sandbox';
  readonly iframe: HTMLIFrameElement;
  readonly surface: SurfaceHandle;
  /**
   * Identifies the renderer generation entitled to use this mount. A retained
   * process can still be mounted by the generation being replaced when its
   * successor starts materializing; waiting for this exact token prevents the
   * successor from issuing requests through that about-to-close client.
   */
  readonly mountToken: object;
  /**
   * The process itself, not just its iframe/surface — the presentation slot
   * modifier needs to call `mount()`/`unmount()` on it directly (RP-15.3: a
   * live iframe is never re-parented, so the modifier can't move an iframe
   * that lives elsewhere; the process has to be born in the slot element the
   * modifier owns, and torn down there too).
   */
  readonly process: SandboxRuntimeProcess;
}

/**
 * Sandbox HMR generation state (RP-17.1's un-deferral for this tier).
 * Transitions only when a `pushDraft()` call's own echoed generation still
 * matches the latest one issued (`SandboxRuntimeProcess.pushDraft`'s doc
 * comment) — a late ack from a since-superseded draft is a no-op, never
 * rolling this backward. `lastKnownGoodGeneration` is the last generation
 * that actually applied; a `'failed'` phase leaves it untouched, so the
 * previously-mounted render stays authoritative (RP-15.3's
 * retained-placeholder spirit) while `error` surfaces alongside it.
 */
export interface SandboxDraftState {
  phase: 'idle' | 'pending' | 'acked' | 'failed';
  generation: number;
  lastKnownGoodGeneration?: number;
  error?: Error;
}

export interface SandboxPushDraftOptions {
  /** The edited module's own identifier, not yet resolved to a fetch URL. */
  moduleIdentifier: string;
  source: string;
  /** The draft's own classified module graph (authority growth, edge case 8). */
  moduleGraph: readonly string[];
  /** Document-declared relationship modules (edge case 9). */
  documentDeclaredModules: readonly string[];
}

export interface SandboxPushDraftResult {
  generation: number;
  ok: boolean;
  error?: Error;
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
  private mountedElement?: HTMLElement;
  private mountOwner?: object;
  private pendingRequest?: {
    card: BoxelInstanceHandle;
    format: string;
    hostOwnsBox?: boolean;
  };
  private client?: Promise<SandboxBoxelRuntimeClient>;
  private runtimeClient?: SandboxBoxelRuntimeClient;
  private renderDiagnosticPort?: MessagePort;
  private paintListeners = new Set<() => void>();
  private painted = false;
  private mountListeners = new Set<{
    token?: object;
    resolve: () => void;
  }>();
  private mountFailedListeners = new Set<(error: Error) => void>();
  private mountError?: Error;
  private surfaceServer?: SandboxSurfaceServer;
  private fetchServer?: SandboxFetchServer;
  private renderClient?: SandboxRenderClient;
  private writeServer?: SandboxWriteServer;
  private viewCardServer?: SandboxViewCardServer;
  /**
   * RP-20.6: the one consumer entitled to apply this process's child writes
   * — registered by `BoxelExecutionService.connectSandboxInstanceSync`,
   * which binds it to the ONE canonical instance this process renders. Held
   * on the process (not the transport) so it survives an unmount/remount
   * cycle the same way the render request does: the transport is per-
   * connection, the entitlement is per-process.
   */
  private childWriteReceiver?: (
    document: LooseSingleCardDocument,
  ) => void | Promise<void>;
  private childViewCardReceiver?: (
    cardId: string,
    format: string,
    options?: SandboxViewCardOptions,
  ) => void | Promise<void>;
  private renderedCard?: BoxelInstanceHandle;
  private cancelConnection?: (error: Error) => void;
  private closed = false;
  private readonly moduleAuthority: SandboxModuleAuthority;
  /** Exact non-executable links carried by projected execution documents. */
  private readonly resourceAuthority = new Set<string>();
  /**
   * RP-17.1 HMR un-deferral: a monotonic sequence number bumped for every
   * render-family request this process issues (render, clear, and draft
   * alike) — see `SandboxRenderRequest`'s doc comment. Never reused across
   * mounts; only `reloadSandbox()` starts a process over from a fresh
   * child, and even then this counter itself keeps climbing (there is no
   * reason to reset it — the child's own `latestGenerationSeen` resets
   * naturally because it is a brand new child).
   */
  private nextGeneration = 0;
  /**
   * The generation `pushDraft()` most recently issued — distinct from
   * `nextGeneration` (which every render-family call bumps) so an ordinary
   * render/format-switch interleaved with an in-flight draft cannot make
   * that draft's own ack look stale. Only a NEWER draft can supersede a
   * draft's own generation-state tracking.
   */
  private lastIssuedDraftGeneration = 0;
  private _draftState: SandboxDraftState = { phase: 'idle', generation: 0 };
  private draftStateListeners = new Set<(state: SandboxDraftState) => void>();
  /**
   * Sandbox HMR draft override, keyed by exact fetch URL — never
   * pattern-matched (the frozen branch's private Monaco-buffer rule).
   * Consulted by `SandboxFetchServer` before the network. A later draft for
   * the same URL replaces the entry; nothing but an explicit
   * `reloadSandbox()` clears it — in particular, a later CANONICAL
   * (persisted/SSE) fetch does NOT silently clear it this round. SSE/save
   * arbitration against a live draft is explicitly deferred (dossier §4)
   * until a Sandbox-tier save path exists.
   */
  private readonly draftOverrides = new Map<string, string>();
  private reloadListeners = new Set<() => void>();
  private reservedMountToken?: object;

  constructor(private readonly options: SandboxRuntimeProcessOptions) {
    this.surface = options.surfaceService.register(options.identity);
    this.moduleAuthority = new SandboxModuleAuthority(
      options.resolveModuleURL,
      options.isTrustedModuleURL,
    );
  }

  /** Readable Sandbox HMR generation state — see `SandboxDraftState`. */
  get draftState(): SandboxDraftState {
    return this._draftState;
  }

  /** Whether a draft override is currently active for the exact URL `url`. */
  hasDraftOverride(url: string): boolean {
    return this.draftOverrides.has(url);
  }

  /** Whether `url` is currently admitted by this process's module authority — diagnostic/test surface (RP-18.6: reloadSandbox() resets this to nothing granted). */
  isModuleAdmitted(url: string): boolean {
    return this.moduleAuthority.has(url);
  }

  /** Calls back on every Sandbox HMR generation-state transition. */
  onDraftStateChange(callback: (state: SandboxDraftState) => void): () => void {
    this.draftStateListeners.add(callback);
    return () => {
      this.draftStateListeners.delete(callback);
    };
  }

  /**
   * Calls back once per `reloadSandbox()` call — the signal a consumer with
   * state keyed on this process's old identity (most concretely: the Host
   * renderer's `sandboxPainted`/placeholder-handoff flag, which otherwise
   * has no reason to ever flip back once set — RP-15.3's placeholder is
   * retained across ordinary HMR precisely so it must NOT re-enter, but a
   * hard reload is exactly the case that DOES need it back) must
   * invalidate before this process's next paint.
   */
  onReload(callback: () => void): () => void {
    this.reloadListeners.add(callback);
    return () => {
      this.reloadListeners.delete(callback);
    };
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
  whenMounted(token?: object): Promise<void> {
    if (this.mounted && (!token || this.mountOwner === token)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.mountListeners.add({ token, resolve });
    });
  }

  /**
   * Reserves the next presentation ownership generation before materialize.
   * `whenMounted(token)` deliberately does not accept an older live mount:
   * Glimmer must first install (or transfer) the replacement modifier.
   */
  reserveMount(): object {
    let token = {};
    this.reservedMountToken = token;
    return token;
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
  mount(
    element: HTMLElement,
    owner = this.reservedMountToken ?? {},
  ): () => void {
    if (this.closed) {
      return () => undefined;
    }
    if (this.mounted) {
      if (this.mountedElement === element) {
        // Glimmer can reuse the same element while replacing the modifier
        // instance that owns it. Transfer teardown ownership without moving
        // the live iframe: the previous modifier's late cleanup must not
        // close the replacement generation's MessageChannel.
        this.mountOwner = owner;
        this.resolveMountListeners(owner);
        return () => this.unmount(element, owner);
      }
      // Glimmer may install the replacement slot before it tears down the
      // previous modifier instance. A live iframe cannot be re-parented, so
      // end the old browsing context and mint the replacement directly in
      // its new permanent slot. The old modifier's later teardown is scoped
      // to its own element and therefore cannot tear this new mount down.
      this.unmount();
    }
    this.mounted = true;
    this.mountedElement = element;
    this.mountOwner = owner;
    // Establish the child URL and all bootstrap listeners before inserting
    // the iframe. Besides closing the first-message race, this means the
    // `load` event below can only belong to the requested child document —
    // never the iframe's initial about:blank document.
    let client = this.connect();
    this.client = client;
    element.append(this._iframe);
    client.catch((error) => {
      this.notifyMountFailed(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    this.resolveMountListeners(owner);
    let pending = this.pendingRequest;
    if (pending) {
      this.pendingRequest = undefined;
      void this.requestRender(
        pending.card,
        pending.format,
        pending.hostOwnsBox,
      ).catch((error: unknown) => {
        // Two distinct failures reject this promise: a connect failure
        // (already reported once via `client.catch` above — notifyMountFailed
        // is idempotent, so reporting again here is harmless) and a CHILD
        // RENDER failure after a successful connect, which rejects only this
        // promise. This first-mount render runs on a background promise no
        // caller awaits (`getRenderSlot()` resolved before mount), so this
        // listener is the only path by which its failure can ever reach the
        // Host's error presentation.
        this.notifyMountFailed(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }
    return () => this.unmount(element, owner);
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
  unmount(element?: HTMLElement, owner?: object): void {
    if (!this.mounted) {
      return;
    }
    if (element && this.mountedElement !== element) {
      return;
    }
    if (owner && this.mountOwner !== owner) {
      return;
    }
    this.mounted = false;
    this.mountedElement = undefined;
    this.mountOwner = undefined;
    this.pendingRequest = undefined;
    // A remount gets an independent chance to connect: a failure from the
    // PREVIOUS mount must not immediately fail a brand new one.
    this.mountError = undefined;
    this.mountFailedListeners.clear();
    this.cancelConnection?.(new Error('Sandbox runtime process was unmounted'));
    this.cancelConnection = undefined;
    this.runtimeClient?.destroy('Sandbox runtime process was unmounted');
    this.runtimeClient = undefined;
    this.client = undefined;
    this.renderDiagnosticPort?.removeEventListener(
      'message',
      this.receiveRenderDiagnostic,
    );
    this.renderDiagnosticPort?.removeEventListener(
      'message',
      this.receiveRuntimeError,
    );
    this.renderDiagnosticPort = undefined;
    this.surfaceServer?.destroy();
    this.surfaceServer = undefined;
    this.fetchServer?.destroy();
    this.fetchServer = undefined;
    this.renderClient?.destroy();
    this.renderClient = undefined;
    this.writeServer?.destroy();
    this.writeServer = undefined;
    this.viewCardServer?.destroy();
    this.viewCardServer = undefined;
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
    this.allowDocumentResources(resource, document, relativeTo);
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

  async dispose(handle: RuntimeHandle): Promise<void> {
    if (handle === this.renderedCard) {
      await this.renderClient?.clear(++this.nextGeneration);
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
    hostOwnsBox?: boolean,
  ): Promise<SandboxRenderSlot> {
    if (this.closed) {
      throw new Error('Sandbox runtime process is closed');
    }
    this.options.surfaceService.layout(this.surface, {
      heightMode: surfaceHeightModeFor(format, hostOwnsBox),
    });
    if (this.mounted) {
      await this.requestRender(card, format, hostOwnsBox);
    } else {
      this.pendingRequest = { card, format, hostOwnsBox };
    }
    return {
      owner: 'sandbox',
      iframe: this._iframe,
      surface: this.surface,
      mountToken:
        this.reservedMountToken ?? this.mountOwner ?? this.reserveMount(),
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
      listener.resolve();
    }
    this.mountListeners.clear();
    this.options.surfaceService.release(this.surface);
  }

  /**
   * Sandbox HMR (RP-17.1 un-deferral): pushes an edited module's unsaved
   * source and asks the child to invalidate-and-rerender the currently
   * mounted card against it (dossier step 2). Growing the module authority
   * with the draft's own classified graph BEFORE admitting its source (edge
   * case 8) means a brand-new import the edit introduces is already granted
   * by the time the child's fetch server would ask for it.
   *
   * The RETURNED promise always reflects the wire outcome of THIS specific
   * call — a caller that awaits its own push always learns whether ITS push
   * applied. Whether this call's outcome also updates the shared
   * `draftState` is a separate question: only if `generation` still equals
   * `lastIssuedDraftGeneration` when the response arrives (nothing newer
   * was pushed in the meantime) — a late ack from an older, already-
   * superseded draft is a no-op there, never rolling that shared state
   * backward (dossier §3.2/3.6).
   */
  async pushDraft(
    options: SandboxPushDraftOptions,
  ): Promise<SandboxPushDraftResult> {
    if (this.closed) {
      return {
        generation: this._draftState.generation,
        ok: false,
        error: new Error('Sandbox runtime process is closed'),
      };
    }
    let url = this.options.resolveModuleURL(options.moduleIdentifier);
    let generation = ++this.nextGeneration;
    this.lastIssuedDraftGeneration = generation;
    this.moduleAuthority.allow([
      ...options.moduleGraph,
      ...options.documentDeclaredModules,
    ]);
    this.draftOverrides.set(url, options.source);
    this.setDraftState({
      phase: 'pending',
      generation,
      lastKnownGoodGeneration: this._draftState.lastKnownGoodGeneration,
    });
    try {
      await this.client;
      if (!this.renderClient) {
        throw new Error('Sandbox render transport is unavailable');
      }
      await this.renderClient.draft(url, generation);
      if (generation === this.lastIssuedDraftGeneration) {
        this.setDraftState({
          phase: 'acked',
          generation,
          lastKnownGoodGeneration: generation,
        });
      }
      return { generation, ok: true };
    } catch (error) {
      let err = asError(error);
      if (generation === this.lastIssuedDraftGeneration) {
        this.setDraftState({
          phase: 'failed',
          generation,
          lastKnownGoodGeneration: this._draftState.lastKnownGoodGeneration,
          error: err,
        });
      }
      return { generation, ok: false, error: err };
    }
  }

  /**
   * RP-20.5 parent→child instance push: deliver the canonical instance's
   * freshly serialized current state to the mounted child, which applies it
   * to its already-materialized copy in place (no remount; the child's own
   * tracking re-renders changed bindings). Shares the render family's
   * monotonic generation sequence, so a push superseded by a newer push (or
   * any newer render/draft) is dropped by the child, never applied out of
   * order. Failures resolve (never reject) with the error — a missed push
   * leaves the child on last-known-good data and the NEXT push carries the
   * full current state anyway, so there is nothing for a caller to unwind.
   */
  async pushInstanceUpdate(
    document: LooseSingleCardDocument,
  ): Promise<{ generation: number; ok: boolean; error?: Error }> {
    if (this.closed) {
      return {
        generation: this.nextGeneration,
        ok: false,
        error: new Error('Sandbox runtime process is closed'),
      };
    }
    this.allowDocumentResources(document.data, document, undefined);
    let generation = ++this.nextGeneration;
    try {
      await this.client;
      if (!this.renderClient) {
        throw new Error('Sandbox render transport is unavailable');
      }
      await this.renderClient.updateInstance(document, generation);
      return { generation, ok: true };
    } catch (error) {
      return { generation, ok: false, error: asError(error) };
    }
  }

  /**
   * RP-10/RP-9.1 across the boundary: push a cloneable context snapshot —
   * v1 carries the card's realm `Permissions` — to the mounted child, which
   * provides it to the rendered card exactly as the Host's own context
   * plane would (without it, every Base-wrapped field editor in the child
   * renders disabled). Same fire-and-forget failure contract as
   * `pushInstanceUpdate`: a missed push self-heals on the next, because
   * every push carries the full current snapshot.
   */
  async pushContext(
    permissions: { canRead: boolean; canWrite: boolean } | null,
  ): Promise<{ generation: number; ok: boolean; error?: Error }> {
    if (this.closed) {
      return {
        generation: this.nextGeneration,
        ok: false,
        error: new Error('Sandbox runtime process is closed'),
      };
    }
    // The context-sync modifier can fire in the same render flush that
    // mounts this process — before `mount()` has set `this.client`. Waiting
    // for the mount (resolved immediately if already mounted; released by
    // destroy() too) keeps that first push from being lost, since nothing
    // re-pushes until the consumed permissions value actually changes.
    await this.whenMounted(this.reservedMountToken);
    let generation = ++this.nextGeneration;
    try {
      await this.client;
      if (!this.renderClient) {
        throw new Error('Sandbox render transport is unavailable');
      }
      await this.renderClient.updateContext(permissions, generation);
      return { generation, ok: true };
    } catch (error) {
      return { generation, ok: false, error: asError(error) };
    }
  }

  /**
   * RP-20.6: registers the ONE receiver entitled to apply this process's
   * child instance writes — see `connectSandboxInstanceSync`, which binds it
   * to the canonical instance this process renders (identity validation and
   * persistence both live there, parent-side). Returns a deregistration
   * callback; a second registration replaces the first (the runtime router
   * retains one process per surface identity, and the sync connection is
   * re-established per render).
   */
  setChildWriteReceiver(
    receiver: (document: LooseSingleCardDocument) => void | Promise<void>,
  ): () => void {
    this.childWriteReceiver = receiver;
    return () => {
      if (this.childWriteReceiver === receiver) {
        this.childWriteReceiver = undefined;
      }
    };
  }

  /**
   * Registers the Host UI capability for nested cards rendered by this
   * process. Unlike the write receiver this carries no data authority: the
   * child can only request the same `viewCard` action that main's
   * ElementTracker would invoke for an in-document render.
   */
  setChildViewCardReceiver(
    receiver: (
      cardId: string,
      format: string,
      options?: SandboxViewCardOptions,
    ) => void | Promise<void>,
  ): () => void {
    this.childViewCardReceiver = receiver;
    return () => {
      if (this.childViewCardReceiver === receiver) {
        this.childViewCardReceiver = undefined;
      }
    };
  }

  /**
   * Explicit hard reload — distinct from ordinary HMR (`pushDraft`): remints
   * this process's child from scratch. Stays the SAME retained object (the
   * runtime router keeps its lease; nothing re-routes) but tears down and
   * re-establishes the live iframe/connection exactly like an ordinary
   * unmount+remount, which already mints a fresh, still-detached iframe and
   * a new `bootstrapId` on its next `connect()` (RP-15.3's "never
   * re-parented" is honored the same way: this never moves the iframe, it
   * replaces it). Additionally clears draft overrides and resets the module
   * authority to a clean slate (no residual grants from the pre-reload
   * session) and notifies `onReload` listeners so a consumer with state
   * keyed on the old identity (the Host renderer's placeholder-handoff
   * flag) knows to invalidate it before this process's next paint.
   */
  reloadSandbox(): void {
    if (this.closed) {
      return;
    }
    let wasMounted = this.mounted;
    let parent = wasMounted ? this._iframe.parentElement : null;
    this.unmount();
    this.draftOverrides.clear();
    this.moduleAuthority.reset();
    // Bumped (not merely copied from `nextGeneration`) so a draft already
    // in flight when reload happens — its `generation` is necessarily
    // `<= nextGeneration` at the moment it was issued — can never match
    // this new value once it finally settles (rejected by the very
    // unmount() above) and tries to update draftState. Without this, a
    // same-numbered late failure could overwrite the freshly-reset 'idle'
    // phase right back to 'failed'.
    this.lastIssuedDraftGeneration = ++this.nextGeneration;
    this.setDraftState({ phase: 'idle', generation: this.nextGeneration });
    for (let listener of [...this.reloadListeners]) {
      listener();
    }
    if (wasMounted && parent) {
      this.mount(parent);
    }
  }

  private setDraftState(state: SandboxDraftState): void {
    this._draftState = state;
    for (let listener of [...this.draftStateListeners]) {
      listener(state);
    }
  }

  private async requestRender(
    card: BoxelInstanceHandle,
    format: string,
    hostOwnsBox?: boolean,
  ): Promise<void> {
    let generation = ++this.nextGeneration;
    await this.client;
    if (!this.renderClient) {
      throw new Error('Sandbox render transport is unavailable');
    }
    await this.renderClient.render(card, format, generation, hostOwnsBox);
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

  private resolveMountListeners(owner: object): void {
    for (let listener of [...this.mountListeners]) {
      if (!listener.token || listener.token === owner) {
        listener.resolve();
        this.mountListeners.delete(listener);
      }
    }
  }

  /**
   * RP-15.3: the child's report of an uncaught error or unhandled rejection
   * after a successful bootstrap — the only signal for a failure that
   * happens outside any render-request/response cycle. Terminal for the
   * mounted render: fail anything in flight (so an awaiting render caller
   * rejects with the REAL error, not a later timeout) and surface it
   * through the mount-failure channel, which the Host renderer already
   * turns into the error presentation in place of a silently blank iframe.
   */
  private receiveRuntimeError = (event: MessageEvent<unknown>): void => {
    let data = event.data;
    if (!isSandboxRuntimeControl(data) || data.type !== 'runtime-error') {
      return;
    }
    let error = reconstructedError(data.error);
    this.renderClient?.failPending(error);
    this.notifyMountFailed(error);
  };

  private receiveRenderDiagnostic = (event: MessageEvent<unknown>): void => {
    let data = event.data as {
      kind?: unknown;
      hasVisibleContent?: unknown;
    } | null;
    if (
      typeof data !== 'object' ||
      data === null ||
      data.kind !== 'boxel-sandbox-render-diagnostic'
    ) {
      return;
    }
    if (!data.hasVisibleContent) {
      // The child logs this too, but only to its own (cross-origin) console.
      // Mirroring it here puts "the render acked but painted nothing" where
      // someone debugging the PARENT app can actually see it.
      console.warn(
        '[sandbox-parent] child render acked but produced no visible output',
        data,
      );
    }
    if (this.painted || !data.hasVisibleContent) {
      return;
    }
    this.painted = true;
    for (let listener of [...this.paintListeners]) {
      listener();
    }
    this.paintListeners.clear();
    if (!this.options.keepRenderDiagnostics && this.renderDiagnosticPort) {
      this.renderDiagnosticPort.postMessage({
        kind: sandboxRenderDiagnosticAcceptedKind,
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      });
      this.renderDiagnosticPort.removeEventListener(
        'message',
        this.receiveRenderDiagnostic,
      );
    }
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
      // Loading the cross-origin child document includes its module graph.
      // In development that can include a cold Vite transform and is not a
      // transport failure. Give document boot its own bounded phase, then
      // apply the much tighter connection deadline only after `load`.
      let loadTimeout = globalThis.setTimeout(() => {
        fail(new Error('Timed out loading the Sandbox child'));
      }, this.options.loadTimeout ?? 90_000);
      let connectTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;
      let receiveLoad = () => {
        globalThis.clearTimeout(loadTimeout);
        connectTimeout ??= globalThis.setTimeout(() => {
          fail(new Error('Timed out connecting to the Sandbox child'));
        }, this.options.connectTimeout ?? 15_000);
      };
      let receiveLoadError = () => {
        fail(new Error('Failed to load the Sandbox child'));
      };
      let cleanupBootstrap = () => {
        globalThis.clearTimeout(loadTimeout);
        if (connectTimeout !== undefined) {
          globalThis.clearTimeout(connectTimeout);
        }
        iframe.removeEventListener('load', receiveLoad);
        iframe.removeEventListener('error', receiveLoadError);
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
        if (this.runtimeClient === client) {
          this.runtimeClient = undefined;
        }
        this.renderClient?.destroy(error.message);
        this.renderClient = undefined;
        this.surfaceServer?.destroy();
        this.surfaceServer = undefined;
        this.fetchServer?.destroy();
        this.fetchServer = undefined;
        this.writeServer?.destroy();
        this.writeServer = undefined;
        this.viewCardServer?.destroy();
        this.viewCardServer = undefined;
        reject(error);
      };
      let receiveControl = (event: MessageEvent<unknown>) => {
        if (!isSandboxRuntimeControl(event.data)) {
          return;
        }
        if (event.data.type === 'failed') {
          fail(reconstructedError(event.data.error));
          return;
        }
        if (event.data.type !== 'ready') {
          // 'runtime-error' belongs to the persistent post-bootstrap
          // listener (receiveRuntimeError) — it must never satisfy the
          // bootstrap handshake as if it were 'ready'.
          return;
        }
        if (settled || !client) {
          return;
        }
        settled = true;
        cleanupBootstrap();
        this.runtimeClient = client;
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
          (url) => this.draftOverrides.get(url),
          (url) => this.options.resolveModuleURL(url),
          (url) => this.resourceAuthority.has(canonicalURL(url)),
        );
        // RP-20.6 child→parent write leg: applies through the registered
        // receiver (connectSandboxInstanceSync's entitlement to the ONE
        // canonical instance this process renders). A write arriving before
        // any receiver is registered fails closed with an ordinary error
        // response — never buffered, never applied later out of context.
        this.writeServer = new SandboxWriteServer(channel.port1, (document) => {
          let receiver = this.childWriteReceiver;
          if (!receiver) {
            throw new Error(
              'No sandbox instance-write receiver is registered for this process',
            );
          }
          return receiver(document);
        });
        this.viewCardServer = new SandboxViewCardServer(
          channel.port1,
          (cardId, format, options) => {
            let receiver = this.childViewCardReceiver;
            if (!receiver) {
              throw new Error(
                'No sandbox view-card receiver is registered for this process',
              );
            }
            return receiver(cardId, format, options);
          },
        );
        // Independent of, and outlives, the bootstrap-scoped receiveControl
        // above (which cleanupBootstrap detaches once the handshake
        // completes): the child posts a render diagnostic after every
        // render for the life of the connection, not only during bootstrap —
        // and a post-'ready' uncaught error/unhandled rejection arrives as a
        // 'runtime-error' control message at any later time (RP-15.3:
        // silence after an ack is a protocol violation).
        this.renderDiagnosticPort = channel.port1;
        channel.port1.addEventListener('message', this.receiveRenderDiagnostic);
        channel.port1.addEventListener('message', this.receiveRuntimeError);
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
      iframe.addEventListener('load', receiveLoad);
      iframe.addEventListener('error', receiveLoadError);
      globalThis.addEventListener('message', receive);
      iframe.src = child.href;
    });
  }

  private allowDocumentResources(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
  ): void {
    for (let url of projectedResourceLinks(resource, document, relativeTo)) {
      this.resourceAuthority.add(url);
    }
  }
}

/**
 * Exact data-resource authority carried by a projected Boxel document.
 * Relationship links are the protocol's general explicit grant. The one
 * scalar exception is `resourceUrl`: FileDef adapters use that deliberately
 * named field as their wrapper-free projection of a binary resource when the
 * underlying polymorphic FileDef relationship cannot cross a boundary. No
 * other URL-looking string becomes authenticated Host fetch authority merely
 * because authored code can name it.
 */
export function projectedResourceLinks(
  resource: LooseCardResource,
  document: LooseSingleCardDocument,
  relativeTo: RealmResourceIdentifier | undefined,
): string[] {
  let result = new Set<string>();
  for (let candidate of [resource, ...(document.included ?? [])]) {
    let base =
      candidate.id ?? (candidate === resource ? relativeTo : undefined);
    if (!base) {
      continue;
    }
    let resourceUrl = candidate.attributes?.resourceUrl;
    if (typeof resourceUrl === 'string') {
      try {
        let url = new URL(resourceUrl, base);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          result.add(canonicalURL(url.href));
        }
      } catch {
        // A malformed scalar resource projection grants nothing.
      }
    }
    for (let relationship of Object.values(candidate.relationships ?? {})) {
      for (let entry of Array.isArray(relationship)
        ? relationship
        : [relationship]) {
        for (let link of [entry?.links?.self, entry?.links?.related]) {
          if (!link) {
            continue;
          }
          try {
            let url = new URL(link, base);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              result.add(canonicalURL(url.href));
            }
          } catch {
            // A malformed projected link grants nothing.
          }
        }
      }
    }
  }
  return [...result];
}

function canonicalURL(input: string): string {
  let url = new URL(input);
  url.hash = '';
  return url.href;
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
