import { setComponentTemplate } from '@ember/component';
import type Owner from '@ember/owner';
import { next } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { createTemplateFactory } from '@ember/template-factory';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  type CodeRef,
  isResolvedCodeRef,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type Relationship,
  type RealmResourceIdentifier,
  SupportedMimeType,
  decodeScopedCSSRequest,
  realmURL as realmURLSymbol,
  rri,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import type CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';
import RealmCompartmentModuleRuntime, {
  sandboxRealmURLArgument,
  type SandboxCardFieldMetadata,
  type SandboxCardTypeMetadata,
  type SandboxScopeReference,
  type SandboxTemplateBundle,
  type SandboxTrustedExportIdentity,
} from '@cardstack/host/lib/realm-compartment-module-runtime';
import {
  assertAllowedAIProxyURL,
  assertURLWithinRealm,
  snapshotFromCardDocument,
  type RealmSandboxProbeReport,
  type SpikeRealmConfig,
  type WorkerCapabilityRequest,
} from '@cardstack/host/lib/realm-isolation-spike';
import RealmIsolationWorkerRuntime from '@cardstack/host/lib/realm-isolation-worker-runtime';
import {
  getOpaqueRealmCardState,
  opaqueRealmCardState,
  type OpaqueRealmCardState,
  type OpaqueRealmCardTheme,
} from '@cardstack/host/lib/realm-sandbox-boundary';
import realmSandboxFieldComponent from '@cardstack/host/lib/realm-sandbox-field-component';
import {
  isBaseRealmModule,
  isCatalogRealmModule,
  isTrustedHostRealmModule,
  isTrustedSandboxImport,
  trustedSandboxImportConfiguration,
} from '@cardstack/host/lib/realm-sandbox-import-policy';
import RealmWorkerCompartmentModuleRuntime from '@cardstack/host/lib/realm-worker-compartment-module-runtime';
import type CardService from '@cardstack/host/services/card-service';
import type NetworkService from '@cardstack/host/services/network';

import type {
  BaseDef,
  BaseDefComponent,
  Field,
  Format,
} from '@cardstack/base/card-api';

export interface RealmSandboxRender {
  component: BaseDefComponent;
  model: BaseDef | Record<string, unknown>;
  fields: Record<string, BaseDefComponent>;
  styles: string[];
  principal: string;
  theme?: OpaqueRealmCardTheme;
}

export interface RealmIframeSandboxRender {
  cardID?: string;
  document: LooseSingleCardDocument;
  format: Format;
  principal: string;
  targetOrigin: string;
  url: string;
  accessibleTitle: string;
  codePreviewID?: string;
  draft?: {
    sourceURL: string;
    source: string;
    revision: number;
  };
}

export interface RealmIframeFetchResult {
  body: string | null;
  headers: [string, string][];
  status: number;
  statusText: string;
  url: string;
}

export interface RealmSandboxMetrics {
  enabled: boolean;
  executionTier: 'compartment' | 'worker' | 'iframe';
  renderRequests: number;
  sandboxedCards: number;
  fallbackCards: number;
  templateCacheHits: number;
  templateCacheMisses: number;
  templateCloneTimeMs: number;
  snapshotTimeMs: number;
  activePrincipals: number;
  fallbackReasons: Record<string, number>;
  omittedFields: Record<string, number>;
  activeCompartments: number;
  activeCodePreviewLoaders: number;
  activeWorkerCompartments: number;
  compartmentTemplateCacheHits: number;
  compartmentTemplateCacheMisses: number;
  compartmentEvaluationTimeMs: number;
  compartmentRenderedCards: number;
  compartmentErrors: Record<string, number>;
}

interface InertTemplate {
  component: BaseDefComponent;
  styles: string[];
}

interface CodePreviewRuntimeEntry {
  runtime: RealmCompartmentModuleRuntime;
  revision: number;
  pending: Promise<void>;
}

export interface RealmSandboxProbeCard {
  id?: string;
  realmLabel?: string;
  realmURL?: string;
  targetCardURL?: string;
  targetEndpoint?: string;
}

interface RealmRuntimeEntry {
  cardURL: string;
  runtime: RealmIsolationWorkerRuntime;
}

function createSandboxMathFacade(): object {
  let facade: Record<string, unknown> = Object.create(null);
  for (let name of Object.getOwnPropertyNames(Math)) {
    let value = (Math as unknown as Record<string, unknown>)[name];
    facade[name] = typeof value === 'function' ? value.bind(Math) : value;
  }
  facade.random = () => {
    let value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0]! / 0x1_0000_0000;
  };
  return Object.freeze(facade);
}

export default class RealmSandboxService extends Service {
  @service declare private network: NetworkService;
  @service declare private cardService: CardService;

  private runtimes = new Map<string, Promise<RealmRuntimeEntry>>();
  private compartmentRuntimes = new Map<
    string,
    RealmCompartmentModuleRuntime
  >();
  private codePreviewRuntimes = new WeakMap<
    CodePreviewSandbox,
    Map<string, CodePreviewRuntimeEntry>
  >();
  private activeCodePreviews = new Set<CodePreviewSandbox>();
  private activeIframeCodePreviewLoaders = new Set<object>();
  private codePreviewTemplates = new Map<string, InertTemplate>();
  private codePreviewTemplateKeys = new Map<string, string>();
  private workerCompartmentRuntimes = new Map<
    string,
    RealmWorkerCompartmentModuleRuntime
  >();
  private compartmentTemplates = new Map<string, InertTemplate>();
  private compartmentLoads = new Map<string, Promise<void>>();
  private compartmentRenderedCards = new WeakSet<object>();
  private opaqueCardTypes = new Map<string, typeof BaseDef>();
  private trustedFieldTypesByOpaqueType = new Map<
    string,
    Record<string, typeof BaseDef>
  >();
  private trustedFieldTypeLoads = new Map<
    string,
    Promise<typeof BaseDef | undefined>
  >();
  private fieldMetadataByOpaqueType = new Map<
    string,
    Record<string, SandboxCardFieldMetadata>
  >();
  private trustedFieldTypesByCard = new WeakMap<
    object,
    Record<string, typeof BaseDef>
  >();
  private fieldMetadataByCard = new WeakMap<
    BaseDef,
    Record<string, SandboxCardFieldMetadata>
  >();
  private themes = new Map<string, Promise<OpaqueRealmCardTheme | undefined>>();
  private workerSnapshotKeys = new WeakMap<object, string>();
  private nextWorkerSnapshotKey = 0;
  private opaqueFieldComponents = new WeakMap<
    object,
    Map<Format, Record<string, BaseDefComponent>>
  >();
  @tracked private compartmentRevision = 0;
  private sandboxedCards = new WeakSet<object>();
  private principals = new Set<string>();
  private metrics: RealmSandboxMetrics = {
    enabled: true,
    executionTier: 'compartment',
    renderRequests: 0,
    sandboxedCards: 0,
    fallbackCards: 0,
    templateCacheHits: 0,
    templateCacheMisses: 0,
    templateCloneTimeMs: 0,
    snapshotTimeMs: 0,
    activePrincipals: 0,
    fallbackReasons: {},
    omittedFields: {},
    activeCompartments: 0,
    activeCodePreviewLoaders: 0,
    activeWorkerCompartments: 0,
    compartmentTemplateCacheHits: 0,
    compartmentTemplateCacheMisses: 0,
    compartmentEvaluationTimeMs: 0,
    compartmentRenderedCards: 0,
    compartmentErrors: {},
  };

