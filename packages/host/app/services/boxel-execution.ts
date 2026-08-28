import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { TrackedObject } from 'tracked-built-ins';

import {
  isCssResource,
  isHtmlResource,
  buildQuerySearchURL,
  codeRefWithAbsoluteIdentifier,
  identifyCard,
  isCardInstance,
  isFileDefInstance,
  isResolvedCodeRef,
  isSingleCardDocument,
  getAncestor,
  Loader,
  localId,
  normalizeQueryDefinition,
  normalizeCodeRef,
  realmURL as realmURLSymbol,
  relativeTo as relativeToSymbol,
  rri,
  withReauthenticationAllowed,
  type CodeRef,
  type FieldDefinition,
  type JSONValue,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type PrerenderedHtmlFormat,
  type Query,
  type RealmResourceIdentifier,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import { createBoxelFieldPortal } from '@cardstack/host/components/boxel-field-portal';
import config from '@cardstack/host/config/environment';
import BoxelExecutionEngine, {
  type BoundaryBoxelExecutionRequest,
  type BoxelExecutionRequest,
  type DirectBoxelExecutionRequest,
  type BoxelExecutionSession,
} from '@cardstack/host/lib/boxel-execution-engine';
import {
  boxelExecutionPerformanceEnabled,
  startBoxelExecutionStage,
  type BoxelExecutionPerformanceContext,
  type BoxelExecutionStage,
} from '@cardstack/host/lib/boxel-execution-performance';
import {
  createLiveBoxelModel,
  projectBoxelExecutionDocument,
  projectHostBoxelSemantics,
  projectInstancePresentation,
  type HostBoxelProjection,
} from '@cardstack/host/lib/boxel-projection';
import type { BoxelExecutionMode } from '@cardstack/host/lib/boxel-runtime';
import BoxelRuntimeRouter from '@cardstack/host/lib/boxel-runtime-router';
import {
  BoxelModuleGraphClassifier,
  type BoxelSourceClassification,
} from '@cardstack/host/lib/boxel-source-classifier';
import CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import {
  validateCapsuleInlineStyle,
  validateSharedDocumentScopedCSSRequest,
} from '@cardstack/host/lib/capsule-css-policy';
import CapsuleModuleEvaluator from '@cardstack/host/lib/capsule-module-evaluator';
import type { DirectRenderSlot } from '@cardstack/host/lib/direct-boxel-runtime';
import {
  htmlComponent,
  type HTMLComponent,
} from '@cardstack/host/lib/html-component';
import { fetchBoundedSandboxMedia } from '@cardstack/host/lib/sandbox-fetch-transport';
import SandboxMediaBridge, {
  protectSandboxMediaSources,
} from '@cardstack/host/lib/sandbox-media-bridge';
import {
  allocateSandboxRuntimeOrigin,
  newSandboxRuntimeNonce,
} from '@cardstack/host/lib/sandbox-runtime-origin';
import SandboxRuntimeProcess, {
  sandboxIframeIsolationMode,
} from '@cardstack/host/lib/sandbox-runtime-process';
import { constrainSandboxWriteDocument } from '@cardstack/host/lib/sandbox-write-transport';
import {
  isImplicitSandboxModule,
  isTrustedImport,
  isTrustedModule,
} from '@cardstack/host/lib/trusted-modules';

import type CardService from './card-service';
import type DirectBoxelRuntimeService from './direct-boxel-runtime';
import type LoaderService from './loader-service';
import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type StoreService from './store';
import type SurfaceService from './surface-service';
import type {
  BaseDef,
  BaseDefConstructor,
  BoxComponent,
  CardDef,
  Field,
  Format,
} from '@cardstack/base/card-api';

interface HostBoundaryQuerySeed {
  instance: BaseDef;
  fieldName: string;
  values: CardDef[];
  searchURL: string;
}

export interface PreparedSandboxDocumentExecution {
  request: BoundaryBoxelExecutionRequest;
  classification: BoxelSourceClassification;
}

/**
 * Application owner for Boxel execution runtimes.
 *
 * This service is the only product-layer place that turns canonical Store
 * state into a versioned execution request. Runtime adapters receive source
 * text and cloneable JSON:API data, never the Store, Loader, card instance, or
 * an Ember service.
 */
export default class BoxelExecutionService extends Service {
  @service declare private cardService: CardService;
  @service declare private directBoxelRuntime: DirectBoxelRuntimeService;
  @service declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private surfaceService: SurfaceService;
  @service declare private store: StoreService;

  private engine?: BoxelExecutionEngine;
  private classifier?: BoxelModuleGraphClassifier;
  /**
   * The same router instance handed to `engine` — retained here too so
   * `reserveSandboxProcess()` can call `route()` directly, independent of
   * (and before) a session's own materialize() call. See that method.
   */
  private router?: BoxelRuntimeRouter;
  private fieldPortalMaps = new WeakMap<
    BaseDef,
    Promise<Record<string, BoxComponent>>
  >();
  private nextSurface = 0;
  private nextPerformanceOperation = 0;
  private nextLocalBoxel = 0;
  private sandboxCreationCount = 0;
  private appliedExecutableGeneration = 0;
  /** Set on first `requestFor()`; see `liveModelFor()`. */
  private cardAPI?: Awaited<ReturnType<CardService['getAPI']>>;
  /**
   * RP-20.2: one tracked version cell per canonical instance — the bridge
   * from card-api's imperative `subscribeToChanges` notifications into
   * Glimmer autotracking for the live model's reads. The subscriber is a
   * PURE OBSERVER by contract: it bumps this cell and (async, idempotent)
   * re-grows the recursive subscription to cover newly-assigned nested
   * compounds — it never reads or writes the instance, never reprojects,
   * never touches the store (the sync root-cause lesson,
   * docs/boxel-sync-root-cause-2026-08-06.md).
   */
  private instanceVersions = new WeakMap<BaseDef, { v: number }>();
  /**
   * RP-20.6: every live sandbox sync connection's push trigger, per
   * canonical instance. A child write applied to the canonical instance
   * cannot fire card-api change subscribers (`updateFromSerialized` writes
   * the data bucket directly), so the OTHER sandbox views of the same card
   * would never learn of it — this registry is how an applied write fans
   * back out: the receiver invokes every registered trigger, each of which
   * serializes the (now-updated) canonical state and pushes it to its own
   * child. The writer's own trigger is included deliberately: its child
   * applies the normalization echo silently (no subscribers fire in the
   * child either), so the loop terminates by construction.
   */
  private instanceSyncPushTriggers = new WeakMap<BaseDef, Set<() => void>>();
  /**
   * Volatile promotion (docs/boxel-volatile-execution-plan.md): one-way for
   * the life of this service (tab) — no lease, no timer, no demotion. The
   * only way a module leaves this set is the tab closing.
   */
  private volatileModules = new Set<string>();
  /**
   * A tracked cell per promoted-or-not module identifier, created lazily on
   * first read. `isVolatile()` reads it (establishing autotracking's
   * dependency); `promoteToVolatile()` bumps it. Deliberately per-module,
   * not one shared counter: a consumer (the renderer resource) that reads
   * `isVolatile('card-a')` must re-run when card-a is promoted, but must
   * NOT re-run — and flicker an unrelated, unpromoted card — when some
   * other card-b is promoted instead. See `moduleIdentifierFor()`.
   */
  private volatileTokens = new Map<string, { v: number }>();

  constructor(owner: Owner) {
    super(owner);
    registerDestructor(this, () => this.destroyEngine());
  }

  createSession(): BoxelExecutionSession {
    return this.ensureExecutionEngine().createSession();
  }

  surfaceId(): string {
    return `boxel-surface-${++this.nextSurface}`;
  }

  /**
   * Volatile promotion (docs/boxel-volatile-execution-plan.md): marks
   * `moduleIdentifier` as under active source editing for the rest of this
   * tab's session. One-way — promoting an already-volatile module, or
   * re-promoting after this call, is a no-op; there is no corresponding
   * "demote". Never applies to a trusted Host module: volatile promotion
   * exists for user cards under active edit, not the platform's own
   * trusted graph, so this call is silently inert (not a thrown error —
   * a caller racing card-graph discovery with a promotion trigger
   * shouldn't have to pre-filter trusted modules itself) for a trusted
   * `moduleIdentifier`.
   */
  promoteToVolatile(moduleIdentifier: string): void {
    if (isTrustedModule(moduleIdentifier)) {
      return;
    }
    if (this.volatileModules.has(moduleIdentifier)) {
      return;
    }
    this.volatileModules.add(moduleIdentifier);
    // Bump AFTER adding, so a consumer that reads isVolatile() in reaction
    // to this exact tracked write sees the promotion already applied.
    this.volatileToken(moduleIdentifier).v++;
  }

  /**
   * Whether `moduleIdentifier` has been promoted to volatile. Reading this
   * establishes a tracked dependency scoped to exactly this module
   * identifier (see `volatileToken()`) — a consumer (the renderer
   * resource, via `moduleIdentifierFor()`) that reads it for its OWN
   * card's module re-runs when THAT card is promoted, never when an
   * unrelated one is.
   */
  isVolatile(moduleIdentifier: string): boolean {
    // Establishes the tracked read even though the value itself is unused
    // here — `has()` below is not itself trackable.
    void this.volatileToken(moduleIdentifier).v;
    return this.volatileModules.has(moduleIdentifier);
  }

  /**
   * Synchronous module-identity lookup — the same one `requestFor()` uses
   * internally, exposed so a consumer can establish a per-module tracked
   * `isVolatile()` dependency SYNCHRONOUSLY, in its own tracking frame,
   * before any async work begins (reading `isVolatile()` later, inside an
   * async continuation, would not register as an autotracking dependency).
   * Returns `undefined` rather than throwing for a card whose module can't
   * be identified yet — there is nothing to track in that case; the real
   * error still surfaces from `requestFor()` itself.
   */
  moduleIdentifierFor(card: BaseDef): string | undefined {
    return Loader.identify(card.constructor)?.module;
  }

  /**
   * Host-side executable generation token. Loader replacement begins a code
   * rebuild, but it is not yet a renderable generation: the Store still owns
   * instances created by the outgoing Loader until its live graph has been
   * re-established. The Store publishes this tracked token only after the new
   * canonical instances are installed, so presentation never combines a new
   * component with an obsolete CardDef object.
   */
  prepareExecutableGeneration(): number {
    let generation = this.store.settledExecutableGeneration;
    if (generation === this.appliedExecutableGeneration) {
      return generation;
    }
    for (let moduleIdentifier of this.store.settledExecutableInvalidations) {
      this.classifier?.invalidate(moduleIdentifier);
      this.router?.invalidateModule(moduleIdentifier);
    }
    this.appliedExecutableGeneration = generation;
    return generation;
  }

  /**
   * Resolve a caller-held instance back to the Store's current canonical
   * object before forming an execution request. A code rebuild may replace a
   * card's constructor while the surrounding Host component remains mounted;
   * rendering the old object would pair new source with an obsolete CardDef
   * and component. The Store remains the semantic owner in every tier.
   */
  canonicalCardFor(card: BaseDef): BaseDef {
    if (!('id' in card) || typeof card.id !== 'string') {
      return card;
    }
    let current = this.store.peek(card.id);
    return isCardInstance(current) || isFileDefInstance(current)
      ? (current as BaseDef)
      : card;
  }

  retainExecutableModule(moduleIdentifier: string): () => void {
    return this.loaderService.retainExecutableModule(moduleIdentifier);
  }

  private volatileToken(moduleIdentifier: string): { v: number } {
    let token = this.volatileTokens.get(moduleIdentifier);
    if (!token) {
      token = new TrackedObject({ v: 0 });
      this.volatileTokens.set(moduleIdentifier, token);
    }
    return token;
  }

  /**
   * Pre-flight classification, duplicated ahead of a session's own identical
   * internal step (`BoxelExecutionSession.update()`'s `classifySource` call).
   * Classification is pure static module-graph analysis with no side effects
   * — `BoxelModuleGraphClassifier.classify()` is itself memoized by
   * `moduleIdentifier`/`source`, so calling it here and then again from
   * `update()` does real work only once. The renderer uses this to learn,
   * before materialize() ever runs, whether a card needs the Sandbox tier —
   * see `reserveSandboxProcess()`.
   */
  classifyForExecution(
    moduleIdentifier: string,
    source: string,
  ): Promise<BoxelSourceClassification> {
    this.ensureExecutionEngine();
    // `classify` is the module graph API, not Ember's String extension.
    // eslint-disable-next-line ember/no-string-prototype-extensions
    return this.classifier!.classify(moduleIdentifier, source);
  }

  /**
   * Obtains (and retains) the Sandbox process for this surface — completely
   * independent of, and before, card materialization.
   *
   * RP-15.3: a Sandbox process cannot connect until it has a permanent DOM
   * mount point, and that mount point is the presentation slot element the
   * Host renders only once `BoxelExecutionSession.getRenderSlot()` resolves
   * — which itself cannot resolve until `materialize()` has already created
   * the card through a live connection. Left alone, that is a deadlock: the
   * process cannot connect before it is mounted, and materialize() cannot
   * create a card before the process connects. This reservation breaks the
   * cycle by obtaining the (registry-retained, reference-counted) process
   * ahead of materialize() — using the same, pure, memoized classification
   * decision it will independently reach — so the caller can render the real
   * presentation slot immediately and let `mount()` start connecting before
   * materialize() ever needs the client.
   *
   * Returns `undefined` when classification does not select Sandbox for this
   * request. The caller must release the returned lease exactly once (e.g.
   * from its own teardown) — this is a second, independent retain on the
   * same reference-counted registry entry `materialize()`'s own `route()`
   * call also retains, so an extra release here never tears down a process
   * still in active use.
   */
  reserveSandboxProcess(
    principal: string,
    surfaceId: string,
    trusted: boolean,
    format: string | undefined,
    source: BoxelSourceClassification,
    volatile = false,
    prefersFullSandbox = false,
  ):
    | {
        process: SandboxRuntimeProcess;
        mountToken: object;
        release: () => void;
      }
    | undefined {
    this.ensureExecutionEngine();
    let router = this.router;
    if (!router) {
      return undefined;
    }
    let lease = router.route({
      principal,
      surfaceId,
      trusted,
      format,
      source,
      prefersFullSandbox,
      volatile,
    });
    if (lease.runtime.mode !== 'sandbox') {
      lease.release();
      return undefined;
    }
    return {
      process: lease.runtime as SandboxRuntimeProcess,
      mountToken: (lease.runtime as SandboxRuntimeProcess).reserveMount(),
      release: lease.release,
    };
  }

  /**
   * Secure Sandbox admission from an inert realm document. Unlike
   * `requestFor(BaseDef)`, this path never asks the Host Store or Card API to
   * materialize the authored type. The module graph is classified from source
   * bytes, denied to the Host Loader, and then handed to the child runtime as
   * a JSON:API document.
   *
   * This is intentionally a Sandbox-only vertical slice. Direct admission
   * will share the document-first prefix, but may invoke the Host Loader only
   * after a separate trusted-provenance decision.
   */
  async prepareSandboxURL(
    cardURL: string,
    format: Format | undefined,
    surfaceId: string,
  ): Promise<PreparedSandboxDocumentExecution> {
    let document = await this.cardService.fetchJSON(cardURL);
    if (!isSingleCardDocument(document)) {
      throw new Error(`Unable to load a card document for ${cardURL}`);
    }
    return this.prepareSandboxDocument(
      document,
      format,
      surfaceId,
      rri(cardURL),
    );
  }

  async prepareSandboxDocument(
    inputDocument: LooseSingleCardDocument,
    format: Format | undefined,
    surfaceId: string,
    relativeTo?: RealmResourceIdentifier,
  ): Promise<PreparedSandboxDocumentExecution> {
    if (!inputDocument.data) {
      throw new Error('Cannot execute a Boxel without a document resource');
    }
    let adoptsFrom = inputDocument.data.meta?.adoptsFrom;
    if (!adoptsFrom) {
      throw new Error('Cannot execute a Boxel document without adoptsFrom');
    }
    let documentBase =
      relativeTo ??
      (typeof inputDocument.data.id === 'string'
        ? rri(inputDocument.data.id)
        : undefined);
    let resolvedRef = codeRefWithAbsoluteIdentifier(
      adoptsFrom,
      documentBase,
      undefined,
      this.network.virtualNetwork,
    );
    if (!isResolvedCodeRef(resolvedRef)) {
      throw new Error('Sandbox document adoptsFrom must resolve to a module');
    }
    let moduleIdentifier = resolvedRef.module;
    if (isTrustedImport(moduleIdentifier)) {
      throw new Error(
        `Sandbox document admission expects an authored module, received trusted module ${moduleIdentifier}`,
      );
    }

    // Block the entry before the first await in graph classification. This
    // closes the window in which another Host path could import the module
    // while its source and dependencies are being inspected.
    this.loaderService.denyHostModuleEvaluation([moduleIdentifier]);
    let source = await this.sourceFor(moduleIdentifier);
    let classification = await this.classifyForExecution(
      moduleIdentifier,
      source,
    );
    this.loaderService.denyHostModuleEvaluation(
      classification.moduleGraph.filter(
        (identifier) => !isTrustedImport(identifier),
      ),
    );

    let document = structuredClone(inputDocument);
    document.data.meta = {
      ...document.data.meta,
      adoptsFrom: resolvedRef,
    };
    let performance: BoxelExecutionPerformanceContext = {
      operationId: `${surfaceId}:${++this.nextPerformanceOperation}`,
      occurrenceId: surfaceId,
    };
    return {
      classification,
      request: {
        principal: this.principal,
        surfaceId,
        trusted: false,
        format: format ?? 'isolated',
        moduleIdentifier,
        source,
        relativeTo: documentBase,
        purpose: format === 'edit' ? 'interactive-edit' : 'host-display',
        resource: document.data,
        document,
        // This API is an explicit stronger-boundary admission. It never
        // falls back to Capsule even when the source itself needs no browser
        // globals.
        prefersFullSandbox: true,
        performance,
      },
    };
  }

  async requestFor(
    card: BaseDef,
    format: Format | undefined,
    surfaceId: string,
    relativeTo: RealmResourceIdentifier | undefined,
    hostRequestedMode: 'direct',
  ): Promise<DirectBoxelExecutionRequest>;
  async requestFor(
    card: BaseDef,
    format: Format | undefined,
    surfaceId: string,
    relativeTo?: RealmResourceIdentifier,
    hostRequestedMode?: undefined,
  ): Promise<BoundaryBoxelExecutionRequest>;
  async requestFor(
    card: BaseDef,
    format: Format | undefined,
    surfaceId: string,
    relativeTo: RealmResourceIdentifier | undefined,
    hostRequestedMode: 'direct' | undefined,
  ): Promise<BoxelExecutionRequest>;
  async requestFor(
    card: BaseDef,
    format: Format | undefined,
    surfaceId: string,
    relativeTo?: RealmResourceIdentifier,
    hostRequestedMode?: 'direct',
  ): Promise<BoxelExecutionRequest> {
    let performance: BoxelExecutionPerformanceContext = {
      operationId: `${surfaceId}:${++this.nextPerformanceOperation}`,
      occurrenceId: surfaceId,
    };
    let requestStage = startBoxelExecutionStage({
      ...performance,
      stage: 'request',
    });
    let identity = Loader.identify(card.constructor);
    if (!identity) {
      throw new Error('Cannot execute a Boxel whose module is unidentified');
    }
    let moduleIdentifier = identity.module;
    this.ensureLocalIdentity(card);

    // Direct is the canonical-Store adapter of the rendering protocol. It
    // needs the Card API for live projection, but it has no serialization or
    // source boundary: the engine retains `canonicalCard` and the Direct
    // runtime derives its render record from that instance. Avoid building a
    // complete included JSON:API graph (and fetching source) only to discard
    // both during materialization. Besides reducing allocation pressure, this
    // makes the request payload state the actual authority being transferred.
    if (hostRequestedMode === 'direct') {
      let api = await recordExecutionPromise(
        performance,
        'card-api',
        this.cardService.getAPI(),
      );
      this.cardAPI = api;
      let request: DirectBoxelExecutionRequest = {
        principal: this.principal,
        surfaceId,
        hostRequestedMode: 'direct',
        trusted: true,
        format: format ?? 'isolated',
        moduleIdentifier,
        source: '',
        relativeTo: relativeTo ?? executionRelativeTo(card),
        purpose: format === 'edit' ? 'interactive-edit' : 'host-display',
        canonicalCard: card,
        performance,
      };
      requestStage.finish({
        counters: { includedResources: 0, sourceCharacters: 0 },
      });
      return request;
    }

    let [source, initialDocument, api] = await Promise.all([
      recordExecutionPromise(
        performance,
        'source',
        this.sourceFor(moduleIdentifier),
      ),
      recordExecutionPromise(
        performance,
        'serialize',
        this.cardService.serializeCard(card as never, {
          withIncluded: true,
          includeUnrenderedFields: true,
          // Execution documents cross Loader and process boundaries. Keep type
          // identities absolute so a side-loaded card from another directory or
          // realm cannot accidentally rebase its adoptsFrom module against the
          // primary card when the receiving runtime deserializes it.
          useAbsoluteURL: true,
        }),
      ),
      recordExecutionPromise(
        performance,
        'card-api',
        this.cardService.getAPI(),
      ),
    ]);
    // Captured for the synchronous live-model reads (`liveModelFor`) —
    // every render that needs it necessarily passed through here first.
    this.cardAPI = api;
    if (!initialDocument.data) {
      throw new Error('Cannot execute a Boxel without a serialized resource');
    }
    let document = initialDocument;

    // A query-backed relationship is a Host-owned Store semantic. The initial
    // serialization is intentionally concurrent with source/API loading and
    // can therefore describe the pre-query empty state. Direct and Capsule
    // can keep reading the canonical instance; a Sandbox cannot. Before
    // crossing that process boundary, explicitly resolve the bounded query
    // projection (without depending on a later Glimmer modifier), then
    // serialize once more so the child receives relationship data and
    // included resources rather than an empty snapshot that cannot repair
    // itself.
    let hostProjection: HostBoxelProjection | undefined;
    let hadPendingRelationship = false;
    let querySeeds: HostBoundaryQuerySeed[] = [];
    // Direct owns the canonical Store instance and therefore has no graph
    // boundary to prepare. Projecting its complete field graph here would
    // eagerly read query-backed fields before Glimmer renders them, starting
    // searches that main never performs and duplicating Store semantics. The
    // Direct runtime derives its cloneable RP record from the canonical card
    // at render time instead. Capsule and Sandbox still need the bounded,
    // settled Host projection before data crosses their execution boundary.
    let projectionStage = startBoxelExecutionStage({
      ...performance,
      stage: 'projection-settle',
    });
    try {
      let settled = await this.settleHostProjection(card, api);
      hostProjection = settled.projection;
      hadPendingRelationship = settled.hadPendingRelationship;
      querySeeds = settled.querySeeds;
      projectionStage.finish({
        counters: { passes: settled.relationshipSettlementPasses },
      });
    } catch (error) {
      projectionStage.finish({ status: 'error' });
      throw error;
    }
    if (hadPendingRelationship) {
      document = await recordExecutionPromise(
        performance,
        'serialize',
        this.cardService.serializeCard(card as never, {
          withIncluded: true,
          includeUnrenderedFields: true,
          useAbsoluteURL: true,
        }),
      );
      if (!document.data) {
        throw new Error(
          'Cannot execute a Boxel without a serialized resource after relationship resolution',
        );
      }
    }
    let projectedDocument = projectBoxelExecutionDocument(
      card,
      document as LooseSingleCardDocument,
      api,
      isTrustedModule,
    );
    applyHostBoundaryQuerySeeds(
      card,
      projectedDocument,
      querySeeds,
      api,
      (id) => this.network.virtualNetwork.unresolveURL(id),
    );
    let request: BoundaryBoxelExecutionRequest = {
      principal: this.principal,
      surfaceId,
      hostRequestedMode: undefined,
      // A Loader-shimmed module is host-defined by construction: its class
      // identity lives in the host process and its realm file serves only a
      // shim marker (no evaluable source exists for Capsule/Sandbox to
      // run). Routing it anywhere but Direct executes a comment. In the
      // app, shims are @cardstack internals (already trusted); in tests,
      // fixture modules registered via `loader.shimModule` render exactly
      // as main renders them.
      trusted:
        isTrustedModule(moduleIdentifier) ||
        this.loaderService.loader.isShimmedModule(moduleIdentifier),
      format: format ?? 'isolated',
      moduleIdentifier,
      source,
      resource: projectedDocument.data,
      document: projectedDocument,
      relativeTo: relativeTo ?? executionRelativeTo(card),
      purpose: format === 'edit' ? 'interactive-edit' : 'host-display',
      canonicalCard: card,
      // `useAbsoluteURL: true` above keeps `document`'s own instance ids
      // absolute (RP-8.4). A themed card's presentation must not inherit
      // that: the theme stylesheet a themed card's realm/prerender pipeline
      // installs is compiled against the linked Theme card's *scoped*
      // identifier (`unresolveResourceInstanceURLs` in
      // `runtime-common/url.ts` runs on every realm-served document), so
      // `projectHostBoxelSemantics` needs the same normalization to derive
      // a matching `data-boxel-theme-scope` token
      // (`boxel-projection.ts`'s `projectThemeScopeToken`).
      // `ensureRelationshipLoaded` closes RP-7.2's lazy-load gap for a
      // pending relationship reached through a nested `contains()` field
      // (e.g. a themed card's `cardInfo.theme`, or a `linksToMany` owned by
      // a contained field): card-api.gts's own lazy-load trigger keys the
      // fetch off the field's immediate owning instance, which is only
      // guaranteed store-wired for the canonical root this service already
      // creates with `store: this.store` (`services/store.ts`), not for a
      // nested sub-instance the classic (main) render path never
      // distinguishes. Routing every pending reference through the same
      // `StoreService.get` the classic path uses, then writing the result
      // back onto the field, makes the fetch happen regardless.
      hostProjection,
      performance,
    };
    requestStage.finish({
      counters: {
        includedResources: projectedDocument.included?.length ?? 0,
        sourceCharacters: source.length,
      },
    });
    return request;
  }

  /**
   * RP-20.2/RP-20.5: the live `@model` for a mounted generation — main's
   * sync pattern (shared instance + autotracked reads) expressed through
   * the projection boundary. Property reads project the canonical
   * instance's current value as cloneable data; because the reads are
   * tracked, every mounted view of this instance re-renders in place on
   * any mutation, with no subscription pipeline at all. `fallback` is the
   * materialize-time record model (instance id, RP-4.4 extensions, and
   * the pending-relationship values only materialize could resolve).
   */
  liveModelFor(
    card: BaseDef,
    fallback: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!this.cardAPI) {
      return fallback;
    }
    let cell = this.instanceVersionCellFor(card, this.cardAPI);
    return createLiveBoxelModel(
      card,
      this.cardAPI,
      fallback as Record<string, JSONValue>,
      () => cell.v,
    );
  }

  /**
   * RP-20.5: connect the canonical instance's change stream to a mounted
   * Sandbox process — the parent→child half of cross-view sync for the one
   * tier whose views cannot read the canonical instance live. Each
   * mutation batch serializes the instance's CURRENT state (the same
   * projected execution document `createFromSerialized` consumed) and
   * pushes it over the render transport; the child applies it to its copy
   * in place, so its DOM re-renders without remounting.
   *
   * Serialization happens inside a promise-chain continuation — an
   * imperative context, never a tracking frame — so its tracked reads
   * cannot re-entangle any resource (the RP-20.1 lesson). The chain also
   * serializes pushes: a burst of changes coalesces to one serialize+push
   * per drain (the `dirty` flag), and generation ordering on the wire
   * drops anything superseded in flight. Push failures are logged, never
   * thrown — the next push carries full current state, so a missed one
   * self-heals.
   */
  connectSandboxInstanceSync(
    card: BaseDef,
    process: SandboxRuntimeProcess,
  ): () => void {
    let api = this.cardAPI;
    if (!api) {
      // Every render path passes through requestFor() (which captures the
      // API) before a sandbox slot can exist; this guard is for tests that
      // wire a process directly.
      return () => {};
    }
    let stopped = false;
    let dirty = false;
    let queue = Promise.resolve();
    let subscriber = () => {
      dirty = true;
      queue = queue.then(async () => {
        if (stopped || !dirty) {
          return;
        }
        dirty = false;
        try {
          let document = await this.serializeForExecution(card);
          if (stopped) {
            return;
          }
          let result = await process.pushInstanceUpdate(document);
          if (!result.ok && result.error) {
            console.warn(
              '[sandbox-parent] instance push failed',
              result.error.message,
            );
          } else {
            // Parent-observable proof the child ACKED applying this
            // revision (its in-place updateFromSerialized completed) —
            // the cross-origin child's own console is unreachable from
            // Host tooling, so this breadcrumb is the one place the
            // RP-20.5 delivery loop closes observably.
            console.debug('[sandbox-parent] instance push applied', {
              generation: result.generation,
            });
          }
        } catch (error) {
          console.warn('[sandbox-parent] instance push failed', error);
        }
      });
    };
    api.subscribeToChanges(card, subscriber);
    let triggers = this.instanceSyncPushTriggers.get(card);
    if (!triggers) {
      triggers = new Set();
      this.instanceSyncPushTriggers.set(card, triggers);
    }
    triggers.add(subscriber);
    // RP-20.6 child→parent write leg: the reverse of the push loop above.
    // The child proposes its rendered instance's complete current state; the
    // ONLY thing it is entitled to write is this connection's own canonical
    // card, so the document's identity is validated before anything is
    // applied. Apply goes through `updateFromSerialized` — the same in-place
    // mechanism the child uses for the downstream push — and persistence
    // goes through the store's own debounced autosave lane
    // (`scheduleSave`), because the direct bucket write cannot fire the
    // autosave subscriber the way a host-side setter mutation would.
    // Boxel accepts writes; validation is a post-save concern (the guide
    // system), so an apply here is expected to succeed — the error path
    // exists for transport faults and identity violations, not a
    // validation UX.
    let disconnectWriteReceiver = process.setChildWriteReceiver(
      async (document) => {
        let cardId = (card as { id?: unknown }).id;
        let incomingId = document.data?.id;
        if (typeof cardId !== 'string' || cardId.length === 0) {
          throw new Error(
            'Sandbox instance write requires a saved canonical card',
          );
        }
        if (
          typeof incomingId !== 'string' ||
          this.network.virtualNetwork.unresolveURL(incomingId) !==
            this.network.virtualNetwork.unresolveURL(cardId)
        ) {
          throw new Error(
            `Sandbox instance write for '${String(incomingId)}' does not match the card this process renders`,
          );
        }
        let authorizedDocument = await this.serializeForExecution(card);
        let constrainedDocument = constrainSandboxWriteDocument(
          document,
          authorizedDocument,
          (id) => this.network.virtualNetwork.unresolveURL(id),
        );
        await api.updateFromSerialized(card as never, constrainedDocument);
        this.store.scheduleSave(cardId);
        console.debug('[sandbox-parent] child write applied', { id: cardId });
        for (let trigger of [
          ...(this.instanceSyncPushTriggers.get(card) ?? []),
        ]) {
          // Skip the WRITER's own connection: its child already holds
          // exactly the state it just wrote, and an echo push would apply
          // updateFromSerialized over it — replacing nested compound field
          // instances and remounting their {{each}} DOM (destroying an
          // open in-cell editor) for zero data change. Every OTHER view of
          // the card receives the write as an ordinary RP-20.5 push.
          if (trigger === subscriber) {
            continue;
          }
          trigger();
        }
      },
    );
    return () => {
      stopped = true;
      api.unsubscribeFromChanges(card, subscriber);
      this.instanceSyncPushTriggers.get(card)?.delete(subscriber);
      disconnectWriteReceiver();
    };
  }

  /**
   * The projected execution document for `card`'s CURRENT state — the same
   * serialization `requestFor()` performs at materialize time, factored so
   * the RP-20.5 push delivers documents identical in shape to the one the
   * child originally consumed.
   */
  private async serializeForExecution(
    card: BaseDef,
  ): Promise<LooseSingleCardDocument> {
    let api = await this.cardService.getAPI();
    // A mutation can invalidate a query-backed relationship. Its change
    // notification arrives before the replacement SearchResource settles;
    // publish only after the same bounded graph projection used at initial
    // materialization is stable, so the push lane never sends a transient
    // empty membership that has no later mutation to repair it.
    let { querySeeds } = await this.settleHostProjection(card, api);
    let document = await this.cardService.serializeCard(card as never, {
      withIncluded: true,
      includeUnrenderedFields: true,
      useAbsoluteURL: true,
    });
    if (!document.data) {
      throw new Error('Cannot push a Boxel without a serialized resource');
    }
    let projectedDocument = projectBoxelExecutionDocument(
      card,
      document as LooseSingleCardDocument,
      api,
      isTrustedModule,
    );
    applyHostBoundaryQuerySeeds(
      card,
      projectedDocument,
      querySeeds,
      api,
      (id) => this.network.virtualNetwork.unresolveURL(id),
    );
    return projectedDocument;
  }

  /**
   * Resolve every pending relationship encountered by the bounded Host
   * projection. A settled edge can reveal another query/link in a nested
   * Boxel, so repeat until the full projected graph is stable. Runtimes still
   * receive only the resulting data; Store and search remain Host-owned.
   */
  private async settleHostProjection(
    card: BaseDef,
    api: typeof import('@cardstack/base/card-api'),
  ): Promise<{
    projection: HostBoxelProjection;
    hadPendingRelationship: boolean;
    relationshipSettlementPasses: number;
    querySeeds: HostBoundaryQuerySeed[];
  }> {
    let relationshipSettlementPasses = 0;
    let sawPendingRelationship = false;
    let resolvedQueries = new WeakMap<BaseDef, Map<string, CardDef[]>>();
    let querySeeds = new Map<BaseDef, Map<string, HostBoundaryQuerySeed>>();
    let pendingRelationships: Array<{
      instance: BaseDef;
      fieldName: string;
    }> = [];
    let resolvedQueryValues = (instance: BaseDef, fieldName: string) =>
      resolvedQueries.get(instance)?.get(fieldName);
    let markQueryResolved = (
      instance: BaseDef,
      fieldName: string,
      values: CardDef[],
    ) => {
      let fields = resolvedQueries.get(instance);
      if (!fields) {
        fields = new Map();
        resolvedQueries.set(instance, fields);
      }
      fields.set(fieldName, values);
    };
    let markQuerySeed = (
      instance: BaseDef,
      fieldName: string,
      values: CardDef[],
      searchURL: string,
    ) => {
      let fields = querySeeds.get(instance);
      if (!fields) {
        fields = new Map();
        querySeeds.set(instance, fields);
      }
      fields.set(fieldName, { instance, fieldName, values, searchURL });
    };
    let project = () => {
      sawPendingRelationship = false;
      pendingRelationships = [];
      return projectHostBoxelSemantics(card, api, {
        unresolveURL: (url) => this.network.virtualNetwork.unresolveURL(url),
        ensureRelationshipLoaded: (reference) => this.store.get(reference),
        onRelationship: (relationship) => {
          if (
            relationship.queryBacked &&
            resolvedQueryValues(
              relationship.instance,
              relationship.fieldName,
            ) === undefined
          ) {
            sawPendingRelationship = true;
            pendingRelationships.push(relationship);
          } else if (!relationship.queryBacked && relationship.pending) {
            sawPendingRelationship = true;
          }
        },
        resolvedQueryValues,
      });
    };
    let projection = project();
    while (sawPendingRelationship) {
      if (relationshipSettlementPasses++ >= 32) {
        throw new Error(
          'Cannot execute a Boxel whose relationship graph did not settle',
        );
      }
      // A query SearchResource does not actually start until its Glimmer
      // modifier mounts. A Sandbox request is deliberately prepared before
      // any child render exists, so waiting for `store.loaded()` alone can
      // never make that query complete. Resolve the declarative request here,
      // under the card-facing Store bounds, and freeze the result into the
      // execution document before the child is asked to materialize it.
      for (let { instance, fieldName } of pendingRelationships) {
        if (resolvedQueryValues(instance, fieldName) !== undefined) {
          continue;
        }
        let field = (
          api.getFields(instance, { includeComputeds: true }) as Record<
            string,
            Field<BaseDefConstructor> | undefined
          >
        )[fieldName];
        if (!field?.queryDefinition) {
          markQueryResolved(instance, fieldName, []);
          continue;
        }
        let request = resolveBoundaryQueryFieldRequest(
          this.store,
          instance,
          field,
          api,
        );
        let instances = request
          ? await this.store.search<CardDef>(request.query, request.realms, {
              cardInitiated: true,
            })
          : [];
        markQueryResolved(instance, fieldName, instances);
        if (request) {
          markQuerySeed(
            instance,
            fieldName,
            instances,
            buildQuerySearchURL(request.realms, request.query),
          );
        }
        await primeBoundaryQueryField(
          instance,
          field,
          instances,
          api,
          this.store,
        );
      }
      // Declared links still settle through the Store's ordinary load lane.
      await this.store.loaded();
      projection = project();
    }
    return {
      projection,
      hadPendingRelationship: relationshipSettlementPasses > 0,
      relationshipSettlementPasses,
      querySeeds: [...querySeeds.values()].flatMap((fields) => [
        ...fields.values(),
      ]),
    };
  }

  /**
   * RP-20.2 applied to presentation: the same live read-through the model
   * gets, for the theme/title/summary block main derives per render inside
   * `field-component.gts`. `projectInstancePresentation` is pure (peek
   * reads and membership observations only — no lazy-load triggers, no
   * write-backs), so consuming it from a tracked getter is safe; the
   * version cell makes a late-settling `cardInfo.theme` re-derive the
   * scope token in place. Returns `undefined` before the first
   * `requestFor()` has captured the card API — callers fall back to the
   * materialize-time record presentation, which is identical at that
   * moment by construction.
   */
  livePresentationFor(card: BaseDef) {
    if (!this.cardAPI) {
      return undefined;
    }
    let cell = this.instanceVersionCellFor(card, this.cardAPI);
    void cell.v;
    return projectInstancePresentation(card, this.cardAPI, (url) =>
      this.network.virtualNetwork.unresolveURL(url),
    );
  }

  private instanceVersionCellFor(
    card: BaseDef,
    api: NonNullable<typeof this.cardAPI>,
  ): { v: number } {
    let cell = this.instanceVersions.get(card);
    if (!cell) {
      let created = new TrackedObject({ v: 0 });
      cell = created;
      this.instanceVersions.set(card, created);
      let subscriber = () => {
        created.v++;
        // A mutation may have assigned a brand-new nested compound;
        // subscribeToChanges is recursive but only over values present at
        // subscription time. Re-subscribing is idempotent per (instance,
        // subscriber) and grows coverage. Deferred off the notify path so
        // the subscriber itself stays a bump-only observer.
        queueMicrotask(() => api.subscribeToChanges(card, subscriber));
      };
      api.subscribeToChanges(card, subscriber);
    }
    return cell;
  }

  /**
   * Resolve an inert, server-prerendered rendering for the execution handoff.
   *
   * This is presentation data only: it is never materialized into the Store,
   * never receives event handlers, and cannot acquire a Surface capability.
   * The live Capsule or Sandbox rendering replaces it atomically when ready.
   */
  async prerenderedComponentFor(
    card: BaseDef,
    format: Format | undefined,
  ): Promise<HTMLComponent | undefined> {
    let cardId =
      'id' in card && typeof card.id === 'string' ? card.id : undefined;
    if (!cardId) {
      return undefined;
    }

    // An isolated surface prefers its own stored rendering, falling back to
    // embedded while an index that predates isolated storage catches up. An
    // edit surface uses embedded as its inert handoff image; the live
    // renderer still receives and renders the exact requested format.
    let formats: readonly PrerenderedHtmlFormat[] =
      format === 'fitted' || format === 'atom' || format === 'head'
        ? [format]
        : format === 'edit'
          ? ['embedded']
          : ['isolated', 'embedded'];

    for (let candidate of formats) {
      try {
        let result = await this.store.fetchCardEntry(cardId, {
          kind: 'card',
          format: candidate,
          fields: 'html',
        });
        if (result.notModified) {
          continue;
        }
        let included = result.doc.included ?? [];
        let rendering = included.find(
          (resource) =>
            isHtmlResource(resource) &&
            resource.attributes.format === candidate &&
            resource.attributes.html !== undefined,
        );
        if (!rendering || !isHtmlResource(rendering)) {
          continue;
        }
        let styleIds = new Set(
          rendering.relationships.styles.data.map(({ id }) => id),
        );
        let styleHrefs = included
          .filter(isCssResource)
          .filter(({ id }) => styleIds.has(id))
          .map(({ attributes }) => attributes.href);
        await Promise.all(
          styleHrefs.map((href) => this.installPrerenderedStylesheet(href)),
        );
        // Indexed isolated HTML may have several root nodes; htmlComponent
        // requires exactly one, so the placeholder gets a neutral wrapper.
        let placeholder = document.createElement('div');
        placeholder.dataset.boxelPrerenderPlaceholder = '';
        placeholder.innerHTML = rendering.attributes.html!;
        protectSandboxMediaSources(placeholder);
        return htmlComponent(placeholder.outerHTML, {}, (element) => {
          let bridge = new SandboxMediaBridge(
            element as HTMLElement,
            async (url) => {
              let response = await fetchBoundedSandboxMedia(
                this.network.authedFetch,
                url,
              );
              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            },
          );
          bridge.start();
          return () => bridge.stop();
        });
      } catch {
        // A missing or stale prerender must never delay or fail live execution.
      }
    }
    return undefined;
  }

  /**
   * Register one prerendered stylesheet in the shared Host document.
   *
   * The Capsule CSS policy (capsule-css-policy.ts) confines AUTHORED,
   * untrusted CSS that shares the Host document — it was never meant to
   * police a trusted Cardstack component's own compiled scoped CSS (Base,
   * Catalog, `@cardstack/*` packages like Boxel UI execute as Host-owned
   * portals outside Capsule confinement per "Trusted Cardstack components
   * are one-way portals" in docs/boxel-execution-runtime-architecture.md).
   * `isTrustedImport` — the same trust boundary the module-graph classifier
   * uses (boxel-source-classifier.ts) — exempts those requests; every
   * genuinely authored stylesheet still goes through the full policy.
   *
   * A rejection here means the placeholder cannot carry that declaration,
   * but per RP-8-adjacent (unsupported semantics fail atomically, never
   * silently) the rejection itself must stay observable: log it loudly
   * instead of disappearing into the outer best-effort catch. The
   * placeholder is inert and disposable — the live Boxel rendering that
   * supersedes it is classified independently (boxel-source-classifier.ts)
   * and, for network-bearing scoped CSS, renders in the Sandbox tier, where
   * the declaration is actually supported.
   */
  private async installPrerenderedStylesheet(href: string): Promise<void> {
    let request: string;
    try {
      request = validateSharedDocumentScopedCSSRequest(href, isTrustedImport);
    } catch (error) {
      console.error(
        `Boxel execution: dropped a prerendered placeholder stylesheet that failed the Capsule CSS policy (${href})`,
        error,
      );
      return;
    }
    await this.loaderService.loader.import(request);
  }

  invalidate(moduleIdentifier?: string): void {
    this.classifier?.invalidate(moduleIdentifier);
  }

  registerSurface(mode: BoxelExecutionMode, surfaceId: string): SurfaceHandle {
    return this.surfaceService.register({
      mode,
      principal: this.principal,
      surfaceId,
    });
  }

  releaseSurface(surface: SurfaceHandle): void {
    this.surfaceService.release(surface);
  }

  /**
   * Builds the explicit Host invocation boundary consumed as `@fields` by an
   * authored template. Trusted Base field components stay native. An authored
   * FieldDef receives a Host portal that routes its value through this same
   * execution engine instead of evaluating its renderer in the Host.
   */
  fieldPortalsFor(card: BaseDef): Promise<Record<string, BoxComponent>> {
    let existing = this.fieldPortalMaps.get(card);
    if (existing) {
      return existing;
    }
    let portals = this.buildFieldPortals(card);
    this.fieldPortalMaps.set(card, portals);
    void portals.catch(() => {
      if (this.fieldPortalMaps.get(card) === portals) {
        this.fieldPortalMaps.delete(card);
      }
    });
    return portals;
  }

  /**
   * Resolve a missing authored format to the real trusted Base implementation.
   *
   * The Capsule returns only an inert CodeRef marker. The Host then selects
   * the matching trusted ancestor component over the canonical Store-backed
   * instance, preserving Base's edit controls and mutation contexts without
   * giving the Capsule a live card, Loader, Store, or Ember service.
   */
  trustedBaseRenderSlotFor(
    card: BaseDef,
    requestedRef: CodeRef,
  ): DirectRenderSlot {
    let normalizedRef = normalizeCodeRef(requestedRef);
    let { name } = normalizedRef;
    switch (name) {
      case 'CardDef':
      case 'FieldDef':
      case 'FileDef':
        break;
      default:
        throw new Error(`Unsupported trusted Base format provider ${name}`);
    }
    if (!isTrustedModule(normalizedRef.module)) {
      throw new Error(
        `Refusing untrusted Host format provider ${normalizedRef.module}::${name}`,
      );
    }
    let componentProvider = this.trustedComponentProviderFor(card, name);
    return this.directBoxelRuntime.runtime.getRenderSlot(card, undefined, {
      componentCodeRef: requestedRef,
      componentProvider,
    });
  }

  /**
   * Selects the first trusted constructor in the authored card's ancestry.
   * Host fallback rendering must never invoke an overridable static through
   * the authored subclass: that would let a Capsule card choose a Direct
   * component. Matching an expected Base name additionally binds an inert
   * trusted-base CodeRef to the constructor that actually owns it.
   */
  private trustedComponentProviderFor(
    card: BaseDef,
    expectedName?: string,
  ): BaseDefConstructor {
    let current: BaseDefConstructor | undefined = card.constructor;
    while (current) {
      let identity = Loader.identify(current);
      if (
        identity &&
        isTrustedModule(identity.module) &&
        (!expectedName || identity.name === expectedName)
      ) {
        return current;
      }
      current = getAncestor(current);
    }
    throw new Error(
      `Could not resolve trusted Base component provider${
        expectedName ? ` ${expectedName}` : ''
      }`,
    );
  }

  private ensureExecutionEngine(): BoxelExecutionEngine {
    if (!this.engine) {
      this.classifier = new BoxelModuleGraphClassifier({
        loadSource: (identifier) => this.sourceFor(identifier),
        resolveImport: (specifier, relativeTo) =>
          this.network.resolveImport(
            specifier.startsWith('.')
              ? new URL(specifier, relativeTo).href
              : specifier,
          ),
        isTrustedModule: isTrustedImport,
      });
      let router = new BoxelRuntimeRouter(
        this.directBoxelRuntime.runtime,
        (principal) => this.createCapsule(principal),
        (surfaceIdentity) => this.createSandbox(surfaceIdentity),
      );
      this.router = router;
      let classifier = this.classifier;
      this.engine = new BoxelExecutionEngine(
        router,
        (moduleIdentifier, source) =>
          // `classify` is the module graph API, not Ember's String extension.
          // eslint-disable-next-line ember/no-string-prototype-extensions
          classifier.classify(moduleIdentifier, source),
        (moduleIdentifier) => this.isVolatile(moduleIdentifier),
      );
    }
    return this.engine;
  }

  private async buildFieldPortals(
    card: BaseDef,
  ): Promise<Record<string, BoxComponent>> {
    let api = await this.cardService.getAPI();
    let fields = api.getFields(card, {
      includeComputeds: true,
    }) as unknown as Record<string, Field<BaseDefConstructor>>;
    let rootComponent = this.directBoxelRuntime.runtime.getRenderSlot(
      card,
      undefined,
      { componentProvider: this.trustedComponentProviderFor(card) },
    ).component as unknown as Record<PropertyKey, unknown>;
    let authored = new Map<string, BoxComponent>();

    return new Proxy(Object.create(null) as Record<string, BoxComponent>, {
      get: (_target, property) => {
        if (typeof property !== 'string') {
          return Reflect.get(rootComponent, property);
        }
        let field = fields[property];
        if (!field) {
          return Reflect.get(rootComponent, property);
        }
        let identity = Loader.identify(field.card);
        if (identity && isTrustedModule(identity.module)) {
          return Reflect.get(rootComponent, property);
        }
        let portal = authored.get(property);
        if (!portal) {
          let cell = this.instanceVersionCellFor(card, api);
          portal = createBoxelFieldPortal(
            // A PATH, never a captured value (RP-20.2, main's Box): the
            // portal re-reads the canonical instance per render. The version
            // cell is composed in for the same reason as the live model's
            // reads — `peekAtField` tracks a TrackedArray's items but not
            // the field SLOT, so a save echo that replaces the whole array
            // would otherwise freeze the portal.
            () => {
              void cell.v;
              return api.peekAtField(card, property);
            },
            executionRelativeTo(card),
            // RP-11.5: the portal re-stamps field-component.gts's DOM
            // contract (ElementTracker registration + data attributes),
            // which needs the field's identity — without it, overlays
            // cannot classify the entry (linksTo vs linksToMany vs
            // contains) and operator-mode adornments skip the card.
            {
              fieldType: field.fieldType,
              fieldName: field.name,
              isComputed: Boolean(field.computeVia),
            },
            // Main's Box.set, granted per RP-9.1's own rule (computed
            // fields are never writable): assignment funnels through
            // RP-9.2's one setField path — notify → autosave — so a
            // Capsule editor's set effect is the same write a trusted Base
            // editor performs.
            field.computeVia
              ? undefined
              : (value) => {
                  (card as unknown as Record<string, unknown>)[property] =
                    value;
                },
            field.fieldType === 'linksTo' || field.fieldType === 'linksToMany'
              ? {
                  broken: (index) => {
                    let member = api.getRelationshipMembershipState(
                      card as CardDef,
                      property,
                    ).membership?.[index];
                    return member?.kind === 'error' ||
                      member?.kind === 'not-found'
                      ? member
                      : undefined;
                  },
                }
              : undefined,
          );
          authored.set(property, portal);
        }
        return portal;
      },
      getOwnPropertyDescriptor: (_target, property) =>
        typeof property === 'string' && property in fields
          ? { configurable: true, enumerable: true }
          : undefined,
      has: (_target, property) =>
        typeof property === 'string' && property in fields,
      ownKeys: () => Object.keys(fields),
    });
  }

  private createCapsule(principal: string): CapsuleBoxelRuntime {
    let evaluator = new CapsuleModuleEvaluator(principal, {
      fetch: this.network.authedFetch,
      resolveImport: this.network.resolveImport,
      virtualNetwork: this.network.virtualNetwork,
      isTrustedImport,
      validateInlineStyle: validateCapsuleInlineStyle,
    });
    return new CapsuleBoxelRuntime(evaluator, (identifier) =>
      this.loaderService.loader.import<Record<string, unknown>>(identifier),
    );
  }

  /**
   * Constructs the process object only — no iframe is created or appended
   * here. RP-15.3: a live iframe is never re-parented, and this factory
   * runs (via the runtime router) before any presentation slot element
   * exists to mount into. `SandboxRuntimeProcess` creates its own iframe
   * lazily, detached, and only inserts it into the document once — from
   * `mount(element)`, called by the presentation slot modifier with its
   * own, permanent slot element as the target.
   */
  private createSandbox(surfaceIdentity: string): SandboxRuntimeProcess {
    if (typeof document === 'undefined') {
      throw new Error('Sandbox rendering requires a browser document');
    }
    let isolationMode = sandboxIframeIsolationMode();
    // Parent-side counterpart of the child's own boot breadcrumbs
    // ([sandbox-child] route model resolved / listening posted): a Sandbox
    // process being created more than once for the same surface in quick
    // succession is the signature of a remint loop (a renderer resource
    // re-instantiating on every tick of some tracked state), and only this
    // side knows the surface identity that ties the boots together.
    console.debug('[sandbox-parent] process created', {
      surfaceId: surfaceIdentity,
      isolationMode,
      priorCreationsThisSession: this.sandboxCreationCount++,
    });
    let childURL = this.sandboxChildURL;
    return new SandboxRuntimeProcess({
      childURL,
      childOrigin: new URL(childURL).origin,
      fetch: this.network.authedFetch,
      resolveModuleURL: (identifier) =>
        this.resolveSandboxModuleURL(identifier),
      // Host-trusted imports and the exact BXL prototype compatibility entry
      // are both readable inside the origin-isolated child. The latter is
      // deliberately NOT part of isTrustedImport: it executes only in the
      // Sandbox and never becomes a Direct/Capsule Host portal.
      isTrustedModuleURL: (identifier) =>
        isTrustedImport(identifier) || isImplicitSandboxModule(identifier),
      surfaceService: this.surfaceService,
      identity: {
        mode: 'sandbox',
        principal: this.principal,
        surfaceId: surfaceIdentity,
      },
      keepRenderDiagnostics: boxelExecutionPerformanceEnabled(),
      isolationMode,
    });
  }

  private get sandboxChildURL(): string {
    if (typeof globalThis.location === 'undefined') {
      throw new Error('Boxel Sandbox runtime origin is not configured');
    }
    let origin = allocateSandboxRuntimeOrigin(
      config.boxelSandboxRuntimeURL,
      globalThis.location.origin,
      newSandboxRuntimeNonce(),
    );
    if (origin) {
      return new URL('/_boxel-sandbox-runtime', origin).href;
    }
    throw new Error('Boxel Sandbox runtime origin is not configured');
  }

  private get principal(): string {
    try {
      return this.matrixService.userId ?? 'anonymous';
    } catch {
      return 'anonymous';
    }
  }

  private async sourceFor(moduleIdentifier: string): Promise<string> {
    // A shim's executable identity is already installed in the Host Loader.
    // It has no independent realm source to fetch (and Direct is the only
    // runtime allowed to consume it), but the RP classifier still needs a
    // deterministic inert input so the request follows the same pipeline.
    if (this.loaderService.loader.isShimmedModule(moduleIdentifier)) {
      return `// Host-defined shim: ${moduleIdentifier}`;
    }
    let load = () =>
      this.cardService.getSource(moduleIdentifier as RealmResourceIdentifier);
    let result = await (this.isDedicatedPrerenderApp()
      ? load()
      : withReauthenticationAllowed(load));
    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `Unable to load Boxel source ${moduleIdentifier} (${result.status})`,
      );
    }
    return result.content;
  }

  private isDedicatedPrerenderApp(): boolean {
    return Boolean(
      (globalThis as { __boxelPrerenderApp?: unknown }).__boxelPrerenderApp,
    );
  }

  /**
   * Inline FieldDefs and freshly constructed Boxels do not always pass
   * through Store deserialization, so they may lack both a persisted id and
   * Base's local identity. Base serialization requires one of those
   * identities in order to produce valid JSON:API. Restore only the missing
   * framework metadata; no authored field or Store state is changed.
   */
  private ensureLocalIdentity(card: BaseDef): void {
    if (
      ('id' in card && typeof card.id === 'string') ||
      typeof (card as BaseDef & { [localId]?: unknown })[localId] === 'string'
    ) {
      return;
    }
    Object.defineProperty(card, localId, {
      configurable: false,
      enumerable: false,
      value: `boxel-execution-local-${++this.nextLocalBoxel}`,
    });
  }

  private resolveSandboxModuleURL(moduleIdentifier: string): string {
    try {
      return this.network.virtualNetwork.toRealURLHref(
        this.network.resolveImport(moduleIdentifier),
      );
    } catch {
      // A graph may include a framework shim or another non-URL identifier.
      // Such entries are handled inside VirtualNetwork and never reach the
      // Host fetch broker, so retaining the original spelling is sufficient.
      return moduleIdentifier;
    }
  }

  private destroyEngine(): void {
    this.engine?.destroy();
    this.engine = undefined;
    this.classifier = undefined;
    this.router = undefined;
  }
}

