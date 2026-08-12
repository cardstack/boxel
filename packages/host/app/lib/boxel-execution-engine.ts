import {
  assertBoxelExecutionProtocolVersion,
  assertSupportedFeatures,
  modulesConsumedInMeta,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type CodeRef,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import {
  startBoxelExecutionStage,
  type BoxelExecutionPerformanceContext,
} from './boxel-execution-performance';
import { decideBoxelExecution } from './boxel-execution-policy';
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

/**
 * The semantic-protocol features this Host understands. Producers stamp
 * requiredFeatures on their records; anything outside this set fails closed
 * at record admission rather than rendering a partial semantic.
 */
const SUPPORTED_EXECUTION_FEATURES: ReadonlySet<string> = new Set();

export interface BoxelExecutionRequest {
  /** Viewer/app execution principal, never inferred from the Realm URL. */
  principal: string;
  /** Stable identity of the mounted visual surface. */
  surfaceId: string;
  trusted: boolean;
  /** Host-authorized tier selection; authored records cannot set this. */
  hostRequestedMode?: 'direct';
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
  /** Host-only diagnostic correlation. Never sent to a runtime boundary. */
  performance?: BoxelExecutionPerformanceContext;
}

export interface BoxelExecutionGeneration {
  readonly generation: number;
  readonly lease: BoxelRuntimeLease;
  readonly card: BoxelInstanceHandle;
  readonly renderRecord: BoxelRenderRecord;
  readonly source: BoxelSourceClassification;
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
 * Volatile promotion (docs/boxel-volatile-execution-plan.md): queries the
 * Host's LIVE volatile-module set at the moment it's needed, rather than a
 * value baked into `BoxelExecutionRequest` at `requestFor()` time — a
 * promotion can happen in the (real, async) gap between building a request
 * and this engine actually materializing it, and the freshest answer is
 * the one that matters. The smallest seam that gives materialize() this
 * without coupling the engine to `BoxelExecutionService` directly.
 */
export type BoxelVolatilePredicate = (moduleIdentifier: string) => boolean;

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
  private nextFormatSwitch = 0;
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
    private readonly isModuleVolatile: BoxelVolatilePredicate = () => false,
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

  /**
   * `hostOwnsBox` (RP-9.9) reaches only the Sandbox: Direct and Capsule
   * render into the Host's own document, where the slot element carries the
   * box contract in CSS and no one has to be told about it. A Sandbox's
   * child is behind an iframe whose viewport IS its box, so the contract
   * has to cross the boundary as data.
   */
  async getRenderSlot(
    format: string,
    hostOwnsBox?: boolean,
    componentCodeRef?: CodeRef,
  ): Promise<BoxelExecutionRenderSlot> {
    let current = this.currentGeneration;
    if (!current) {
      throw new Error('Boxel execution session has no ready generation');
    }
    switch (current.lease.runtime.mode) {
      case 'direct':
        return (
          current.lease.runtime as DirectBoxelRuntime
        ).getRenderSlotForHandle(current.card, undefined, {
          componentCodeRef,
        });
      case 'capsule':
        return (current.lease.runtime as CapsuleBoxelRuntime).getRenderSlot(
          current.card,
          format,
          componentCodeRef,
        );
      case 'sandbox':
        return (current.lease.runtime as SandboxRuntimeProcess).getRenderSlot(
          current.card,
          format,
          hostOwnsBox,
        );
    }
  }

  /**
   * Switches an already-live Sandbox generation between its full-card
   * formats without serializing or materializing the card again. The policy
   * check is repeated with the retained classification, so this fast path is
   * available only when the destination format belongs in the SAME Sandbox;
   * a default trusted editor or compact format falls back to an ordinary
   * session update instead.
   */
  async switchSandboxFormat(
    format: string,
    hostOwnsBox?: boolean,
  ): Promise<SandboxRenderSlot | undefined> {
    this.assertOpen();
    let current = this.currentGeneration;
    let request = this.lastRequest;
    if (!current || !request || current.lease.runtime.mode !== 'sandbox') {
      return undefined;
    }
    let decision = decideBoxelExecution({
      hostRequestedMode: request.hostRequestedMode,
      trusted: request.trusted,
      format,
      source: current.source,
      prefersFullSandbox: request.prefersFullSandbox ?? false,
      volatile: this.isModuleVolatile(request.moduleIdentifier),
    });
    if (decision.mode !== 'sandbox') {
      return undefined;
    }
    let formatSwitch = ++this.nextFormatSwitch;
    let requestedGeneration = this.requestedGeneration;
    let formatSwitchStage = startBoxelExecutionStage({
      operationId: `${request.surfaceId}:format-${formatSwitch}`,
      occurrenceId: request.surfaceId,
      stage: 'format-switch',
      tier: 'sandbox',
    });
    let slot: SandboxRenderSlot;
    let process = current.lease.runtime as SandboxRuntimeProcess;
    try {
      slot = await process.getRenderSlot(current.card, format, hostOwnsBox);
    } catch (error) {
      formatSwitchStage.finish({ status: 'error' });
      throw error;
    }
    if (
      this.closed ||
      current !== this.currentGeneration ||
      requestedGeneration !== this.requestedGeneration ||
      formatSwitch !== this.nextFormatSwitch
    ) {
      formatSwitchStage.finish({ status: 'obsolete' });
      return undefined;
    }
    formatSwitchStage.finish();
    this.lastRequest = { ...request, format };
    // The child card and iframe stay live, but the Glimmer modifier that
    // presents them belongs to a new format generation. Transfer teardown
    // ownership with a fresh token: if the successor reused the old token,
    // the predecessor's later cleanup would still match and unmount the
    // retained iframe.
    return { ...slot, mountToken: process.reserveMount() };
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
    let generation = ++this.requestedGeneration;
    let performance = request.performance ?? {
      operationId: `${request.surfaceId}:${generation}`,
      occurrenceId: request.surfaceId,
    };
    let generationStage = startBoxelExecutionStage({
      ...performance,
      stage: 'generation',
    });
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
      let classifyStage = startBoxelExecutionStage({
        ...performance,
        stage: 'classify',
      });
      let source: BoxelSourceClassification;
      try {
        source = await this.classifySource(
          request.moduleIdentifier,
          request.source,
        );
        classifyStage.finish({
          counters: { modules: source.moduleGraph.length },
        });
      } catch (error) {
        classifyStage.finish({ status: 'error' });
        throw error;
      }
      this.assertCurrent(generation);
      candidate = await this.materialize(
        generation,
        request,
        source,
        request.prefersFullSandbox ?? false,
        performance,
      );

      // The type itself may request the stronger process boundary. This hint
      // is authoritative only in the upward direction: it can never select a
      // weaker runtime than source analysis or Host trust policy selected.
      if (
        candidate.lease.decision.mode !== 'sandbox' &&
        candidate.renderRecord.boxel.executionHints.prefersFullSandbox
      ) {
        await disposeGeneration(candidate);
        candidate = await this.materialize(
          generation,
          request,
          source,
          true,
          performance,
        );
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
      generationStage.finish();
      // RP-7.3: this generation renders immediately with any not-yet-settled
      // relationship absent — first paint never awaits settlement. No tier
      // needs a settle watch: Direct reads the canonical instance natively,
      // a Capsule's `@model`/`@fields`/presentation are live read-through
      // paths (RP-20.2), and a mounted Sandbox child receives settlement
      // through the RP-20.5 instance push, whose freshly serialized
      // document carries whatever has settled by push time.
      return this.currentGeneration;
    } catch (error) {
      if (candidate) {
        await disposeGeneration(candidate);
      }
      if (this.closed || generation !== this.requestedGeneration) {
        generationStage.finish({ status: 'obsolete' });
        return undefined;
      }
      this.status = 'error';
      this.error = asError(error);
      this.notify();
      generationStage.finish({ status: 'error' });
      return undefined;
    }
  }

  async destroy(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.requestedGeneration++;
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
    performance = request.performance ??
      ({
        operationId: `${request.surfaceId}:${generation}`,
        occurrenceId: request.surfaceId,
      } satisfies BoxelExecutionPerformanceContext),
  ): Promise<BoxelExecutionGeneration> {
    let route: BoxelRuntimeRouteInput = {
      principal: request.principal,
      surfaceId: request.surfaceId,
      hostRequestedMode: request.hostRequestedMode,
      trusted: request.trusted,
      format: request.format,
      source,
      prefersFullSandbox,
      volatile: this.isModuleVolatile(request.moduleIdentifier),
    };
    let lease = this.router.route(route);
    let materializeStage = startBoxelExecutionStage({
      ...performance,
      stage: 'materialize',
      tier: lease.runtime.mode,
    });
    if (lease.runtime.mode === 'sandbox') {
      (lease.runtime as SandboxRuntimeProcess).allowModules([
        ...source.moduleGraph,
        ...documentDeclaredModules(request),
      ]);
    }
    let card: BoxelInstanceHandle | undefined;
    try {
      let createStage = startBoxelExecutionStage({
        ...performance,
        stage: 'runtime-create',
        tier: lease.runtime.mode,
      });
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
        createStage.finish();
      } catch (error) {
        createStage.finish({ status: 'error' });
        throw error;
      }
      if (request.hostProjection && lease.runtime.mode === 'capsule') {
        (lease.runtime as CapsuleBoxelRuntime).adoptHostProjection(
          card,
          request.hostProjection,
        );
      }
      this.assertCurrent(generation);
      let renderRecordStage = startBoxelExecutionStage({
        ...performance,
        stage: 'render-record',
        tier: lease.runtime.mode,
      });
      let renderRecord: BoxelRenderRecord;
      try {
        renderRecord = await lease.runtime.buildRenderRecord(card);
        renderRecordStage.finish({
          counters: {
            fields: renderRecord.boxel.fields.length,
            formats: renderRecord.boxel.formats.length,
          },
        });
      } catch (error) {
        renderRecordStage.finish({ status: 'error' });
        throw error;
      }
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
      materializeStage.finish();
      return { generation, lease, card, renderRecord, source };
    } catch (error) {
      materializeStage.finish({
        status:
          error instanceof ObsoleteBoxelExecutionGeneration
            ? 'obsolete'
            : 'error',
      });
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
    private readonly isModuleVolatile: BoxelVolatilePredicate = () => false,
  ) {}

  createSession(): BoxelExecutionSession {
    return new BoxelExecutionSession(
      this.router,
      this.classifySource,
      this.isModuleVolatile,
    );
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