  constructor(owner: Owner) {
    super(owner);
    (
      globalThis as typeof globalThis & {
        __boxelRealmSandboxMetrics?: RealmSandboxMetrics;
      }
    ).__boxelRealmSandboxMetrics = this.metrics;
  }

  isTransparentSandboxEnabled(): boolean {
    return true;
  }

  isOpaqueCard(card: BaseDef): boolean {
    return Boolean(getOpaqueRealmCardState(card));
  }

  shouldUseOpaqueCard(typeRef: CodeRef | undefined): boolean {
    if (this.isIframeSandboxChild()) {
      return false;
    }
    if (!typeRef || !isResolvedCodeRef(typeRef)) {
      return false;
    }
    let module = String(typeRef.module);
    return !(
      isTrustedHostRealmModule(module) ||
      isTrustedHostRealmModule(this.network.resolveImport(module)) ||
      this.isConfiguredTrustedRealmModule(module)
    );
  }

  // Returns the ordinary loader that is allowed to evaluate a trusted card
  // definition. Base has one app-wide loader. Every other explicitly trusted
  // realm has a distinct loader, shared by all card instances/types in that
  // realm, whose Base imports delegate to the app-wide Base loader.
  loaderForTrustedCard(
    typeRef: CodeRef | undefined,
    relativeTo?: RealmResourceIdentifier | URL,
  ) {
    if (!typeRef || !isResolvedCodeRef(typeRef)) {
      return this.network.loaderService.baseLoader;
    }
    let rawModuleIdentifier = String(typeRef.module);
    let moduleIdentifier = this.resolveCardModule(
      rawModuleIdentifier,
      relativeTo,
    );
    if (
      isBaseRealmModule(rawModuleIdentifier) ||
      isBaseRealmModule(moduleIdentifier)
    ) {
      return this.network.loaderService.baseLoader;
    }
    let trustedRealm = this.trustedRealmForModule(moduleIdentifier);
    if (!trustedRealm) {
      // This path is reachable for unresolved/legacy trusted host spellings.
      // Keep them outside Base's cache even though they remain unsandboxed.
      trustedRealm = new URL('./', moduleIdentifier).href;
    }
    return this.network.loaderService.loaderForTrustedRealm(trustedRealm);
  }

  private resolveCardModule(
    moduleIdentifier: string,
    relativeTo?: RealmResourceIdentifier | URL,
  ): string {
    let module = this.network.resolveImport(moduleIdentifier);
    if (relativeTo) {
      let base =
        relativeTo instanceof URL
          ? relativeTo
          : this.network.virtualNetwork.toURL(relativeTo);
      return new URL(module, base).href;
    }
    try {
      return new URL(module).href;
    } catch {
      return module;
    }
  }

  private isConfiguredTrustedRealmModule(moduleIdentifier: string): boolean {
    let resolved = this.network.resolveImport(moduleIdentifier);
    return Boolean(this.trustedRealmForModule(moduleIdentifier, resolved));
  }

  private trustedRealmForModule(
    ...moduleIdentifiers: string[]
  ): string | undefined {
    for (let realmURL of config.trustedCardRealmURLs ?? []) {
      if (moduleIdentifiers.some((module) => module.startsWith(realmURL))) {
        return realmURL;
      }
    }
    if (
      config.resolvedCatalogRealmURL &&
      moduleIdentifiers.some(
        (module) =>
          isCatalogRealmModule(module) ||
          module.startsWith(config.resolvedCatalogRealmURL!),
      )
    ) {
      return config.resolvedCatalogRealmURL;
    }
    return undefined;
  }