type BoundaryQueryRequest = { realms: string[]; query: Query };

/**
 * Resolve a query field without depending on its render-lifetime modifier.
 *
 * New Base versions expose this operation directly. The compatibility path
 * deliberately uses only the same stable Boxel field metadata and
 * runtime-common normalizer, so a locally-built Host can still execute cards
 * against an older deployed Base realm. Remove it only after the oldest Base
 * version the Host supports has the explicit operation.
 */
function resolveBoundaryQueryFieldRequest(
  store: StoreService,
  instance: BaseDef,
  field: Field<BaseDefConstructor>,
  api: typeof import('@cardstack/base/card-api'),
): BoundaryQueryRequest | undefined {
  let explicitResolver = (
    api as typeof api & {
      resolveQueryFieldRequest?: (
        store: StoreService,
        instance: BaseDef,
        field: Field<BaseDefConstructor>,
      ) => BoundaryQueryRequest | undefined;
    }
  ).resolveQueryFieldRequest;
  if (typeof explicitResolver === 'function') {
    return explicitResolver(store, instance, field);
  }

  let realm = (instance as BaseDef & { [realmURLSymbol]?: URL })[
    realmURLSymbol
  ];
  let fieldOrCard = identifyCard(field.card);
  if (!realm || !fieldOrCard || !field.queryDefinition) {
    return undefined;
  }
  let fieldDefinition: FieldDefinition = {
    type: field.fieldType,
    isPrimitive: false,
    isComputed: Boolean(field.computeVia),
    fieldOrCard,
  };
  let fieldPath = field.name.includes('.')
    ? field.name.slice(0, field.name.lastIndexOf('.'))
    : undefined;
  let normalized = normalizeQueryDefinition({
    fieldDefinition,
    queryDefinition: field.queryDefinition,
    realmURL: realm,
    fieldName: field.name,
    fieldPath,
    resolvePathValue: (path) => resolveInstancePathValue(instance, path),
    relativeTo:
      'id' in instance && typeof instance.id === 'string'
        ? rri(instance.id)
        : realm,
  });
  return normalized
    ? { realms: normalized.realms, query: normalized.query }
    : undefined;
}

