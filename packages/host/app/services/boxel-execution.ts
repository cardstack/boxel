import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  isCssResource,
  isHtmlResource,
  Loader,
  localId,
  normalizeCodeRef,
  relativeTo as relativeToSymbol,
  type CodeRef,
  type LooseSingleCardDocument,
  type PrerenderedHtmlFormat,
  type RealmResourceIdentifier,
  type SurfaceHandle,
} from '@cardstack/runtime-common';
import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import { createBoxelFieldPortal } from '@cardstack/host/components/boxel-field-portal';
import config from '@cardstack/host/config/environment';
import BoxelExecutionEngine, {
  type BoxelExecutionRequest,
  type BoxelExecutionSession,
} from '@cardstack/host/lib/boxel-execution-engine';
import type { BoxelExecutionMode } from '@cardstack/host/lib/boxel-runtime';
import BoxelRuntimeRouter from '@cardstack/host/lib/boxel-runtime-router';
import { BoxelModuleGraphClassifier } from '@cardstack/host/lib/boxel-source-classifier';
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
  private fieldPortalMaps = new WeakMap<
    BaseDef,
    Promise<Record<string, BoxComponent>>
  >();
  private nextSurface = 0;
  private nextLocalBoxel = 0;

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
    let resource = document.data;
    if (!resource) {
      throw new Error('Cannot execute a Boxel without a serialized resource');
    }
    projectTrustedBoxelSemantics(
      card,
      resource.attributes ?? (resource.attributes = {}),
      api,
      (identifier) => this.isTrustedModule(identifier),
    );
    return {
      principal: this.principal,
      surfaceId,
      trusted: this.isTrustedModule(moduleIdentifier),
      format: format ?? 'isolated',
      moduleIdentifier,
      source,
      resource,
      document: document as LooseSingleCardDocument,
      relativeTo: relativeTo ?? executionRelativeTo(card),
      purpose: format === 'edit' ? 'interactive-edit' : 'host-display',
      canonicalCard: card,
    };
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

    // The indexed prerender channel stores the four composable formats. An
    // isolated or edit surface uses embedded as its inert handoff image; the
    // live renderer still receives and renders the exact requested format.
    let requestedFormat: PrerenderedHtmlFormat =
      format === 'fitted' || format === 'atom' || format === 'head'
        ? format
        : 'embedded';
    let formats = [requestedFormat] as const;

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
          styleHrefs.map((href) =>
            this.loaderService.loader.import(
              validateSharedDocumentScopedCSSRequest(href),
            ),
          ),
        );
        return htmlComponent(rendering.attributes.html!);
      } catch {
        // A missing or stale prerender must never delay or fail live execution.
      }
    }
    return undefined;
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

  parkSandboxIframe(iframe: HTMLIFrameElement): void {
    if (typeof document === 'undefined') {
      return;
    }
    this.parkingElement.append(iframe);
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
        isTrustedModule: (identifier) => this.isTrustedImport(identifier),
      });
      let router = new BoxelRuntimeRouter(
        this.directBoxelRuntime.runtime,
        (principal) => this.createCapsule(principal),
        (surfaceIdentity) => this.createSandbox(surfaceIdentity),
      );
      let classifier = this.classifier;
      this.engine = new BoxelExecutionEngine(
        router,
        (moduleIdentifier, source) =>
          // `classify` is the module graph API, not Ember's String extension.
          // eslint-disable-next-line ember/no-string-prototype-extensions
          classifier.classify(moduleIdentifier, source),
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
        if (identity && this.isTrustedModule(identity.module)) {
          return Reflect.get(rootComponent, property);
        }
        let portal = authored.get(property);
        if (!portal) {
          portal = createBoxelFieldPortal(
            api.peekAtField(card, property),
            executionRelativeTo(card),
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
      isTrustedImport: (identifier) => this.isTrustedImport(identifier),
      validateInlineStyle: validateCapsuleInlineStyle,
    });
    return new CapsuleBoxelRuntime(evaluator, (identifier) =>
      this.loaderService.loader.import<Record<string, unknown>>(identifier),
    );
  }

  private createSandbox(surfaceIdentity: string): SandboxRuntimeProcess {
    if (typeof document === 'undefined') {
      throw new Error('Sandbox rendering requires a browser document');
    }
    let iframe = document.createElement('iframe');
    iframe.className = 'boxel-sandbox-process';
    iframe.title = 'Boxel Sandbox';
    this.parkingElement.append(iframe);
    let childURL = this.sandboxChildURL;
    return new SandboxRuntimeProcess({
      iframe,
      childURL,
      childOrigin: new URL(childURL).origin,
      fetch: this.network.authedFetch,
      resolveModuleURL: (identifier) =>
        this.resolveSandboxModuleURL(identifier),
      isTrustedModuleURL: (identifier) => this.isTrustedImport(identifier),
      surfaceService: this.surfaceService,
      identity: {
        mode: 'sandbox',
        principal: this.principal,
        surfaceId: surfaceIdentity,
      },
    });
  }

  private get parkingElement(): HTMLElement {
    let existing = document.querySelector<HTMLElement>(
      '[data-boxel-sandbox-processes]',
    );
    if (existing) {
      return existing;
    }
    let element = document.createElement('div');
    element.dataset.boxelSandboxProcesses = '';
    // A Sandbox process must stay connected and renderable while it boots and
    // while Glimmer moves its iframe between presentation slots. `hidden`
    // would apply `display: none`, which can suspend layout/observers inside
    // the child and deadlock the handshake that makes the slot available.
    // Keep the parking lot active but outside the visible and interactive UI.
    Object.assign(element.style, {
      position: 'fixed',
      inset: '0 auto auto 0',
      width: '0',
      height: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      visibility: 'hidden',
    });
    document.body.append(element);
    return element;
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

  private isTrustedModule(moduleIdentifier: string): boolean {
    return (
      moduleIdentifier.startsWith('@cardstack/') ||
      moduleIdentifier.startsWith(`${PACKAGES_FAKE_ORIGIN}@cardstack/`) ||
      isURLWithin(moduleIdentifier, 'https://cardstack.com/base/') ||
      isURLWithin(moduleIdentifier, config.resolvedBaseRealmURL)
    );
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

  private isTrustedImport(moduleIdentifier: string): boolean {
    return (
      this.isTrustedModule(moduleIdentifier) ||
      isURLWithin(moduleIdentifier, 'https://cardstack.com/catalog/') ||
      (config.resolvedCatalogRealmURL !== undefined &&
        isURLWithin(moduleIdentifier, config.resolvedCatalogRealmURL)) ||
      isURLWithin(moduleIdentifier, config.iconsURL) ||
      moduleIdentifier === '@ember/component' ||
      moduleIdentifier === '@ember/object' ||
      moduleIdentifier === '@ember/helper' ||
      moduleIdentifier === '@ember/modifier' ||
      moduleIdentifier === '@ember/component/template-only' ||
      moduleIdentifier === '@ember/template-factory' ||
      moduleIdentifier === '@glimmer/component' ||
      moduleIdentifier === '@glimmer/tracking' ||
      moduleIdentifier === 'ember-provide-consume-context' ||
      moduleIdentifier === '@cardstack/runtime-common'
    );
  }

  private destroyEngine(): void {
    this.engine?.destroy();
    this.engine = undefined;
    this.classifier = undefined;
    if (typeof document !== 'undefined') {
      document
        .querySelector<HTMLElement>('[data-boxel-sandbox-processes]')
        ?.remove();
    }
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

/**
 * Add JSON-safe semantics supplied by trusted Boxel types to the bounded
 * execution snapshot. Authored getters and computeVia functions still execute
 * only in their selected runtime; this walk merely lets nested trusted Base
 * values retain public getter semantics such as CurrencyField.symbol.
 *
 * The Store-backed instance never crosses the boundary. Only values whose
 * constructors resolve to a trusted module are evaluated, and only cloneable
 * results are copied into the request document.
 */
function projectTrustedBoxelSemantics(
  boxel: BaseDef,
  snapshot: Record<string, unknown>,
  api: typeof import('@cardstack/base/card-api'),
  isTrustedModule: (identifier: string) => boolean,
  visited = new WeakSet<object>(),
  declaredType?: BaseDefConstructor,
): void {
  if (visited.has(boxel)) {
    return;
  }
  visited.add(boxel);

  let fields = (
    declaredType
      ? api.getFields(declaredType, { includeComputeds: false })
      : api.getFields(boxel, { includeComputeds: false })
  ) as Record<string, Field<BaseDefConstructor>>;
  for (let [fieldName, field] of Object.entries(fields)) {
    if (field.fieldType !== 'contains' && field.fieldType !== 'containsMany') {
      continue;
    }
    let projectedValue = snapshot[fieldName];
    let liveValue: unknown;
    if (declaredType) {
      // Trusted nested projection uses a deliberately inert receiver rather
      // than a live Base instance. Its own values are the bounded snapshot;
      // asking Base to peek can throw for declared defaults that are absent.
      liveValue = snapshot[fieldName];
    } else {
      liveValue = api.peekAtField(boxel, fieldName) as unknown;
    }
    if (field.fieldType === 'containsMany') {
      if (!Array.isArray(liveValue) || !Array.isArray(projectedValue)) {
        continue;
      }
      for (let [index, entry] of liveValue.entries()) {
        projectNestedBoxelSemantics(
          entry,
          projectedValue[index],
          field.card,
          api,
          isTrustedModule,
          visited,
        );
      }
    } else {
      projectNestedBoxelSemantics(
        liveValue,
        projectedValue,
        field.card,
        api,
        isTrustedModule,
        visited,
      );
    }
  }
}

function projectNestedBoxelSemantics(
  boxel: unknown,
  snapshot: unknown,
  boxelType: BaseDefConstructor,
  api: typeof import('@cardstack/base/card-api'),
  isTrustedModule: (identifier: string) => boolean,
  visited: WeakSet<object>,
): void {
  if (
    !boxel ||
    typeof boxel !== 'object' ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return;
  }
  // Field metadata is the canonical type identity. Values produced by Base
  // deserialization may be wrapped or subclassed, so their runtime
  // `constructor` is not a reliable Loader lookup key.
  let identity = Loader.identify(boxelType);
  let projected = snapshot as Record<string, unknown>;
  if (!identity || !isTrustedModule(identity.module)) {
    // Authored FieldDefs are structural waypoints, not trusted semantic
    // owners. Traverse their declared contained fields so trusted Base values
    // below them are not pruned, but never evaluate an authored getter or
    // computeVia in the Host.
    projectTrustedBoxelSemantics(
      boxel as BaseDef,
      projected,
      api,
      isTrustedModule,
      visited,
    );
    return;
  }
  // Evaluate trusted Base semantics against the bounded snapshot itself. A
  // deserialized nested value can be a wrapper whose own constructor is not
  // the declared Field type; the field prototype is the stable semantic
  // contract. Do not run its constructor or pass the live Store object.
  let receiver = Object.create(boxelType.prototype) as Record<string, unknown>;
  for (let [name, value] of Object.entries(projected)) {
    // Define inert own data directly. Assignment would invoke Base's field
    // setters and reject the intentionally plain nested boundary records.
    Object.defineProperty(receiver, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  projectTrustedBoxelSemantics(
    receiver as unknown as BaseDef,
    projected,
    api,
    isTrustedModule,
    visited,
    boxelType,
  );
  projectTrustedGetters(receiver, boxelType, projected, isTrustedModule);
}

function projectTrustedGetters(
  boxel: object,
  boxelType: BaseDefConstructor,
  snapshot: Record<string, unknown>,
  isTrustedModule: (identifier: string) => boolean,
): void {
  let prototype = boxelType.prototype as object | null;
  let declaredType: BaseDefConstructor | undefined = boxelType;
  while (prototype && prototype !== Object.prototype) {
    let constructor = (prototype as { constructor?: { prototype?: object } })
      .constructor;
    let identity =
      (declaredType ? Loader.identify(declaredType) : undefined) ??
      (constructor ? Loader.identify(constructor) : undefined);
    if (!identity || !isTrustedModule(identity.module)) {
      break;
    }
    for (let name of Object.getOwnPropertyNames(prototype)) {
      if (
        name === 'constructor' ||
        Object.prototype.hasOwnProperty.call(snapshot, name)
      ) {
        continue;
      }
      let getter = Object.getOwnPropertyDescriptor(prototype, name)?.get;
      if (!getter) {
        continue;
      }
      try {
        let projected = cloneBoundaryValue(getter.call(boxel));
        if (projected !== boundaryValueUnavailable) {
          snapshot[name] = projected;
        }
      } catch {
        // One optional trusted getter must not erase independent semantics.
      }
    }
    declaredType = undefined;
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
}

const boundaryValueUnavailable = Symbol('boundary-value-unavailable');

function cloneBoundaryValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown | typeof boundaryValueUnavailable {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined) {
    return boundaryValueUnavailable;
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return boundaryValueUnavailable;
  }
  if (Loader.identify(value.constructor)) {
    return boundaryValueUnavailable;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    let result: unknown[] = [];
    for (let item of value) {
      let projected = cloneBoundaryValue(item, seen);
      if (projected === boundaryValueUnavailable) {
        return boundaryValueUnavailable;
      }
      result.push(projected);
    }
    return result;
  }
  let result: Record<string, unknown> = {};
  for (let [key, item] of Object.entries(value)) {
    let projected = cloneBoundaryValue(item, seen);
    if (projected !== boundaryValueUnavailable) {
      result[key] = projected;
    }
  }
  return result;
}

function isURLWithin(identifier: string, root: string): boolean {
  try {
    let candidate = new URL(identifier);
    let boundary = new URL(root);
    if (candidate.origin !== boundary.origin) {
      return false;
    }
    let boundaryPath = boundary.pathname.endsWith('/')
      ? boundary.pathname
      : `${boundary.pathname}/`;
    return (
      candidate.pathname === boundaryPath.slice(0, -1) ||
      candidate.pathname.startsWith(boundaryPath)
    );
  } catch {
    return false;
  }
}

declare module '@ember/service' {
  interface Registry {
    'boxel-execution': BoxelExecutionService;
  }
}
