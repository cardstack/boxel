import { getOwner } from '@ember/application';
import { setComponentTemplate } from '@ember/component';
import type Owner from '@ember/owner';
import { cancel, schedule, scheduleOnce } from '@ember/runloop';
import type { Timer } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { createTemplateFactory } from '@ember/template-factory';
import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

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
  delegatedCardRenderComponent,
  hasExecutableExtension,
  localId as localIdSymbol,
  meta,
  realmURL as realmURLSymbol,
  rri,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import {
  CodePreviewAnalysisCache,
  codePreviewModuleKey,
  sameCodePreviewModuleURL,
  type VolatileModuleGeneration,
  VolatileModuleRegistry,
} from '@cardstack/host/lib/code-preview-sandbox';
import CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';
import type {
  CodePreviewDraft,
  PreparedCodePreviewCommit,
} from '@cardstack/host/lib/code-preview-sandbox';
import {
  serializeWithArgs,
  teardown,
} from '@cardstack/host/lib/isolated-render';
import RealmCompartmentModuleRuntime, {
  sandboxRealmURLArgument,
  type SandboxCardFieldMetadata,
  type SandboxCardTypeMetadata,
  type SandboxScopeReference,
  type SandboxTemplateBundle,
  type SandboxTrustedExportIdentity,
} from '@cardstack/host/lib/realm-compartment-module-runtime';
import type { RealmIframeSandboxPresentation } from '@cardstack/host/lib/realm-iframe-sandbox-protocol';
import {
  getOpaqueRealmCardState,
  getOpaqueRealmCardTypeState,
  opaqueRealmCardTypeState,
  opaqueRealmCardState,
  type OpaqueRealmCardState,
  type OpaqueRealmCardTheme,
} from '@cardstack/host/lib/realm-sandbox-boundary';
import realmSandboxDelegatedCardComponent from '@cardstack/host/lib/realm-sandbox-delegated-card-component';
import realmSandboxFieldComponent from '@cardstack/host/lib/realm-sandbox-field-component';
import {
  isBaseRealmModule,
  isCatalogRealmModule,
  isTrustedHostRealmModule,
  isTrustedSandboxImport,
} from '@cardstack/host/lib/realm-sandbox-import-policy';
import RealmSandboxRuntimeRegistry from '@cardstack/host/lib/realm-sandbox-runtime-registry';
import {
  classifyCardSourceForSandbox,
  sandboxDecisionForFormat,
  type CardRenderSandboxTier,
  type CardSourceSandboxClassification,
} from '@cardstack/host/lib/realm-sandbox-source-policy';
import { assertURLWithinRealm } from '@cardstack/host/lib/realm-sandbox-url-policy';
import type CardService from '@cardstack/host/services/card-service';
import type { SaveType } from '@cardstack/host/services/card-service';
import type NetworkService from '@cardstack/host/services/network';

import type {
  BaseDef,
  BaseDefComponent,
  BoxComponent,
  Field,
  Format,
} from '@cardstack/base/card-api';

const compartmentTemplateWaiter = buildWaiter(
  'realm-sandbox:compartment-template',
);

export interface RealmSandboxRender {
  component: BaseDefComponent;
  model: BaseDef | Record<string, unknown>;
  fields: Record<string, BaseDefComponent>;
  styles: string[];
  principal: string;
  theme?: OpaqueRealmCardTheme;
  onError?: (error: unknown, component: BaseDefComponent) => void;
  onRendered?: (component: BaseDefComponent) => void;
}

class StableRealmSandboxRender implements RealmSandboxRender {
  @tracked component: BaseDefComponent;
  @tracked model: BaseDef | Record<string, unknown>;
  @tracked fields: Record<string, BaseDefComponent>;
  @tracked styles: string[];
  @tracked principal: string;
  @tracked theme?: OpaqueRealmCardTheme;
  onError?: (error: unknown, component: BaseDefComponent) => void;
  onRendered?: (component: BaseDefComponent) => void;
  private pending?: RealmSandboxRender;

  constructor(value: RealmSandboxRender) {
    this.component = value.component;
    this.model = value.model;
    this.fields = value.fields;
    this.styles = value.styles;
    this.principal = value.principal;
    this.theme = value.theme;
    this.onError = value.onError;
    this.onRendered = value.onRendered;
  }

  scheduleUpdate(value: RealmSandboxRender) {
    let current = this.pending ?? this;
    if (
      current.component === value.component &&
      current.model === value.model &&
      current.fields === value.fields &&
      sameStyles(current.styles, value.styles) &&
      current.principal === value.principal &&
      current.theme === value.theme &&
      current.onError === value.onError &&
      current.onRendered === value.onRendered
    ) {
      return;
    }
    this.pending = value;
    scheduleOnce('afterRender', this, this.flushUpdate);
  }

  private flushUpdate() {
    let value = this.pending;
    this.pending = undefined;
    if (!value) {
      return;
    }
    if (this.component !== value.component) {
      this.component = value.component;
    }
    if (this.model !== value.model) {
      this.model = value.model;
    }
    if (this.fields !== value.fields) {
      this.fields = value.fields;
    }
    if (!sameStyles(this.styles, value.styles)) {
      this.styles = value.styles;
    }
    if (this.principal !== value.principal) {
      this.principal = value.principal;
    }
    if (this.theme !== value.theme) {
      this.theme = value.theme;
    }
    if (this.onError !== value.onError) {
      this.onError = value.onError;
    }
    if (this.onRendered !== value.onRendered) {
      this.onRendered = value.onRendered;
    }
  }
}

function sameStyles(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((stylesheet, index) => stylesheet === right[index])
  );
}

interface PendingCodePreviewTemplate {
  codePreviewSandbox: CodePreviewSandbox;
  draft: CodePreviewDraft;
  key: string;
  previewSlot: string;
  template: InertTemplate;
  previousKey?: string;
  previousTemplate?: InertTemplate;
}

export interface RealmIframeSandboxRender {
  cardID?: string;
  document: LooseSingleCardDocument;
  format: Format;
  principal: string;
  targetOrigin: string;
  url: string;
  accessibleTitle: string;
  presentation: RealmIframeSandboxPresentation;
  codePreviewID?: string;
  onGenerationResult?: (revision: number, error?: string) => void;
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
  executionTier: 'compartment' | 'iframe';
  executionReason: string;
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
  codePreviewCommitsPrepared: number;
  codePreviewAcknowledgementsRecognized: number;
  codePreviewAnalysisCacheHits: number;
  codePreviewAnalysisCacheMisses: number;
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
  draft?: CodePreviewDraft;
  pending: Promise<void>;
}

// Search resources can be instantiated under a render Store owner while Code
// mode lives under the host owner. Realm events fan out to both owners, so the
// save transaction registry must be client-wide rather than service-instance
// local. Entries still retain their exact CodePreviewSandbox and are bounded
// like CardService's own request-id history.
type CodePreviewCommitRegistry = Map<
  string,
  {
    sandboxes: Set<CodePreviewSandbox>;
    drafts?: Map<CodePreviewSandbox, CodePreviewDraft>;
    sourceURL: string;
    expiresAt: number;
  }
>;

const codePreviewCommitRegistryKey = Symbol.for(
  '@cardstack/host/code-preview-commits',
);
const codePreviewCommitGlobal = globalThis as unknown as Record<
  PropertyKey,
  unknown
>;
let codePreviewCommits = codePreviewCommitGlobal[codePreviewCommitRegistryKey];
if (!(codePreviewCommits instanceof Map)) {
  codePreviewCommits = new Map();
  Object.defineProperty(globalThis, codePreviewCommitRegistryKey, {
    configurable: true,
    value: codePreviewCommits,
  });
}
const codePreviewCommitRegistry =
  codePreviewCommits as CodePreviewCommitRegistry;
const maxCachedThemes = 128;

class ReactiveRevision {
  @tracked value = 0;

  consume() {
    return this.value;
  }

  bump() {
    this.value++;
  }
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