async function primeBoundaryQueryField(
  instance: BaseDef,
  field: Field<BaseDefConstructor>,
  instances: CardDef[],
  api: typeof import('@cardstack/base/card-api'),
  store: StoreService,
): Promise<void> {
  let explicitPrimer = (
    api as typeof api & {
      primeQueryFieldSearchResource?: (
        store: StoreService,
        instance: BaseDef,
        field: Field<BaseDefConstructor>,
        instances: CardDef[],
      ) => Promise<void>;
    }
  ).primeQueryFieldSearchResource;
  if (typeof explicitPrimer === 'function') {
    await explicitPrimer(store, instance, field, instances);
    return;
  }
  // Older Base versions serialize relationship membership from this bucket.
  // This is a bounded data snapshot, never a Store or SearchResource crossing
  // the execution boundary.
  api.getDataBucket(instance).set(field.name, instances);
}

/**
 * Turn a Host-resolved query into an explicit, bounded relationship grant.
 *
 * Ordinary linksToMany serialization uses `field.0`, `field.1`, ... entries.
 * That shape describes authored links, but it does not tell a receiving Store
 * that an empty (or partial) list is the authoritative result of a query. The
 * umbrella relationship is the existing Boxel query wire shape: `data` is the
 * complete membership and `links.search` records which Host-owned query
 * produced it. A boundary-local Store consumes the included cards as a seed;
 * it never receives the Host Store or permission to execute the search.
 */
