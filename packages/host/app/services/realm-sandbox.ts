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

import { TrackedObject } from 'tracked-built-ins';

import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  canonicalModuleKey,
  type CodeRef,
  isResolvedCodeRef,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type Relationship,
  type ResolvedCodeRef,
  type RealmResourceIdentifier,
  SupportedMimeType,
  decodeScopedCSSRequest,
  getField,
  hasExecutableExtension,
  type getCard,
  localId as localIdSymbol,
  meta,
  primitive,
  realmURL as realmURLSymbol,
  rri,
  relativeReference,
} from '@cardstack/runtime-common';

import RealmSandboxDelegatedRender from '@cardstack/host/components/realm-sandbox-delegated-render';
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
  sandboxSetCapabilityArgument,
  sandboxViewCardCapabilityArgument,
  type SandboxCardFieldMetadata,
  type SandboxCardMethodResult,
  type SandboxCardTypeMetadata,
  type SandboxScopeReference,
  type SandboxTemplateBundle,
  type SandboxTrustedExportIdentity,
} from '@cardstack/host/lib/realm-compartment-module-runtime';
import {
  iframeFetchResponseLimitBytes,
  type RealmIframeSandboxPresentation,
  type RealmIframeSandboxTypePresentation,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';
import {
  getOpaqueRealmCardState,
  getOpaqueRealmCardTypeState,
  opaqueRealmCardTypeState,
  opaqueRealmCardState,
  type OpaqueRealmCardState,
  type OpaqueRealmCardTheme,
  type OpaqueRealmCardTypeState,
} from '@cardstack/host/lib/realm-sandbox-boundary';
import realmSandboxDelegatedCardComponent from '@cardstack/host/lib/realm-sandbox-delegated-card-component';
import realmSandboxFieldComponent from '@cardstack/host/lib/realm-sandbox-field-component';
import {
  allocateRealmSandboxIframeOrigin,
  isRealmSandboxIframeChildLocation,
  newRealmSandboxIframeNonce,
} from '@cardstack/host/lib/realm-sandbox-iframe-origin';
import {
  isBaseRealmModule,
  isCatalogRealmModule,
  isTrustedHostRealmModule,
  isModuleWithinRealm,
  trustedSandboxImportIdentity,
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
  CardOrFieldTypeIcon,
  CardContext,
  Field,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';

const compartmentTemplateWaiter = buildWaiter(
  'realm-sandbox:compartment-template',
);
const renderEnvelopeWaiter = buildWaiter('realm-sandbox:render-envelope');

const JAVASCRIPT_MODULE_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'text/ecmascript',
  'text/javascript',
]);

export function isExecutableModuleResponse(
  url: string,
  contentType: string | null,
): boolean {
  if (hasExecutableExtension(url)) {
    return true;
  }
  let mimeType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return Boolean(
    mimeType &&
    (JAVASCRIPT_MODULE_MIME_TYPES.has(mimeType) ||
      mimeType.endsWith('+javascript')),
  );
}

// A contextual component is a lookup capability, not additional schema.
// Glimmer must be able to resolve paths such as `@fields.cardInfo.name`, while
// Object.keys/Reflect.ownKeys must continue to describe only the authored
// top-level fields. Making the nested components enumerable caused generic
// field introspection to invent synthetic fields such as "Card Info Name".
export function withContextualComponents<T extends object>(
  target: T,
  contextualComponents: Record<string, unknown>,
  componentPrototype?: object,
): T {
  let handler: ProxyHandler<T> = {
    get(target, property, receiver) {
      if (
        typeof property === 'string' &&
        Object.prototype.hasOwnProperty.call(contextualComponents, property)
      ) {
        return contextualComponents[property];
      }
      return Reflect.get(target, property, receiver);
    },
  };
  if (componentPrototype) {
    handler.getPrototypeOf = () => componentPrototype;
  }
  return new Proxy(target, handler);
}

export interface RealmSandboxRender {
  component: BaseDefComponent;
  model: BaseDef | Record<string, unknown>;
  fields: Record<string, BaseDefComponent>;
  styles: string[];
  principal: string;
  markerBacked: boolean;
  trustedHostTemplate?: boolean;
  theme?: OpaqueRealmCardTheme;
  onError?: (error: unknown, component: BaseDefComponent) => void;
  onRendered?: (component: BaseDefComponent) => void;
}

export interface RealmSandboxRelationshipContext {
  getCard: getCard;
  cardContext?: CardContext;
  canWrite: () => boolean;
  viewCard?: ViewCardFn;
}

class StableRealmSandboxRender implements RealmSandboxRender {
  @tracked component: BaseDefComponent;
  @tracked model: BaseDef | Record<string, unknown>;
  @tracked fields: Record<string, BaseDefComponent>;
  @tracked styles: string[];
  @tracked principal: string;
  @tracked markerBacked: boolean;
  @tracked trustedHostTemplate: boolean;
  @tracked theme?: OpaqueRealmCardTheme;
  onError?: (error: unknown, component: BaseDefComponent) => void;
  onRendered?: (component: BaseDefComponent) => void;
  private pending?: RealmSandboxRender;
  private waiterToken?: ReturnType<typeof renderEnvelopeWaiter.beginAsync>;

  constructor(value: RealmSandboxRender) {
    this.component = value.component;
    this.model = value.model;
    this.fields = value.fields;
    this.styles = value.styles;
    this.principal = value.principal;
    this.markerBacked = value.markerBacked;
    this.trustedHostTemplate = value.trustedHostTemplate === true;
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
      current.markerBacked === value.markerBacked &&
      current.trustedHostTemplate === (value.trustedHostTemplate === true) &&
      current.theme === value.theme &&
      current.onError === value.onError &&
      current.onRendered === value.onRendered
    ) {
      return;
    }
    this.pending = value;
    this.waiterToken ??= renderEnvelopeWaiter.beginAsync();
    scheduleOnce('afterRender', this, this.flushUpdate);
  }

  private flushUpdate() {
    try {
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
      if (this.markerBacked !== value.markerBacked) {
        this.markerBacked = value.markerBacked;
      }
      if (this.trustedHostTemplate !== (value.trustedHostTemplate === true)) {
        this.trustedHostTemplate = value.trustedHostTemplate === true;
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
    } finally {
      if (this.waiterToken) {
        renderEnvelopeWaiter.endAsync(this.waiterToken);
        this.waiterToken = undefined;
      }
    }
  }
}

function sameStyles(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((stylesheet, index) => stylesheet === right[index])
  );
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameModuleClassification(
  left: CardSourceSandboxClassification | undefined,
  right: CardSourceSandboxClassification,
) {
  return (
    left?.tier === right.tier &&
    left.reason === right.reason &&
    left.propagatesToImporters === right.propagatesToImporters &&
    sameStrings(left.imports, right.imports) &&
    sameStrings(left.signals, right.signals)
  );
}

function sameTrustedExportIdentities(
  left: readonly SandboxTrustedExportIdentity[],
  right: readonly SandboxTrustedExportIdentity[],
) {
  return (
    left.length === right.length &&
    left.every(
      (identity, index) =>
        identity.module === right[index]?.module &&
        identity.name === right[index]?.name,
    )
  );
}

function sameFieldMetadata(
  left: Record<string, SandboxCardFieldMetadata>,
  right: Record<string, SandboxCardFieldMetadata>,
) {
  let leftNames = Object.keys(left);
  let rightNames = Object.keys(right);
  return (
    leftNames.length === rightNames.length &&
    leftNames.every((name) => {
      let leftField = left[name];
      let rightField = right[name];
      return (
        leftField?.kind === rightField?.kind &&
        leftField?.type.module === rightField?.type.module &&
        leftField?.type.name === rightField?.type.name
      );
    })
  );
}