  private realmRuntimes = new RealmSandboxRuntimeRegistry(
    (principal) =>
      this.createCompartmentRuntime(principal, this.fetchCompartmentModule),
    (principal) => this.onRealmRuntimeEvicted(principal),
  );
  private codePreviewRuntimes = new WeakMap<
    CodePreviewSandbox,
    Map<string, CodePreviewRuntimeEntry>
  >();
  private codePreviewAnalyses = new CodePreviewAnalysisCache(
    () => this.metrics.codePreviewAnalysisCacheHits++,
    () => this.metrics.codePreviewAnalysisCacheMisses++,
  );
  private activeCodePreviews = new Set<CodePreviewSandbox>();
  private volatileModules = new VolatileModuleRegistry();
  private interactiveCodePreviewConsumers = new Map<string, Set<object>>();
  private interactiveCodePreviews = new Map<string, CodePreviewSandbox>();
  private interactiveCodePreviewRevisions = new Map<string, ReactiveRevision>();
  private interactiveCodePreviewTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private externallyVolatileModules = new Set<string>();
  private externalModuleInvalidationRevisions = new Map<string, number>();
  private externalModuleRefreshes = new Map<string, Promise<void>>();
  private activeIframeCodePreviewLoaders = new Set<object>();
  private codePreviewTemplates = new Map<string, InertTemplate>();
  private codePreviewTemplateKeys = new Map<string, string>();
  private pendingCodePreviewTemplates = new Map<
    BaseDefComponent,
    PendingCodePreviewTemplate
  >();
  private canonicalTemplateKeysByModule = new Map<string, Set<string>>();
  private compartmentTemplates = new Map<string, InertTemplate>();
  private moduleClassifications = new Map<
    string,
    CardSourceSandboxClassification
  >();
  private moduleDependencies = new Map<string, string[]>();
  private compartmentLoads = new Map<string, Promise<void>>();
  private compartmentFailures = new Set<string>();
  private compartmentTemplateRevisions = new Map<string, ReactiveRevision>();
  private compartmentLoadingRevisions = new WeakMap<
    BaseDef,
    Map<string, ReactiveRevision>
  >();
  private pendingCompartmentRevisions = new Set<ReactiveRevision>();
  private compartmentRevisionFrame?: Timer;
  private compartmentLoadingByCard = new WeakMap<
    BaseDef,
    Map<string, number>
  >();
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
  private opaqueFieldComponents = new WeakMap<
    object,
    Map<Format, Record<string, BaseDefComponent>>
  >();
  private renderEnvelopes = new WeakMap<
    BaseDef,
    Map<string, RealmSandboxRender>
  >();
  private cardReloadRevisions = new WeakMap<BaseDef, ReactiveRevision>();
  @tracked private metricsRevision = 0;
  private sandboxedCards = new WeakSet<object>();
  private principals = new Set<string>();
  private metrics: RealmSandboxMetrics = {
    enabled: true,
    executionTier: 'compartment',
    executionReason: 'default-user-card',
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
    codePreviewCommitsPrepared: 0,
    codePreviewAcknowledgementsRecognized: 0,
    codePreviewAnalysisCacheHits: 0,
    codePreviewAnalysisCacheMisses: 0,
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

  reloadCard(card: BaseDef, codePreviewSandbox?: CodePreviewSandbox): boolean {
    if (!this.isOpaqueCard(card)) {
      return false;
    }

    let moduleKey = this.interactiveCodePreviewKey(card);
    let preview =
      codePreviewSandbox ??
      (moduleKey ? this.interactiveCodePreviews.get(moduleKey) : undefined);
    let reloadedPreview = preview?.reload() ?? false;
    if (reloadedPreview && moduleKey && preview !== codePreviewSandbox) {
      this.bumpInteractiveCodePreview(moduleKey);
    }

    if (!reloadedPreview) {
      let ref = getOpaqueRealmCardState(card)?.typeRef;
      if (ref && 'module' in ref) {
        this.invalidateCanonicalSandboxModule(String(ref.module));
      }
    }

    // A manual reload is deliberately the escape hatch from HMR's stable
    // rendered island. Drop only this card's envelope, leave Store identity
    // and other realm runtimes alone, then invalidate both SES and iframe
    // render getters through one explicit boundary revision.
    this.renderEnvelopes.delete(card);
    this.cardReloadRevisionFor(card).bump();
    return true;
  }

  // Host-owned rendering entry point. Interactive host UI must ask the
  // boundary for a component instead of introspecting an opaque card's
  // constructor. Trusted cards retain the ordinary card-api behavior.
  componentFor(
    card: BaseDef,
    field?: Field,
    opts?: { componentCodeRef?: CodeRef },
  ): BoxComponent {
    if (!field) {
      let delegated = (
        card as BaseDef & {
          [delegatedCardRenderComponent]?: BoxComponent;
        }
      )[delegatedCardRenderComponent];
      if (delegated) {
        return delegated;
      }
    }
    return card.constructor.getComponent(card, field, opts);
  }

  shouldUseOpaqueCard(
    typeRef: CodeRef | undefined,
    relativeTo?: RealmResourceIdentifier | URL,
  ): boolean {
    if (this.isIframeSandboxChild()) {
      return false;
    }
    if (!typeRef || !isResolvedCodeRef(typeRef)) {
      return false;
    }
    let module = String(typeRef.module);
    if (isTesting() && relativeTo) {
      // Existing integration tests construct realm modules as live class
      // objects and install them with Loader.shimModule(). There is no source
      // text for an SES compartment to evaluate. Treat only an already-loaded
      // test shim as trusted so the pre-sandbox feature suites continue to
      // exercise their own behavior; network-backed test modules still take
      // the real opaque/sandbox path.
      let resolvedModule = this.resolveCardModule(module, relativeTo);
      if (this.network.loaderService.loader.isModuleShimmed(resolvedModule)) {
        return false;
      }
    }
    return !(
      isTrustedHostRealmModule(module) ||
      isTrustedHostRealmModule(this.network.resolveImport(module)) ||
      this.isConfiguredTrustedRealmModule(module)
    );
  }

  // Executable invalidations need the same trust decision as Store
  // materialization, but realm events carry a module URL rather than a CodeRef.
  // Test shims remain on the legacy trusted path because they have no source
  // text for the compartment to evaluate.
  isSandboxedUserModule(moduleIdentifier: string): boolean {
    let resolved = this.network.resolveImport(moduleIdentifier);
    if (
      isTrustedHostRealmModule(moduleIdentifier) ||
      isTrustedHostRealmModule(resolved) ||
      this.isConfiguredTrustedRealmModule(moduleIdentifier)
    ) {
      return false;
    }
    if (
      isTesting() &&
      this.network.loaderService.loader.isModuleShimmed(resolved)
    ) {
      return false;
    }
    return true;
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
    existingLocalId?: string,
  ): Promise<T> {
    let typeRef = resource.meta?.adoptsFrom;
    if (!typeRef || !isResolvedCodeRef(typeRef)) {
      throw new Error('Sandboxed card has no resolvable adoptsFrom');
    }
    let relativeURL = this.relativeURL(
      relativeTo,
      resource.id,
      String(typeRef.module),
    );
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
      let authoredTemplateFormats = metadata?.authoredTemplateFormats;
      let prefersWideFormat = metadata?.prefersWideFormat === true;
      fieldMetadata = metadata?.fields ?? {};
      trustedFieldTypes = await this.resolveTrustedFieldTypes(fieldMetadata);
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
      Object.defineProperty(OpaqueCard, opaqueRealmCardTypeState, {
        configurable: false,
        enumerable: false,
        value: Object.freeze({
          typeRef: resolvedTypeRef,
          displayName,
          fields: Object.freeze({ ...fieldMetadata }),
          hasCustomEditTemplate,
          hasCustomIsolatedTemplate,
          authoredTemplateFormats,
          headerColor,
          prefersWideFormat,
        }),
      });
      let icon = await this.resolveTrustedIcon(metadata?.icon);
      if (icon) {
        Object.defineProperty(OpaqueCard, 'icon', { value: icon });
      }
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
      ...(existingLocalId ? { [localIdSymbol]: existingLocalId } : {}),
    }) as unknown as T;
    // Match Base's createFromSerialized contract: host presentation metadata
    // such as realmInfo is inert data and must survive opaque materialization.
    // Do not expose the executable definition or loader through this channel.
    if (resource.meta) {
      card[meta] = structuredClone(resource.meta);
    }
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
    Object.defineProperty(card, delegatedCardRenderComponent, {
      configurable: false,
      enumerable: false,
      value: realmSandboxDelegatedCardComponent(card),
    });
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
    let reloadRevision = this.cardReloadRevisionFor(card).consume();
    if (
      !this.isTransparentSandboxEnabled() ||
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
    let useBaseTemplate =
      options.useBaseTemplate === true ||
      this.usesInheritedBaseTemplate(card, effectiveFormat);
    if (
      !useBaseTemplate &&
      this.sandboxDecisionFor(card, effectiveFormat, options.codePreviewSandbox)
        .tier === 'iframe'
    ) {
      return undefined;
    }
    this.metrics.renderRequests++;
    let principal = opaqueState.principal;
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
    let fields = this.fieldsFor(card, opaqueState.snapshot, effectiveFormat);
    // A preview slot is the stable rendered island. Source generations update
    // its tracked payload; they are not separate render-envelope identities.
    // This keeps the Glimmer component, island element, and style modifier
    // mounted while RealmSandboxTemplateIsland adopts a compatible program.
    let envelopeKey = `${effectiveFormat}|${useBaseTemplate ? 'base' : 'sandbox'}|${options.codePreviewSandbox?.id ?? 'canonical'}|reload:${reloadRevision}`;
    let envelopes = this.renderEnvelopes.get(card);
    if (!envelopes) {
      envelopes = new Map();
      this.renderEnvelopes.set(card, envelopes);
    }
    let next = {
      component: inertTemplate.component,
      model,
      fields,
      styles: inertTemplate.styles,
      principal,
      theme: opaqueState.presentation.theme,
      ...(options.codePreviewSandbox
        ? {
            onError: this.onCodePreviewTemplateError,
            onRendered: this.onCodePreviewTemplateRendered,
          }
        : {}),
    };
    let envelope = envelopes.get(envelopeKey) as
      | StableRealmSandboxRender
      | undefined;
    if (envelope) {
      envelope.scheduleUpdate(next);
      return envelope;
    }
    envelope = new StableRealmSandboxRender(next);
    envelopes.set(envelopeKey, envelope);
    return envelope;
  }

