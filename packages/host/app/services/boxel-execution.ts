import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { TrackedObject } from 'tracked-built-ins';

import {
  isCssResource,
  isHtmlResource,
  Loader,
  localId,
  normalizeCodeRef,
  relativeTo as relativeToSymbol,
  type CodeRef,
  type JSONValue,
  type LooseSingleCardDocument,
  type PrerenderedHtmlFormat,
  type RealmResourceIdentifier,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import { createBoxelFieldPortal } from '@cardstack/host/components/boxel-field-portal';
import config from '@cardstack/host/config/environment';
import BoxelExecutionEngine, {
  type BoxelExecutionRequest,
  type BoxelExecutionSession,
} from '@cardstack/host/lib/boxel-execution-engine';
import {
  createLiveBoxelModel,
  projectBoxelExecutionDocument,
  projectHostBoxelSemantics,
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
import SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';
import {
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
  Field,
  Format,
} from '@cardstack/base/card-api';

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
  private nextLocalBoxel = 0;
  private sandboxCreationCount = 0;
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
  ): { process: SandboxRuntimeProcess; release: () => void } | undefined {
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
      prefersFullSandbox: false,
      volatile,
    });
    if (lease.runtime.mode !== 'sandbox') {
      lease.release();
      return undefined;
    }
    return {
      process: lease.runtime as SandboxRuntimeProcess,
      release: lease.release,
    };
  }

  async requestFor(
    card: BaseDef,
    format: Format | undefined,
    surfaceId: string,
    relativeTo?: RealmResourceIdentifier,
  ): Promise<BoxelExecutionRequest> {
    let identity = Loader.identify(card.constructor);
    if (!identity) {
      throw new Error('Cannot execute a Boxel whose module is unidentified');
    }
    let moduleIdentifier = identity.module;
    this.ensureLocalIdentity(card);
    let [source, document, api] = await Promise.all([
      this.sourceFor(moduleIdentifier),
      this.cardService.serializeCard(card as never, {
        withIncluded: true,
        // Execution documents cross Loader and process boundaries. Keep type
        // identities absolute so a side-loaded card from another directory or
        // realm cannot accidentally rebase its adoptsFrom module against the
        // primary card when the receiving runtime deserializes it.
        useAbsoluteURL: true,
      }),
      this.cardService.getAPI(),
    ]);
    // Captured for the synchronous live-model reads (`liveModelFor`) —
    // every render that needs it necessarily passed through here first.
    this.cardAPI = api;
    if (!document.data) {
      throw new Error('Cannot execute a Boxel without a serialized resource');
    }
    let projectedDocument = projectBoxelExecutionDocument(
      card,
      document as LooseSingleCardDocument,
      api,
      isTrustedModule,
    );
    return {
      principal: this.principal,
      surfaceId,
      trusted: isTrustedModule(moduleIdentifier),
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
      hostProjection: projectHostBoxelSemantics(card, api, {
        unresolveURL: (url) => this.network.virtualNetwork.unresolveURL(url),
        ensureRelationshipLoaded: (reference) => this.store.get(reference),
      }),
    };
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
        return htmlComponent(
          `<div data-boxel-prerender-placeholder>${rendering.attributes.html!}</div>`,
        );
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
    let { name } = normalizeCodeRef(requestedRef);
    switch (name) {
      case 'CardDef':
      case 'FieldDef':
      case 'FileDef':
        break;
      default:
        throw new Error(`Unsupported trusted Base format provider ${name}`);
    }
    return this.directBoxelRuntime.runtime.getRenderSlot(card, undefined, {
      componentCodeRef: requestedRef,
    });
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
    let rootComponent = this.directBoxelRuntime.runtime.getRenderSlot(card)
      .component as unknown as Record<PropertyKey, unknown>;
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
          portal = createBoxelFieldPortal(
            api.peekAtField(card, property),
            executionRelativeTo(card),
            // RP-11.5: the portal re-stamps field-component.gts's DOM
            // contract (ElementTracker registration + data attributes),
            // which needs the field's identity — without it, overlays
            // cannot classify the entry (linksTo vs linksToMany vs
            // contains) and operator-mode adornments skip the card.
            { fieldType: field.fieldType, fieldName: field.name },
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
    // Parent-side counterpart of the child's own boot breadcrumbs
    // ([sandbox-child] route model resolved / listening posted): a Sandbox
    // process being created more than once for the same surface in quick
    // succession is the signature of a remint loop (a renderer resource
    // re-instantiating on every tick of some tracked state), and only this
    // side knows the surface identity that ties the boots together.
    console.warn('[sandbox-parent] process created', {
      surfaceId: surfaceIdentity,
      priorCreationsThisSession: this.sandboxCreationCount++,
    });
    let childURL = this.sandboxChildURL;
    return new SandboxRuntimeProcess({
      childURL,
      childOrigin: new URL(childURL).origin,
      fetch: this.network.authedFetch,
      resolveModuleURL: (identifier) =>
        this.resolveSandboxModuleURL(identifier),
      isTrustedModuleURL: isTrustedImport,
      surfaceService: this.surfaceService,
      identity: {
        mode: 'sandbox',
        principal: this.principal,
        surfaceId: surfaceIdentity,
      },
    });
  }

  private get sandboxChildURL(): string {
    let configured = config.boxelSandboxRuntimeURL;
    if (typeof configured === 'string' && configured.length > 0) {
      return new URL('/_boxel-sandbox-runtime', configured).href;
    }
    if (typeof globalThis.location === 'undefined') {
      throw new Error('Boxel Sandbox runtime origin is not configured');
    }
    let local = new URL(globalThis.location.href);
    if (local.hostname === 'localhost') {
      local.hostname = 'user.localhost';
      local.pathname = '/_boxel-sandbox-runtime';
      local.search = '';
      local.hash = '';
      return local.href;
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
    let result = await this.cardService.getSource(
      moduleIdentifier as RealmResourceIdentifier,
    );
    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `Unable to load Boxel source ${moduleIdentifier} (${result.status})`,
      );
    }
    return result.content;
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