  async createOpaqueCard<T extends BaseDef>(
    resource: LooseCardResource,
    relativeTo: RealmResourceIdentifier | URL | undefined,
    document?: Pick<LooseSingleCardDocument, 'included'>,
  ): Promise<T> {
    let typeRef = resource.meta?.adoptsFrom;
    if (!typeRef || !isResolvedCodeRef(typeRef)) {
      throw new Error('Sandboxed card has no resolvable adoptsFrom');
    }
    let relativeURL = this.relativeURL(relativeTo, resource.id);
    let moduleIdentifier = new URL(
      this.network.resolveImport(String(typeRef.module)),
      relativeURL,
    ).href;
    let resolvedTypeRef = {
      module: rri(moduleIdentifier),
      name: String(typeRef.name),
    } satisfies CodeRef;
    let typeName = String(typeRef.name);
    let principal = this.principalFor(resource, moduleIdentifier);
    let snapshot = this.snapshotFromResource(resource, relativeURL, document);
    Object.defineProperty(snapshot, realmURLSymbol, {
      configurable: false,
      enumerable: false,
      value: new URL(principal),
    });
    let key = `${moduleIdentifier}|${typeName}`;
    let api = await this.cardService.getAPI();
    let OpaqueCard = this.opaqueCardTypes.get(key);
    let trustedFieldTypes = this.trustedFieldTypesByOpaqueType.get(key);
    let fieldMetadata = this.fieldMetadataByOpaqueType.get(key);
    if (!OpaqueCard) {
      let metadata = await this.loadCardTypeMetadata(
        principal,
        moduleIdentifier,
        typeName,
      );
      let displayName = metadata?.displayName ?? typeName;
      let headerColor = this.safeHeaderColor(metadata?.headerColor);
      let hasCustomEditTemplate = metadata?.hasCustomEditTemplate === true;
      let hasCustomIsolatedTemplate =
        metadata?.hasCustomIsolatedTemplate === true;
      let prefersWideFormat = metadata?.prefersWideFormat === true;
      OpaqueCard = class OpaqueRealmCard extends api.CardDef {
        static displayName = displayName;
        static headerColor = headerColor;
        static prefersWideFormat = prefersWideFormat;

        static get hasCustomEditTemplate() {
          return hasCustomEditTemplate;
        }

        static get hasCustomIsolatedTemplate() {
          return hasCustomIsolatedTemplate;
        }

        get [realmURLSymbol]() {
          let state = getOpaqueRealmCardState(this);
          return state ? new URL(state.principal) : undefined;
        }
      };
      let icon = await this.resolveTrustedIcon(metadata?.icon);
      if (icon) {
        Object.defineProperty(OpaqueCard, 'icon', { value: icon });
      }
      trustedFieldTypes = await this.resolveTrustedFieldTypes(
        metadata?.fields ?? {},
      );
      fieldMetadata = metadata?.fields ?? {};
      this.opaqueCardTypes.set(key, OpaqueCard);
      this.trustedFieldTypesByOpaqueType.set(key, trustedFieldTypes);
      this.fieldMetadataByOpaqueType.set(key, fieldMetadata);
    }
    // Authored templates commonly read `@model.constructor.displayName` and
    // `.icon`. Give them an inert presentation descriptor, not the executable
    // opaque CardDef class (which inherits host runtime methods). Keeping the
    // property non-enumerable also means component getter args remain JSON-only
    // when they are cloned back into the compartment.
    Object.defineProperty(snapshot, 'constructor', {
      configurable: false,
      enumerable: false,
      value: Object.freeze({
        displayName: OpaqueCard.displayName,
        icon: OpaqueCard.icon,
      }),
    });
    let theme = await this.themeFor(resource, relativeURL, document);
    let card = new (OpaqueCard as typeof api.CardDef)({
      id: resource.id ? rri(resource.id) : undefined,
    }) as unknown as T;
    let state: OpaqueRealmCardState = {
      typeRef: resolvedTypeRef,
      principal,
      document: {
        data: resource,
        ...(document?.included ? { included: document.included } : {}),
      },
      snapshot,
      presentation: {
        displayName: OpaqueCard.displayName,
        headerColor:
          'headerColor' in OpaqueCard
            ? (OpaqueCard.headerColor as string | null)
            : null,
        prefersWideFormat:
          'prefersWideFormat' in OpaqueCard &&
          OpaqueCard.prefersWideFormat === true,
        theme,
      },
    };
    Object.defineProperty(card, opaqueRealmCardState, { value: state });
    this.trustedFieldTypesByCard.set(card, trustedFieldTypes ?? {});
    this.fieldMetadataByCard.set(card, fieldMetadata ?? {});
    for (let [name, value] of Object.entries(snapshot)) {
      if (name === 'id') {
        continue;
      }
      Object.defineProperty(card, name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return card;
  }

  renderFor(
    card: BaseDef,
    format: Format | undefined,
    options: {
      useBaseTemplate?: boolean;
      codePreviewSandbox?: CodePreviewSandbox;
    } = {},
  ): RealmSandboxRender | undefined {
    if (
      !this.isTransparentSandboxEnabled() ||
      this.isSecurityProbe(card, format) ||
      !this.isSupportedFormat(format)
    ) {
      return undefined;
    }

    let effectiveFormat = format ?? 'isolated';
    let opaqueState = getOpaqueRealmCardState(card);
    if (!opaqueState) {
      // Base Realm and other explicitly trusted host-loaded definitions stay
      // on Boxel's ordinary card runtime. Store only creates opaque records
      // for non-base realm types.
      return undefined;
    }
    this.metrics.renderRequests++;
    let principal = opaqueState.principal;
    let useBaseTemplate =
      options.useBaseTemplate === true || effectiveFormat === 'edit';
    let inertTemplate = useBaseTemplate
      ? this.trustedBaseTemplateFor(card, effectiveFormat)
      : this.compartmentTemplateFor(
          card,
          effectiveFormat,
          principal,
          options.codePreviewSandbox,
        );
    if (!inertTemplate) {
      // The opaque Store record inherits only trusted base templates. Until
      // its compartment template is ready (or when evaluation is denied),
      // returning undefined is a fail-closed trusted render, never execution
      // of the realm's original component class.
      return undefined;
    }

    let snapshotStarted = performance.now();
    let model = useBaseTemplate ? card : opaqueState.snapshot;
    this.metrics.snapshotTimeMs += performance.now() - snapshotStarted;

    this.principals.add(principal);
    this.metrics.activePrincipals = this.principals.size;
    if (!this.sandboxedCards.has(card)) {
      this.sandboxedCards.add(card);
      this.metrics.sandboxedCards++;
    }
    if (!this.compartmentRenderedCards.has(card)) {
      this.compartmentRenderedCards.add(card);
      this.metrics.compartmentRenderedCards++;
    }
    return {
      component: inertTemplate.component,
      model,
      fields: this.fieldsFor(card, opaqueState.snapshot, effectiveFormat),
      styles: inertTemplate.styles,
      principal,
      theme: opaqueState.presentation.theme,
    };
  }

  iframeRenderFor(
    card: BaseDef,
    format: Format | undefined,
    options: {
      field?: Field;
      codeRef?: CodeRef;
      displayContainer?: boolean;
      codePreviewSandbox?: CodePreviewSandbox;
    } = {},
  ): RealmIframeSandboxRender | undefined {
    if (
      this.sandboxExecutionTier() !== 'iframe' ||
      this.isIframeSandboxChild() ||
      !this.isSupportedFormat(format)
    ) {
      return undefined;
    }
    let state = getOpaqueRealmCardState(card);
    let cardID = 'id' in card ? (card.id as string | undefined) : undefined;
    let targetOrigin = this.iframeSandboxOrigin();
    if (!state || !cardID || !targetOrigin) {
      return undefined;
    }
    let effectiveFormat = this.safeIframeFormat(format);
    let url = new URL('/_realm-sandbox-frame', targetOrigin);
    url.searchParams.set('cardURL', cardID);
    url.searchParams.set('format', effectiveFormat);
    url.searchParams.set('parentOrigin', globalThis.location.origin);
    url.searchParams.set('cardSandboxTier', 'iframe-child');
    if (options.field) {
      url.searchParams.set('fieldName', options.field.name);
    }
    if (options.codeRef && isResolvedCodeRef(options.codeRef)) {
      url.searchParams.set('componentModule', String(options.codeRef.module));
      url.searchParams.set('componentName', options.codeRef.name);
    }
    url.searchParams.set(
      'displayContainer',
      options.displayContainer === false ? 'false' : 'true',
    );
    this.metrics.executionTier = 'iframe';
    return {
      cardID,
      document: state.document,
      format: effectiveFormat,
      principal: state.principal,
      targetOrigin,
      url: url.href,
      accessibleTitle: `${state.presentation.displayName} sandboxed card`,
      ...(options.codePreviewSandbox
        ? { codePreviewID: options.codePreviewSandbox.id }
        : {}),
      ...(options.codePreviewSandbox?.sourceURL &&
      options.codePreviewSandbox.source != null
        ? {
            draft: {
              sourceURL: options.codePreviewSandbox.sourceURL,
              source: options.codePreviewSandbox.source,
              revision: options.codePreviewSandbox.revision,
            },
          }
        : {}),
    };
  }

  async fetchForIframe(
    sandbox: RealmIframeSandboxRender,
    urlString: string,
    init: { method?: string; headers?: [string, string][] } = {},
  ): Promise<RealmIframeFetchResult> {
    let url = new URL(urlString);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('Iframe renderer only supports HTTP module reads');
    }
    let method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      throw new Error('Iframe renderer fetch capability is read-only');
    }
    if (
      sandbox.draft &&
      this.sameModuleURL(url.href, sandbox.draft.sourceURL)
    ) {
      return {
        body: sandbox.draft.source,
        headers: [['content-type', SupportedMimeType.CardSource]],
        status: 200,
        statusText: 'OK',
        url: url.href,
      };
    }
    let headers = new Headers();
    for (let [name, value] of init.headers ?? []) {
      if (
        ['accept', 'if-modified-since', 'if-none-match'].includes(
          name.toLowerCase(),
        )
      ) {
        headers.set(name, value);
      }
    }
    // authorizationMiddleware grants credentials only when the response is a
    // Boxel realm challenge. Public CDN/module reads remain credentialless,
    // while same- and cross-realm imports use the user's server-enforced read
    // permissions without exposing the token to the iframe.
    let response = await this.network.authedFetch(url, {
      method,
      headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    return {
      body: [204, 205, 304].includes(response.status)
        ? null
        : await response.text(),
      headers: [...response.headers.entries()],
      status: response.status,
      statusText: response.statusText,
      url: response.url || url.href,
    };
  }

  isIframeSandboxChild(): boolean {
    try {
      let targetOrigin = this.iframeSandboxOrigin();
      return (
        Boolean(targetOrigin) &&
        globalThis.location.origin === targetOrigin &&
        globalThis.self !== globalThis.top &&
        new URL(globalThis.location.href).searchParams.get(
          'cardSandboxTier',
        ) === 'iframe-child'
      );
    } catch {
      return false;
    }
  }

  safeIframeFormat(format: string | undefined): Format {
    return ['isolated', 'embedded', 'fitted', 'atom', 'edit'].includes(
      String(format),
    )
      ? (format as Format)
      : 'isolated';
  }

  private iframeSandboxOrigin(): string | undefined {
    let configured = config.realmSandboxIframeOrigin;
    if (typeof configured === 'string' && configured.length > 0) {
      return new URL(configured).origin;
    }
    if (globalThis.location.hostname === 'localhost') {
      let url = new URL(globalThis.location.origin);
      url.hostname = '127.0.0.1';
      return url.origin;
    }
    if (globalThis.location.hostname === '127.0.0.1') {
      return globalThis.location.origin;
    }
    return undefined;
  }

  metricsSnapshot(): RealmSandboxMetrics {
    this.compartmentRevision;
    return {
      ...this.metrics,
      fallbackReasons: { ...this.metrics.fallbackReasons },
      omittedFields: { ...this.metrics.omittedFields },
      compartmentErrors: { ...this.metrics.compartmentErrors },
    };
  }

  registerIframeCodePreviewLoader(token: object) {
    if (!this.activeIframeCodePreviewLoaders.has(token)) {
      this.activeIframeCodePreviewLoaders.add(token);
      this.metrics.activeCodePreviewLoaders++;
    }
  }

  releaseIframeCodePreviewLoader(token: object) {
    if (this.activeIframeCodePreviewLoaders.delete(token)) {
      this.metrics.activeCodePreviewLoaders--;
    }
  }

  isSecurityProbe(card: object, format: string | undefined): boolean {
    return (
      format !== 'edit' &&
      format !== 'head' &&
      (card as { sandboxProfile?: string }).sandboxProfile ===
        'realm-exfiltration-probe'
    );
  }

  async runSecurityProbe(
    card: RealmSandboxProbeCard,
  ): Promise<RealmSandboxProbeReport> {
    let realmURL = this.requiredString(card.realmURL, 'realmURL');
    let targetCardURL = this.requiredString(
      card.targetCardURL,
      'targetCardURL',
    );
    let targetEndpoint = this.requiredString(
      card.targetEndpoint,
      'targetEndpoint',
    );
    let entry = await this.runtimeForRealm(realmURL, card);
    return await entry.runtime.invoke<RealmSandboxProbeReport>(
      'scrapeAll',
      targetCardURL,
      targetEndpoint,
    );
  }

  private async runtimeForRealm(
    realmURL: string,
    card: RealmSandboxProbeCard,
  ): Promise<RealmRuntimeEntry> {
    let cardURL = this.requiredString(card.id, 'card id');
    let existing = this.runtimes.get(realmURL);
    if (existing) {
      let entry = await existing;
      if (entry.cardURL !== cardURL) {
        throw new Error(
          `Realm sandbox is already bound to ${entry.cardURL}; per-card authority must be selected at invocation time before multiple active probe cards are supported`,
        );
      }
      return entry;
    }

    let pending = this.createRuntime(realmURL, cardURL, card.realmLabel);
    this.runtimes.set(realmURL, pending);
    try {
      return await pending;
    } catch (error) {
      this.runtimes.delete(realmURL);
      throw error;
    }
  }

  private async createRuntime(
    realmURL: string,
    cardURL: string,
    realmLabel: string | undefined,
  ): Promise<RealmRuntimeEntry> {
    let programURL = assertURLWithinRealm(
      realmURL,
      `${realmURL}security-probe-program.js`,
    ).href;
    let response = await this.network.authedFetch(programURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(
        `Could not load realm sandbox program: ${response.status} ${await response.text()}`,
      );
    }

    let config: SpikeRealmConfig = {
      realmURL,
      cardURL,
      programURL,
      label: realmLabel ?? realmURL,
      role: 'child',
      // The compartment gets a fetch-shaped capability. The host still
      // validates every destination, so attacker.invalid is rejected before
      // any network request is created.
      canUseAIProxy: true,
    };
    let runtime = new RealmIsolationWorkerRuntime(
      config,
      await response.text(),
      async (request) => await this.handleCapability(config, request),
    );
    return { cardURL, runtime };
  }

  private async handleCapability(
    config: SpikeRealmConfig,
    request: WorkerCapabilityRequest,
  ): Promise<unknown> {
    switch (request.operation) {
      case 'read-own-card':
        return await this.readCard(config, config.cardURL);
      case 'read-card':
        return await this.readCard(config, String(request.args[0] ?? ''));
      case 'proxy-fetch':
        // Throws for every target except the single approved AI proxy. This
        // probe deliberately asks for attacker.invalid.
        assertAllowedAIProxyURL(String(request.args[0] ?? ''));
        throw new Error('The security probe is not granted AI proxy access');
      default:
        throw new Error(
          `Capability ${request.operation} is not granted to this card`,
        );
    }
  }

  private async readCard(config: SpikeRealmConfig, cardURL: string) {
    assertURLWithinRealm(config.realmURL, cardURL);
    let response = await this.network.authedFetch(`${cardURL}.json`, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(`Could not read card ${cardURL}: ${response.status}`);
    }
    return snapshotFromCardDocument(cardURL, await response.json());
  }

  private requiredString(value: string | undefined, label: string): string {
    if (!value) {
      throw new Error(`Security probe card is missing ${label}`);
    }
    return value;
  }

  private isSupportedFormat(format: Format | undefined): boolean {
    return (
      format == null ||
      ['isolated', 'embedded', 'fitted', 'atom', 'edit'].includes(format)
    );
  }

  private trustedBaseTemplateFor(
    card: BaseDef,
    format: Format,
  ): InertTemplate | undefined {
    let component = (card.constructor as unknown as Record<string, unknown>)[
      format
    ];
    if (
      (typeof component !== 'object' || component === null) &&
      typeof component !== 'function'
    ) {
      return undefined;
    }
    return { component: component as BaseDefComponent, styles: [] };
  }

  private createCompartmentRuntime(
    principal: string,
    fetch: typeof globalThis.fetch,
  ) {
    return new RealmCompartmentModuleRuntime(principal, {
      fetch,
      resolveImport: this.network.resolveImport,
      virtualNetwork: this.network.virtualNetwork,
      documentFacade: Object.freeze({
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      mathFacade: createSandboxMathFacade(),
      isTrustedImport: isTrustedSandboxImport,
    });
  }

  private compartmentRuntimeFor(
    principal: string,
    codePreviewSandbox?: CodePreviewSandbox,
  ) {
    if (codePreviewSandbox) {
      return this.codePreviewRuntimeEntryFor(principal, codePreviewSandbox)
        .runtime;
    }
    let runtime = this.compartmentRuntimes.get(principal);
    if (!runtime) {
      runtime = this.createCompartmentRuntime(
        principal,
        this.fetchCompartmentModule,
      );
      this.compartmentRuntimes.set(principal, runtime);
      this.metrics.activeCompartments = this.compartmentRuntimes.size;
    }
    return runtime;
  }

  private codePreviewRuntimeEntryFor(
    principal: string,
    codePreviewSandbox: CodePreviewSandbox,
  ): CodePreviewRuntimeEntry {
    let runtimes = this.codePreviewRuntimes.get(codePreviewSandbox);
    if (!runtimes) {
      runtimes = new Map();
      this.codePreviewRuntimes.set(codePreviewSandbox, runtimes);
      this.activeCodePreviews.add(codePreviewSandbox);
    }
    let entry = runtimes.get(principal);
    if (!entry) {
      entry = {
        runtime: this.createCompartmentRuntime(
          principal,
          this.fetchCompartmentModuleForCodePreview(codePreviewSandbox),
        ),
        revision: -1,
        pending: Promise.resolve(),
      };
      runtimes.set(principal, entry);
      this.metrics.activeCodePreviewLoaders++;
    }
    return entry;
  }

  private fetchCompartmentModuleForCodePreview(
    codePreviewSandbox: CodePreviewSandbox,
  ): typeof globalThis.fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = new Request(input, init);
      if (
        codePreviewSandbox.active &&
        codePreviewSandbox.sourceURL &&
        codePreviewSandbox.source != null &&
        this.sameModuleURL(request.url, codePreviewSandbox.sourceURL)
      ) {
        // This response is never put into the global response cache: it has no
        // ETag or realm header and belongs only to this preview Loader.
        return new Response(codePreviewSandbox.source, {
          status: 200,
          headers: { 'content-type': SupportedMimeType.CardSource },
        });
      }
      return await this.fetchCompartmentModule(request);
    };
  }

  private sameModuleURL(left: string, right: string): boolean {
    try {
      let leftURL = new URL(left);
      let rightURL = new URL(right);
      leftURL.search = '';
      leftURL.hash = '';
      rightURL.search = '';
      rightURL.hash = '';
      return leftURL.href === rightURL.href;
    } catch {
      return false;
    }
  }

  releaseCodePreviewSandbox(codePreviewSandbox: CodePreviewSandbox) {
    codePreviewSandbox.deactivate();
    let runtimes = this.codePreviewRuntimes.get(codePreviewSandbox);
    if (runtimes) {
      for (let entry of runtimes.values()) {
        entry.runtime.destroy();
        this.metrics.activeCodePreviewLoaders--;
      }
      this.codePreviewRuntimes.delete(codePreviewSandbox);
    }
    this.activeCodePreviews.delete(codePreviewSandbox);
    for (let key of this.codePreviewTemplates.keys()) {
      if (key.startsWith(`${codePreviewSandbox.id}|`)) {
        this.codePreviewTemplates.delete(key);
      }
    }
    for (let [slot, key] of this.codePreviewTemplateKeys) {
      if (slot.startsWith(`${codePreviewSandbox.id}|`)) {
        this.codePreviewTemplateKeys.delete(slot);
        this.compartmentTemplates.delete(key);
      }
    }
  }

  private workerCompartmentRuntimeFor(principal: string) {
    let runtime = this.workerCompartmentRuntimes.get(principal);
    if (!runtime) {
      runtime = new RealmWorkerCompartmentModuleRuntime(
        principal,
        this.fetchCompartmentModule,
        trustedSandboxImportConfiguration(),
      );
      this.workerCompartmentRuntimes.set(principal, runtime);
      this.metrics.activeWorkerCompartments =
        this.workerCompartmentRuntimes.size;
    }
    return runtime;
  }

  private cardModuleRuntimeFor(
    principal: string,
    codePreviewSandbox?: CodePreviewSandbox,
  ) {
    // Authoring previews always use their private SES loader. Worker renderers
    // cannot host Glimmer DOM, and replacing an iframe per keystroke defeats
    // the incremental module graph this path exists to preserve.
    if (codePreviewSandbox) {
      return this.compartmentRuntimeFor(principal, codePreviewSandbox);
    }
    return this.sandboxExecutionTier() === 'worker'
      ? this.workerCompartmentRuntimeFor(principal)
      : this.compartmentRuntimeFor(principal);
  }

  private sandboxExecutionTier(): 'compartment' | 'worker' | 'iframe' {
    try {
      let requested = new URL(globalThis.location.href).searchParams.get(
        'cardSandboxTier',
      );
      let tier: 'compartment' | 'worker' | 'iframe' =
        requested === 'worker'
          ? 'worker'
          : requested === 'iframe'
            ? 'iframe'
            : 'compartment';
      this.metrics.executionTier = tier;
      return tier;
    } catch {
      this.metrics.executionTier = 'compartment';
      return 'compartment';
    }
  }

  private async loadCardTypeMetadata(
    principal: string,
    moduleIdentifier: string,
    exportName: string,
  ): Promise<SandboxCardTypeMetadata | undefined> {
    try {
      return await this.cardModuleRuntimeFor(
        principal,
      ).evaluateCardTypeMetadata(moduleIdentifier, exportName);
    } catch (error) {
      this.recordCompartmentError(error);
      return undefined;
    }
  }

  private async resolveTrustedIcon(
    identity: SandboxTrustedExportIdentity | undefined,
  ): Promise<unknown> {
    if (!identity || !isTrustedSandboxImport(identity.module)) {
      return undefined;
    }
    try {
      let module = await this.network.loaderService.loader.import<
        Record<string, unknown>
      >(identity.module);
      return module[identity.name];
    } catch (error) {
      this.recordCompartmentError(error);
      return undefined;
    }
  }

  private async resolveTrustedFieldTypes(
    fields: Record<string, SandboxCardFieldMetadata>,
  ): Promise<Record<string, typeof BaseDef>> {
    let resolved: Record<string, typeof BaseDef> = {};
    await Promise.all(
      Object.entries(fields).map(async ([name, field]) => {
        let fieldType = await this.resolveTrustedFieldType(field.type);
        if (fieldType) {
          resolved[name] = fieldType;
        }
      }),
    );
    return resolved;
  }

  private async resolveTrustedFieldType(
    identity: SandboxTrustedExportIdentity,
  ): Promise<typeof BaseDef | undefined> {
    let resolvedModule = this.network.resolveImport(identity.module);
    if (
      !isTrustedHostRealmModule(identity.module) &&
      !isTrustedHostRealmModule(resolvedModule)
    ) {
      return undefined;
    }
    let key = `${resolvedModule}|${identity.name}`;
    let pending = this.trustedFieldTypeLoads.get(key);
    if (!pending) {
      pending = this.loadTrustedFieldType(identity);
      this.trustedFieldTypeLoads.set(key, pending);
    }
    return await pending;
  }

  private async loadTrustedFieldType(
    identity: SandboxTrustedExportIdentity,
  ): Promise<typeof BaseDef | undefined> {
    try {
      let module = await this.network.loaderService.loader.import<
        Record<string, unknown>
      >(identity.module);
      let fieldType = module[identity.name];
      if (
        (typeof fieldType === 'object' && fieldType !== null) ||
        typeof fieldType === 'function'
      ) {
        return fieldType as typeof BaseDef;
      }
    } catch (error) {
      this.recordCompartmentError(error);
    }
    return undefined;
  }

  private safeHeaderColor(value: string | null | undefined): string | null {
    if (
      typeof value !== 'string' ||
      value.length > 128 ||
      /[;{}]/.test(value) ||
      /url\s*\(/i.test(value)
    ) {
      return null;
    }
    return value;
  }

  private async themeFor(
    resource: LooseCardResource,
    relativeURL: URL,
    document?: Pick<LooseSingleCardDocument, 'included'>,
  ): Promise<OpaqueRealmCardTheme | undefined> {
    let relationship = resource.relationships?.['cardInfo.theme'];
    let link = Array.isArray(relationship)
      ? undefined
      : relationship?.links?.self;
    if (typeof link !== 'string') {
      let cardInfo = resource.attributes?.cardInfo;
      let nestedTheme =
        typeof cardInfo === 'object' &&
        cardInfo !== null &&
        !Array.isArray(cardInfo)
          ? (cardInfo as Record<string, unknown>).theme
          : undefined;
      let nestedLinks =
        typeof nestedTheme === 'object' &&
        nestedTheme !== null &&
        !Array.isArray(nestedTheme)
          ? (nestedTheme as Record<string, unknown>).links
          : undefined;
      let nestedSelf =
        typeof nestedLinks === 'object' &&
        nestedLinks !== null &&
        !Array.isArray(nestedLinks)
          ? (nestedLinks as Record<string, unknown>).self
          : undefined;
      link = typeof nestedSelf === 'string' ? nestedSelf : undefined;
    }
    if (typeof link !== 'string') {
      return undefined;
    }
    let themeURL: URL;
    try {
      themeURL = new URL(link, relativeURL);
    } catch {
      return undefined;
    }
    let relationshipData = Array.isArray(relationship)
      ? undefined
      : relationship?.data;
    let identity = Array.isArray(relationshipData)
      ? undefined
      : relationshipData;
    let identityID = identity && 'id' in identity ? identity.id : undefined;
    let includedTheme = document?.included?.find(
      (included) =>
        included.type === identity?.type &&
        'id' in included &&
        included.id === identityID,
    );
    let includedCss = includedTheme?.attributes?.cssVariables;
    if (typeof includedCss === 'string') {
      return this.buildTheme(themeURL.href, includedCss);
    }
    let key = themeURL.href;
    let pending = this.themes.get(key);
    if (!pending) {
      pending = this.loadTheme(themeURL);
      this.themes.set(key, pending);
    }
    return await pending;
  }

  private async loadTheme(
    themeURL: URL,
  ): Promise<OpaqueRealmCardTheme | undefined> {
    try {
      let response = await this.network.authedFetch(themeURL, {
        headers: { Accept: SupportedMimeType.CardJson },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        let sourceURL = themeURL.pathname.endsWith('.json')
          ? themeURL.href
          : `${themeURL.href}.json`;
        response = await this.network.authedFetch(sourceURL, {
          headers: { Accept: SupportedMimeType.CardSource },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          return undefined;
        }
      }
      let realmURL = response.headers.get('x-boxel-realm-url');
      if (!realmURL) {
        return undefined;
      }
      assertURLWithinRealm(realmURL, response.url || themeURL.href);
      let document = (await response.json()) as LooseSingleCardDocument;
      let css = document.data.attributes?.cssVariables;
      if (typeof css !== 'string' || css.length > 512_000) {
        return undefined;
      }
      let id = document.data.id ? String(document.data.id) : themeURL.href;
      return this.buildTheme(id, css);
    } catch (error) {
      this.recordCompartmentError(error);
      return undefined;
    }
  }

  private buildTheme(
    id: string,
    rawCss: string,
  ): OpaqueRealmCardTheme | undefined {
    if (rawCss.length > 512_000) {
      return undefined;
    }
    let css = this.sanitizeCompartmentCSS(rawCss);
    let scope = themeScope(id, css);
    return scope ? { css, id, scope } : undefined;
  }

  private recordCompartmentError(error: unknown) {
    let reason = error instanceof Error ? error.message : String(error);
    this.metrics.compartmentErrors[reason] =
      (this.metrics.compartmentErrors[reason] ?? 0) + 1;
  }

  private compartmentTemplateFor(
    card: BaseDef,
    format: string,
    principal: string,
    codePreviewSandbox?: CodePreviewSandbox,
  ): InertTemplate | undefined {
    this.compartmentRevision;
    let ref = getOpaqueRealmCardState(card)?.typeRef;
    if (!ref || !('module' in ref) || !('name' in ref)) {
      return undefined;
    }
    let moduleIdentifier: string;
    try {
      moduleIdentifier = new URL(
        this.network.resolveImport(String(ref.module)),
        principal,
      ).href;
    } catch {
      return undefined;
    }
    let tier = codePreviewSandbox ? 'compartment' : this.sandboxExecutionTier();
    let snapshot = getOpaqueRealmCardState(card)?.snapshot ?? {};
    let snapshotKey =
      tier === 'worker' ? `|${this.workerSnapshotKey(snapshot)}` : '';
    let previewSlot = codePreviewSandbox
      ? `${codePreviewSandbox.id}|${principal}|${moduleIdentifier}|${String(ref.name)}|${format}`
      : undefined;
    let previewKey = codePreviewSandbox
      ? `|${codePreviewSandbox.id}:${codePreviewSandbox.revision}`
      : '';
    let key = `${tier}|${principal}|${moduleIdentifier}|${String(ref.name)}|${format}${snapshotKey}${previewKey}`;
    let cached = this.compartmentTemplates.get(key);
    if (cached) {
      this.metrics.compartmentTemplateCacheHits++;
      return cached;
    }
    if (!this.compartmentLoads.has(key)) {
      this.metrics.compartmentTemplateCacheMisses++;
      let load = this.loadCompartmentTemplate(
        key,
        principal,
        moduleIdentifier,
        String(ref.name),
        format,
        snapshot,
        codePreviewSandbox,
        previewSlot,
        codePreviewSandbox?.revision,
      );
      this.compartmentLoads.set(key, load);
    }
    return previewSlot ? this.codePreviewTemplates.get(previewSlot) : undefined;
  }

  private async loadCompartmentTemplate(
    key: string,
    principal: string,
    moduleIdentifier: string,
    exportName: string,
    format: string,
    model: Record<string, unknown>,
    codePreviewSandbox?: CodePreviewSandbox,
    previewSlot?: string,
    expectedRevision?: number,
  ) {
    let started = performance.now();
    try {
      if (codePreviewSandbox && expectedRevision != null) {
        let entry = this.codePreviewRuntimeEntryFor(
          principal,
          codePreviewSandbox,
        );
        let evaluate = entry.pending
          .catch(() => undefined)
          .then(async () => {
            if (
              !codePreviewSandbox.active ||
              codePreviewSandbox.revision !== expectedRevision
            ) {
              return;
            }
            if (entry.revision !== expectedRevision) {
              if (codePreviewSandbox.sourceURL) {
                entry.runtime.invalidateModule(codePreviewSandbox.sourceURL);
              }
              entry.revision = expectedRevision;
            }
            await this.evaluateAndInstallCompartmentTemplate(
              key,
              principal,
              moduleIdentifier,
              exportName,
              format,
              model,
              codePreviewSandbox,
              previewSlot,
              expectedRevision,
            );
          });
        entry.pending = evaluate;
        await evaluate;
      } else {
        await this.evaluateAndInstallCompartmentTemplate(
          key,
          principal,
          moduleIdentifier,
          exportName,
          format,
          model,
        );
      }
    } catch (error) {
      this.recordCompartmentError(error);
    } finally {
      if (codePreviewSandbox) {
        this.compartmentLoads.delete(key);
      }
      this.metrics.compartmentEvaluationTimeMs += performance.now() - started;
      next(this, this.bumpCompartmentRevision);
    }
  }

  private async evaluateAndInstallCompartmentTemplate(
    key: string,
    principal: string,
    moduleIdentifier: string,
    exportName: string,
    format: string,
    model: Record<string, unknown>,
    codePreviewSandbox?: CodePreviewSandbox,
    previewSlot?: string,
    expectedRevision?: number,
  ) {
    let runtime = this.cardModuleRuntimeFor(principal, codePreviewSandbox);
    let bundle =
      runtime instanceof RealmWorkerCompartmentModuleRuntime
        ? await runtime.evaluateTemplate(
            moduleIdentifier,
            exportName,
            format,
            plainComponentArgs({ model }),
          )
        : await runtime.evaluateTemplate(moduleIdentifier, exportName, format);
    let inertTemplate = await this.inertTemplateFromBundle(bundle, runtime);
    if (typeof inertTemplate === 'string') {
      throw new Error(inertTemplate);
    }
    if (
      codePreviewSandbox &&
      (!codePreviewSandbox.active ||
        codePreviewSandbox.revision !== expectedRevision)
    ) {
      return;
    }
    this.compartmentTemplates.set(key, inertTemplate);
    if (previewSlot) {
      let previousKey = this.codePreviewTemplateKeys.get(previewSlot);
      if (previousKey && previousKey !== key) {
        this.compartmentTemplates.delete(previousKey);
      }
      this.codePreviewTemplateKeys.set(previewSlot, key);
      this.codePreviewTemplates.set(previewSlot, inertTemplate);
    }
  }

  private fetchCompartmentModule = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let request = new Request(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
    let response = await this.network.authedFetch(request);
    if (!response.ok) {
      // A 401/403 is the realm server enforcing the current user's read
      // boundary. Preserve it so Loader reports the real dependency URL.
      return response;
    }
    let realmURL = response.headers.get('x-boxel-realm-url');
    if (!realmURL) {
      return new Response('Sandbox imports must resolve to a Boxel realm', {
        status: 403,
        statusText: 'Not a realm resource',
      });
    }
    try {
      assertURLWithinRealm(realmURL, response.url || request.url);
    } catch {
      return new Response('Sandbox import escaped its declaring realm', {
        status: 403,
        statusText: 'Realm boundary mismatch',
      });
    }
    return response;
  };

  private bumpCompartmentRevision() {
    this.compartmentRevision++;
  }

  private workerSnapshotKey(snapshot: object): string {
    let key = this.workerSnapshotKeys.get(snapshot);
    if (!key) {
      key = `snapshot-${++this.nextWorkerSnapshotKey}`;
      this.workerSnapshotKeys.set(snapshot, key);
    }
    return key;
  }

  private async inertTemplateFromBundle(
    bundle: SandboxTemplateBundle,
    runtime:
      | RealmCompartmentModuleRuntime
      | RealmWorkerCompartmentModuleRuntime,
  ): Promise<InertTemplate | string> {
    let compartmentRuntime =
      runtime instanceof RealmCompartmentModuleRuntime ? runtime : undefined;
    if (
      !compartmentRuntime &&
      Object.values(bundle.templates).some(
        (descriptor) =>
          descriptor.instance.getters.length > 0 ||
          descriptor.instance.actions.length > 0,
      )
    ) {
      return 'worker-template-returned-live-component-behavior';
    }
    let components = new Map<string, object>();
    for (let [id, descriptor] of Object.entries(bundle.templates)) {
      try {
        JSON.parse(descriptor.block);
      } catch {
        return 'compartment-template-block-invalid';
      }
      class InertCompartmentTemplate extends GlimmerComponent {
        readonly realmCompartmentBoundary = true;
        @tracked sandboxRevision = 0;
        sandboxInstanceHandle: string | undefined;
        sandboxState: Record<string, unknown> = {};
        sandboxActions: Record<string, (...args: unknown[]) => void> = {};

        constructor(owner: Owner, args: Record<string, unknown>) {
          super(owner, args);
          if (compartmentRuntime) {
            let live = compartmentRuntime.instantiateComponent(
              descriptor.instance.handle,
              plainComponentArgs(args),
            );
            this.sandboxInstanceHandle = live.handle;
            this.sandboxState = live.state;
            for (let action of live.actions) {
              this.sandboxActions[action] = async (
                ...actionArgs: unknown[]
              ) => {
                if (!this.sandboxInstanceHandle) {
                  return;
                }
                let updated = await compartmentRuntime.invokeComponentAction(
                  this.sandboxInstanceHandle,
                  action,
                  actionArgs,
                );
                this.sandboxState = updated.state;
                this.sandboxRevision++;
              };
            }
          }
        }

        willDestroy() {
          super.willDestroy();
          if (this.sandboxInstanceHandle) {
            compartmentRuntime?.releaseComponentInstance(
              this.sandboxInstanceHandle,
            );
          }
        }
      }
      for (let [name, value] of Object.entries(descriptor.instance.state)) {
        Object.defineProperty(InertCompartmentTemplate.prototype, name, {
          configurable: false,
          enumerable: true,
          get(this: InertCompartmentTemplate) {
            this.sandboxRevision;
            return this.sandboxState[name] ?? value;
          },
        });
      }
      for (let name of descriptor.instance.getters) {
        Object.defineProperty(InertCompartmentTemplate.prototype, name, {
          configurable: false,
          enumerable: true,
          get(this: InertCompartmentTemplate) {
            this.sandboxRevision;
            return this.sandboxInstanceHandle
              ? compartmentRuntime!.readComponentProperty(
                  this.sandboxInstanceHandle,
                  name,
                )
              : undefined;
          },
        });
      }
      for (let name of descriptor.instance.actions) {
        Object.defineProperty(InertCompartmentTemplate.prototype, name, {
          configurable: false,
          enumerable: true,
          get(this: InertCompartmentTemplate) {
            return this.sandboxActions[name];
          },
        });
      }
      components.set(id, InertCompartmentTemplate);
    }

    let trustedModules = new Map<string, Record<string, unknown>>();
    let resolveScope = async (reference: SandboxScopeReference) => {
      switch (reference.kind) {
        case 'component': {
          let component = components.get(reference.component);
          if (!component) {
            throw new Error(
              `compartment-template-missing-component:${reference.component}`,
            );
          }
          return component;
        }
        case 'trusted-export': {
          if (!isTrustedSandboxImport(reference.module)) {
            throw new Error(
              `compartment-template-untrusted-scope:${reference.module}`,
            );
          }
          let module = trustedModules.get(reference.module);
          if (!module) {
            module = await this.network.loaderService.loader.import<
              Record<string, unknown>
            >(reference.module);
            trustedModules.set(reference.module, module);
          }
          if (!(reference.name in module)) {
            throw new Error(
              `compartment-template-missing-export:${reference.module}#${reference.name}`,
            );
          }
          return module[reference.name];
        }
        case 'value':
          return reference.value;
      }
    };

    for (let [id, descriptor] of Object.entries(bundle.templates)) {
      let component = components.get(id)!;
      let scope = await Promise.all(descriptor.scope.map(resolveScope));
      setComponentTemplate(
        createTemplateFactory({
          id: `${descriptor.id}-realm-compartment`,
          block: descriptor.block,
          moduleName: descriptor.moduleName,
          scope: () => scope,
          isStrictMode: descriptor.isStrictMode,
        }),
        component,
      );
    }

    let root = components.get(bundle.root);
    if (!root) {
      return 'compartment-template-missing-root';
    }
    let stylesheets = new Set<string>();
    for (let descriptor of Object.values(bundle.templates)) {
      for (let stylesheet of descriptor.stylesheets) {
        stylesheets.add(stylesheet);
      }
    }
    return {
      component: root as unknown as BaseDefComponent,
      styles: this.loadCompartmentStyles([...stylesheets]),
    };
  }

  private loadCompartmentStyles(stylesheets: string[]): string[] {
    return stylesheets.map((stylesheet) =>
      this.sanitizeCompartmentCSS(decodeScopedCSSRequest(stylesheet).css),
    );
  }

  private sanitizeCompartmentCSS(css: string): string {
    // Compiled scoped styles are inert presentation data. Network-bearing CSS
    // is denied so a card cannot turn url() or @import into an exfiltration
    // channel from the shared document.
    return css
      .replace(/@import[^;]*;/gi, '')
      .replace(/url\s*\([^)]*\)/gi, 'none');
  }

  private fieldsFor(
    card: BaseDef,
    model: Record<string, unknown>,
    format: Format,
  ): Record<string, BaseDefComponent> {
    let componentsByFormat = this.opaqueFieldComponents.get(card);
    let cached = componentsByFormat?.get(format);
    if (cached) {
      return cached;
    }
    let fields: Record<string, BaseDefComponent> = {};
    let trustedFieldTypes = this.trustedFieldTypesByCard.get(card) ?? {};
    let fieldMetadata = this.fieldMetadataByCard.get(card) ?? {};
    for (let name of Object.keys(model)) {
      if (name !== 'id') {
        fields[name] = realmSandboxFieldComponent(
          model,
          name,
          trustedFieldTypes[name],
          format,
          fieldMetadata[name]?.kind,
        );
      }
    }
    let cardInfo = model.cardInfo;
    if (
      typeof cardInfo === 'object' &&
      cardInfo !== null &&
      !Array.isArray(cardInfo)
    ) {
      let cardInfoFields = fields.cardInfo as BaseDefComponent &
        Record<string, BaseDefComponent>;
      for (let name of [
        'name',
        'summary',
        'cardThumbnailURL',
        'theme',
        'notes',
      ]) {
        Object.defineProperty(cardInfoFields, name, {
          configurable: true,
          value: realmSandboxFieldComponent(
            cardInfo as Record<string, unknown>,
            name,
            undefined,
            format,
          ),
        });
      }
    }
    if (!componentsByFormat) {
      componentsByFormat = new Map();
      this.opaqueFieldComponents.set(card, componentsByFormat);
    }
    componentsByFormat.set(format, fields);
    return fields;
  }

  private relativeURL(
    relativeTo: RealmResourceIdentifier | URL | undefined,
    id: string | undefined,
  ): URL {
    let value = relativeTo ?? id;
    if (!value) {
      throw new Error('Sandboxed card has no URL for resolving adoptsFrom');
    }
    if (value instanceof URL) {
      return value;
    }
    return this.network.virtualNetwork.toURL(value);
  }

  private principalFor(
    resource: LooseCardResource,
    moduleIdentifier: string,
  ): string {
    let realmURL = resource.meta?.realmURL;
    if (realmURL) {
      return this.network.virtualNetwork.toURL(realmURL).href;
    }
    return new URL('./', moduleIdentifier).href;
  }

  private snapshotFromResource(
    resource: LooseCardResource,
    relativeURL: URL,
    document?: Pick<LooseSingleCardDocument, 'included'>,
  ): Record<string, unknown> {
    let snapshot: Record<string, unknown> = {};
    if (resource.id) {
      snapshot.id = resource.id;
    }
    for (let [name, value] of Object.entries(resource.attributes ?? {})) {
      let cloned = this.clonePlainData(value);
      if (cloned !== unsupportedValue) {
        snapshot[name] = cloned;
      }
    }
    for (let [name, relationship] of Object.entries(
      resource.relationships ?? {},
    )) {
      if (Array.isArray(relationship)) {
        snapshot[name] = relationship
          .map((item) =>
            this.relationshipProjection(item, relativeURL, document),
          )
          .filter((item) => item !== undefined);
      } else {
        let projection = this.relationshipProjection(
          relationship,
          relativeURL,
          document,
        );
        if (projection !== undefined) {
          snapshot[name] = projection;
        }
      }
    }
    return snapshot;
  }

  private relationshipProjection(
    relationship: Relationship,
    relativeURL: URL,
    document?: Pick<LooseSingleCardDocument, 'included'>,
  ): Record<string, unknown> | Record<string, unknown>[] | null | undefined {
    let data = relationship.data;
    if (Array.isArray(data)) {
      return data.map((identity) =>
        this.relationshipIdentityProjection(
          identity,
          relationship.links?.self,
          relativeURL,
          document,
        ),
      );
    }
    if (data === null) {
      return null;
    }
    if (data) {
      return this.relationshipIdentityProjection(
        data,
        relationship.links?.self,
        relativeURL,
        document,
      );
    }
    let link = relationship.links?.self;
    if (typeof link !== 'string') {
      return undefined;
    }
    let url = new URL(link, relativeURL).href;
    return { id: url, sourceUrl: url, url };
  }

  private relationshipIdentityProjection(
    identity: { type: string; id?: string; lid?: string },
    link: string | null | undefined,
    relativeURL: URL,
    document?: Pick<LooseSingleCardDocument, 'included'>,
  ): Record<string, unknown> {
    let included = document?.included?.find(
      (resource) =>
        resource.type === identity.type &&
        'id' in resource &&
        resource.id === identity.id,
    );
    let projected: Record<string, unknown> = {};
    if (identity.id) {
      projected.id = identity.id;
    }
    for (let [name, value] of Object.entries(included?.attributes ?? {})) {
      let cloned = this.clonePlainData(value);
      if (cloned !== unsupportedValue) {
        projected[name] = cloned;
      }
    }
    if (typeof link === 'string') {
      let url = new URL(link, relativeURL).href;
      projected.id ??= url;
      projected.sourceUrl ??= url;
      projected.url ??= url;
    }
    return projected;
  }

  private clonePlainData(
    value: unknown,
    seen = new WeakSet<object>(),
  ): unknown | typeof unsupportedValue {
    if (
      value == null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : unsupportedValue;
    }
    if (typeof value !== 'object' || seen.has(value)) {
      return unsupportedValue;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      let result: unknown[] = [];
      for (let item of value) {
        let cloned = this.clonePlainData(item, seen);
        if (cloned === unsupportedValue) {
          return unsupportedValue;
        }
        result.push(cloned);
      }
      return result;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return unsupportedValue;
    }
    let result: Record<string, unknown> = {};
    for (let [key, item] of Object.entries(value)) {
      let cloned = this.clonePlainData(item, seen);
      if (cloned === unsupportedValue) {
        return unsupportedValue;
      }
      result[key] = cloned;
    }
    return result;
  }

  willDestroy() {
    super.willDestroy();
    for (let pending of this.runtimes.values()) {
      void pending.then(({ runtime }) => runtime.destroy());
    }
    this.runtimes.clear();
    for (let runtime of this.compartmentRuntimes.values()) {
      runtime.destroy();
    }
    this.compartmentRuntimes.clear();
    for (let runtime of this.workerCompartmentRuntimes.values()) {
      runtime.destroy();
    }
    this.workerCompartmentRuntimes.clear();
    for (let preview of [...this.activeCodePreviews]) {
      this.releaseCodePreviewSandbox(preview);
    }
    this.metrics.activeCodePreviewLoaders -=
      this.activeIframeCodePreviewLoaders.size;
    this.activeIframeCodePreviewLoaders.clear();
  }
}

const unsupportedValue = Symbol('unsupported realm sandbox value');

function plainComponentArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  let result: Record<string, unknown> = {};
  for (let [name, item] of Object.entries(value)) {
    try {
      let json = JSON.stringify(item);
      if (json !== undefined) {
        result[name] = JSON.parse(json);
      }
    } catch {
      // Component args that are host capabilities (functions, component
      // classes, cyclic framework objects) are intentionally omitted. Realm
      // component getters receive only JSON-shaped values.
    }
  }
  let model = (value as { model?: unknown }).model;
  if (typeof model === 'object' && model !== null) {
    let modelRealmURL = (model as { [realmURLSymbol]?: { href?: unknown } })[
      realmURLSymbol
    ]?.href;
    let plainModel = result.model;
    if (
      typeof modelRealmURL === 'string' &&
      typeof plainModel === 'object' &&
      plainModel !== null
    ) {
      (plainModel as Record<string, unknown>)[sandboxRealmURLArgument] =
        modelRealmURL;
    }
  }
  return result;
}

declare module '@ember/service' {
  interface Registry {
    'realm-sandbox': RealmSandboxService;
  }
}