function applyHostBoundaryQuerySeeds(
  root: BaseDef,
  document: LooseSingleCardDocument,
  seeds: HostBoundaryQuerySeed[],
  api: typeof import('@cardstack/base/card-api'),
  normalizeId: (id: string) => string,
): void {
  for (let seed of seeds) {
    let resource = resourceForBoundaryQuerySeed(
      root,
      seed.instance,
      document,
      normalizeId,
    );
    if (!resource) {
      continue;
    }
    let fieldName = boundaryQueryFieldName(root, seed, api);
    let relationships = (resource.relationships ??= {});
    let prefix = `${fieldName}.`;
    for (let relationshipName of Object.keys(relationships)) {
      let suffix = relationshipName.slice(prefix.length);
      if (relationshipName.startsWith(prefix) && /^\d+$/.test(suffix)) {
        delete relationships[relationshipName];
      }
    }
    relationships[fieldName] = {
      links: { self: null, search: seed.searchURL },
      data: seed.values.map((value) => {
        if (typeof value.id === 'string' && value.id.length > 0) {
          return { type: 'card' as const, id: value.id };
        }
        return { type: 'card' as const, lid: value[localId] };
      }),
    };
  }
}

function resourceForBoundaryQuerySeed(
  root: BaseDef,
  instance: BaseDef,
  document: LooseSingleCardDocument,
  normalizeId: (id: string) => string,
): LooseCardResource | undefined {
  if (instance === root || typeof (instance as CardDef).id !== 'string') {
    return document.data;
  }
  let id = normalizeId((instance as CardDef).id);
  return [document.data, ...(document.included ?? [])].find(
    (resource): resource is LooseCardResource =>
      resource.type === 'card' &&
      typeof resource.id === 'string' &&
      normalizeId(resource.id) === id,
  );
}

