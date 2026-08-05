import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  isCssResource,
  isHtmlResource,
  Loader,
  localId,
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
import type { BoxelExecutionMode } from '@cardstack/host/lib/boxel-runtime';
import BoxelRuntimeRouter from '@cardstack/host/lib/boxel-runtime-router';
import { BoxelModuleGraphClassifier } from '@cardstack/host/lib/boxel-source-classifier';
import CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import { validateCapsuleInlineStyle } from '@cardstack/host/lib/capsule-css-policy';
import CapsuleModuleEvaluator from '@cardstack/host/lib/capsule-module-evaluator';
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
    let source = await this.sourceFor(moduleIdentifier);
    this.ensureLocalIdentity(card);
    let document = await this.cardService.serializeCard(card as never, {
      withIncluded: true,
      includeComputeds: true,
      includeUnrenderedFields: true,
    });
    let resource = document.data;
    if (!resource) {
      throw new Error('Cannot execute a Boxel without a serialized resource');
    }
    return {
      principal: this.principal,
      surfaceId,
      trusted: this.isTrustedModule(moduleIdentifier),
      format: format ?? 'isolated',
      moduleIdentifier,
      source,
      resource,
      document: document as LooseSingleCardDocument,
      relativeTo:
        relativeTo ??
        ('id' in card && typeof card.id === 'string'
          ? (card.id as RealmResourceIdentifier)
          : undefined),
      purpose: format === 'edit' ? 'interactive-edit' : 'host-display',
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
          styleHrefs.map((href) => this.loaderService.loader.import(href)),
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
            'id' in card && typeof card.id === 'string'
              ? (card.id as RealmResourceIdentifier)
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
      moduleIdentifier.startsWith('@cardstack/base/') ||
      isURLWithin(moduleIdentifier, 'https://cardstack.com/catalog/') ||
      (config.resolvedCatalogRealmURL !== undefined &&
        isURLWithin(moduleIdentifier, config.resolvedCatalogRealmURL)) ||
      moduleIdentifier.startsWith('@cardstack/catalog/') ||
      moduleIdentifier.startsWith('@cardstack/boxel-icons/') ||
      isURLWithin(moduleIdentifier, config.iconsURL) ||
      moduleIdentifier.startsWith('@cardstack/boxel-ui/') ||
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