  isRenderLoading(card: BaseDef, format: Format | undefined): boolean {
    let effectiveFormat = format ?? 'isolated';
    this.compartmentLoadingRevisionFor(card, effectiveFormat).consume();
    return (
      (this.compartmentLoadingByCard.get(card)?.get(effectiveFormat) ?? 0) > 0
    );
  }

  // A prerendered CardIsland must remain the visible authority until the
  // client has the exact sandbox branch that CardRenderer will consume.
  // Calling this method starts SES evaluation when necessary and subscribes
  // the caller only to this card/format's load. A completed failure is also
  // ready: the
  // live CardRenderer can then take its normal explicit error/fallback path
  // instead of leaving stale server DOM mounted forever.
  isCardIslandHydrationReady(
    card: BaseDef,
    format: Format | undefined,
  ): boolean {
    if (!this.isOpaqueCard(card)) {
      return true;
    }
    if (this.iframeRenderFor(card, format)) {
      return true;
    }
    if (this.renderFor(card, format)) {
      return true;
    }
    return !this.isRenderLoading(card, format);
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
    let reloadRevision = this.cardReloadRevisionFor(card).consume();
    let effectiveFormat = format ?? 'isolated';
    // The sandbox metadata has already established that this format is not
    // authored. Render Base's trusted, app-wide fallback in the host instead
    // of paying to boot an iframe that would only inherit the same template.
    if (this.usesInheritedBaseTemplate(card, effectiveFormat)) {
      return undefined;
    }
    let decision = this.sandboxDecisionFor(
      card,
      effectiveFormat,
      options.codePreviewSandbox,
    );
    if (
      decision.tier !== 'iframe' ||
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
    let iframeFormat = this.safeIframeFormat(effectiveFormat);
    if (!iframeFormat) {
      return undefined;
    }
    let url = new URL('/_realm-sandbox-frame', targetOrigin);
    url.searchParams.set('cardURL', cardID);
    url.searchParams.set('parentOrigin', globalThis.location.origin);
    url.searchParams.set('reload', String(reloadRevision));
    this.metrics.executionTier = 'iframe';
    this.metrics.executionReason = decision.reason;
    return {
      cardID,
      document: state.document,
      format: iframeFormat,
      principal: state.principal,
      targetOrigin,
      url: url.href,
      accessibleTitle: `${state.presentation.displayName} sandboxed card`,
      presentation: {
        format: iframeFormat,
        displayContainer: options.displayContainer !== false,
        ...(options.field ? { fieldName: options.field.name } : {}),
        ...(options.codeRef && isResolvedCodeRef(options.codeRef)
          ? {
              codeRef: {
                module: options.codeRef.module,
                name: options.codeRef.name,
              },
            }
          : {}),
      },
      ...(options.codePreviewSandbox
        ? {
            codePreviewID: options.codePreviewSandbox.id,
            onGenerationResult:
              options.codePreviewSandbox.onIframeGenerationResult,
          }
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
        new URL(globalThis.location.href).pathname === '/_realm-sandbox-frame'
      );
    } catch {
      return false;
    }
  }

  safeIframeFormat(format: string | undefined): Format | undefined {
    return ['isolated', 'embedded', 'edit'].includes(String(format))
      ? (format as Format)
      : undefined;
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
    this.metricsRevision;
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

  private isSupportedFormat(format: Format | undefined): boolean {
    return (
      format == null ||
      [
        'isolated',
        'embedded',
        'fitted',
        'atom',
        'edit',
        'head',
        'markdown',
      ].includes(format)
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

  private usesInheritedBaseTemplate(card: BaseDef, format: Format): boolean {
    let authoredTemplateFormats =
      getOpaqueRealmCardTypeState(card)?.authoredTemplateFormats;
    // Absence means metadata evaluation itself failed. Preserve the existing
    // fail-closed path in that case; only an explicit sandbox result may opt
    // into a trusted Base fallback.
    return (
      authoredTemplateFormats !== undefined &&
      !authoredTemplateFormats.includes(format)
    );
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
    let runtime = this.realmRuntimes.runtimeFor(principal);
    this.metrics.activeCompartments = this.realmRuntimes.size;
    return runtime;
  }

  retainRealmCard(card: BaseDef): () => void {
    let principal = getOpaqueRealmCardState(card)?.principal;
    if (!principal) {
      return () => undefined;
    }
    return this.realmRuntimes.retain(principal);
  }

  // Gives memory-pressure handlers and deterministic tests an immediate
  // version of the normal TTL sweep. Active realms are never touched.
  evictIdleRealmRuntimes() {
    this.realmRuntimes.evictIdle();
  }

  private onRealmRuntimeEvicted(principal: string) {
    let keyFragment = `|${principal}|`;
    for (let key of [...this.compartmentTemplates.keys()]) {
      if (!key.includes(keyFragment)) {
        continue;
      }
      this.compartmentTemplates.delete(key);
      this.compartmentLoads.delete(key);
      this.compartmentFailures.delete(key);
      this.compartmentTemplateRevisions.delete(key);
      for (let templateKeys of this.canonicalTemplateKeysByModule.values()) {
        templateKeys.delete(key);
      }
    }
    for (let [moduleKey, templateKeys] of this.canonicalTemplateKeysByModule) {
      if (templateKeys.size === 0) {
        this.canonicalTemplateKeysByModule.delete(moduleKey);
      }
    }
    this.principals.delete(principal);
    this.metrics.activePrincipals = this.principals.size;
    this.metrics.activeCompartments = this.realmRuntimes.size;
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
      let newEntry = {} as CodePreviewRuntimeEntry;
      newEntry.runtime = this.createCompartmentRuntime(
        principal,
        this.fetchCompartmentModuleForCodePreview(
          codePreviewSandbox,
          () => newEntry.draft,
        ),
      );
      Object.assign(newEntry, {
        revision: -1,
        pending: Promise.resolve(),
      });
      entry = newEntry;
      runtimes.set(principal, entry);
      this.metrics.activeCodePreviewLoaders++;
    }
    return entry;
  }

  private fetchCompartmentModuleForCodePreview(
    codePreviewSandbox: CodePreviewSandbox,
    currentDraft: () => CodePreviewDraft | undefined,
  ): typeof globalThis.fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = new Request(input, init);
      let draft = currentDraft();
      if (
        codePreviewSandbox.active &&
        draft &&
        this.sameModuleURL(request.url, draft.sourceURL)
      ) {
        let classification = await this.classifyCodePreviewDraft(draft);
        await this.recordModuleSourceClassification(
          request.url,
          draft.source,
          classification,
        );
        let compiledSource = await this.compileCodePreviewDraft(draft);
        // This response is never put into the global response cache: it has no
        // ETag or realm header and belongs only to this preview Loader.
        return new Response(compiledSource, {
          status: 200,
          headers: { 'content-type': SupportedMimeType.CardSource },
        });
      }
      return await this.fetchCompartmentModule(request);
    };
  }

  private compileCodePreviewDraft(draft: CodePreviewDraft): Promise<string> {
    return this.codePreviewAnalyses.compiledFor(draft);
  }

  private classifyCodePreviewDraft(
    draft: CodePreviewDraft,
  ): Promise<CardSourceSandboxClassification> {
    return this.codePreviewAnalyses.classificationFor(draft);
  }

  // A completed AI diff already contains the exact next module source. Start
  // classification and GTS transpilation while the user is reading the diff;
  // Apply will reuse these promises by URL + source hash.
  prewarmCodePreviewSource(sourceURL: string, source: string): void {
    if (!hasExecutableExtension(sourceURL)) {
      return;
    }
    let draft = { sourceURL, source, revision: 0 };
    this.codePreviewAnalyses.prewarm(draft);
  }

  private sameModuleURL(left: string, right: string): boolean {
    // Loader intentionally gives executable siblings one module identity.
    // Monaco publishes the concrete `.gts` file URL while an evaluated import
    // is commonly extensionless. Using a stricter comparison makes revision N
    // evaluate saved source and appear only after revision N + 1.
    return sameCodePreviewModuleURL(left, right);
  }

  releaseCodePreviewSandbox(codePreviewSandbox: CodePreviewSandbox) {
    let moduleKey = codePreviewSandbox.sourceURL
      ? codePreviewModuleKey(codePreviewSandbox.sourceURL)
      : undefined;
    codePreviewSandbox.deactivate();
    for (let [clientRequestId, commit] of codePreviewCommitRegistry) {
      commit.sandboxes.delete(codePreviewSandbox);
      if (commit.sandboxes.size === 0) {
        codePreviewCommitRegistry.delete(clientRequestId);
      }
    }
    let runtimes = this.codePreviewRuntimes.get(codePreviewSandbox);
    if (runtimes) {
      for (let entry of runtimes.values()) {
        entry.runtime.destroy();
        this.metrics.activeCodePreviewLoaders--;
      }
      this.codePreviewRuntimes.delete(codePreviewSandbox);
    }
    this.activeCodePreviews.delete(codePreviewSandbox);
    for (let [component, pending] of this.pendingCodePreviewTemplates) {
      if (pending.codePreviewSandbox === codePreviewSandbox) {
        this.pendingCodePreviewTemplates.delete(component);
      }
    }
    for (let key of this.codePreviewTemplates.keys()) {
      if (key.startsWith(`${codePreviewSandbox.id}|`)) {
        this.codePreviewTemplates.delete(key);
      }
    }
    for (let [slot, key] of this.codePreviewTemplateKeys) {
      if (slot.startsWith(`${codePreviewSandbox.id}|`)) {
        this.codePreviewTemplateKeys.delete(slot);
        this.compartmentTemplates.delete(key);
        this.compartmentLoads.delete(key);
        this.compartmentFailures.delete(key);
        this.compartmentTemplateRevisions.delete(key);
      }
    }
    if (moduleKey) {
      this.clearExternalVolatilityIfUnused(moduleKey);
    }
  }

  settleDeferredCodePreviewModule(codePreviewSandbox: CodePreviewSandbox) {
    if (
      codePreviewSandbox.consumeDeferredCanonicalRefresh() &&
      codePreviewSandbox.sourceURL
    ) {
      this.invalidateCanonicalSandboxModule(codePreviewSandbox.sourceURL);
    }
  }

  // Interact mode does not own a Monaco preview object, but a mounted card is
  // still a live consumer of its definition module. Register that interest so
  // the first assistant source mutation can attach the same private preview
  // loader used by Code mode before the realm write/index round trip begins.
  registerInteractiveCodePreview(card: BaseDef): () => void {
    let key = this.interactiveCodePreviewKey(card);
    if (!key) {
      return () => undefined;
    }
    let consumers = this.interactiveCodePreviewConsumers.get(key);
    if (!consumers) {
      consumers = new Set();
      this.interactiveCodePreviewConsumers.set(key, consumers);
    }
    let consumer = {};
    consumers.add(consumer);

    let ref = getOpaqueRealmCardState(card)?.typeRef;
    let generation =
      ref && 'module' in ref
        ? this.volatileModules.current(String(ref.module))
        : undefined;
    if (generation) {
      this.ensureInteractiveCodePreview(key, generation);
    }

    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      let currentConsumers = this.interactiveCodePreviewConsumers.get(key);
      currentConsumers?.delete(consumer);
      if (currentConsumers?.size) {
        return;
      }
      this.interactiveCodePreviewConsumers.delete(key);
      this.settleInteractiveCodePreview(key);
      this.clearExternalVolatilityIfUnused(key);
    };
  }

