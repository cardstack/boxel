import {
  assertBoxelExecutionProtocolVersion,
  assertSupportedFeatures,
  modulesConsumedInMeta,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

/**
 * The semantic-protocol features this Host understands. Producers stamp
 * requiredFeatures on their records; anything outside this set fails closed
 * at record admission rather than rendering a partial semantic.
 */
const SUPPORTED_EXECUTION_FEATURES: ReadonlySet<string> = new Set();

import {
  classifyBoxelSource,
  type BoxelSourceClassification,
} from './boxel-source-classifier';

import type { HostBoxelProjection } from './boxel-projection';
import type { MaterializationPurpose } from './boxel-runtime';
import type BoxelRuntimeRouter from './boxel-runtime-router';
import type {
  BoxelRuntimeLease,
  BoxelRuntimeRouteInput,
} from './boxel-runtime-router';
import type CapsuleBoxelRuntime from './capsule-boxel-runtime';
import type {
  CapsuleRenderSlot,
  TrustedBaseRenderSlot,
} from './capsule-component';
import type { DirectRenderSlot } from './direct-boxel-runtime';
import type DirectBoxelRuntime from './direct-boxel-runtime';
import type { SandboxRenderSlot } from './sandbox-runtime-process';
import type SandboxRuntimeProcess from './sandbox-runtime-process';

import type { BaseDef } from '@cardstack/base/card-api';

export interface BoxelExecutionRequest {
  /** Viewer/app execution principal, never inferred from the Realm URL. */
  principal: string;
  /** Stable identity of the mounted visual surface. */
  surfaceId: string;
  trusted: boolean;
  format: string;
  moduleIdentifier: string;
  source: string;
  resource: LooseCardResource;
  document: LooseSingleCardDocument;
  relativeTo?: RealmResourceIdentifier;
  purpose: MaterializationPurpose;
  /**
   * Host-only canonical value used exclusively by Direct. It is never passed
   * to Capsule or Sandbox runtimes and never crosses an execution boundary.
   */
  canonicalCard?: BaseDef;
  /**
   * The Host's cloneable semantic projection of the canonical instance,
   * produced by the shared pipeline in `boxel-projection.ts`. A Capsule
   * adopts it so trusted-Base semantics materialize once, Host-side, and
   * cross as data; the Sandbox child re-derives the same shapes from the
   * projected document with its child-local Base (RP-14.4).
   */
  hostProjection?: HostBoxelProjection;
  /** A Host-known stronger-boundary request, if already available. */
  prefersFullSandbox?: boolean;
}

export interface BoxelExecutionGeneration {
  readonly generation: number;
  readonly lease: BoxelRuntimeLease;
  readonly card: BoxelInstanceHandle;
  readonly renderRecord: BoxelRenderRecord;
}

export type BoxelExecutionStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BoxelExecutionRenderSlot =
  | DirectRenderSlot
  | CapsuleRenderSlot
  | TrustedBaseRenderSlot
  | SandboxRenderSlot;

export interface BoxelExecutionSessionSnapshot {
  status: BoxelExecutionStatus;
  requestedGeneration: number;
  current?: BoxelExecutionGeneration;
  error?: Error;
}

export type BoxelExecutionSessionListener = (
  snapshot: BoxelExecutionSessionSnapshot,
) => void;

export type BoxelSourceClassifier = (
  moduleIdentifier: string,
  source: string,
) => Promise<BoxelSourceClassification>;

/**
 * Host owner for one mounted Boxel execution surface.
 *
 * A session changes runtime generations atomically: an incomplete or failed
 * candidate cannot replace the last-known-good generation, and an obsolete
 * asynchronous result is disposed before it can become visible.
 */
export class BoxelExecutionSession {
  private requestedGeneration = 0;
  private currentGeneration?: BoxelExecutionGeneration;
  private status: BoxelExecutionStatus = 'idle';
  private error?: Error;
  private closed = false;
  private listeners = new Set<BoxelExecutionSessionListener>();
  /**
   * One `AbortController` per in-flight RP-7.3 settle watch
   * (`request.hostProjection.onSettle`, set up in `boxel-projection.ts` when
   * a relationship was rendered absent because it hadn't settled yet). Any
   * watch still here is for a generation this session no longer wants: a
   * newer `update()` supersedes it (aborted at the top of `update()`, since
   * whatever it would republish is already moot), and `destroy()` aborts
   * whatever is left so a closed session never republishes.
   */
  private settleWatchers = new Set<AbortController>();
  /**
   * The request that produced `currentGeneration` — retained only for
   * `pushDraft()`'s authority-growth step (`documentDeclaredModules`), which
   * needs the same resource/document `materialize()` used, not for
   * `update()`'s own control flow. Always set alongside `currentGeneration`
   * so the two stay a consistent snapshot.
   */
  private lastRequest?: BoxelExecutionRequest;

  constructor(
    private readonly router: BoxelRuntimeRouter,
    private readonly classifySource: BoxelSourceClassifier,
  ) {}

  get snapshot(): BoxelExecutionSessionSnapshot {
    return {
      status: this.status,
      requestedGeneration: this.requestedGeneration,
      ...(this.currentGeneration ? { current: this.currentGeneration } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(listener: BoxelExecutionSessionListener): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async getRenderSlot(format: string): Promise<BoxelExecutionRenderSlot> {
    let current = this.currentGeneration;
    if (!current) {
      throw new Error('Boxel execution session has no ready generation');
    }
    switch (current.lease.runtime.mode) {
      case 'direct':
        return (
          current.lease.runtime as DirectBoxelRuntime
        ).getRenderSlotForHandle(current.card);
      case 'capsule':
        return (current.lease.runtime as CapsuleBoxelRuntime).getRenderSlot(
          current.card,
          format,
        );
      case 'sandbox':
        return (current.lease.runtime as SandboxRuntimeProcess).getRenderSlot(
          current.card,
          format,
        );
    }
  }

  /**
   * Sandbox HMR (RP-17.1's un-deferral for this tier): pushes an edited
   * module's unsaved source against the currently mounted generation. This
   * is the one public entry seam both the future code-mode wiring and the
   * volatile-execution workstream (`docs/boxel-volatile-execution-plan.md`
   * — direction only, not implemented by this method) are expected to
   * consume; it does no UI wiring of its own.
   *
   * Only meaningful for a session whose current generation is Sandbox —
   * Capsule/Direct HMR are out of scope for this extraction (dossier §4).
   * Classification is re-run here (the same pure, memoized step `update()`
   * already performs for a fresh render) so authority can grow with the
   * draft's own module graph before its source is ever admitted (edge case
   * 8, `SandboxRuntimeProcess.pushDraft`'s doc comment) — this session
   * never routes to a different runtime for a draft push, unlike an
   * ordinary `update()`, since the whole point is to keep updating the
   * SAME live process without disturbing its identity (RP-15.3).
   */
  async pushDraft(
    moduleIdentifier: string,
    source: string,
  ): Promise<{ generation: number; ok: boolean; error?: Error }> {
    this.assertOpen();
    let current = this.currentGeneration;
    let request = this.lastRequest;
    if (!current || !request) {
      return {
        generation: 0,
        ok: false,
        error: new Error(
          'Boxel execution session has no ready generation to push a draft against',
        ),
      };
    }
    if (current.lease.runtime.mode !== 'sandbox') {
      return {
        generation: 0,
        ok: false,
        error: new Error(
          `Sandbox HMR draft push is not supported for the '${current.lease.runtime.mode}' execution tier`,
        ),
      };
    }
    let classification: BoxelSourceClassification;
    try {
      classification = await this.classifySource(moduleIdentifier, source);
    } catch (error) {
      return { generation: 0, ok: false, error: asError(error) };
    }
    // A draft that raced a session teardown or a newer update() while
    // classifying must not apply against a generation/runtime this session
    // no longer owns.
    if (this.closed || current !== this.currentGeneration) {
      return {
        generation: 0,
        ok: false,
        error: new Error(
          'Boxel execution session generation changed while classifying the draft',
        ),
      };
    }
    let sandbox = current.lease.runtime as SandboxRuntimeProcess;
    return sandbox.pushDraft({
      moduleIdentifier,
      source,
      moduleGraph: classification.moduleGraph,
      documentDeclaredModules: documentDeclaredModules(request),
    });
  }

  /**
   * Explicit hard reload (dossier step 6) — distinct from `pushDraft`'s
   * ordinary HMR: remints the current generation's Sandbox process from
   * scratch (new bootstrapId, cleared draft overrides, reset module
   * authority) rather than surgically invalidating one module. A no-op for
   * a session with no current generation, or one not currently on the
   * Sandbox tier.
   */
  reloadSandbox(): void {
    this.assertOpen();
    let current = this.currentGeneration;
    if (!current || current.lease.runtime.mode !== 'sandbox') {
      return;
    }
    (current.lease.runtime as SandboxRuntimeProcess).reloadSandbox();
  }

  async update(
    request: BoxelExecutionRequest,
  ): Promise<BoxelExecutionGeneration | undefined> {
    this.assertOpen();
    // Whatever an existing settle watch would republish is for a generation
    // this call is about to supersede either way.
    this.abortSettleWatchers();
    let generation = ++this.requestedGeneration;
    this.status = 'loading';
    this.error = undefined;
    // Only broadcast this "now loading" transition when there is no
    // current generation yet — a genuinely first/cold load. A REPLACE
    // (a format switch, or RP-7.3's settle-triggered republish) leaves
    // `currentGeneration` populated as last-known-good throughout —
    // notifying here too would push that exact same, already-observed
    // generation to subscribers a second time under a misleading
    // "something changed" signal, before the real new generation (or a
    // failure) ever arrives. No production consumer of this session's
    // `status` distinguishes a mid-replace 'loading' from the 'ready' it
    // briefly interrupts, so skipping it costs nothing observable while
    // dedicating the render-record sequence a subscriber that DOES pay
    // attention to `current` to exactly one entry per real generation.
    if (!this.currentGeneration) {
      this.notify();
    }

    let candidate: BoxelExecutionGeneration | undefined;
    try {
      let source = await this.classifySource(
        request.moduleIdentifier,
        request.source,
      );
      this.assertCurrent(generation);
      candidate = await this.materialize(generation, request, source);

      // The type itself may request the stronger process boundary. This hint
      // is authoritative only in the upward direction: it can never select a
      // weaker runtime than source analysis or Host trust policy selected.
      if (
        candidate.lease.decision.mode !== 'sandbox' &&
        candidate.renderRecord.boxel.executionHints.prefersFullSandbox
      ) {
        await disposeGeneration(candidate);
        candidate = await this.materialize(generation, request, source, true);
      }

      this.assertCurrent(generation);
      let previous = this.currentGeneration;
      this.currentGeneration = candidate;
      this.lastRequest = request;
      candidate = undefined;
      this.status = 'ready';
      this.error = undefined;
      this.notify();
      if (previous) {
        await disposeGeneration(previous);
      }
      // RP-7.3: this generation renders immediately with any not-yet-settled
      // relationship absent — first paint never awaits settlement. If the
      // projection reported one, watch it in the background and republish a
      // fresh generation through this same atomic path once it resolves.
      this.watchForSettle(generation, request);
      return this.currentGeneration;
    } catch (error) {
      if (candidate) {
        await disposeGeneration(candidate);
      }
      if (this.closed || generation !== this.requestedGeneration) {
        return undefined;
      }
      this.status = 'error';
      this.error = asError(error);
      this.notify();
      return undefined;
    }
  }

  /**
   * Observe one generation's RP-7.3 settle watch (if its projection reported
   * one) and republish a fresh generation when it resolves. Fire-and-forget
   * by design: `update()` must not await this (RP-7.3 forbids blocking first
   * paint on relationship resolution), so failures are swallowed here rather
   * than surfacing as an unhandled rejection or a spurious session error —
   * the current generation, correctly rendered absent, is not wrong, just
   * not yet complete.
   */
  private watchForSettle(
    generation: number,
    request: BoxelExecutionRequest,
  ): void {
    let onSettle = request.hostProjection?.onSettle;
    if (!onSettle) {
      return;
    }
    let controller = new AbortController();
    this.settleWatchers.add(controller);
    void (async () => {
      try {
        let fresh = await onSettle(controller.signal);
        if (!fresh || this.closed || generation !== this.requestedGeneration) {
          return;
        }
        await this.update({ ...request, hostProjection: fresh });
      } catch {
        // Best-effort observation; see doc comment above.
      } finally {
        this.settleWatchers.delete(controller);
      }
    })();
  }

  private abortSettleWatchers(): void {
    for (let controller of this.settleWatchers) {
      controller.abort();
    }
    this.settleWatchers.clear();
  }

  async destroy(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.requestedGeneration++;
    this.abortSettleWatchers();
    let current = this.currentGeneration;
    this.currentGeneration = undefined;
    this.listeners.clear();
    this.status = 'idle';
    this.error = undefined;
    if (current) {
      await disposeGeneration(current);
    }
  }

  private async materialize(
    generation: number,
    request: BoxelExecutionRequest,
    source: BoxelSourceClassification,
    prefersFullSandbox = request.prefersFullSandbox ?? false,
  ): Promise<BoxelExecutionGeneration> {
    let route: BoxelRuntimeRouteInput = {
      principal: request.principal,
      surfaceId: request.surfaceId,
      trusted: request.trusted,
      format: request.format,
      source,
      prefersFullSandbox,
    };
    let lease = this.router.route(route);
    if (lease.runtime.mode === 'sandbox') {
      (lease.runtime as SandboxRuntimeProcess).allowModules([
        ...source.moduleGraph,
        ...documentDeclaredModules(request),
      ]);
    }
    let card: BoxelInstanceHandle | undefined;
    try {
      card =
        lease.runtime.mode === 'direct' && request.canonicalCard
          ? (lease.runtime as DirectBoxelRuntime).retainCanonicalInstance(
              request.canonicalCard,
            )
          : await lease.runtime.createFromSerialized(
              request.resource,
              request.document,
              request.relativeTo,
              request.purpose,
            );
      if (request.hostProjection && lease.runtime.mode === 'capsule') {
        (lease.runtime as CapsuleBoxelRuntime).adoptHostProjection(
          card,
          request.hostProjection,
        );
      }
      this.assertCurrent(generation);
      let renderRecord = await lease.runtime.buildRenderRecord(card);
      // Semantic-record admission (RP-14.3): an unsupported protocol version
      // or required feature rejects the whole generation here, so the session
      // retains its last-known-good output instead of rendering an unknown
      // record shape.
      assertBoxelExecutionProtocolVersion(renderRecord.protocolVersion);
      assertSupportedFeatures(
        renderRecord.boxel.requiredFeatures,
        SUPPORTED_EXECUTION_FEATURES,
      );
      this.assertCurrent(generation);
      return { generation, lease, card, renderRecord };
    } catch (error) {
      if (card) {
        await lease.runtime.dispose(card).catch(() => undefined);
      }
      lease.release();
      throw error;
    }
  }

  private assertCurrent(generation: number): void {
    this.assertOpen();
    if (generation !== this.requestedGeneration) {
      throw new ObsoleteBoxelExecutionGeneration();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Boxel execution session is closed');
    }
  }

  private notify(): void {
    let snapshot = this.snapshot;
    for (let listener of this.listeners) {
      listener(snapshot);
    }
  }
}

/** Creates stable per-surface sessions over the shared runtime router. */
export default class BoxelExecutionEngine {
  constructor(
    private readonly router: BoxelRuntimeRouter,
    private readonly classifySource: BoxelSourceClassifier = (
      _module,
      source,
    ) => classifyBoxelSource(source),
  ) {}

  createSession(): BoxelExecutionSession {
    return new BoxelExecutionSession(this.router, this.classifySource);
  }

  destroy(): void {
    this.router.destroy();
  }
}

class ObsoleteBoxelExecutionGeneration extends Error {
  constructor() {
    super('Boxel execution generation was superseded');
    this.name = 'ObsoleteBoxelExecutionGeneration';
  }
}

async function disposeGeneration(
  generation: BoxelExecutionGeneration,
): Promise<void> {
  await generation.lease.runtime
    .dispose(generation.card)
    .catch(() => undefined);
  generation.lease.release();
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Every `adoptsFrom` module the execution document declares, for the primary
 * resource and every `included` resource.
 *
 * A Sandbox module graph is otherwise seeded only from the entry module's own
 * literal ESM imports (`source.moduleGraph`). That walk cannot see a type
 * reached only through a `linksTo`/`linksToMany` relationship or a
 * polymorphic `contains`/`containsMany` value — those are authored generically
 * (e.g. `linksTo(CardDef)`) and their concrete type is data on the serialized
 * resource, never a source-level import. `createFromSerialized` still needs
 * to load each such type in the child, so its module must be admitted too.
 * These are the exact modules the Host itself resolved while building this
 * document — an explicit, per-document grant, not a realm-wide one.
 */
function documentDeclaredModules(request: BoxelExecutionRequest): string[] {
  let modules = modulesConsumedInMeta(request.resource.meta);
  for (let resource of request.document.included ?? []) {
    if (resource.meta) {
      modules.push(...modulesConsumedInMeta(resource.meta));
    }
  }
  return [...new Set(modules)];
}
