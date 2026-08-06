import {
  assertBoxelExecutionProtocolVersion,
  assertSupportedFeatures,
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

  async update(
    request: BoxelExecutionRequest,
  ): Promise<BoxelExecutionGeneration | undefined> {
    this.assertOpen();
    let generation = ++this.requestedGeneration;
    this.status = 'loading';
    this.error = undefined;
    this.notify();

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
      candidate = undefined;
      this.status = 'ready';
      this.error = undefined;
      this.notify();
      if (previous) {
        await disposeGeneration(previous);
      }
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
      (lease.runtime as SandboxRuntimeProcess).allowModules(source.moduleGraph);
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