  interactiveCodePreviewFor(card: BaseDef): CodePreviewSandbox | undefined {
    let key = this.interactiveCodePreviewKey(card);
    if (key) {
      this.interactiveCodePreviewRevisionFor(key).consume();
    }
    return key ? this.interactiveCodePreviews.get(key) : undefined;
  }

  private interactiveCodePreviewKey(card: BaseDef): string | undefined {
    let ref = getOpaqueRealmCardState(card)?.typeRef;
    if (!ref || !('module' in ref)) {
      return undefined;
    }
    try {
      return codePreviewModuleKey(String(ref.module));
    } catch {
      return undefined;
    }
  }

  private ensureInteractiveCodePreview(
    key: string,
    generation: VolatileModuleGeneration,
  ): CodePreviewSandbox | undefined {
    if (!this.interactiveCodePreviewConsumers.get(key)?.size) {
      return undefined;
    }
    let preview = this.interactiveCodePreviews.get(key);
    if (!preview) {
      preview = new CodePreviewSandbox();
      this.interactiveCodePreviews.set(key, preview);
    }
    this.seedCodePreviewSource(
      preview,
      generation.sourceURL,
      generation.source,
    );
    return preview;
  }

  private scheduleInteractiveCodePreviewSettlement(
    key: string,
    generation: VolatileModuleGeneration,
  ) {
    // A server-observed write stays on the private loader for the lifetime of
    // the displayed card. Unlike an unsaved Monaco/assistant burst, there is
    // no useful quiet-period handoff: doing so would rebuild the realm loader
    // while the user is still looking at the same card.
    if (this.externallyVolatileModules.has(key)) {
      return;
    }
    let previous = this.interactiveCodePreviewTimers.get(key);
    if (previous) {
      clearTimeout(previous);
    }
    let delay = Math.max(0, generation.expiresAt - Date.now()) + 1;
    let timer = setTimeout(() => {
      this.interactiveCodePreviewTimers.delete(key);
      let current = this.volatileModules.current(generation.sourceURL);
      if (current) {
        this.scheduleInteractiveCodePreviewSettlement(key, current);
        return;
      }
      this.settleInteractiveCodePreview(key);
    }, delay);
    this.interactiveCodePreviewTimers.set(key, timer);
  }