function sameFieldTypes(
  left: Record<string, typeof BaseDef> | undefined,
  right: Record<string, typeof BaseDef>,
) {
  if (!left) {
    return Object.keys(right).length === 0;
  }
  let leftNames = Object.keys(left);
  let rightNames = Object.keys(right);
  return (
    leftNames.length === rightNames.length &&
    leftNames.every((name) => left[name] === right[name])
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
  // Host-only identity used to apply validated child data updates. This value
  // is never included in the MessageChannel connect payload.
  card: BaseDef;
  cardID?: string;
  document: LooseSingleCardDocument;
  format: Format;
  principal: string;
  rootModuleURL: string;
  targetOrigin: string;
  url: string;
  accessibleTitle: string;
  presentation: RealmIframeSandboxPresentation;
  codePreviewID?: string;
  onGenerationResult?: (revision: number, error?: string) => void;
  onTypePresentation?: (
    presentation: RealmIframeSandboxTypePresentation,
  ) => void;
  draft?: {
    sourceURL: string;
    source: string;
    revision: number;
  };
}

class StableRealmIframeSandboxRender implements RealmIframeSandboxRender {
  card: BaseDef;
  @tracked document: LooseSingleCardDocument;
  @tracked format: Format;
  @tracked principal: string;
  @tracked rootModuleURL: string;
  @tracked targetOrigin: string;
  @tracked url: string;
  @tracked accessibleTitle: string;
  @tracked presentation: RealmIframeSandboxPresentation;
  @tracked codePreviewID?: string;
  @tracked onGenerationResult?: (revision: number, error?: string) => void;
  @tracked onTypePresentation?: (
    presentation: RealmIframeSandboxTypePresentation,
  ) => void;
  @tracked draft?: RealmIframeSandboxRender['draft'];
  cardID?: string;
  private pending?: RealmIframeSandboxRender;

  constructor(value: RealmIframeSandboxRender) {
    this.card = value.card;
    this.cardID = value.cardID;
    this.document = value.document;
    this.format = value.format;
    this.principal = value.principal;
    this.rootModuleURL = value.rootModuleURL;
    this.targetOrigin = value.targetOrigin;
    this.url = value.url;
    this.accessibleTitle = value.accessibleTitle;
    this.presentation = value.presentation;
    this.codePreviewID = value.codePreviewID;
    this.onGenerationResult = value.onGenerationResult;
    this.onTypePresentation = value.onTypePresentation;
    this.draft = value.draft;
  }

  scheduleUpdate(value: RealmIframeSandboxRender) {
    this.pending = value;
    scheduleOnce('afterRender', this, this.flushUpdate);
  }

  private flushUpdate() {
    let value = this.pending;
    this.pending = undefined;
    if (!value) {
      return;
    }
    this.cardID = value.cardID;
    this.card = value.card;
    this.document = value.document;
    this.format = value.format;
    this.principal = value.principal;
    this.rootModuleURL = value.rootModuleURL;
    this.targetOrigin = value.targetOrigin;
    this.url = value.url;
    this.accessibleTitle = value.accessibleTitle;
    this.presentation = value.presentation;
    this.codePreviewID = value.codePreviewID;
    this.onGenerationResult = value.onGenerationResult;
    this.onTypePresentation = value.onTypePresentation;
    this.draft = value.draft;
  }
}

export interface RealmIframeFetchResult {
  body: string | ArrayBuffer | null;
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
  activeIframeConnections: number;
  activeCodePreviewLoaders: number;
  activeCompartmentLoads: number;
  cachedCompartmentTemplates: number;
  cachedThemes: number;
  codePreviewAnalysisCacheEntries: number;
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
    acknowledgementRecorded?: boolean;
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
const maxCompartmentErrorKinds = 64;

const networkBearingCSS =
  /(?:@import\b|(?:url|src|image|(?:-webkit-)?image-set|cross-fade|(?:-moz-)?element|paint)\s*\()/i;
const documentGlobalCSS =
  /@(?:font-face|font-feature-values|font-palette-values|property|counter-style|color-profile|page|viewport|(?:-moz-)?document|namespace|view-transition|position-try|scroll-timeline|custom-media|custom-selector)\b/i;
const namedLayerCSS = /@layer\b(?!\s*\{)/i;
// View-transition snapshots are painted in the document top layer, outside
// the card's paint-containment box. A sandbox card cannot start a transition
// itself, but a Host transition would still capture a named authored element
// and lift that snapshot above Host chrome. Keep that document-global naming
// surface out of shared-document SES styles.
const topLayerBearingCSS = /\bview-transition-(?:name|class)\s*:/i;
// These properties publish names into an ancestor/cross-tree lookup space.
// Even when the declaration's selector is scoped to one card, a matching Host
// rule can resolve the authored name and have its layout or animation changed.
// SES cards therefore cannot publish them into the shared document. Cards
// that need anchor positioning or named scroll/view timelines use the iframe
// tier, whose document owns a separate name registry.
const crossTreeNamedPropertyCSS =
  /\b(?:anchor-name|anchor-scope|timeline-scope|scroll-timeline-name|view-timeline-name)\s*:/i;

interface CompartmentCSSPolicy {
  requireScopedSelectors?: boolean;
}

function decodedCSSForPolicy(css: string): string {
  // CSS identifiers may use a 1-6 digit hex escape (with optional trailing
  // whitespace) or escape a single non-newline character. Decode a policy-only
  // copy before looking for fetch-bearing grammar. The authored source remains
  // unchanged and is returned only after this validation succeeds.
  return css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)),
    )
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTopLevelCSSList(value: string): string[] {
  let items: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    let character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses++;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets++;
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (character === ',' && parentheses === 0 && brackets === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  items.push(value.slice(start));
  return items;
}

function selectorTargetIsConfinedByTopLevelScope(selector: string): boolean {
  let parentheses = 0;
  let brackets = 0;
  let quote: string | undefined;
  let escaped = false;
  let lastScopeAttribute = -1;
  let lastEscapingCombinator = -1;

  for (let index = 0; index < selector.length; index++) {
    let character = selector[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses++;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets++;
      if (parentheses !== 0 || brackets !== 1) {
        continue;
      }
      let end = selector.indexOf(']', index + 1);
      if (end === -1) {
        return false;
      }
      let attribute = selector.slice(index + 1, end).trimStart();
      if (attribute.toLowerCase().startsWith('data-scopedcss-')) {
        lastScopeAttribute = index;
      }
      index = end;
      brackets--;
    } else if (
      parentheses === 0 &&
      brackets === 0 &&
      (character === '+' ||
        character === '~' ||
        (character === '|' && selector[index + 1] === '|'))
    ) {
      // Descendant and child combinators remain confined by a scoped ancestor.
      // Sibling/column combinators can leave that subtree, so a later scope is
      // required on the actual target side of the selector.
      lastEscapingCombinator = index;
    }
  }
  return lastScopeAttribute > lastEscapingCombinator;
}

function validateParsedCompartmentRules(
  rules: CSSRuleList,
  policy: CompartmentCSSPolicy,
  compiledScopes: ReadonlySet<string>,
): void {
  for (let rule of rules) {
    if (
      policy.requireScopedSelectors &&
      typeof CSSKeyframesRule !== 'undefined' &&
      rule instanceof CSSKeyframesRule &&
      ![...compiledScopes].some((scope) => rule.name.endsWith(`-${scope}`))
    ) {
      throw new Error(
        `Sandbox stylesheet keyframes escaped their compiled namespace: ${rule.name}`,
      );
    }
    if (
      policy.requireScopedSelectors &&
      typeof CSSStyleRule !== 'undefined' &&
      rule instanceof CSSStyleRule
    ) {
      let escapedSelector = splitTopLevelCSSList(rule.selectorText).find(
        (selector) => !selectorTargetIsConfinedByTopLevelScope(selector),
      );
      if (escapedSelector) {
        throw new Error(
          `Sandbox stylesheet selector escaped its compiled scope: ${escapedSelector.trim()}`,
        );
      }
    }

    // Grouping rules such as @media, @supports, @container, @scope, and
    // anonymous @layer expose nested cssRules. Keyframe steps do too, but they
    // are declarations rather than document selectors and have already been
    // given collision-resistant names by the scoped-CSS compiler.
    if (
      !(
        typeof CSSKeyframesRule !== 'undefined' &&
        rule instanceof CSSKeyframesRule
      ) &&
      'cssRules' in rule
    ) {
      validateParsedCompartmentRules(
        (rule as CSSRule & { cssRules: CSSRuleList }).cssRules,
        policy,
        compiledScopes,
      );
    }
  }
}

function compiledScopeNames(rules: CSSRuleList): Set<string> {
  let scopes = new Set<string>();
  for (let rule of rules) {
    if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
      for (let match of rule.selectorText.matchAll(
        /\[(data-scopedcss-[a-z0-9-]+)(?:[~|^$*]?=[^\]]+)?\]/gi,
      )) {
        if (match[1]) {
          scopes.add(match[1]);
        }
      }
    }
    if (
      !(
        typeof CSSKeyframesRule !== 'undefined' &&
        rule instanceof CSSKeyframesRule
      ) &&
      'cssRules' in rule
    ) {
      for (let scope of compiledScopeNames(
        (rule as CSSRule & { cssRules: CSSRuleList }).cssRules,
      )) {
        scopes.add(scope);
      }
    }
  }
  return scopes;
}

// Parse with the browser before inspecting. Raw regex replacement is not a
// security boundary: CSS escapes, comments, and image-set() can spell network
// requests without containing a literal `url(...)` substring. The detached
// constructed sheet uses the same parser as the eventual document stylesheet
// but cannot initiate fetches because it is never adopted. User-authored
// template styles additionally have to retain their compiler-injected scope on
// every selector. Theme CSS is validated for network access but is scoped by a
// separate theme projection step, so it does not use that selector invariant.
export function validateCompartmentCSS(
  css: string,
  policy: CompartmentCSSPolicy = {},
): string {
  if (typeof CSSStyleSheet === 'undefined') {
    throw new Error('Sandbox CSS validation is unavailable');
  }
  let decoded = decodedCSSForPolicy(css);
  if (networkBearingCSS.test(decoded)) {
    throw new Error('Sandbox stylesheet contains a network-bearing value');
  }
  if (
    policy.requireScopedSelectors &&
    (documentGlobalCSS.test(decoded) ||
      namedLayerCSS.test(decoded) ||
      topLayerBearingCSS.test(decoded) ||
      crossTreeNamedPropertyCSS.test(decoded))
  ) {
    throw new Error('Sandbox stylesheet contains a document-global rule');
  }
  let parsed = new CSSStyleSheet();
  try {
    parsed.replaceSync(css);
  } catch (error) {
    let detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(`Sandbox stylesheet could not be parsed${detail}`);
  }
  let normalized = [...parsed.cssRules].map((rule) => rule.cssText).join('\n');
  if (networkBearingCSS.test(normalized)) {
    throw new Error('Sandbox stylesheet contains a network-bearing value');
  }
  if (
    policy.requireScopedSelectors &&
    (documentGlobalCSS.test(normalized) ||
      namedLayerCSS.test(normalized) ||
      topLayerBearingCSS.test(normalized) ||
      crossTreeNamedPropertyCSS.test(normalized))
  ) {
    throw new Error('Sandbox stylesheet contains a document-global rule');
  }
  validateParsedCompartmentRules(
    parsed.cssRules,
    policy,
    compiledScopeNames(parsed.cssRules),
  );
  return css;
}

export function validateCompartmentInlineStyle(style: string): string {
  validateCompartmentCSS(`[data-realm-sandbox-inline-style] { ${style} }`);
  return style;
}

class ReactiveRevision {
  @tracked value = 0;

  consume() {
    return this.value;
  }

  bump() {
    this.value++;
  }
}

interface MutableOpaqueRealmCardTypeState extends OpaqueRealmCardTypeState {
  icon: CardOrFieldTypeIcon;
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
    (principal) => this.createCanonicalCompartmentRuntime(principal),
    (principal) => this.onRealmRuntimeEvicted(principal),
  );
  private canonicalRuntimeEpochs = new Map<string, number>();
  private nextCanonicalRuntimeEpoch = 0;
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
  private activeIframeConnections = new Set<object>();
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
  private moduleClassificationRevisions = new Map<string, ReactiveRevision>();
  private moduleDependencies = new Map<string, string[]>();
  private compartmentLoads = new Map<string, Promise<void>>();
  private compartmentLoadsByCard = new WeakMap<
    BaseDef,
    Map<string, Set<Promise<void>>>
  >();
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
  private opaqueTypeStates = new Map<string, MutableOpaqueRealmCardTypeState>();
  private opaqueTypeKeysByModule = new Map<string, Set<string>>();
  private opaqueMetadataRevisions = new Map<string, ReactiveRevision>();
  private opaqueDataRevisions = new WeakMap<BaseDef, ReactiveRevision>();
  private opaqueDataRenderers = new WeakMap<BaseDef, Set<() => void>>();
  private computedProjectionLoads = new WeakMap<BaseDef, Promise<void>>();
  private computedProjectionReady = new WeakSet<BaseDef>();
  private relationshipContexts = new WeakMap<
    BaseDef,
    RealmSandboxRelationshipContext
  >();
  private relationshipContextRevisions = new WeakMap<
    BaseDef,
    ReactiveRevision
  >();
  private relationshipContextInitialized = new WeakSet<BaseDef>();
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
  private delegatedComponents = new WeakMap<
    BaseDef,
    Map<string, BoxComponent>
  >();
  private iframeRenderEnvelopes = new WeakMap<
    BaseDef,
    Map<string, StableRealmIframeSandboxRender>
  >();
  private iframeRenderOrigins = new WeakMap<BaseDef, Map<string, string>>();
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
    activeIframeConnections: 0,
    activeCodePreviewLoaders: 0,
    activeCompartmentLoads: 0,
    cachedCompartmentTemplates: 0,
    cachedThemes: 0,
    codePreviewAnalysisCacheEntries: 0,
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

  async validateCodeRef(
    card: BaseDef,
    ref: CodeRef,
  ): Promise<ResolvedCodeRef | undefined> {
    let state = getOpaqueRealmCardState(card);
    if (!state) {
      return undefined;
    }
    // A CodeRef editor asks this capability to resolve relative inert
    // descriptors. Requiring an already-resolved ref here would reject the
    // exact input this boundary exists to validate.
    if (
      !('module' in ref) ||
      !('name' in ref) ||
      typeof ref.module !== 'string' ||
      typeof ref.name !== 'string'
    ) {
      return undefined;
    }
    let refModule = ref.module;
    let refName = ref.name;
    try {
      let moduleIdentifier = String(refModule);
      if (moduleIdentifier.startsWith('.')) {
        let snapshotID = state.snapshot.id;
        let cardID = (card as BaseDef & { id?: string }).id;
        let referenceBase =
          state.document.data.id ??
          (typeof snapshotID === 'string' ? snapshotID : undefined) ??
          cardID;
        if (!referenceBase) {
          // A newly-created preview can become editable before its persisted
          // document acknowledgement supplies an id. Preserve the ordinary
          // card-relative semantics with an inert temporary instance path in
          // the same realm; no URL from the card crosses this boundary.
          let typeName =
            'name' in state.typeRef ? String(state.typeRef.name) : 'Card';
          referenceBase = new URL(
            `${encodeURIComponent(typeName)}/__preview__`,
            state.principal,
          ).href;
        }
        moduleIdentifier = new URL(
          moduleIdentifier,
          this.network.virtualNetwork.toURL(referenceBase),
        ).href;
      }
      let resolvedRef = {
        module: rri(moduleIdentifier),
        name: refName,
      } satisfies ResolvedCodeRef;
      let hasExport = await this.compartmentRuntimeFor(
        state.principal,
      ).hasModuleExport(moduleIdentifier, refName);
      return hasExport ? resolvedRef : undefined;
    } catch (error) {
      this.recordCompartmentError(error);
      return undefined;
    }
  }

  // Explicit inert-data adapters for runtime-common's client-side search
  // matcher. They replace constructor/field introspection for opaque records;
  // ordinary CardDefs return undefined and keep using card-api.
  opaqueCardIsInstanceOf(card: BaseDef, ref: CodeRef): boolean | undefined {
    let state = getOpaqueRealmCardState(card);
    let typeState = getOpaqueRealmCardTypeState(card);
    if (
      !state ||
      !isResolvedCodeRef(state.typeRef) ||
      !isResolvedCodeRef(ref)
    ) {
      return undefined;
    }
    let actualModule = canonicalModuleKey(
      state.typeRef.module,
      this.network.virtualNetwork,
    );
    let expectedModule = canonicalModuleKey(
      ref.module,
      this.network.virtualNetwork,
    );
    if (state.typeRef.name === ref.name && actualModule === expectedModule) {
      return true;
    }
    return Boolean(
      typeState?.ancestorTypes.some(
        (ancestor) =>
          ancestor.name === ref.name &&
          canonicalModuleKey(ancestor.module, this.network.virtualNetwork) ===
            expectedModule,
      ),
    );
  }

  resolveOpaqueQueryablePath(
    card: BaseDef,
    path: string,
  ):
    | {
        values: unknown[];
        leafField: Field | undefined;
        sawUnresolvable: boolean;
      }
    | undefined {
    let state = getOpaqueRealmCardState(card);
    if (!state) {
      return undefined;
    }
    this.opaqueDataRevisionFor(card).consume();
    let segments = path.split('.').filter(Boolean);
    if (segments.length === 0) {
      return { values: [], leafField: undefined, sawUnresolvable: false };
    }
    let nodes: unknown[] = [state.snapshot];
    let sawUnresolvable = false;
    for (let index = 0; index < segments.length; index++) {
      let segment = segments[index]!;
      let next: unknown[] = [];
      for (let node of nodes) {
        if (node == null || typeof node !== 'object') {
          continue;
        }
        if (!(segment in node)) {
          // A relationship projection that only carries identity is a loaded
          // boundary placeholder, not evidence that a nested value is absent.
          // Trust the server result instead of incorrectly filtering it out.
          if (index > 0 && typeof (node as { id?: unknown }).id === 'string') {
            sawUnresolvable = true;
          }
          continue;
        }
        let value = (node as Record<string, unknown>)[segment];
        if (index < segments.length - 1 && Array.isArray(value)) {
          next.push(...value);
        } else {
          next.push(value);
        }
      }
      nodes = next;
    }
    let values = nodes.flatMap((value) =>
      Array.isArray(value) ? value : [value],
    );
    return { values, leafField: undefined, sawUnresolvable };
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
    this.consumeOpaqueMetadataRevision(card);
    if (!field && this.isOpaqueCard(card)) {
      let components = this.delegatedComponents.get(card);
      if (!components) {
        components = new Map();
        this.delegatedComponents.set(card, components);
      }
      let key = opts?.componentCodeRef
        ? JSON.stringify(opts.componentCodeRef)
        : '';
      let component = components.get(key);
      if (!component) {
        component = realmSandboxDelegatedCardComponent(
          card,
          opts?.componentCodeRef,
        );
        components.set(key, component);
      }
      return component;
    }
    return card.constructor.getComponent(card, field, opts);
  }

  isOpaqueField(card: BaseDef): boolean {
    this.consumeOpaqueMetadataRevision(card);
    let kind = getOpaqueRealmCardTypeState(card)?.definitionKind;
    return kind === 'field' || kind === 'file';
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
      if (
        moduleIdentifiers.some((module) =>
          isModuleWithinRealm(module, realmURL),
        )
      ) {
        return realmURL;
      }
    }
    if (
      config.resolvedCatalogRealmURL &&
      moduleIdentifiers.some(
        (module) =>
          isCatalogRealmModule(module) ||
          isModuleWithinRealm(module, config.resolvedCatalogRealmURL!),
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
    resolveTrustedRelationship?: (
      id: string,
      fieldType: typeof BaseDef,
    ) => BaseDef | undefined,
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
    let key = `${moduleIdentifier}|${typeName}`;
    let api = await this.cardService.getAPI();
    let OpaqueCard = this.opaqueCardTypes.get(key);
    let typeState = this.opaqueTypeStates.get(key);
    let trustedFieldTypes = this.trustedFieldTypesByOpaqueType.get(key);
    let fieldMetadata = this.fieldMetadataByOpaqueType.get(key);
    if (!OpaqueCard) {
      let metadata = await this.loadCardTypeMetadata(
        principal,
        moduleIdentifier,
        typeName,
      );
      let definitionKind = metadata?.definitionKind ?? 'card';
      let displayName = metadata?.displayName ?? typeName;
      let headerColor = this.safeHeaderColor(metadata?.headerColor);
      let hasCustomEditTemplate = metadata?.hasCustomEditTemplate === true;
      let hasCustomIsolatedTemplate =
        metadata?.hasCustomIsolatedTemplate === true;
      let authoredTemplateFormats = metadata?.authoredTemplateFormats;
      let prefersWideFormat = metadata?.prefersWideFormat === true;
      fieldMetadata = metadata?.fields ?? {};
      trustedFieldTypes = await this.resolveTrustedFieldTypes(fieldMetadata);
      // `cardInfo` is inherited from trusted Base and therefore may not be
      // repeated in user-authored metadata. Preserve its concrete FieldDef so
      // nested name/summary/theme/notes editors use the normal Base widgets.
      trustedFieldTypes.cardInfo = api.CardInfoField;
      typeState = {
        typeRef: resolvedTypeRef,
        definitionKind,
        ancestorTypes: metadata?.ancestorTypes ?? [],
        displayName,
        fields: Object.freeze(
          this.canonicalOpaqueFieldMetadata(fieldMetadata, trustedFieldTypes),
        ),
        hasCustomEditTemplate,
        hasCustomIsolatedTemplate,
        authoredTemplateFormats,
        headerColor,
        prefersWideFormat,
        icon:
          (await this.resolveTrustedIcon(metadata?.icon)) ??
          (definitionKind === 'card'
            ? api.CardDef.icon
            : definitionKind === 'file'
              ? api.FileDef.icon
              : api.FieldDef.icon),
      };
      let mutableTypeState = typeState;
      let OpaqueBase =
        definitionKind === 'card'
          ? api.CardDef
          : definitionKind === 'file'
            ? api.FileDef
            : api.FieldDef;
      let OpaqueDefinition = class OpaqueRealmCard extends OpaqueBase {
        static get displayName() {
          return mutableTypeState.displayName;
        }

        static get headerColor() {
          return mutableTypeState.headerColor;
        }

        static get prefersWideFormat() {
          return mutableTypeState.prefersWideFormat;
        }

        static get hasCustomEditTemplate() {
          return mutableTypeState.hasCustomEditTemplate;
        }

        static get hasCustomIsolatedTemplate() {
          return mutableTypeState.hasCustomIsolatedTemplate;
        }

        get [realmURLSymbol]() {
          let state = getOpaqueRealmCardState(this);
          if (!state) {
            return undefined;
          }
          // The sandbox principal answers "where may this card's code load
          // from?"; it is not necessarily the realm that owns this data
          // instance. Copies intentionally keep adopting code from the source
          // realm while their JSON belongs to the selected target realm.
          return new URL(state.document.data.meta.realmURL ?? state.principal);
        }
      };
      for (let [fieldName, metadata] of Object.entries(fieldMetadata)) {
        let fieldType = trustedFieldTypes[fieldName];
        if (!fieldType) {
          continue;
        }
        let initializer = () => {
          let useFieldType = (factory: (type: typeof BaseDef) => unknown) =>
            factory(fieldType);
          switch (metadata.kind) {
            case 'contains':
              return useFieldType(
                api.contains as unknown as (type: typeof BaseDef) => unknown,
              );
            case 'containsMany':
              return useFieldType(
                api.containsMany as unknown as (
                  type: typeof BaseDef,
                ) => unknown,
              );
            case 'linksTo':
              return useFieldType(
                api.linksTo as unknown as (type: typeof BaseDef) => unknown,
              );
            case 'linksToMany':
              return useFieldType(
                api.linksToMany as unknown as (type: typeof BaseDef) => unknown,
              );
          }
        };
        let descriptor = (
          api.field as unknown as (
            target: BaseDef,
            key: string,
            descriptor: { initializer: () => unknown },
          ) => PropertyDescriptor
        )(OpaqueDefinition.prototype as BaseDef, fieldName, { initializer });
        Object.defineProperty(
          OpaqueDefinition.prototype,
          fieldName,
          descriptor,
        );
      }
      OpaqueCard = OpaqueDefinition as unknown as typeof BaseDef;
      this.network.loaderService.loader.registerIdentity(OpaqueCard, {
        module: moduleIdentifier,
        name: typeName,
      });
      Object.defineProperty(OpaqueCard, 'icon', {
        configurable: true,
        get: () => mutableTypeState.icon,
      });
      // This is the compatibility shim for trusted Base code that calls its
      // existing getComponent(instance) helper (Markdown embeds, workspace
      // lists, and similar portals). Base already resolves a card's static
      // format slot; expose the Host delegate through that ordinary seam
      // instead of requiring a coordinated Base deployment or a new symbol.
      // Unauthored slots keep their trusted Base fallback, so blank cards and
      // default edit/isolated templates stay fast and never enter SES.
      let TrustedBase =
        definitionKind === 'card'
          ? api.CardDef
          : definitionKind === 'file'
            ? api.FileDef
            : api.FieldDef;
      for (let format of [
        'isolated',
        'embedded',
        'fitted',
        'atom',
        'edit',
        'head',
        'markdown',
      ]) {
        Object.defineProperty(OpaqueCard, format, {
          configurable: true,
          get: () =>
            mutableTypeState.authoredTemplateFormats?.includes(format)
              ? RealmSandboxDelegatedRender
              : Reflect.get(TrustedBase, format),
        });
      }
      Object.defineProperty(OpaqueCard, opaqueRealmCardTypeState, {
        configurable: false,
        enumerable: false,
        value: typeState,
      });
      this.opaqueCardTypes.set(key, OpaqueCard);
      this.opaqueTypeStates.set(key, typeState);
      let moduleKey = codePreviewModuleKey(moduleIdentifier);
      let typeKeys = this.opaqueTypeKeysByModule.get(moduleKey);
      if (!typeKeys) {
        typeKeys = new Set();
        this.opaqueTypeKeysByModule.set(moduleKey, typeKeys);
      }
      typeKeys.add(key);
      this.trustedFieldTypesByOpaqueType.set(key, trustedFieldTypes);
      this.fieldMetadataByOpaqueType.set(key, fieldMetadata);
    }
    if (!OpaqueCard) {
      throw new Error(`Unable to construct opaque card type ${key}`);
    }
    Object.defineProperty(snapshot, realmURLSymbol, {
      configurable: false,
      enumerable: false,
      value: new URL(resource.meta.realmURL ?? principal),
    });
    // Start with the Realm document's inert JSON. SES computes its explicit
    // projection lazily when a shared-document format is actually requested.
    // Iframe-only cards therefore avoid a redundant parent-compartment module
    // evaluation: the child deserializes this document through the ordinary
    // card runtime, which materializes computeVia inside the process boundary.
    snapshot = new TrackedObject(snapshot);
    // Authored templates commonly read `@model.constructor.displayName` and
    // `.icon`. Give them an inert presentation descriptor, not the executable
    // opaque CardDef class (which inherits host runtime methods). Keeping the
    // property non-enumerable also means component getter args remain JSON-only
    // when they are cloned back into the compartment.
    Object.defineProperty(snapshot, 'constructor', {
      configurable: true,
      enumerable: false,
      value: this.opaquePresentationConstructor(
        OpaqueCard.displayName,
        OpaqueCard.icon,
      ),
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
      resolveTrustedRelationship,
    };
    state.setField = (fieldName, value) => {
      this.setOpaqueCardFieldValue(card, state, fieldName, value);
    };
    Object.defineProperty(card, opaqueRealmCardState, { value: state });
    this.trustedFieldTypesByCard.set(card, trustedFieldTypes ?? {});
    this.fieldMetadataByCard.set(card, fieldMetadata ?? {});
    let proxies = new WeakMap<object, object>();
    let proxyTargets = new WeakMap<object, object>();
    let updateSnapshot = (fieldName: string, value: unknown) => {
      // `snapshot` is the stable tracked JSON projection consumed by a
      // mounted SES template. Dirty the affected top-level field instead of
      // replacing the projection: replacement would strand the live
      // component's @model argument on an obsolete object.
      state.snapshot[fieldName] = value;
    };
    let observableValue = (input: unknown, fieldName: string): unknown => {
      if (
        input === null ||
        typeof input !== 'object' ||
        (!Array.isArray(input) &&
          Object.getPrototypeOf(input) !== Object.prototype &&
          Object.getPrototypeOf(input) !== null)
      ) {
        return input;
      }
      let existing = proxies.get(input);
      if (existing) {
        return existing;
      }
      let proxy = new Proxy(input, {
        get: (target, property) =>
          observableValue(Reflect.get(target, property), fieldName),
        set: (target, property, value) => {
          let raw =
            value !== null && typeof value === 'object'
              ? (proxyTargets.get(value) ?? value)
              : value;
          let changed = Reflect.get(target, property) !== raw;
          let result = Reflect.set(target, property, raw);
          if (changed && result) {
            updateSnapshot(fieldName, state.snapshot[fieldName]);
            this.bumpOpaqueData(card);
          }
          return result;
        },
        deleteProperty: (target, property) => {
          let existed = Reflect.has(target, property);
          let result = Reflect.deleteProperty(target, property);
          if (existed && result) {
            updateSnapshot(fieldName, state.snapshot[fieldName]);
            this.bumpOpaqueData(card);
          }
          return result;
        },
      });
      proxies.set(input, proxy);
      proxyTargets.set(proxy, input);
      return proxy;
    };
    for (let [name, value] of Object.entries(snapshot)) {
      if (name === 'id') {
        continue;
      }
      let current = this.hydrateTrustedRelationship(
        value,
        fieldMetadata?.[name],
        trustedFieldTypes?.[name],
        resolveTrustedRelationship,
      );
      let schemaDescriptor: PropertyDescriptor | undefined;
      let prototype: object | null = Object.getPrototypeOf(card);
      while (prototype && !schemaDescriptor) {
        schemaDescriptor = Object.getOwnPropertyDescriptor(prototype, name);
        prototype = Object.getPrototypeOf(prototype) as object | null;
      }
      // Base serialization reads declared fields through their schema
      // descriptor/data bucket. Seed that trusted bucket while retaining the
      // inert own-property facade used by sandbox templates.
      let seedSchemaField = Boolean(
        fieldMetadata?.[name] &&
        trustedFieldTypes?.[name] &&
        primitive in trustedFieldTypes[name],
      );
      if (seedSchemaField) {
        schemaDescriptor?.set?.call(card, current);
      }
      Object.defineProperty(card, name, {
        get: () => observableValue(current, name),
        set: (next) => {
          current =
            next !== null && typeof next === 'object'
              ? (proxyTargets.get(next) ?? next)
              : next;
          if (seedSchemaField) {
            schemaDescriptor?.set?.call(card, current);
          }
          updateSnapshot(name, current);
          this.bumpOpaqueData(card);
        },
        enumerable: true,
        configurable: true,
      });
    }
    return card;
  }

  async createOpaqueFieldValue(
    parentCard: BaseDef,
    fieldName: string,
    fieldType: ResolvedCodeRef,
    value: unknown,
  ): Promise<BaseDef> {
    let parentState = getOpaqueRealmCardState(parentCard);
    if (!parentState) {
      throw new Error('Sandboxed field value requires an opaque parent card');
    }
    let attributes =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : { value };
    let resource: LooseCardResource = {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: {
          module: fieldType.module,
          name: fieldType.name,
        },
      },
    };
    let parentID = parentState.snapshot.id;
    return this.createOpaqueCard(
      resource,
      typeof parentID === 'string'
        ? rri(parentID)
        : new URL(parentState.principal),
      parentState.document,
      `sandbox-field:${fieldName}`,
      parentState.resolveTrustedRelationship,
    );
  }

  async invokeOpaqueCardMethod(
    card: BaseDef,
    methodName: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    let state = getOpaqueRealmCardState(card);
    if (!state) {
      throw new Error('Cannot invoke a sandbox method on a trusted card');
    }
    if (!isResolvedCodeRef(state.typeRef)) {
      throw new Error('Cannot invoke a sandbox method without a resolved type');
    }
    let moduleIdentifier = String(state.typeRef.module);
    let runtime = this.compartmentRuntimeFor(state.principal);
    let result: SandboxCardMethodResult = await runtime.invokeCardMethod(
      moduleIdentifier,
      String(state.typeRef.name),
      state.snapshot,
      methodName,
      args,
    );
    if (!result.card) {
      return result.returnValue;
    }
    let resource: LooseCardResource = {
      type: 'card',
      attributes: result.card.attributes,
      meta: {
        adoptsFrom: {
          module: rri(result.card.type.module),
          name: result.card.type.name,
        },
      },
    };
    return this.createOpaqueCard(
      resource,
      new URL(state.principal),
      state.document,
      undefined,
      state.resolveTrustedRelationship,
    );
  }

  async updateOpaqueCardFromDocument(
    card: BaseDef,
    document: LooseSingleCardDocument,
    options: { recomputeProjection?: boolean } = {},
  ): Promise<BaseDef | false> {
    let state = getOpaqueRealmCardState(card);
    if (!state || !isResolvedCodeRef(state.typeRef)) {
      return false;
    }

    let relativeURL = this.relativeURL(
      document.data.id ? rri(document.data.id) : undefined,
      document.data.id,
      String(state.typeRef.module),
    );
    let nextTypeRef = document.data.meta.adoptsFrom;
    if (!isResolvedCodeRef(nextTypeRef)) {
      return false;
    }
    let nextModuleIdentifier = new URL(
      this.network.resolveImport(String(nextTypeRef.module)),
      relativeURL,
    ).href;
    let currentModuleIdentifier = this.network.virtualNetwork.toURL(
      state.typeRef.module,
    ).href;
    if (
      currentModuleIdentifier !== nextModuleIdentifier ||
      String(state.typeRef.name) !== String(nextTypeRef.name)
    ) {
      // A CardDef's class is fixed at construction. Re-pointing adoptsFrom is
      // therefore the one data edit that cannot preserve the opaque record
      // object itself. Rebuild only this record, retain its local identity,
      // and let Store replace the canonical remote-id entry; every unrelated
      // sandbox runtime, loader, stylesheet, and rendered island stays live.
      return await this.createOpaqueCard(
        document.data,
        document.data.id ? rri(document.data.id) : relativeURL,
        document,
        (card as BaseDef & { [localIdSymbol]: string })[localIdSymbol],
        state.resolveTrustedRelationship,
      );
    }
    let previousSnapshot = state.snapshot;
    let nextSnapshot = this.snapshotFromResource(
      document.data,
      relativeURL,
      document,
    );
    if (
      options.recomputeProjection !== false &&
      this.computedProjectionReady.has(card)
    ) {
      nextSnapshot = await this.evaluateCardProjection(
        state.principal,
        currentModuleIdentifier,
        String(state.typeRef.name),
        nextSnapshot,
      );
    }
    Object.defineProperty(nextSnapshot, realmURLSymbol, {
      configurable: false,
      enumerable: false,
      value: new URL(document.data.meta.realmURL ?? state.principal),
    });
    // The rendered SES island receives this object as @model. Preserve that
    // boundary identity across server/index reconciliation so a data update
    // can rerender the mounted island in place instead of leaving its args
    // pointed at the previous snapshot generation.
    for (let fieldName of Object.keys(previousSnapshot)) {
      if (!(fieldName in nextSnapshot)) {
        delete previousSnapshot[fieldName];
      }
    }
    for (let [fieldName, value] of Object.entries(nextSnapshot)) {
      previousSnapshot[fieldName] = value;
    }
    state.document = structuredClone(document);
    state.snapshot = previousSnapshot;
    this.syncOpaqueCardPresentation(card, state);

    for (let fieldName of new Set([
      ...Object.keys(previousSnapshot),
      ...Object.keys(nextSnapshot),
    ])) {
      if (fieldName === 'id') {
        continue;
      }
      // This is a server/index acknowledgement, not a new local edit. Update
      // the opaque projection without feeding the autosave subscriber back
      // into another persist cycle.
      let typeKey = this.opaqueTypeKeyFor(card);
      let fieldMetadata = typeKey
        ? this.fieldMetadataByOpaqueType.get(typeKey)?.[fieldName]
        : this.fieldMetadataByCard.get(card)?.[fieldName];
      let fieldType = typeKey
        ? this.trustedFieldTypesByOpaqueType.get(typeKey)?.[fieldName]
        : this.trustedFieldTypesByCard.get(card)?.[fieldName];
      this.setOpaqueCardFieldValue(
        card,
        state,
        fieldName,
        this.hydrateTrustedRelationship(
          nextSnapshot[fieldName],
          fieldMetadata,
          fieldType,
          state.resolveTrustedRelationship,
        ),
        false,
      );
    }
    // Opaque field setters update this same tracked projection. Reconciliation
    // must likewise keep the mounted island's existing @model object.
    state.snapshot = previousSnapshot;
    this.bumpOpaqueData(card);
    return card;
  }

  renderFor(
    card: BaseDef,
    format: Format | undefined,
    options: {
      useBaseTemplate?: boolean;
      codePreviewSandbox?: CodePreviewSandbox;
      codeRef?: CodeRef;
      markerBacked?: boolean;
      stableEnvelope?: boolean;
    } = {},
  ): RealmSandboxRender | undefined {
    this.consumeOpaqueMetadataRevision(card);
    this.opaqueDataRevisionFor(card).consume();
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
    this.syncOpaqueCardPresentation(card, opaqueState);
    let useBaseTemplate =
      options.useBaseTemplate === true ||
      this.usesInheritedBaseTemplate(card, effectiveFormat);
    let decision = this.sandboxDecisionFor(
      card,
      effectiveFormat,
      options.codePreviewSandbox,
    );
    if (!useBaseTemplate && decision.tier === 'iframe') {
      return undefined;
    }
    this.metrics.renderRequests++;
    let principal = opaqueState.principal;
    // Kick off the SES projection and template imports in the same render
    // turn. They share the compartment runtime/module cache, but neither load
    // needs to block the other. Iframe renders return above and never pay this
    // parent-compartment projection cost.
    let projectionReady =
      useBaseTemplate ||
      this.ensureComputedProjection(
        card,
        opaqueState,
        effectiveFormat,
        options.codePreviewSandbox,
      );
    let inertTemplate = useBaseTemplate
      ? this.trustedBaseTemplateFor(card, effectiveFormat, options.codeRef)
      : this.compartmentTemplateFor(
          card,
          effectiveFormat,
          principal,
          options.codePreviewSandbox,
          options.codeRef,
        );
    if (!inertTemplate || !projectionReady) {
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
    let componentRefKey =
      options.codeRef && isResolvedCodeRef(options.codeRef)
        ? `${String(options.codeRef.module)}#${String(options.codeRef.name)}`
        : '';
    let runtimeEpoch =
      !useBaseTemplate && !options.codePreviewSandbox
        ? (this.canonicalRuntimeEpochs.get(principal) ?? 0)
        : 0;
    let envelopeKey = `${effectiveFormat}|${useBaseTemplate ? 'base' : 'sandbox'}|${componentRefKey}|${options.codePreviewSandbox?.id ?? 'canonical'}|runtime:${runtimeEpoch}|reload:${reloadRevision}`;
    let envelopes = this.renderEnvelopes.get(card);
    if (!envelopes) {
      envelopes = new Map();
      this.renderEnvelopes.set(card, envelopes);
    }
    let markerBacked =
      options.markerBacked === true || options.codePreviewSandbox != null;
    let next = {
      component: inertTemplate.component,
      model,
      fields,
      styles: inertTemplate.styles,
      principal,
      markerBacked,
      trustedHostTemplate: useBaseTemplate,
      theme: opaqueState.presentation.theme,
      ...(options.codePreviewSandbox
        ? {
            onError: this.onCodePreviewTemplateError,
            onRendered: this.onCodePreviewTemplateRendered,
          }
        : {}),
    };
    if (options.stableEnvelope === false) {
      // Head format is rendered only into a hidden, inert metadata extractor.
      // It needs the latest snapshot synchronously and has no user-visible DOM
      // whose identity is worth preserving across generations.
      return new StableRealmSandboxRender(next);
    }
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

  async prepareRender(
    card: BaseDef,
    format: Format | undefined,
    options: Parameters<RealmSandboxService['renderFor']>[2] = {},
  ): Promise<RealmSandboxRender | undefined> {
    let render = this.renderFor(card, format, options);
    if (render) {
      return render;
    }

    let effectiveFormat = format ?? 'isolated';
    let loads = this.compartmentLoadsByCard.get(card)?.get(effectiveFormat);
    if (!loads?.size) {
      // The load can settle between the first cache read and the scoped
      // promise lookup. Re-read the installed template before concluding that
      // there is nothing to prepare.
      return this.renderFor(card, format, options);
    }

    await Promise.allSettled([...loads]);
    // Template installation queues its exact reactive revision in Ember's
    // afterRender phase. Let that publication finish before a low-level
    // CardIsland starts consuming the cell. Otherwise the queued revision can
    // revalidate the island outside renderCardIsland's explicit error capture
    // and replace an authored exception with Glimmer tracking cleanup noise.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return this.renderFor(card, format, options);
  }

  isRenderLoading(card: BaseDef, format: Format | undefined): boolean {
    let effectiveFormat = format ?? 'isolated';
    this.compartmentLoadingRevisionFor(card, effectiveFormat).consume();
    return (
      (this.compartmentLoadingByCard.get(card)?.get(effectiveFormat) ?? 0) > 0
    );
  }

  subscribeToOpaqueCardData(card: BaseDef, render: () => void): () => void {
    let renderers = this.opaqueDataRenderers.get(card);
    if (!renderers) {
      renderers = new Set();
      this.opaqueDataRenderers.set(card, renderers);
    }
    renderers.add(render);
    return () => {
      renderers?.delete(render);
      if (renderers?.size === 0) {
        this.opaqueDataRenderers.delete(card);
      }
    };
  }

  registerRelationshipContext(
    card: BaseDef,
    context: RealmSandboxRelationshipContext,
  ): () => void {
    this.relationshipContexts.set(card, context);
    let revision = this.relationshipContextRevisionFor(card);
    // The field island can render once before this host modifier registers.
    // Wake it exactly once. Subsequent modifier lifecycles already occur as
    // part of another render and must not recursively schedule a new render.
    if (!this.relationshipContextInitialized.has(card)) {
      this.relationshipContextInitialized.add(card);
      scheduleOnce('afterRender', revision, revision.bump);
    }
    return () => {
      if (this.relationshipContexts.get(card) === context) {
        this.relationshipContexts.delete(card);
      }
    };
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
    this.consumeOpaqueMetadataRevision(card);
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
    if (!state || !cardID) {
      return undefined;
    }
    this.syncOpaqueCardPresentation(card, state);
    let iframeFormat = this.safeIframeFormat(effectiveFormat);
    if (!iframeFormat) {
      return undefined;
    }
    if (!isResolvedCodeRef(state.typeRef)) {
      return undefined;
    }
    let rootModuleURL = this.network.virtualNetwork.toURL(
      state.typeRef.module,
    ).href;
    let resolvedCodeRef =
      options.codeRef && isResolvedCodeRef(options.codeRef)
        ? options.codeRef
        : undefined;
    let envelopeKey = `${iframeFormat}|${options.field?.name ?? ''}|${resolvedCodeRef?.module ?? ''}#${resolvedCodeRef?.name ?? ''}|${options.codePreviewSandbox?.id ?? 'canonical'}|reload:${reloadRevision}`;
    let targetOrigin = this.iframeSandboxOriginFor(card, envelopeKey);
    if (!targetOrigin) {
      return undefined;
    }
    let url = new URL('/_realm-sandbox-frame', targetOrigin);
    url.searchParams.set('cardURL', cardID);
    url.searchParams.set('parentOrigin', globalThis.location.origin);
    url.searchParams.set('reload', String(reloadRevision));
    this.metrics.executionTier = 'iframe';
    this.metrics.executionReason = decision.reason;
    let next: RealmIframeSandboxRender = {
      card,
      cardID,
      document: state.document,
      format: iframeFormat,
      principal: state.principal,
      rootModuleURL,
      targetOrigin,
      url: url.href,
      accessibleTitle: `${state.presentation.displayName} sandboxed card`,
      onTypePresentation: (presentation) =>
        this.applyIframeTypePresentation(card, presentation),
      presentation: {
        format: iframeFormat,
        displayContainer: options.displayContainer !== false,
        ...(options.field ? { fieldName: options.field.name } : {}),
        ...(resolvedCodeRef
          ? {
              codeRef: {
                module: resolvedCodeRef.module,
                name: resolvedCodeRef.name,
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
    let envelopes = this.iframeRenderEnvelopes.get(card);
    if (!envelopes) {
      envelopes = new Map();
      this.iframeRenderEnvelopes.set(card, envelopes);
    }
    let envelope = envelopes.get(envelopeKey);
    if (envelope) {
      envelope.scheduleUpdate(next);
      return envelope;
    }
    envelope = new StableRealmIframeSandboxRender(next);
    envelopes.set(envelopeKey, envelope);
    return envelope;
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
    if (!this.isIframeFetchAllowed(sandbox, url.href)) {
      throw new Error(`Iframe renderer denied undeclared module read: ${url}`);
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
    // Only declared Boxel realm dependencies receive the user's realm token.
    // Public CDN dependencies use the credentialless virtual network fetch.
    let isRealmRead =
      isModuleWithinRealm(url.href, sandbox.principal) ||
      Boolean(this.network.realm.realmOf(url));
    let fetch = isRealmRead ? this.network.authedFetch : this.network.fetch;
    let response = await fetch(url, {
      method,
      headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    let responseURL = response.url || url.href;
    if (!this.isIframeFetchAllowed(sandbox, responseURL)) {
      throw new Error('Iframe renderer response escaped its module allowlist');
    }
    let contentLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > iframeFetchResponseLimitBytes
    ) {
      throw new Error('Iframe renderer response exceeded its size limit');
    }
    let isExecutable = isExecutableModuleResponse(
      responseURL,
      response.headers.get('content-type'),
    );
    let body: string | ArrayBuffer | null = null;
    if (![204, 205, 304].includes(response.status)) {
      let bytes = await response.arrayBuffer();
      if (bytes.byteLength > iframeFetchResponseLimitBytes) {
        throw new Error('Iframe renderer response exceeded its size limit');
      }
      body = isExecutable ? new TextDecoder().decode(bytes) : bytes;
    }
    if (response.ok && typeof body === 'string' && isExecutable) {
      await this.recordModuleSourceClassification(responseURL, body);
    }
    let responseHeaders: [string, string][] = [];
    for (let name of [
      'content-type',
      'etag',
      'last-modified',
      'cache-control',
    ]) {
      let value = response.headers.get(name);
      if (value != null) {
        responseHeaders.push([name, value]);
      }
    }
    return {
      body,
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
      url: responseURL,
    };
  }

  private isIframeFetchAllowed(
    sandbox: RealmIframeSandboxRender,
    targetURL: string,
  ): boolean {
    if (
      sameCodePreviewModuleURL(targetURL, sandbox.rootModuleURL) ||
      isModuleWithinRealm(targetURL, sandbox.principal) ||
      trustedSandboxImportIdentity(targetURL, this.network.resolveImport)
    ) {
      return true;
    }
    let pending = [sandbox.rootModuleURL];
    let visited = new Set<string>();
    while (pending.length > 0) {
      let moduleIdentifier = pending.pop()!;
      if (visited.has(moduleIdentifier)) {
        continue;
      }
      visited.add(moduleIdentifier);
      for (let dependency of this.moduleDependencies.get(
        codePreviewModuleKey(moduleIdentifier),
      ) ?? []) {
        if (sameCodePreviewModuleURL(dependency, targetURL)) {
          return true;
        }
        pending.push(dependency);
      }
    }
    return false;
  }

  isIframeSandboxChild(): boolean {
    return isRealmSandboxIframeChildLocation(
      config.realmSandboxIframeOrigin,
      globalThis.location.origin,
      globalThis.location.href,
      globalThis.self !== globalThis.top,
    );
  }

  safeIframeFormat(format: string | undefined): Format | undefined {
    return ['isolated', 'embedded', 'edit'].includes(String(format))
      ? (format as Format)
      : undefined;
  }

  private iframeSandboxOriginFor(
    card: BaseDef,
    envelopeKey: string,
  ): string | undefined {
    let origins = this.iframeRenderOrigins.get(card);
    if (!origins) {
      origins = new Map();
      this.iframeRenderOrigins.set(card, origins);
    }
    let cached = origins.get(envelopeKey);
    if (cached) {
      return cached;
    }
    let origin = allocateRealmSandboxIframeOrigin(
      config.realmSandboxIframeOrigin,
      globalThis.location.origin,
      newRealmSandboxIframeNonce(),
    );
    if (origin) {
      origins.set(envelopeKey, origin);
    }
    return origin;
  }

  metricsSnapshot(): RealmSandboxMetrics {
    this.metricsRevision;
    return {
      ...this.metrics,
      activeCompartmentLoads: this.compartmentLoads.size,
      cachedCompartmentTemplates: this.compartmentTemplates.size,
      cachedThemes: this.themes.size,
      codePreviewAnalysisCacheEntries: this.codePreviewAnalyses.size,
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

  registerIframeConnection(token: object) {
    if (!this.activeIframeConnections.has(token)) {
      this.activeIframeConnections.add(token);
      this.metrics.activeIframeConnections = this.activeIframeConnections.size;
    }
  }

  releaseIframeConnection(token: object) {
    if (this.activeIframeConnections.delete(token)) {
      this.metrics.activeIframeConnections = this.activeIframeConnections.size;
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
    componentCodeRef?: CodeRef,
  ): InertTemplate | undefined {
    if (componentCodeRef && isResolvedCodeRef(componentCodeRef)) {
      let moduleIdentifier = this.resolveCardModule(
        String(componentCodeRef.module),
      );
      if (
        !trustedSandboxImportIdentity(
          moduleIdentifier,
          this.network.resolveImport,
        )
      ) {
        return undefined;
      }
      let key = `trusted-component|${moduleIdentifier}|${String(componentCodeRef.name)}|${format}`;
      this.compartmentTemplateRevisionFor(key).consume();
      let cached = this.compartmentTemplates.get(key);
      if (cached) {
        return cached;
      }
      if (
        !this.compartmentLoads.has(key) &&
        !this.compartmentFailures.has(key)
      ) {
        this.updateCompartmentLoading(card, format, 1);
        let load = this.loadTrustedComponentTemplate(
          key,
          card,
          componentCodeRef,
          moduleIdentifier,
          format,
        );
        this.compartmentLoads.set(key, load);
        this.trackCompartmentLoad(card, format, load);
      }
      return undefined;
    }
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

  private async loadTrustedComponentTemplate(
    key: string,
    card: BaseDef,
    componentCodeRef: ResolvedCodeRef,
    moduleIdentifier: string,
    format: Format,
  ) {
    try {
      let loader = this.loaderForTrustedCard(componentCodeRef);
      let module =
        await loader.import<Record<string, unknown>>(moduleIdentifier);
      let cardType = module[String(componentCodeRef.name)] as
        | Record<string, unknown>
        | undefined;
      let component = cardType?.[format];
      if (
        (typeof component !== 'object' || component === null) &&
        typeof component !== 'function'
      ) {
        throw new Error(
          `Trusted component ${moduleIdentifier}#${String(componentCodeRef.name)} has no ${format} template`,
        );
      }
      this.compartmentTemplates.set(key, {
        component: component as BaseDefComponent,
        styles: [],
      });
      this.compartmentFailures.delete(key);
    } catch (error) {
      this.compartmentFailures.add(key);
      this.recordCompartmentError(error);
    } finally {
      this.compartmentLoads.delete(key);
      this.updateCompartmentLoading(card, format, -1);
      this.scheduleCompartmentRevision(
        this.compartmentTemplateRevisionFor(key),
      );
    }
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
      isTrustedImport: (moduleIdentifier) =>
        trustedSandboxImportIdentity(
          moduleIdentifier,
          this.network.resolveImport,
        ) ?? false,
      validateInlineStyle: validateCompartmentInlineStyle,
    });
  }

  private createCanonicalCompartmentRuntime(principal: string) {
    let runtime = this.createCompartmentRuntime(
      principal,
      this.fetchCompartmentModule,
    );
    this.canonicalRuntimeEpochs.set(
      principal,
      ++this.nextCanonicalRuntimeEpoch,
    );
    return runtime;
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
    return this.retainRealmPrincipal(principal);
  }

  retainRealmPrincipal(principal: string): () => void {
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
      let evictedRevision = this.compartmentTemplateRevisions.get(key);
      if (evictedRevision) {
        // Existing consumers track this exact cell. Wake them before dropping
        // it so a later navigation cannot keep a component proxy whose SES
        // runtime has been destroyed. A subsequent evaluation receives a new
        // per-template cell; unrelated realms and trusted loaders stay
        // immune.
        this.scheduleCompartmentRevision(evictedRevision);
      }
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
    this.canonicalRuntimeEpochs.delete(principal);
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

  private async queueCodePreviewRuntimeOperation<T>(
    principal: string,
    codePreviewSandbox: CodePreviewSandbox,
    expectedDraft: CodePreviewDraft,
    operation: (runtime: RealmCompartmentModuleRuntime) => Promise<T>,
  ): Promise<T | undefined> {
    let entry = this.codePreviewRuntimeEntryFor(principal, codePreviewSandbox);
    let result = entry.pending
      .catch(() => undefined)
      .then(async () => {
        if (
          !codePreviewSandbox.active ||
          codePreviewSandbox.draft !== expectedDraft
        ) {
          return undefined;
        }
        if (entry.revision !== expectedDraft.revision) {
          entry.draft = expectedDraft;
          entry.runtime.invalidateModule(expectedDraft.sourceURL);
          entry.revision = expectedDraft.revision;
        }
        return await operation(entry.runtime);
      });
    // `result` belongs to this operation's caller, which reports compile or
    // metadata failures through the normal preview error surface. The queue
    // tail is coordination state only and must never become a second,
    // unobserved rejecting promise.
    entry.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
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

  isOpaqueCardDefinedByModule(card: BaseDef, moduleURL: string): boolean {
    let ref = getOpaqueRealmCardState(card)?.typeRef;
    if (!ref || !('module' in ref)) {
      return false;
    }
    return sameCodePreviewModuleURL(String(ref.module), moduleURL);
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

  codePreviewAppliesToCard(
    codePreviewSandbox: CodePreviewSandbox | undefined,
    card: BaseDef,
  ): boolean {
    let sourceURL = codePreviewSandbox?.sourceURL;
    let cardModuleKey = this.interactiveCodePreviewKey(card);
    if (!sourceURL || !cardModuleKey || !hasExecutableExtension(sourceURL)) {
      return false;
    }
    try {
      return codePreviewModuleKey(sourceURL) === cardModuleKey;
    } catch {
      return false;
    }
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
    this.setCodePreviewSource(
      preview,
      generation.sourceURL,
      generation.source,
      true,
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
    this.setCodePreviewSource(codePreviewSandbox, sourceURL, source, true);
    void this.refreshOpaqueTypeMetadataForModule(sourceURL, codePreviewSandbox);
    return generation;
  }

  seedCodePreviewSource(
    codePreviewSandbox: CodePreviewSandbox,
    sourceURL: string,
    source: string,
  ) {
    this.setCodePreviewSource(codePreviewSandbox, sourceURL, source, false);
  }

  private setCodePreviewSource(
    codePreviewSandbox: CodePreviewSandbox,
    sourceURL: string,
    source: string,
    volatile: boolean,
  ) {
    let previousKey = codePreviewSandbox.sourceURL
      ? codePreviewModuleKey(codePreviewSandbox.sourceURL)
      : undefined;
    this.activeCodePreviews.add(codePreviewSandbox);
    codePreviewSandbox.update(sourceURL, source, volatile);
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
    let metadataPreview = interactivePreview;
    for (let preview of this.activeCodePreviews) {
      if (
        preview !== interactivePreview &&
        preview.active &&
        preview.sourceURL &&
        sameCodePreviewModuleURL(preview.sourceURL, sourceURL)
      ) {
        preview.update(sourceURL, source, true);
        void this.classifyCodePreviewSource(preview);
        metadataPreview ??= preview;
      }
    }
    if (metadataPreview) {
      void this.refreshOpaqueTypeMetadataForModule(sourceURL, metadataPreview);
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
      // A local Monaco/assistant generation is the authoritative source for
      // its mounted preview until its volatile lease settles. An out-of-band
      // realm event that arrives during that lease may be stale (or a true
      // concurrent edit), but it must never overwrite the user's local
      // buffer. Consume the event here; if the local edit is abandoned, lease
      // settlement returns the card to canonical Store state and observes the
      // latest server source then. A successfully saved local edit has its own
      // clientRequestId acknowledgement path above this one in Store.
      if (this.hasLocalVolatileGeneration(sourceURL)) {
        handled.add(sourceURL);
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

  private hasLocalVolatileGeneration(sourceURL: string): boolean {
    let key = codePreviewModuleKey(sourceURL);
    return (
      this.volatileModules.current(sourceURL) != null &&
      !this.externallyVolatileModules.has(key)
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

      // A local edit may have started while getSource() was in flight. Do not
      // let the older response recapture the module as externally volatile.
      if (this.hasLocalVolatileGeneration(sourceURL)) {
        this.externalModuleInvalidationRevisions.delete(key);
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
        preview.update(sourceURL, source, true);
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
        this.moduleDependencies.delete(codePreviewModuleKey(moduleIdentifier));
        let revision = this.moduleClassificationRevisions.get(
          codePreviewModuleKey(moduleIdentifier),
        );
        revision?.bump();
        this.moduleClassificationRevisions.delete(
          codePreviewModuleKey(moduleIdentifier),
        );
      }
    }
    void this.refreshOpaqueTypeMetadataForModule(sourceURL);
  }

  prepareCodePreviewCommit(
    codePreviewSandbox: CodePreviewSandbox,
    sourceURL: string,
    source: string,
    saveType: SaveType,
  ): PreparedCodePreviewCommit | undefined {
    if (
      !hasExecutableExtension(sourceURL) ||
      (saveType !== 'editor' && saveType !== 'editor-with-instance') ||
      !codePreviewSandbox.matchesVolatileDraft(sourceURL, source)
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
      !hasExecutableExtension(sourceURL) ||
      (saveType !== 'editor' &&
        saveType !== 'editor-with-instance' &&
        saveType !== 'bot-patch')
    ) {
      return undefined;
    }
    let sandboxes = new Set(
      candidateSandboxes ??
        [...this.activeCodePreviews].filter((preview) =>
          preview.matchesVolatileDraft(sourceURL, source),
        ),
    );
    for (let sandbox of sandboxes) {
      if (!sandbox.matchesVolatileDraft(sourceURL, source)) {
        sandboxes.delete(sandbox);
      }
    }
    if (sandboxes.size === 0) {
      return undefined;
    }
    // A user can pause longer than the quiet-period lease before the editor's
    // save runs. The active preview still proves that this exact source is the
    // locally rendered draft, so renew it instead of letting persistence fall
    // back through the canonical loader and flash the preview.
    let volatileGeneration =
      this.volatileModules.current(sourceURL) ??
      this.volatileModules.publish(sourceURL, source);

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

    let finish = (persisted: boolean, error?: unknown) => {
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
        let message =
          error instanceof Error
            ? (error.stack ?? `${error.name}: ${error.message}`)
            : error == null
              ? undefined
              : String(error);
        for (let sandbox of entry.sandboxes) {
          sandbox.markCommitFailed(
            entry.drafts?.get(sandbox),
            clientRequestId,
            message,
          );
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
      failed: (error?: unknown) => finish(false, error),
    };
  }

  // The editor has already rendered this exact source revision. Its realm
  // event is an acknowledgement, not a second source update. This is a
  // idempotent transition: Store and live-search subscriptions may receive the
  // same event independently, but the guarded commit state records the
  // acknowledgement and metric only once.
  codePreviewCommitAcknowledgedInvalidations(
    clientRequestId: string | undefined,
    invalidations: string[],
  ): Set<string> {
    if (!clientRequestId) {
      return new Set();
    }
    let commit = codePreviewCommitRegistry.get(clientRequestId);
    if (!commit || commit.expiresAt <= Date.now()) {
      return new Set();
    }
    let acknowledged = new Set(
      invalidations.filter((url) =>
        sameCodePreviewModuleURL(url, commit.sourceURL),
      ),
    );
    if (acknowledged.size === 0) {
      return acknowledged;
    }
    let hasActivePreview = false;
    let metadataPreview: CodePreviewSandbox | undefined;
    for (let sandbox of commit.sandboxes) {
      if (sandbox.active) {
        hasActivePreview = true;
        metadataPreview ??= sandbox;
        sandbox.markCommitAcknowledged(
          commit.drafts?.get(sandbox),
          clientRequestId,
        );
        sandbox.deferCanonicalRefresh();
      }
    }
    if (!hasActivePreview) {
      return new Set();
    }
    void this.refreshOpaqueTypeMetadataForModule(
      commit.sourceURL,
      metadataPreview,
    );
    if (!commit.acknowledgementRecorded) {
      commit.acknowledgementRecorded = true;
      this.metrics.codePreviewAcknowledgementsRecognized++;
    }
    return acknowledged;
  }

  isCodePreviewCommitAcknowledgement(
    clientRequestId: string | undefined,
    invalidations: string[],
  ): boolean {
    let acknowledged = this.codePreviewCommitAcknowledgedInvalidations(
      clientRequestId,
      invalidations,
    );
    return (
      acknowledged.size > 0 &&
      invalidations.every((url) => acknowledged.has(url))
    );
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
    this.moduleClassificationRevisionFor(moduleIdentifier).consume();
    let isRoot = visited.size === 0;
    if (visited.has(moduleIdentifier)) {
      return { tier: 'compartment', reason: 'default-user-card' };
    }
    visited.add(moduleIdentifier);
    let classification = this.moduleClassifications.get(moduleIdentifier);
    if (
      classification?.tier === 'iframe' &&
      (isRoot || classification.propagatesToImporters)
    ) {
      return {
        tier: 'iframe',
        reason: classification.reason,
      };
    }
    for (let dependency of this.moduleDependencies.get(
      codePreviewModuleKey(moduleIdentifier),
    ) ?? []) {
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

  private moduleClassificationRevisionFor(
    moduleIdentifier: string,
  ): ReactiveRevision {
    let key = codePreviewModuleKey(moduleIdentifier);
    let revision = this.moduleClassificationRevisions.get(key);
    if (!revision) {
      revision = new ReactiveRevision();
      this.moduleClassificationRevisions.set(key, revision);
    }
    return revision;
  }

  private async loadCardTypeMetadata(
    principal: string,
    moduleIdentifier: string,
    exportName: string,
    codePreviewSandbox?: CodePreviewSandbox,
  ): Promise<SandboxCardTypeMetadata | undefined> {
    try {
      let expectedDraft = codePreviewSandbox?.draft;
      if (codePreviewSandbox && expectedDraft) {
        return await this.queueCodePreviewRuntimeOperation(
          principal,
          codePreviewSandbox,
          expectedDraft,
          (runtime) =>
            runtime.evaluateCardTypeMetadata(moduleIdentifier, exportName),
        );
      }
      return await this.compartmentRuntimeFor(
        principal,
        codePreviewSandbox,
      ).evaluateCardTypeMetadata(moduleIdentifier, exportName);
    } catch (error) {
      this.recordCompartmentError(error);
      return undefined;
    }
  }

  private async evaluateCardProjection(
    principal: string,
    moduleIdentifier: string,
    exportName: string,
    snapshot: Record<string, unknown>,
    codePreviewSandbox?: CodePreviewSandbox,
  ): Promise<Record<string, unknown>> {
    try {
      let expectedDraft = codePreviewSandbox?.draft;
      if (codePreviewSandbox && expectedDraft) {
        return (
          (await this.queueCodePreviewRuntimeOperation(
            principal,
            codePreviewSandbox,
            expectedDraft,
            (runtime) =>
              runtime.evaluateCardProjection(
                moduleIdentifier,
                exportName,
                snapshot,
              ),
          )) ?? snapshot
        );
      }
      return await this.compartmentRuntimeFor(
        principal,
        codePreviewSandbox,
      ).evaluateCardProjection(moduleIdentifier, exportName, snapshot);
    } catch (error) {
      // A failed computed projection must not prevent raw card data from
      // rendering. Preserve the authority-free JSON fallback and surface the
      // error through the existing sandbox diagnostics/last-known-good path.
      this.recordCompartmentError(error);
      return snapshot;
    }
  }

  private ensureComputedProjection(
    card: BaseDef,
    state: OpaqueRealmCardState,
    format: Format,
    codePreviewSandbox?: CodePreviewSandbox,
  ): boolean {
    if (this.computedProjectionReady.has(card)) {
      return true;
    }
    if (this.computedProjectionLoads.has(card)) {
      return false;
    }
    if (!isResolvedCodeRef(state.typeRef)) {
      this.computedProjectionReady.add(card);
      return true;
    }
    let moduleIdentifier = this.network.virtualNetwork.toURL(
      state.typeRef.module,
    ).href;
    this.updateCompartmentLoading(card, format, 1);
    let load = this.evaluateCardProjection(
      state.principal,
      moduleIdentifier,
      String(state.typeRef.name),
      state.snapshot,
      codePreviewSandbox,
    )
      .then((projection) => {
        let snapshot = state.snapshot;
        for (let fieldName of Object.keys(snapshot)) {
          if (!(fieldName in projection)) {
            delete snapshot[fieldName];
          }
        }
        for (let [fieldName, value] of Object.entries(projection)) {
          snapshot[fieldName] = value;
        }
        this.computedProjectionReady.add(card);
        this.bumpOpaqueData(card);
      })
      .finally(() => {
        this.computedProjectionLoads.delete(card);
        this.updateCompartmentLoading(card, format, -1);
      });
    this.computedProjectionLoads.set(card, load);
    this.trackCompartmentLoad(card, format, load);
    return false;
  }

  private async refreshOpaqueTypeMetadataForModule(
    sourceURL: string,
    codePreviewSandbox?: CodePreviewSandbox,
  ) {
    let expectedDraft = codePreviewSandbox?.draft;
    let moduleKey = codePreviewModuleKey(sourceURL);
    let typeKeys = this.opaqueTypeKeysByModule.get(moduleKey);
    if (!typeKeys?.size) {
      return;
    }
    let changed = false;
    let fieldComponentsChanged = false;
    for (let key of typeKeys) {
      let typeState = this.opaqueTypeStates.get(key);
      if (!typeState || !isResolvedCodeRef(typeState.typeRef)) {
        continue;
      }
      let moduleIdentifier = this.network.virtualNetwork.toURL(
        typeState.typeRef.module,
      ).href;
      let metadata = await this.loadCardTypeMetadata(
        this.principalForModule(moduleIdentifier),
        moduleIdentifier,
        String(typeState.typeRef.name),
        codePreviewSandbox,
      );
      // Metadata evaluation is asynchronous. A later Monaco/assistant
      // generation may already own this sandbox by the time an older import
      // completes; only the exact draft that started the evaluation may
      // publish presentation or schema changes.
      if (codePreviewSandbox && codePreviewSandbox.draft !== expectedDraft) {
        return;
      }
      // Metadata evaluation failed. Keep the last-known-good schema and
      // presentation instead of replacing it with an empty definition.
      if (!metadata) {
        continue;
      }
      if (metadata.definitionKind !== typeState.definitionKind) {
        // CardDef versus FieldDef determines the trusted host wrapper and the
        // opaque record's Base superclass. That structural identity cannot be
        // hot-swapped in place. Preserve the last-known-good record until the
        // Store rematerializes it instead of publishing contradictory inert
        // metadata against the old class.
        this.recordCompartmentError(
          new Error(
            `Sandbox definition kind changed from ${typeState.definitionKind} to ${metadata.definitionKind}`,
          ),
        );
        continue;
      }
      let fields = metadata.fields ?? {};
      let trustedFieldTypes = await this.resolveTrustedFieldTypes(fields);
      let nextIcon =
        (await this.resolveTrustedIcon(metadata.icon)) ?? typeState.icon;
      // Trusted field/icon resolution is asynchronous too. Do not publish an
      // older generation after a newer draft became authoritative while those
      // imports were in flight.
      if (codePreviewSandbox && codePreviewSandbox.draft !== expectedDraft) {
        return;
      }
      let nextDisplayName =
        metadata.displayName ?? String(typeState.typeRef.name);
      let nextHasCustomEditTemplate = metadata.hasCustomEditTemplate === true;
      let nextHasCustomIsolatedTemplate =
        metadata.hasCustomIsolatedTemplate === true;
      let nextHeaderColor = this.safeHeaderColor(metadata.headerColor);
      let nextPrefersWideFormat = metadata.prefersWideFormat === true;
      let previousFieldMetadata = this.fieldMetadataByOpaqueType.get(key) ?? {};
      let previousFieldTypes = this.trustedFieldTypesByOpaqueType.get(key);
      let fieldsChanged =
        !sameFieldMetadata(previousFieldMetadata, fields) ||
        !sameFieldTypes(previousFieldTypes, trustedFieldTypes);
      let ancestryChanged = !sameTrustedExportIdentities(
        typeState.ancestorTypes,
        metadata.ancestorTypes,
      );
      let presentationChanged =
        typeState.displayName !== nextDisplayName ||
        typeState.hasCustomEditTemplate !== nextHasCustomEditTemplate ||
        typeState.hasCustomIsolatedTemplate !== nextHasCustomIsolatedTemplate ||
        !sameStrings(
          typeState.authoredTemplateFormats ?? [],
          metadata.authoredTemplateFormats ?? [],
        ) ||
        typeState.headerColor !== nextHeaderColor ||
        typeState.prefersWideFormat !== nextPrefersWideFormat ||
        typeState.icon !== nextIcon;
      if (!fieldsChanged && !ancestryChanged && !presentationChanged) {
        continue;
      }
      typeState.ancestorTypes = metadata.ancestorTypes;
      typeState.displayName = nextDisplayName;
      typeState.fields = Object.freeze(
        this.canonicalOpaqueFieldMetadata(fields, trustedFieldTypes),
      );
      typeState.hasCustomEditTemplate = nextHasCustomEditTemplate;
      typeState.hasCustomIsolatedTemplate = nextHasCustomIsolatedTemplate;
      typeState.authoredTemplateFormats = metadata.authoredTemplateFormats;
      typeState.headerColor = nextHeaderColor;
      typeState.prefersWideFormat = nextPrefersWideFormat;
      typeState.icon = nextIcon;
      this.trustedFieldTypesByOpaqueType.set(key, trustedFieldTypes);
      this.fieldMetadataByOpaqueType.set(key, fields);
      changed = true;
      fieldComponentsChanged ||= fieldsChanged;
    }
    if (changed) {
      // Field component wrappers capture their FieldDef and relationship kind.
      // Replace the weak cache so the next tracked render reconstructs only
      // the cards that are still live.
      if (fieldComponentsChanged) {
        this.opaqueFieldComponents = new WeakMap();
      }
      this.opaqueMetadataRevisionFor(moduleKey).bump();
    }
  }

  private async resolveTrustedIcon(
    identity: SandboxTrustedExportIdentity | undefined,
  ): Promise<CardOrFieldTypeIcon | undefined> {
    if (!identity) {
      return undefined;
    }
    let trustedIdentity = trustedSandboxImportIdentity(
      identity.module,
      this.network.resolveImport,
    );
    if (!trustedIdentity) {
      return undefined;
    }
    try {
      let module =
        await this.network.loaderService.baseLoader.import<
          Record<string, unknown>
        >(trustedIdentity);
      return module[identity.name] as CardOrFieldTypeIcon | undefined;
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

  private canonicalOpaqueFieldMetadata(
    fields: Record<string, SandboxCardFieldMetadata>,
    trustedFieldTypes: Record<string, typeof BaseDef>,
  ): Record<string, SandboxCardFieldMetadata> {
    return Object.fromEntries(
      Object.entries(fields).map(([name, field]) => {
        let trustedType = trustedFieldTypes[name];
        let trustedModule = trustedType
          ? trustedSandboxImportIdentity(
              field.type.module,
              this.network.resolveImport,
            )
          : undefined;
        return [
          name,
          trustedModule
            ? {
                ...field,
                type: { module: trustedModule, name: field.type.name },
              }
            : field,
        ];
      }),
    );
  }

  private async resolveTrustedFieldType(
    identity: SandboxTrustedExportIdentity,
  ): Promise<typeof BaseDef | undefined> {
    let resolvedModule = trustedSandboxImportIdentity(
      identity.module,
      this.network.resolveImport,
    );
    if (!resolvedModule || !isTrustedHostRealmModule(resolvedModule)) {
      return undefined;
    }
    let key = `${resolvedModule}|${identity.name}`;
    let pending = this.trustedFieldTypeLoads.get(key);
    if (!pending) {
      pending = this.loadTrustedFieldType({
        ...identity,
        module: resolvedModule,
      });
      this.trustedFieldTypeLoads.set(key, pending);
    }
    return await pending;
  }

  private async loadTrustedFieldType(
    identity: SandboxTrustedExportIdentity,
  ): Promise<typeof BaseDef | undefined> {
    try {
      let module = await this.network.loaderService.baseLoader.import<
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

  private applyIframeTypePresentation(
    card: BaseDef,
    presentation: RealmIframeSandboxTypePresentation,
  ) {
    let typeState = getOpaqueRealmCardTypeState(card) as
      | MutableOpaqueRealmCardTypeState
      | undefined;
    let state = getOpaqueRealmCardState(card);
    if (!typeState || !state || !isResolvedCodeRef(typeState.typeRef)) {
      return;
    }
    let displayName = presentation.displayName || typeState.displayName;
    let headerColor = this.safeHeaderColor(presentation.headerColor);
    if (
      typeState.displayName === displayName &&
      typeState.headerColor === headerColor &&
      typeState.prefersWideFormat === presentation.prefersWideFormat
    ) {
      return;
    }
    typeState.displayName = displayName;
    typeState.headerColor = headerColor;
    typeState.prefersWideFormat = presentation.prefersWideFormat;
    this.syncOpaqueCardPresentation(card, state);
    this.opaqueMetadataRevisionFor(
      codePreviewModuleKey(
        this.network.virtualNetwork.toURL(typeState.typeRef.module).href,
      ),
    ).bump();
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
    try {
      let css = validateCompartmentCSS(rawCss);
      let scope = themeScope(id, css);
      return scope ? { css, id, scope } : undefined;
    } catch (error) {
      // Theme projection is optional presentation metadata. Reject unsafe CSS
      // at this boundary without rejecting the otherwise valid card record.
      // Authored card styles still fail closed in the template runtime.
      this.recordCompartmentError(error);
      return undefined;
    }
  }

  private recordCompartmentError(error: unknown) {
    let reason = error instanceof Error ? error.message : String(error);
    if (
      !(reason in this.metrics.compartmentErrors) &&
      Object.keys(this.metrics.compartmentErrors).length >=
        maxCompartmentErrorKinds
    ) {
      reason = 'other sandbox errors';
    }
    this.metrics.compartmentErrors[reason] =
      (this.metrics.compartmentErrors[reason] ?? 0) + 1;
  }

  private compartmentTemplateFor(
    card: BaseDef,
    format: string,
    principal: string,
    codePreviewSandbox?: CodePreviewSandbox,
    componentCodeRef?: CodeRef,
  ): InertTemplate | undefined {
    let ref =
      componentCodeRef && isResolvedCodeRef(componentCodeRef)
        ? componentCodeRef
        : getOpaqueRealmCardState(card)?.typeRef;
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
      this.trackCompartmentLoad(card, format, load);
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
        await this.queueCodePreviewRuntimeOperation(
          principal,
          codePreviewSandbox,
          expectedDraft,
          async () => {
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
          },
        );
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

  private trackCompartmentLoad(
    card: BaseDef,
    format: string,
    load: Promise<void>,
  ) {
    let formats = this.compartmentLoadsByCard.get(card);
    if (!formats) {
      formats = new Map();
      this.compartmentLoadsByCard.set(card, formats);
    }
    let loads = formats.get(format);
    if (!loads) {
      loads = new Set();
      formats.set(format, loads);
    }
    loads.add(load);
    void load.then(
      () => this.removeTrackedCompartmentLoad(card, format, load),
      () => this.removeTrackedCompartmentLoad(card, format, load),
    );
  }

  private removeTrackedCompartmentLoad(
    card: BaseDef,
    format: string,
    load: Promise<void>,
  ) {
    let formats = this.compartmentLoadsByCard.get(card);
    let loads = formats?.get(format);
    loads?.delete(load);
    if (loads?.size === 0) {
      formats?.delete(format);
    }
    if (formats?.size === 0) {
      this.compartmentLoadsByCard.delete(card);
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
    let dependencies: string[] = [];
    for (let specifier of classification.imports) {
      if (trustedSandboxImportIdentity(specifier, this.network.resolveImport)) {
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
    let dependencyKey = codePreviewModuleKey(moduleIdentifier);
    let previousClassification =
      this.moduleClassifications.get(moduleIdentifier);
    let previousDependencies = this.moduleDependencies.get(dependencyKey) ?? [];
    if (
      sameModuleClassification(previousClassification, classification) &&
      sameStrings(previousDependencies, dependencies)
    ) {
      return;
    }
    this.moduleClassifications.set(moduleIdentifier, classification);
    this.moduleDependencies.set(dependencyKey, dependencies);
    this.moduleClassificationRevisionFor(moduleIdentifier).bump();
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
        sandboxActions: Record<string, (...args: unknown[]) => unknown> = {};

        constructor(owner: Owner, args: Record<string, unknown>) {
          super(owner, args);
          let live = runtime.instantiateComponent(
            descriptor.instance.handle,
            plainComponentArgs(args),
          );
          this.sandboxInstanceHandle = live.handle;
          this.sandboxState = live.state;
          for (let action of live.actions) {
            this.sandboxActions[action] = (...actionArgs: unknown[]) => {
              if (!this.sandboxInstanceHandle) {
                return;
              }
              let result = runtime.invokeComponentAction(
                this.sandboxInstanceHandle,
                action,
                actionArgs,
              );
              let apply = (updated: Awaited<typeof result>): unknown => {
                let stateChanged =
                  JSON.stringify(this.sandboxState) !==
                  JSON.stringify(updated.state);
                this.sandboxState = updated.state;
                for (let effect of updated.effects) {
                  if (effect.type === 'view-card') {
                    let viewCard = (this.args as Record<string, unknown>)
                      .viewCard;
                    if (typeof viewCard === 'function') {
                      viewCard(effect.target, effect.format, effect.options);
                    }
                  } else if (effect.type === 'set') {
                    let set = (this.args as Record<string, unknown>).set;
                    if (typeof set === 'function') {
                      set(effect.value);
                    }
                  }
                }
                if (stateChanged) {
                  this.sandboxRevision++;
                  let requestRender = (this.args as Record<string, unknown>)
                    .requestRender;
                  if (typeof requestRender === 'function') {
                    requestRender();
                  }
                }
                return updated.returnValue;
              };
              return result instanceof Promise
                ? result.then(apply)
                : apply(result);
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
          let trustedIdentity = trustedSandboxImportIdentity(
            reference.module,
            this.network.resolveImport,
          );
          if (!trustedIdentity) {
            throw new Error(
              `compartment-template-untrusted-scope:${reference.module}`,
            );
          }
          let module = trustedModules.get(trustedIdentity);
          if (!module) {
            module =
              await this.network.loaderService.baseLoader.import<
                Record<string, unknown>
              >(trustedIdentity);
            trustedModules.set(trustedIdentity, module);
          }
          if (!(reference.name in module)) {
            throw new Error(
              `compartment-template-missing-export:${trustedIdentity}#${reference.name}`,
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
      validateCompartmentCSS(decodeScopedCSSRequest(stylesheet).css, {
        requireScopedSelectors: true,
      }),
    );
  }

  private setOpaqueCardFieldValue(
    card: BaseDef,
    state: OpaqueRealmCardState,
    fieldName: string,
    value: unknown,
    persist = true,
  ): void {
    // The opaque snapshot is the canonical Store-facing state. Do not depend
    // on a newly deployed Base API here: a local Host intentionally supports
    // today's staging Base generation, and no executable user field setter is
    // allowed to cross this boundary in either direction.
    state.snapshot[fieldName] = value;
    (card as unknown as Record<string, unknown>)[fieldName] = value;
    state.document.data.attributes ??= {};
    if (!(fieldName in state.document.data.attributes)) {
      // serializeOpaqueRealmCard replaces this marker with the synchronized
      // snapshot value and strips any nested relationship objects.
      state.document.data.attributes[fieldName] = null;
    }
    this.bumpOpaqueData(card);
    if (!persist) {
      return;
    }
    let cardID = state.snapshot.id;
    if (typeof cardID === 'string') {
      void this.relationshipContextFor(card)?.cardContext?.store.save(cardID);
    }
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
    let contextualFields: Record<string, BaseDefComponent> = {};
    let typeKey = this.opaqueTypeKeyFor(card);
    let trustedFieldTypes =
      (typeKey ? this.trustedFieldTypesByOpaqueType.get(typeKey) : undefined) ??
      this.trustedFieldTypesByCard.get(card) ??
      {};
    let fieldMetadata =
      (typeKey ? this.fieldMetadataByOpaqueType.get(typeKey) : undefined) ??
      this.fieldMetadataByCard.get(card) ??
      {};
    let snapshot = () => {
      this.opaqueDataRevisionFor(card).consume();
      return getOpaqueRealmCardState(card)?.snapshot ?? model;
    };
    let setField = (name: string, value: unknown) => {
      let metadata = fieldMetadata[name];
      if (metadata?.kind === 'linksTo' || metadata?.kind === 'linksToMany') {
        this.setOpaqueRelationshipPath(card, name, value);
        return;
      }
      getOpaqueRealmCardState(card)?.setField?.(name, value);
    };
    // Schema fields remain stable across data generations. Include optional
    // fields even when the current resource omits their value so data edits
    // never need to replace the component map or the rendered island.
    for (let name of new Set([
      ...Object.keys(fieldMetadata),
      ...Object.keys(model),
      // `cardInfo` is an inherited Base field and is valid even when none of
      // its optional values have been serialized yet. The default edit
      // template always addresses its contextual children, so preserve that
      // explicit boundary for blank and newly-created cards as well.
      'cardInfo',
    ])) {
      if (name !== 'id') {
        fields[name] = realmSandboxFieldComponent(
          card,
          snapshot,
          name,
          trustedFieldTypes[name],
          fieldMetadata[name]?.type
            ? {
                module: rri(fieldMetadata[name]!.type.module),
                name: fieldMetadata[name]!.type.name,
              }
            : undefined,
          format,
          fieldMetadata[name]?.kind,
          fieldMetadata[name]?.displayName,
          setField,
          () => this.relationshipContextFor(card),
          (ref) => this.validateCodeRef(card, ref),
          (render) => this.subscribeToOpaqueCardData(card, render),
        );
      }
    }
    let cardInfoFields = fields.cardInfo as
      | (BaseDefComponent & Record<string, BaseDefComponent>)
      | undefined;
    if (cardInfoFields) {
      let cardInfoFieldType = trustedFieldTypes.cardInfo;
      let nestedComponents: Record<string, BaseDefComponent> = {};
      let setCardInfoField = (name: string, value: unknown) => {
        let state = getOpaqueRealmCardState(card);
        let nestedField = cardInfoFieldType
          ? getField(cardInfoFieldType, name)
          : undefined;
        if (
          nestedField?.fieldType === 'linksTo' ||
          nestedField?.fieldType === 'linksToMany'
        ) {
          this.setOpaqueRelationshipPath(card, `cardInfo.${name}`, value);
          return;
        }
        let current = snapshot().cardInfo;
        let next = {
          ...(typeof current === 'object' && current !== null
            ? (current as Record<string, unknown>)
            : {}),
          [name]: value,
        };
        state?.setField?.('cardInfo', next);
      };
      for (let name of [
        'name',
        'summary',
        'cardThumbnailURL',
        'theme',
        'notes',
      ]) {
        let nestedField = cardInfoFieldType
          ? getField(cardInfoFieldType, name)
          : undefined;
        nestedComponents[name] = realmSandboxFieldComponent(
          card,
          () => {
            let value = snapshot().cardInfo;
            return typeof value === 'object' && value !== null
              ? (value as Record<string, unknown>)
              : {};
          },
          name,
          nestedField?.card,
          undefined,
          format,
          nestedField?.fieldType,
          undefined,
          setCardInfoField,
          () => this.relationshipContextFor(card),
          (ref) => this.validateCodeRef(card, ref),
          (render) => this.subscribeToOpaqueCardData(card, render),
        );
        contextualFields[`cardInfo.${name}`] = nestedComponents[name]!;
      }
      // Match Base's contextual-field contract without proxying a component
      // definition. Glimmer treats component classes as opaque definitions;
      // a Proxy can answer ordinary property reads while still losing the
      // nested path during component resolution. Non-enumerable own
      // capabilities preserve the component's identity and template while
      // keeping generic schema enumeration free of synthetic fields such as
      // "Card Info Theme".
      for (let [name, component] of Object.entries(nestedComponents)) {
        Object.defineProperty(cardInfoFields, name, {
          configurable: true,
          enumerable: false,
          value: component,
        });
      }
    }
    // Ember's contextual-component path resolver may ask the outer fields
    // object for a dotted path in one operation. Base's ordinary field proxy
    // supports that shape through `getField(model, property)`; mirror it for
    // opaque records so both segmented and dotted resolution are explicit.
    if (Object.keys(contextualFields).length > 0) {
      let target = fields;
      fields = withContextualComponents(target, contextualFields);
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
    _resource: LooseCardResource,
    moduleIdentifier: string,
  ): string {
    // The instance document is data supplied by a remote realm. Its
    // meta.realmURL cannot grant execution into another principal's runtime.
    // Key the compartment from the canonical code URL instead. A later
    // response-level realm header still constrains every module fetch.
    return this.principalForModule(moduleIdentifier);
  }

  private principalForModule(moduleIdentifier: string): string {
    let owningRealm = this.network.realm.realmOf(new URL(moduleIdentifier));
    return owningRealm
      ? this.network.virtualNetwork.toURL(owningRealm).href
      : new URL('./', moduleIdentifier).href;
  }

  private opaqueTypeKeyFor(card: BaseDef): string | undefined {
    let typeState = getOpaqueRealmCardTypeState(card);
    if (!typeState || !isResolvedCodeRef(typeState.typeRef)) {
      return undefined;
    }
    return `${this.network.virtualNetwork.toURL(typeState.typeRef.module).href}|${String(typeState.typeRef.name)}`;
  }

  private opaqueMetadataRevisionFor(moduleKey: string): ReactiveRevision {
    let revision = this.opaqueMetadataRevisions.get(moduleKey);
    if (!revision) {
      revision = new ReactiveRevision();
      this.opaqueMetadataRevisions.set(moduleKey, revision);
    }
    return revision;
  }

  // Host schema and presentation UI must not reach through an opaque card's
  // constructor and infer mutable CardDef state. This is the explicit,
  // reactive boundary for the inert metadata that a sandbox publishes.
  introspectOpaqueCardType(
    value: BaseDef | typeof BaseDef,
  ): Readonly<OpaqueRealmCardTypeState> | undefined {
    let typeState = getOpaqueRealmCardTypeState(value);
    if (typeState && isResolvedCodeRef(typeState.typeRef)) {
      this.opaqueMetadataRevisionFor(
        codePreviewModuleKey(
          this.network.virtualNetwork.toURL(typeState.typeRef.module).href,
        ),
      ).consume();
    }
    return typeState;
  }

  introspectOpaqueCardFields(
    value: BaseDef | typeof BaseDef,
  ): Readonly<Record<string, SandboxCardFieldMetadata>> | undefined {
    return this.introspectOpaqueCardType(value)?.fields;
  }

  opaqueRelationshipPath(card: BaseDef, fieldName: string): string | undefined {
    let state = getOpaqueRealmCardState(card);
    if (!state) {
      return undefined;
    }
    return Object.keys(state.document.data.relationships ?? {}).find((path) => {
      let segments = path.split('.');
      return path === fieldName || segments[segments.length - 1] === fieldName;
    });
  }

  // Relationship editors and tools cannot mutate an authored card by walking
  // through its opaque record. This is the explicit write boundary: update the
  // inert snapshot used by sandbox rendering and the JSON:API relationship
  // document that Store.save() serializes. Trusted cards return false so the
  // caller can use the ordinary Card API assignment path.
  setOpaqueRelationshipPath(
    card: BaseDef,
    path: string,
    value: unknown,
  ): boolean {
    let state = getOpaqueRealmCardState(card);
    if (!state) {
      return false;
    }

    let project = (item: unknown): unknown => {
      if (
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        return { id: (item as { id: string }).id };
      }
      return item;
    };
    let projection = Array.isArray(value) ? value.map(project) : project(value);
    this.setSnapshotPath(state.snapshot, path, projection);

    let relationshipReference = (item: unknown): string | null => {
      let id =
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string'
          ? (item as { id: string }).id
          : undefined;
      if (!id) {
        return null;
      }
      return (
        relativeReference(
          this.network.virtualNetwork.toURL(rri(id)),
          this.network.virtualNetwork.toURL(
            rri(state.document.data.id ?? state.principal),
          ),
          new URL(state.document.data.meta.realmURL ?? state.principal),
        ) ?? id
      );
    };

    state.document.data.relationships ??= {};
    for (let key of Object.keys(state.document.data.relationships)) {
      if (key === path || key.startsWith(`${path}.`)) {
        delete state.document.data.relationships[key];
      }
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        state.document.data.relationships![`${path}.${index}`] = {
          links: { self: relationshipReference(item) },
        };
      });
    } else {
      state.document.data.relationships[path] = {
        links: { self: relationshipReference(value) },
      };
    }
    // Store.save() may serialize synchronously before its returned promise is
    // observed. Update the relationship document first, then publish and
    // persist the tracked root field exactly once. The previous order could
    // save the old relationship and reconcile it back over the local edit.
    let root = path.split('.')[0];
    if (root) {
      if (path === root) {
        // A top-level relationship is represented only in JSON:API
        // `relationships`. Publishing it through setOpaqueCardFieldValue()
        // would also invent an attribute marker with the same name, yielding
        // an invalid document and allowing a failed save to reconcile the old
        // link over the optimistic edit.
        (card as unknown as Record<string, unknown>)[root] =
          state.snapshot[root];
        this.bumpOpaqueData(card);
        let cardID = state.snapshot.id;
        if (typeof cardID === 'string') {
          void this.relationshipContextFor(card)?.cardContext?.store.save(
            cardID,
          );
        }
      } else {
        // A relationship nested inside a contains field (for example
        // cardInfo.theme) still needs its containing attribute published, with
        // the nested relationship pruned by serializeOpaqueRealmCard().
        this.setOpaqueCardFieldValue(card, state, root, state.snapshot[root]);
      }
    }
    return true;
  }

  // Code-mode schema UI needs the inheritance chain without importing a user
  // constructor into the Host. Resolve one authored type through the same SES
  // metadata boundary used for records and return inert data only. Trusted
  // Base/catalog ancestors intentionally return undefined so callers can use
  // their ordinary shared loader identity.
  async introspectOpaqueCardTypeRef(
    ref: CodeRef,
  ): Promise<Readonly<OpaqueRealmCardTypeState> | undefined> {
    if (!isResolvedCodeRef(ref)) {
      return undefined;
    }
    let moduleIdentifier = this.network.virtualNetwork.toURL(ref.module).href;
    if (isTrustedHostRealmModule(moduleIdentifier)) {
      return undefined;
    }
    let metadata = await this.loadCardTypeMetadata(
      this.principalForModule(moduleIdentifier),
      moduleIdentifier,
      String(ref.name),
    );
    if (!metadata) {
      return undefined;
    }
    return {
      typeRef: {
        module: rri(moduleIdentifier),
        name: String(ref.name),
      },
      definitionKind: metadata.definitionKind,
      ancestorTypes: metadata.ancestorTypes,
      displayName: metadata.displayName ?? String(ref.name),
      fields: metadata.fields,
      hasCustomEditTemplate: metadata.hasCustomEditTemplate,
      hasCustomIsolatedTemplate: metadata.hasCustomIsolatedTemplate,
      authoredTemplateFormats: metadata.authoredTemplateFormats,
      headerColor: this.safeHeaderColor(metadata.headerColor),
      prefersWideFormat: metadata.prefersWideFormat,
    };
  }

  private consumeOpaqueMetadataRevision(card: BaseDef) {
    this.introspectOpaqueCardType(card);
  }

  private opaqueDataRevisionFor(card: BaseDef): ReactiveRevision {
    let revision = this.opaqueDataRevisions.get(card);
    if (!revision) {
      revision = new ReactiveRevision();
      this.opaqueDataRevisions.set(card, revision);
    }
    return revision;
  }

  private relationshipContextRevisionFor(card: BaseDef): ReactiveRevision {
    let revision = this.relationshipContextRevisions.get(card);
    if (!revision) {
      revision = new ReactiveRevision();
      this.relationshipContextRevisions.set(card, revision);
    }
    return revision;
  }

  private relationshipContextFor(
    card: BaseDef,
  ): RealmSandboxRelationshipContext | undefined {
    this.relationshipContextRevisionFor(card).consume();
    return this.relationshipContexts.get(card);
  }

  private bumpOpaqueData(card: BaseDef) {
    this.opaqueDataRevisionFor(card).bump();
    for (let render of this.opaqueDataRenderers.get(card) ?? []) {
      render();
    }
  }

  private syncOpaqueCardPresentation(
    card: BaseDef,
    state: OpaqueRealmCardState,
  ) {
    let typeState = getOpaqueRealmCardTypeState(card);
    if (!typeState) {
      return;
    }
    let icon = (typeState as MutableOpaqueRealmCardTypeState).icon;
    Object.defineProperty(state.snapshot, 'constructor', {
      configurable: true,
      enumerable: false,
      value: this.opaquePresentationConstructor(typeState.displayName, icon),
    });
    state.presentation.displayName = typeState.displayName;
    state.presentation.headerColor = typeState.headerColor;
    state.presentation.prefersWideFormat = typeState.prefersWideFormat;
  }

  private opaquePresentationConstructor(displayName: string, icon: unknown) {
    // CardContainer and other trusted presentation components use these Base
    // statics. Expose only their inert results to authored templates; never
    // hand the opaque CardDef constructor (and its Host methods) across the
    // render boundary.
    return Object.freeze({
      displayName,
      icon,
      getDisplayName: () => displayName,
      getIconComponent: () => icon,
    });
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
      let projection: unknown;
      if (Array.isArray(relationship)) {
        projection = relationship
          .map((item) =>
            this.relationshipProjection(item, relativeURL, document),
          )
          .filter((item) => item !== undefined);
      } else {
        projection = this.relationshipProjection(
          relationship,
          relativeURL,
          document,
        );
      }
      if (projection === undefined) {
        continue;
      }
      this.setSnapshotPath(snapshot, name, projection);
    }
    return snapshot;
  }

  private setSnapshotPath(
    snapshot: Record<string, unknown>,
    path: string,
    value: unknown,
  ) {
    let segments = path.split('.').filter(Boolean);
    if (
      segments.length === 0 ||
      segments.some((segment) =>
        ['__proto__', 'prototype', 'constructor'].includes(segment),
      )
    ) {
      return;
    }
    let current: Record<string, unknown> | unknown[] = snapshot;
    for (let index = 0; index < segments.length - 1; index++) {
      let segment = segments[index]!;
      let nextIsIndex = /^\d+$/.test(segments[index + 1]!);
      let existing = Array.isArray(current)
        ? current[Number(segment)]
        : current[segment];
      if (
        existing === null ||
        typeof existing !== 'object' ||
        (nextIsIndex && !Array.isArray(existing)) ||
        (!nextIsIndex && Array.isArray(existing))
      ) {
        existing = nextIsIndex ? [] : {};
        if (Array.isArray(current)) {
          current[Number(segment)] = existing;
        } else {
          current[segment] = existing;
        }
      }
      current = existing as Record<string, unknown> | unknown[];
    }
    let leaf = segments[segments.length - 1]!;
    if (Array.isArray(current)) {
      current[Number(leaf)] = value;
    } else {
      current[leaf] = value;
    }
  }

  private hydrateTrustedRelationship(
    value: unknown,
    metadata: SandboxCardFieldMetadata | undefined,
    fieldType: typeof BaseDef | undefined,
    resolve: OpaqueRealmCardState['resolveTrustedRelationship'],
  ): unknown {
    if (
      !resolve ||
      !fieldType ||
      (metadata?.kind !== 'linksTo' && metadata?.kind !== 'linksToMany')
    ) {
      return value;
    }
    let hydrate = (item: unknown) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item) ||
        typeof (item as { id?: unknown }).id !== 'string'
      ) {
        return item;
      }
      return resolve((item as { id: string }).id, fieldType) ?? item;
    };
    return Array.isArray(value) ? value.map(hydrate) : hydrate(value);
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
    this.activeIframeConnections.clear();
    this.metrics.activeIframeConnections = 0;
  }
}

const unsupportedValue = Symbol('unsupported realm sandbox value');

function plainComponentArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  let result: Record<string, unknown> = {};
  for (let [name, item] of Object.entries(value)) {
    if (name === 'viewCard' && typeof item === 'function') {
      result[sandboxViewCardCapabilityArgument] = true;
      continue;
    }
    if (name === 'set' && typeof item === 'function') {
      result[sandboxSetCapabilityArgument] = true;
      continue;
    }
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