function boundaryQueryFieldName(
  root: BaseDef,
  seed: HostBoundaryQuerySeed,
  api: typeof import('@cardstack/base/card-api'),
): string {
  if (
    seed.instance === root ||
    typeof (seed.instance as CardDef).id === 'string'
  ) {
    return seed.fieldName;
  }
  return (
    containedInstancePath(root, seed.instance, api)
      ?.concat(seed.fieldName)
      .join('.') ?? seed.fieldName
  );
}

function containedInstancePath(
  current: BaseDef,
  target: BaseDef,
  api: typeof import('@cardstack/base/card-api'),
  seen = new WeakSet<object>(),
): string[] | undefined {
  if (current === target) {
    return [];
  }
  if (seen.has(current)) {
    return undefined;
  }
  seen.add(current);
  let fields = api.getFields(current, { includeComputeds: false }) as Record<
    string,
    Field<BaseDefConstructor>
  >;
  for (let [fieldName, field] of Object.entries(fields)) {
    if (field.fieldType !== 'contains' && field.fieldType !== 'containsMany') {
      continue;
    }
    let value = api.peekAtField(current, fieldName);
    let entries =
      field.fieldType === 'containsMany' && Array.isArray(value)
        ? value.map((entry, index) => ({
            entry,
            path: [fieldName, String(index)],
          }))
        : [{ entry: value, path: [fieldName] }];
    for (let { entry, path } of entries) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      let nested = containedInstancePath(entry as BaseDef, target, api, seen);
      if (nested) {
        return [...path, ...nested];
      }
    }
  }
  return undefined;
}

function resolveInstancePathValue(instance: BaseDef, path: string): unknown {
  let current: unknown = instance;
  for (let segment of path.split('.')) {
    if (current == null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

async function recordExecutionPromise<T>(
  performance: BoxelExecutionPerformanceContext,
  stage: BoxelExecutionStage,
  promise: Promise<T>,
): Promise<T> {
  let token = startBoxelExecutionStage({ ...performance, stage });
  try {
    let value = await promise;
    token.finish();
    return value;
  } catch (error) {
    token.finish({ status: 'error' });
    throw error;
  }
}

function executionRelativeTo(
  card: BaseDef,
): RealmResourceIdentifier | undefined {
  let inheritedBase = card[relativeToSymbol];
  if (inheritedBase instanceof URL) {
    return inheritedBase.href as RealmResourceIdentifier;
  }
  if (inheritedBase) {
    return inheritedBase;
  }
  return 'id' in card && typeof card.id === 'string'
    ? (card.id as RealmResourceIdentifier)
    : undefined;
}

declare module '@ember/service' {
  interface Registry {
    'boxel-execution': BoxelExecutionService;
  }
}