  private settleInteractiveCodePreview(key: string) {
    let timer = this.interactiveCodePreviewTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.interactiveCodePreviewTimers.delete(key);
    }
    let preview = this.interactiveCodePreviews.get(key);
    if (!preview) {
      return;
    }
    this.interactiveCodePreviews.delete(key);
    this.releaseCodePreviewSandbox(preview);
    this.bumpInteractiveCodePreview(key);
    setTimeout(() => {
      if (
        !this.interactiveCodePreviews.has(key) &&
        !this.interactiveCodePreviewTimers.has(key)
      ) {
        this.interactiveCodePreviewRevisions.delete(key);
      }
    }, 0);
  }

  // Mutation, not UI mode, opens the volatile lease. The first Monaco change
  // or AI search/replace command seeds this buffer; following commands compose
  // against it without waiting for persistence/indexing to round-trip.
  beginVolatileModuleMutation(sourceURL: string, canonicalSource: string) {
    return this.volatileModules.begin(sourceURL, canonicalSource).source;
  }

  publishCodePreviewSource(
    codePreviewSandbox: CodePreviewSandbox,
    sourceURL: string,
    source: string,
  ) {
    let generation = this.volatileModules.publish(sourceURL, source);
    this.seedCodePreviewSource(codePreviewSandbox, sourceURL, source);
    return generation;
  }

  seedCodePreviewSource(
    codePreviewSandbox: CodePreviewSandbox,
    sourceURL: string,
    source: string,
  ) {
    let previousKey = codePreviewSandbox.sourceURL
      ? codePreviewModuleKey(codePreviewSandbox.sourceURL)
      : undefined;
    this.activeCodePreviews.add(codePreviewSandbox);
    codePreviewSandbox.update(sourceURL, source);
    if (previousKey && previousKey !== codePreviewModuleKey(sourceURL)) {
      this.clearExternalVolatilityIfUnused(previousKey);
    }
    void this.classifyCodePreviewSource(codePreviewSandbox);
  }

  // AI patches do not need to know whether Monaco, SES, or an iframe owns the
  // preview. Publish one generation to every mounted preview of this module;
  // each private loader then evaluates that same immutable source.
  publishVolatileModuleSource(sourceURL: string, source: string) {
    let generation = this.volatileModules.publish(sourceURL, source);
    let key = codePreviewModuleKey(sourceURL);
    let interactivePreview = this.ensureInteractiveCodePreview(key, generation);
    for (let preview of this.activeCodePreviews) {
      if (
        preview !== interactivePreview &&
        preview.active &&
        preview.sourceURL &&
        sameCodePreviewModuleURL(preview.sourceURL, sourceURL)
      ) {
        preview.update(sourceURL, source);
        void this.classifyCodePreviewSource(preview);
      }
    }
    if (interactivePreview && !this.externallyVolatileModules.has(key)) {
      this.scheduleInteractiveCodePreviewSettlement(key, generation);
    }
    this.bumpInteractiveCodePreview(key);
    return generation;
  }

  isLatestVolatileModuleGeneration(generation: VolatileModuleGeneration) {
    return this.volatileModules.isLatestPublished(generation);
  }

  // A CLI or another browser can rewrite a module without going through the
  // local Monaco/assistant buffer. If every executable invalidation belongs to
  // a module that is currently displayed, fetch the new source into those
  // cards' private preview loaders instead of cloning the shared realm loader.
  // The caller can then skip its broad loader reset. The lease lasts until the
  // last displayed consumer unloads.
  handleExternalModuleInvalidations(invalidations: string[]): boolean {
    let executableInvalidations = invalidations.filter(hasExecutableExtension);
    let handled = this.handleExternalModuleInvalidationPartition(invalidations);
    return (
      executableInvalidations.length > 0 &&
      handled.size === executableInvalidations.length
    );
  }

  // Partition a mixed realm event instead of making HMR all-or-nothing. Every
  // displayed module advances through its private preview runtime; undisplayed
  // modules remain for Store's targeted canonical invalidation path.
  handleExternalModuleInvalidationPartition(
    invalidations: string[],
  ): Set<string> {
    let handled = new Set<string>();
    for (let sourceURL of invalidations.filter(hasExecutableExtension)) {
      if (
        !this.hasDisplayedModuleConsumerKey(codePreviewModuleKey(sourceURL))
      ) {
        continue;
      }
      this.queueExternalModuleRefresh(sourceURL);
      handled.add(sourceURL);
    }
    return handled;
  }

  hasDisplayedModuleConsumer(sourceURL: string): boolean {
    try {
      return this.hasDisplayedModuleConsumerKey(
        codePreviewModuleKey(sourceURL),
      );
    } catch {
      return false;
    }
  }

  isUsingExternalModuleHMR(sourceURL: string): boolean {
    try {
      return this.externallyVolatileModules.has(
        codePreviewModuleKey(sourceURL),
      );
    } catch {
      return false;
    }
  }

  private hasDisplayedModuleConsumerKey(key: string): boolean {
    if (this.interactiveCodePreviewConsumers.get(key)?.size) {
      return true;
    }
    return [...this.activeCodePreviews].some(
      (preview) =>
        preview.active &&
        preview.sourceURL != null &&
        codePreviewModuleKey(preview.sourceURL) === key,
    );
  }

  private queueExternalModuleRefresh(sourceURL: string) {
    let key = codePreviewModuleKey(sourceURL);
    this.externalModuleInvalidationRevisions.set(
      key,
      (this.externalModuleInvalidationRevisions.get(key) ?? 0) + 1,
    );
    if (this.externalModuleRefreshes.has(key)) {
      return;
    }

    let refresh = this.refreshExternalModule(key, sourceURL).finally(() => {
      if (this.externalModuleRefreshes.get(key) === refresh) {
        this.externalModuleRefreshes.delete(key);
      }
    });
    this.externalModuleRefreshes.set(key, refresh);
  }

  private async refreshExternalModule(key: string, sourceURL: string) {
    while (this.hasDisplayedModuleConsumerKey(key)) {
      let expectedRevision =
        this.externalModuleInvalidationRevisions.get(key) ?? 0;
      let result: Awaited<ReturnType<CardService['getSource']>>;
      try {
        result = await this.cardService.getSource(rri(sourceURL));
      } catch {
        this.fallbackToCanonicalModule(key, sourceURL);
        return;
      }
      // Another event arrived while the request was in flight. Fetch once more
      // rather than briefly publishing a response that may be one write old.
      if (
        expectedRevision !== this.externalModuleInvalidationRevisions.get(key)
      ) {
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        this.fallbackToCanonicalModule(key, sourceURL);
        return;
      }

      this.externallyVolatileModules.add(key);
      let timer = this.interactiveCodePreviewTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.interactiveCodePreviewTimers.delete(key);
      }
      this.invalidateCanonicalSandboxModule(sourceURL);
      this.publishExternalModuleSource(sourceURL, result.content);
      return;
    }
    this.clearExternalVolatilityIfUnused(key);
  }

  private publishExternalModuleSource(sourceURL: string, source: string) {
    let generation = this.volatileModules.publish(sourceURL, source);
    let key = codePreviewModuleKey(sourceURL);
    let interactivePreview = this.ensureInteractiveCodePreview(key, generation);
    for (let preview of this.activeCodePreviews) {
      if (
        preview !== interactivePreview &&
        preview.active &&
        preview.sourceURL &&
        sameCodePreviewModuleURL(preview.sourceURL, sourceURL)
      ) {
        preview.update(sourceURL, source);
        void this.classifyCodePreviewSource(preview);
      }
    }
    this.bumpInteractiveCodePreview(key);
  }

  private fallbackToCanonicalModule(key: string, sourceURL: string) {
    this.externallyVolatileModules.delete(key);
    this.externalModuleInvalidationRevisions.delete(key);
    this.volatileModules.clear(sourceURL);
    this.invalidateCanonicalSandboxModule(sourceURL);
    let hadInteractivePreview = this.interactiveCodePreviews.has(key);
    this.settleInteractiveCodePreview(key);
    if (!hadInteractivePreview) {
      this.bumpInteractiveCodePreview(key);
    }
  }

  private clearExternalVolatilityIfUnused(key: string) {
    if (this.hasDisplayedModuleConsumerKey(key)) {
      return;
    }
    this.externallyVolatileModules.delete(key);
    this.externalModuleInvalidationRevisions.delete(key);
    this.volatileModules.clear(key);
  }

  // Card data remains in Store throughout source HMR. This only evicts the
  // changed module (plus loader-known dependants) and its inert template
  // cache from the ordinary realm compartment so a later non-volatile render
  // re-fetches canonical server source without rebuilding unrelated modules.
  invalidateCanonicalSandboxModule(sourceURL: string) {
    let key = codePreviewModuleKey(sourceURL);
    for (let runtime of this.realmRuntimes.values()) {
      runtime.invalidateModule(sourceURL);
    }
    for (let templateKey of this.canonicalTemplateKeysByModule.get(key) ?? []) {
      this.compartmentTemplates.delete(templateKey);
      this.compartmentLoads.delete(templateKey);
      this.compartmentFailures.delete(templateKey);
      this.scheduleCompartmentRevision(
        this.compartmentTemplateRevisionFor(templateKey),
      );
    }
    this.canonicalTemplateKeysByModule.delete(key);
    for (let moduleIdentifier of [...this.moduleClassifications.keys()]) {
      if (sameCodePreviewModuleURL(moduleIdentifier, sourceURL)) {
        this.moduleClassifications.delete(moduleIdentifier);
        this.moduleDependencies.delete(moduleIdentifier);
      }
    }
  }

  prepareCodePreviewCommit(
    codePreviewSandbox: CodePreviewSandbox,
    sourceURL: string,
    source: string,
    saveType: SaveType,
  ): PreparedCodePreviewCommit | undefined {
    if (
      (saveType !== 'editor' && saveType !== 'editor-with-instance') ||
      !codePreviewSandbox.matchesDraft(sourceURL, source)
    ) {
      return undefined;
    }

    return this.prepareVolatileModuleCommit(
      sourceURL,
      source,
      saveType,
      undefined,
      new Set([codePreviewSandbox]),
    );
  }

  prepareVolatileModuleCommit(
    sourceURL: string,
    source: string,
    saveType: SaveType,
    clientRequestId?: string,
    candidateSandboxes?: Set<CodePreviewSandbox>,
  ): PreparedCodePreviewCommit | undefined {
    if (
      saveType !== 'editor' &&
      saveType !== 'editor-with-instance' &&
      saveType !== 'bot-patch'
    ) {
      return undefined;
    }
    let sandboxes = new Set(
      candidateSandboxes ??
        [...this.activeCodePreviews].filter((preview) =>
          preview.matchesDraft(sourceURL, source),
        ),
    );
    for (let sandbox of sandboxes) {
      if (!sandbox.matchesDraft(sourceURL, source)) {
        sandboxes.delete(sandbox);
      }
    }
    let volatileGeneration = this.volatileModules.current(sourceURL);
    if (sandboxes.size === 0 || !volatileGeneration) {
      return undefined;
    }

    clientRequestId ??= this.cardService.createClientRequestId(saveType);
    let drafts = new Map<CodePreviewSandbox, CodePreviewDraft>();
    for (let sandbox of sandboxes) {
      if (sandbox.draft) {
        drafts.set(sandbox, sandbox.draft);
        sandbox.markCommitPrepared(sandbox.draft, clientRequestId);
      }
    }
    codePreviewCommitRegistry.set(clientRequestId, {
      sandboxes,
      drafts,
      sourceURL,
      expiresAt: volatileGeneration.expiresAt,
    });
    this.metrics.codePreviewCommitsPrepared++;
    // Match CardService's bounded request-id history. A missing realm event
    // must not make a long-lived Code mode session accumulate commits forever.
    if (codePreviewCommitRegistry.size > 250) {
      let oldest = codePreviewCommitRegistry.keys().next().value;
      if (oldest) {
        codePreviewCommitRegistry.delete(oldest);
      }
    }

    let finish = (persisted: boolean) => {
      let entry = codePreviewCommitRegistry.get(clientRequestId);
      if (!entry) {
        return;
      }
      if (persisted) {
        for (let sandbox of entry.sandboxes) {
          if (sandbox.active) {
            sandbox.markCommitPersisted(
              entry.drafts?.get(sandbox),
              clientRequestId,
            );
            sandbox.deferCanonicalRefresh();
          }
        }
      } else {
        for (let sandbox of entry.sandboxes) {
          sandbox.markCommitFailed(entry.drafts?.get(sandbox), clientRequestId);
        }
        codePreviewCommitRegistry.delete(clientRequestId);
      }
    };

    return {
      clientRequestId,
      shouldDeferStoreRefresh: () =>
        this.volatileModules.isVolatile(sourceURL) &&
        [...sandboxes].some((sandbox) => sandbox.active),
      persisted: () => finish(true),
      failed: () => finish(false),
    };
  }

  // The editor has already rendered this exact source revision. Its realm
  // event is an acknowledgement, not a second source update. This is a
  // read-only query because Store and live-search subscriptions receive the
  // same event independently and must all reach the same decision.
  isCodePreviewCommitAcknowledgement(
    clientRequestId: string | undefined,
    invalidations: string[],
  ): boolean {
    if (!clientRequestId) {
      return false;
    }
    let commit = codePreviewCommitRegistry.get(clientRequestId);
    if (
      !commit ||
      commit.expiresAt <= Date.now() ||
      !invalidations.some((url) =>
        sameCodePreviewModuleURL(url, commit.sourceURL),
      )
    ) {
      return false;
    }
    let hasActivePreview = false;
    for (let sandbox of commit.sandboxes) {
      if (sandbox.active) {
        hasActivePreview = true;
        sandbox.markCommitAcknowledged(
          commit.drafts?.get(sandbox),
          clientRequestId,
        );
        sandbox.deferCanonicalRefresh();
      }
    }
    if (!hasActivePreview) {
      return false;
    }
    this.metrics.codePreviewAcknowledgementsRecognized++;
    return true;
  }

  async classifyCodePreviewSource(codePreviewSandbox: CodePreviewSandbox) {
    let expectedDraft = codePreviewSandbox.draft;
    if (!expectedDraft) {
      return;
    }
    let decision = await this.classifyCodePreviewDraft(expectedDraft);
    if (!decision) {
      return;
    }
    if (
      codePreviewSandbox.active &&
      codePreviewSandbox.draft === expectedDraft
    ) {
      codePreviewSandbox.applySandboxDecision(decision.tier, decision.reason);
    }
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
    return this.compartmentRuntimeFor(principal);
  }

  private sandboxDecisionFor(
    card: BaseDef,
    format: Format | undefined,
    codePreviewSandbox?: CodePreviewSandbox,
  ): { tier: CardRenderSandboxTier; reason: string } {
    let sourceDecision: { tier: CardRenderSandboxTier; reason: string };
    if (codePreviewSandbox) {
      sourceDecision = {
        tier: codePreviewSandbox.sandboxTier,
        reason: codePreviewSandbox.sandboxReason,
      };
    } else {
      let state = getOpaqueRealmCardState(card);
      let ref = state?.typeRef;
      if (!state || !ref || !('module' in ref)) {
        sourceDecision = {
          tier: 'compartment',
          reason: 'default-user-card',
        };
      } else {
        try {
          let moduleIdentifier = new URL(
            this.network.resolveImport(String(ref.module)),
            state.principal,
          ).href;
          sourceDecision = this.moduleSandboxDecision(
            moduleIdentifier,
            new Set(),
          );
        } catch {
          sourceDecision = {
            tier: 'compartment',
            reason: 'default-user-card',
          };
        }
      }
    }
    let decision = sandboxDecisionForFormat(sourceDecision, format);
    this.metrics.executionTier = decision.tier;
    this.metrics.executionReason = decision.reason;
    return decision;
  }

  private moduleSandboxDecision(
    moduleIdentifier: string,
    visited: Set<string>,
  ): { tier: CardRenderSandboxTier; reason: string } {
    if (visited.has(moduleIdentifier)) {
      return { tier: 'compartment', reason: 'default-user-card' };
    }
    visited.add(moduleIdentifier);
    let classification = this.moduleClassifications.get(moduleIdentifier);
    if (classification?.tier === 'iframe') {
      return {
        tier: 'iframe',
        reason: classification.reason,
      };
    }
    for (let dependency of this.moduleDependencies.get(moduleIdentifier) ??
      []) {
      let dependencyDecision = this.moduleSandboxDecision(dependency, visited);
      if (dependencyDecision.tier === 'iframe') {
        return {
          tier: 'iframe',
          reason: `dependency:${dependencyDecision.reason}`,
        };
      }
    }
    return {
      tier: 'compartment',
      reason: classification?.reason ?? 'default-user-card',
    };
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
      while (this.themes.size > maxCachedThemes) {
        let oldest = this.themes.keys().next().value;
        if (oldest == null) {
          break;
        }
        this.themes.delete(oldest);
      }
    } else {
      // Refresh insertion order so the bounded map behaves as an LRU.
      this.themes.delete(key);
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
    let tier = 'compartment';
    let snapshot = getOpaqueRealmCardState(card)?.snapshot ?? {};
    let previewSlot = codePreviewSandbox
      ? `${codePreviewSandbox.id}|${principal}|${moduleIdentifier}|${String(ref.name)}|${format}`
      : undefined;
    let previewKey = codePreviewSandbox
      ? `|${codePreviewSandbox.id}:${codePreviewSandbox.revision}`
      : '';
    let key = `${tier}|${principal}|${moduleIdentifier}|${String(ref.name)}|${format}${previewKey}`;
    this.compartmentTemplateRevisionFor(key).consume();
    if (!codePreviewSandbox) {
      let moduleKey = codePreviewModuleKey(moduleIdentifier);
      let templateKeys = this.canonicalTemplateKeysByModule.get(moduleKey);
      if (!templateKeys) {
        templateKeys = new Set();
        this.canonicalTemplateKeysByModule.set(moduleKey, templateKeys);
      }
      templateKeys.add(key);
    }
    let cached = this.compartmentTemplates.get(key);
    if (cached) {
      this.metrics.compartmentTemplateCacheHits++;
      return cached;
    }
    if (!this.compartmentLoads.has(key) && !this.compartmentFailures.has(key)) {
      this.metrics.compartmentTemplateCacheMisses++;
      this.updateCompartmentLoading(card, format, 1);
      let load = this.loadCompartmentTemplate(
        key,
        card,
        principal,
        moduleIdentifier,
        String(ref.name),
        format,
        snapshot,
        codePreviewSandbox,
        previewSlot,
        codePreviewSandbox?.draft,
      );
      this.compartmentLoads.set(key, load);
    }
    return previewSlot ? this.codePreviewTemplates.get(previewSlot) : undefined;
  }

  private async loadCompartmentTemplate(
    key: string,
    card: BaseDef,
    principal: string,
    moduleIdentifier: string,
    exportName: string,
    format: string,
    model: Record<string, unknown>,
    codePreviewSandbox?: CodePreviewSandbox,
    previewSlot?: string,
    expectedDraft?: CodePreviewDraft,
  ) {
    let waiterToken = compartmentTemplateWaiter.beginAsync();
    let started = performance.now();
    let failed = false;
    try {
      if (codePreviewSandbox) {
        // CodeSubmode provides the first Monaco snapshot immediately after the
        // editor model mounts. Do not start a competing remote evaluation in
        // the short render pass before that snapshot exists.
        if (!expectedDraft) {
          return;
        }
        this.scheduleCodePreviewStateUpdate(
          codePreviewSandbox,
          expectedDraft,
          () => codePreviewSandbox.markEvaluating(expectedDraft),
        );
        let entry = this.codePreviewRuntimeEntryFor(
          principal,
          codePreviewSandbox,
        );
        let evaluate = entry.pending
          .catch(() => undefined)
          .then(async () => {
            if (
              !codePreviewSandbox.active ||
              codePreviewSandbox.draft !== expectedDraft
            ) {
              return;
            }
            if (entry.revision !== expectedDraft.revision) {
              entry.draft = expectedDraft;
              entry.runtime.invalidateModule(expectedDraft.sourceURL);
              entry.revision = expectedDraft.revision;
            }
            await this.evaluateAndInstallCompartmentTemplate(
              key,
              card,
              principal,
              moduleIdentifier,
              exportName,
              format,
              model,
              codePreviewSandbox,
              previewSlot,
              expectedDraft,
            );
          });
        entry.pending = evaluate;
        await evaluate;
      } else {
        await this.evaluateAndInstallCompartmentTemplate(
          key,
          card,
          principal,
          moduleIdentifier,
          exportName,
          format,
          model,
        );
      }
    } catch (error) {
      failed = true;
      this.compartmentFailures.add(key);
      this.recordCompartmentError(error);
      if (codePreviewSandbox && expectedDraft) {
        this.scheduleCodePreviewStateUpdate(
          codePreviewSandbox,
          expectedDraft,
          () => codePreviewSandbox.reportError(expectedDraft, error, 'compile'),
        );
      }
    } finally {
      this.updateCompartmentLoading(card, format, -1);
      this.compartmentLoads.delete(key);
      if (!failed) {
        this.compartmentFailures.delete(key);
      }
      this.metrics.compartmentEvaluationTimeMs += performance.now() - started;
      // The template load itself is complete before we invalidate the tracked
      // render result. Publishing synchronously can recursively revalidate the
      // render that requested this load, while Ember's `next()` leaves a
      // run-loop timer that cannot settle. A native task avoids both: the
      // waiter closes with the cached result ready, then the next browser turn
      // asks Ember to consume it.
      compartmentTemplateWaiter.endAsync(waiterToken);
      this.scheduleCompartmentRevision(
        this.compartmentTemplateRevisionFor(key),
      );
    }
  }

  private updateCompartmentLoading(
    card: BaseDef,
    format: string,
    delta: 1 | -1,
  ) {
    let formats = this.compartmentLoadingByCard.get(card);
    if (!formats) {
      if (delta < 0) {
        return;
      }
      formats = new Map();
      this.compartmentLoadingByCard.set(card, formats);
    }
    let count = Math.max(0, (formats.get(format) ?? 0) + delta);
    if (count === 0) {
      formats.delete(format);
    } else {
      formats.set(format, count);
    }
    this.scheduleCompartmentRevision(
      this.compartmentLoadingRevisionFor(card, format),
    );
  }

  private async evaluateAndInstallCompartmentTemplate(
    key: string,
    card: BaseDef,
    principal: string,
    moduleIdentifier: string,
    exportName: string,
    format: string,
    model: Record<string, unknown>,
    codePreviewSandbox?: CodePreviewSandbox,
    previewSlot?: string,
    expectedDraft?: CodePreviewDraft,
  ) {
    let runtime = this.cardModuleRuntimeFor(principal, codePreviewSandbox);
    let trustedTestComponent =
      runtime instanceof RealmCompartmentModuleRuntime
        ? await runtime.trustedTestShimComponent(
            moduleIdentifier,
            exportName,
            format,
          )
        : undefined;
    if (trustedTestComponent) {
      this.installCompartmentTemplate(
        key,
        {
          component: trustedTestComponent as BaseDefComponent,
          styles: [],
        },
        codePreviewSandbox,
        previewSlot,
        expectedDraft,
      );
      return;
    }
    let bundle = await runtime.evaluateTemplate(
      moduleIdentifier,
      exportName,
      format,
    );
    let inertTemplate = await this.inertTemplateFromBundle(bundle, runtime);
    if (typeof inertTemplate === 'string') {
      throw new Error(inertTemplate);
    }
    if (codePreviewSandbox && expectedDraft) {
      this.assertCodePreviewTemplateRenders(
        inertTemplate.component,
        card,
        model,
        format as Format,
      );
    }
    this.installCompartmentTemplate(
      key,
      inertTemplate,
      codePreviewSandbox,
      previewSlot,
      expectedDraft,
    );
  }

  private assertCodePreviewTemplateRenders(
    component: BaseDefComponent,
    card: BaseDef,
    model: Record<string, unknown>,
    format: Format,
  ) {
    // Evaluating a module proves that its class and template compile, but
    // Glimmer does not execute component getters until rendering. Validate a
    // volatile candidate outside the host render transaction so a throwing
    // getter cannot replace the visible last-known-good island or trap Ember
    // in a rerender loop.
    let element = document.createElement('div');
    let fields = this.fieldsFor(card, model, format);
    try {
      serializeWithArgs(component as any, element as any, getOwner(this)!, {
        cardOrField: card.constructor,
        model,
        fields,
        context: undefined,
        format,
        set: () => undefined,
        viewCard: () => undefined,
      });
    } finally {
      teardown(element as any);
    }
  }

  private installCompartmentTemplate(
    key: string,
    inertTemplate: InertTemplate,
    codePreviewSandbox?: CodePreviewSandbox,
    previewSlot?: string,
    expectedDraft?: CodePreviewDraft,
  ) {
    if (
      codePreviewSandbox &&
      (!codePreviewSandbox.active || codePreviewSandbox.draft !== expectedDraft)
    ) {
      return;
    }
    this.compartmentTemplates.set(key, inertTemplate);
    this.compartmentFailures.delete(key);
    if (previewSlot) {
      let previousKey = this.codePreviewTemplateKeys.get(previewSlot);
      let previousTemplate = this.codePreviewTemplates.get(previewSlot);
      if (codePreviewSandbox && expectedDraft) {
        this.pendingCodePreviewTemplates.set(inertTemplate.component, {
          codePreviewSandbox,
          draft: expectedDraft,
          key,
          previewSlot,
          template: inertTemplate,
          previousKey,
          previousTemplate,
        });
      }
      this.codePreviewTemplateKeys.set(previewSlot, key);
      this.codePreviewTemplates.set(previewSlot, inertTemplate);
    } else {
      codePreviewSandbox?.clearError(expectedDraft);
    }
  }

  private onCodePreviewTemplateRendered = (component: BaseDefComponent) => {
    let pending = this.pendingCodePreviewTemplates.get(component);
    if (!pending) {
      return;
    }
    this.pendingCodePreviewTemplates.delete(component);
    if (
      this.codePreviewTemplates.get(pending.previewSlot) !== pending.template
    ) {
      return;
    }
    pending.codePreviewSandbox.clearError(pending.draft);
    pending.codePreviewSandbox.markRendered(pending.draft);
    if (pending.previousKey && pending.previousKey !== pending.key) {
      this.compartmentTemplates.delete(pending.previousKey);
      this.compartmentLoads.delete(pending.previousKey);
      this.compartmentFailures.delete(pending.previousKey);
      this.compartmentTemplateRevisions.delete(pending.previousKey);
    }
  };

  private onCodePreviewTemplateError = (
    error: unknown,
    component: BaseDefComponent,
  ) => {
    let pending = this.pendingCodePreviewTemplates.get(component);
    if (!pending) {
      return;
    }
    this.pendingCodePreviewTemplates.delete(component);
    if (
      this.codePreviewTemplates.get(pending.previewSlot) === pending.template
    ) {
      if (pending.previousTemplate && pending.previousKey) {
        this.codePreviewTemplates.set(
          pending.previewSlot,
          pending.previousTemplate,
        );
        this.codePreviewTemplateKeys.set(
          pending.previewSlot,
          pending.previousKey,
        );
      } else {
        this.codePreviewTemplates.delete(pending.previewSlot);
        this.codePreviewTemplateKeys.delete(pending.previewSlot);
      }
    }
    this.compartmentTemplates.delete(pending.key);
    this.compartmentLoads.delete(pending.key);
    this.compartmentFailures.add(pending.key);
    pending.codePreviewSandbox.reportError(pending.draft, error, 'runtime');
    this.scheduleCompartmentRevision(
      this.compartmentTemplateRevisionFor(pending.key),
    );
  };

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
    await this.recordModuleSourceClassification(
      response.url || request.url,
      await response.clone().text(),
    );
    return response;
  };

  private async recordModuleSourceClassification(
    moduleIdentifier: string,
    source: string,
    knownClassification?: CardSourceSandboxClassification,
  ) {
    let classification =
      knownClassification ?? (await classifyCardSourceForSandbox(source));
    this.moduleClassifications.set(moduleIdentifier, classification);
    let dependencies: string[] = [];
    for (let specifier of classification.imports) {
      if (isTrustedSandboxImport(specifier)) {
        continue;
      }
      try {
        dependencies.push(
          new URL(this.network.resolveImport(specifier), moduleIdentifier).href,
        );
      } catch {
        // The compartment loader will reject an unresolved bare specifier.
        // Keeping it out of the graph preserves the more restrictive SES
        // failure instead of silently escalating authority.
      }
    }
    this.moduleDependencies.set(moduleIdentifier, dependencies);
    for (let preview of this.activeCodePreviews) {
      if (!preview.sourceURL) {
        continue;
      }
      let rootModule = [...this.moduleClassifications.keys()].find(
        (candidate) => this.sameModuleURL(candidate, preview.sourceURL!),
      );
      let decision = rootModule
        ? this.moduleSandboxDecision(rootModule, new Set())
        : { tier: 'compartment' as const, reason: 'code-preview-ses' };
      preview.applySandboxDecision(decision.tier, decision.reason);
    }
  }

  private interactiveCodePreviewRevisionFor(key: string): ReactiveRevision {
    let revision = this.interactiveCodePreviewRevisions.get(key);
    if (!revision) {
      revision = new ReactiveRevision();
      this.interactiveCodePreviewRevisions.set(key, revision);
    }
    return revision;
  }

  private cardReloadRevisionFor(card: BaseDef): ReactiveRevision {
    let revision = this.cardReloadRevisions.get(card);
    if (!revision) {
      revision = new ReactiveRevision();
      this.cardReloadRevisions.set(card, revision);
    }
    return revision;
  }

  private bumpInteractiveCodePreview(key: string) {
    this.metricsRevision++;
    this.scheduleCompartmentRevision(
      this.interactiveCodePreviewRevisionFor(key),
    );
  }

  private compartmentTemplateRevisionFor(key: string): ReactiveRevision {
    let revision = this.compartmentTemplateRevisions.get(key);
    if (!revision) {
      revision = new ReactiveRevision();
      this.compartmentTemplateRevisions.set(key, revision);
    }
    return revision;
  }

  private compartmentLoadingRevisionFor(
    card: BaseDef,
    format: string,
  ): ReactiveRevision {
    let revisions = this.compartmentLoadingRevisions.get(card);
    if (!revisions) {
      revisions = new Map();
      this.compartmentLoadingRevisions.set(card, revisions);
    }
    let revision = revisions.get(format);
    if (!revision) {
      revision = new ReactiveRevision();
      revisions.set(format, revision);
    }
    return revision;
  }

  private scheduleCompartmentRevision(revision: ReactiveRevision) {
    this.pendingCompartmentRevisions.add(revision);
    if (this.compartmentRevisionFrame != null) {
      return;
    }
    this.compartmentRevisionFrame = scheduleOnce(
      'afterRender',
      this,
      this.flushCompartmentRevisions,
    );
  }

  private scheduleCodePreviewStateUpdate(
    sandbox: CodePreviewSandbox,
    expectedDraft: CodePreviewDraft,
    update: () => void,
  ) {
    schedule('afterRender', null, () => {
      if (sandbox.active && sandbox.draft === expectedDraft) {
        update();
      }
    });
  }

  private flushCompartmentRevisions() {
    this.compartmentRevisionFrame = undefined;
    let revisions = [...this.pendingCompartmentRevisions];
    this.pendingCompartmentRevisions.clear();
    for (let pending of revisions) {
      pending.bump();
    }
  }

  private async inertTemplateFromBundle(
    bundle: SandboxTemplateBundle,
    runtime: RealmCompartmentModuleRuntime,
  ): Promise<InertTemplate | string> {
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
          let live = runtime.instantiateComponent(
            descriptor.instance.handle,
            plainComponentArgs(args),
          );
          this.sandboxInstanceHandle = live.handle;
          this.sandboxState = live.state;
          for (let action of live.actions) {
            this.sandboxActions[action] = async (...actionArgs: unknown[]) => {
              if (!this.sandboxInstanceHandle) {
                return;
              }
              let updated = await runtime.invokeComponentAction(
                this.sandboxInstanceHandle,
                action,
                actionArgs,
              );
              this.sandboxState = updated.state;
              this.sandboxRevision++;
            };
          }
        }

        willDestroy() {
          super.willDestroy();
          if (this.sandboxInstanceHandle) {
            runtime.releaseComponentInstance(this.sandboxInstanceHandle);
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
              ? runtime.readComponentProperty(this.sandboxInstanceHandle, name)
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
    adoptsFromModule: string,
  ): URL {
    let value = relativeTo ?? id;
    if (!value) {
      let resolvedModule = this.network.resolveImport(adoptsFromModule);
      try {
        return new URL(resolvedModule);
      } catch {
        throw new Error('Sandboxed card has no URL for resolving adoptsFrom');
      }
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
    if (this.compartmentRevisionFrame != null) {
      cancel(this.compartmentRevisionFrame);
      this.compartmentRevisionFrame = undefined;
    }
    this.pendingCompartmentRevisions.clear();
    this.realmRuntimes.destroy();
    for (let timer of this.interactiveCodePreviewTimers.values()) {
      clearTimeout(timer);
    }
    this.interactiveCodePreviewTimers.clear();
    this.interactiveCodePreviewConsumers.clear();
    this.interactiveCodePreviews.clear();
    this.interactiveCodePreviewRevisions.clear();
    this.canonicalTemplateKeysByModule.clear();
    this.compartmentTemplates.clear();
    this.compartmentLoads.clear();
    this.compartmentFailures.clear();
    this.compartmentTemplateRevisions.clear();
    this.externallyVolatileModules.clear();
    this.externalModuleInvalidationRevisions.clear();
    this.externalModuleRefreshes.clear();
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
