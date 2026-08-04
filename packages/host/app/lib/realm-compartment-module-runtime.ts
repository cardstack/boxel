import 'ses';

import { isTesting } from '@embroider/macros';

import {
  baseRRI,
  getMenuItems,
  realmURL,
} from '@cardstack/runtime-common/constants';
import { Loader } from '@cardstack/runtime-common/loader';
import { codeRef } from '@cardstack/runtime-common/realm-identifiers';
import type { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';

import { sandboxSearchEntryWireQueryFromQuery } from '@cardstack/host/lib/realm-sandbox-runtime-helpers';

import { createRealmSandboxCompartment } from '../../workers/realm-isolation-module-evaluator';

export type SandboxScopeReference =
  | { kind: 'component'; component: string }
  | { kind: 'trusted-export'; module: string; name: string }
  | { kind: 'value'; value: unknown };

export interface SandboxTemplateDescriptor {
  id: string;
  block: string;
  moduleName: string;
  isStrictMode: boolean;
  stylesheets: string[];
  scope: SandboxScopeReference[];
  instance: SandboxComponentInstanceDescriptor;
}

export interface SandboxComponentInstanceDescriptor {
  handle: string;
  state: Record<string, unknown>;
  getters: string[];
  actions: string[];
}

export type SandboxComponentEffect =
  | {
      type: 'view-card';
      target: string;
      format?: string;
      options?: Record<string, unknown>;
    }
  | {
      type: 'set';
      value: unknown;
    };

export interface SandboxComponentActionResult extends SandboxComponentInstanceDescriptor {
  effects: SandboxComponentEffect[];
  returnValue?: unknown;
}

export interface SandboxTemplateBundle {
  root: string;
  templates: Record<string, SandboxTemplateDescriptor>;
}

export interface SandboxTrustedExportIdentity {
  module: string;
  name: string;
}

interface SandboxFormatReference {
  kind: 'sandbox-format-reference';
  module: string;
  name: string;
}

export interface SandboxFormatOnlyImportDescriptor {
  module: string;
  exports: string[];
}

export interface SandboxCardFieldMetadata {
  kind: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  type: SandboxTrustedExportIdentity;
  displayName?: string;
}

export interface SandboxCardTypeMetadata {
  definitionKind: 'card' | 'field' | 'file';
  ancestorTypes: SandboxTrustedExportIdentity[];
  displayName?: string;
  fields: Record<string, SandboxCardFieldMetadata>;
  headerColor: string | null;
  hasCustomEditTemplate: boolean;
  hasCustomIsolatedTemplate: boolean;
  authoredTemplateFormats: string[];
  icon?: SandboxTrustedExportIdentity;
  prefersFullSandbox: boolean;
  prefersWideFormat: boolean;
}

export interface SandboxCardMethodResult {
  returnValue?: unknown;
  card?: {
    type: SandboxTrustedExportIdentity;
    attributes: Record<string, unknown>;
  };
}

interface CapturedCardFieldMetadata {
  kind: SandboxCardFieldMetadata['kind'];
  card: object;
  computeVia?: (this: Record<string, unknown>) => unknown;
}

interface SandboxCardFieldDefinition {
  type: SandboxCardFieldMetadata['kind'];
  card: object;
  computeVia?: (this: Record<string, unknown>) => unknown;
}

function safeEventTarget(
  target: EventTarget | null,
): Record<string, unknown> | null {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return null;
  }
  let source = target as Element & {
    checked?: unknown;
    dataset?: DOMStringMap;
    name?: unknown;
    selectedIndex?: unknown;
    type?: unknown;
    value?: unknown;
  };
  let result: Record<string, unknown> = {
    tagName: source.tagName,
  };
  for (let property of [
    'checked',
    'id',
    'name',
    'selectedIndex',
    'type',
    'value',
  ] as const) {
    let value = source[property];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[property] = value;
    }
  }
  if (source.dataset) {
    result.dataset = Object.fromEntries(Object.entries(source.dataset));
  }
  return result;
}

function safeEvent(event: Event): Record<string, unknown> {
  let result: Record<string, unknown> = {
    type: event.type,
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
    defaultPrevented: event.defaultPrevented,
    target: safeEventTarget(event.target),
    currentTarget: safeEventTarget(event.currentTarget),
  };
  for (let property of [
    'altKey',
    'button',
    'buttons',
    'clientX',
    'clientY',
    'code',
    'ctrlKey',
    'data',
    'deltaMode',
    'deltaX',
    'deltaY',
    'inputType',
    'isPrimary',
    'key',
    'metaKey',
    'pageX',
    'pageY',
    'pointerId',
    'pointerType',
    'repeat',
    'screenX',
    'screenY',
    'shiftKey',
  ] as const) {
    let value = (event as unknown as Record<string, unknown>)[property];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[property] = value;
    }
  }
  return result;
}

export function projectSandboxActionArguments(args: unknown[]): unknown[] {
  return args.map((value) =>
    typeof Event !== 'undefined' && value instanceof Event
      ? safeEvent(value)
      : value,
  );
}

export interface CompartmentAmbientReport {
  window: string;
  document: string;
  localStorage: string;
  fetch: string;
  XMLHttpRequest: string;
  URL: string;
  URLSearchParams: string;
}

interface TemplateFactoryDescriptor {
  id: string;
  block: string;
  moduleName: string;
  isStrictMode?: boolean;
  scope?: () => unknown[];
}

interface TemplateFactoryResult {
  parsedLayout?: TemplateFactoryDescriptor;
}

interface CapturedTemplate {
  descriptor: Omit<SandboxTemplateDescriptor, 'scope' | 'instance'>;
  scope: unknown[];
}

function templateContainsLiteralElement(
  value: unknown,
  tagName: string,
): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  // Ember's serialized wire format represents a literal element as
  // [OpenElement, tagName]. Scoped style elements never reach this block:
  // glimmer-scoped-css removes them and emits a hashed stylesheet dependency.
  // Therefore a literal style element here is necessarily an unscoped style
  // that the browser would apply to the shared host document.
  if (value[0] === 10 && value[1] === tagName) {
    return true;
  }
  return value.some((entry) => templateContainsLiteralElement(entry, tagName));
}

const inertHeadElementPrefix = 'boxel-head-tag-';

function inertHeadTemplateElements(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  let result = value.map(inertHeadTemplateElements);
  // Head previews must observe authored markup without ever installing live
  // style, script, link, image, or other browser-active elements into the
  // shared Host document. Preserve the wire structure and attributes, but
  // replace every literal tag with an inert custom element. The trusted head
  // preview restores these names only inside a detached parser.
  if (result[0] === 10 && typeof result[1] === 'string') {
    let tagName = result[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
    result[1] = `${inertHeadElementPrefix}${tagName}`;
  }
  return result;
}

export interface RealmCompartmentRuntimeOptions {
  fetch: typeof fetch;
  resolveImport: (moduleIdentifier: string) => string;
  virtualNetwork?: VirtualNetwork;
  decoratorRuntime?: unknown;
  documentFacade?: object;
  mathFacade?: object;
  isTrustedImport?: (moduleIdentifier: string) => boolean | string;
  validateInlineStyle?: (style: string) => void;
}

const lockdownMarker = Symbol.for('boxel.realm-compartment.lockdown');
export const sandboxRealmURLArgument = '__boxelSandboxRealmURL';
export const sandboxViewCardCapabilityArgument =
  '__boxelSandboxHasViewCardCapability';
export const sandboxSetCapabilityArgument = '__boxelSandboxHasSetCapability';

const staticAttributeOpcodes = new Set([14, 24]);
const dynamicAttributeOpcodes = new Set([15, 16, 22, 23]);
const topLayerAttributeNames = new Set([
  'command',
  'commandfor',
  'popover',
  'popovertarget',
  'popovertargetaction',
]);

function validateTemplateDOMPolicy(
  value: unknown,
  validateInlineStyle: ((style: string) => void) | undefined,
): void {
  if (!Array.isArray(value)) {
    return;
  }
  let [opcode, name, attributeValue] = value;
  if (
    typeof name === 'string' &&
    topLayerAttributeNames.has(name.toLowerCase()) &&
    (staticAttributeOpcodes.has(Number(opcode)) ||
      dynamicAttributeOpcodes.has(Number(opcode)))
  ) {
    // Popovers and command-invoked dialogs enter the browser top layer. That
    // layer is intentionally outside ancestor paint/layout containment, so
    // allowing these declarative attributes would let SES content cover Host
    // chrome without ever receiving document or element capabilities.
    throw new Error(
      `SES templates cannot use the ${name} attribute because it can escape the card paint boundary`,
    );
  }
  let isStyleAttribute = name === 'style' || name === 5;
  if (isStyleAttribute && staticAttributeOpcodes.has(Number(opcode))) {
    if (typeof attributeValue !== 'string' || !validateInlineStyle) {
      throw new Error('SES template inline style validation is unavailable');
    }
    validateInlineStyle(attributeValue);
  } else if (isStyleAttribute && dynamicAttributeOpcodes.has(Number(opcode))) {
    throw new Error(
      'SES templates cannot use dynamic inline styles; use <style scoped> or an iframe-rendered format',
    );
  }
  for (let entry of value) {
    validateTemplateDOMPolicy(entry, validateInlineStyle);
  }
}

function ensureLockdown() {
  let globals = globalThis as typeof globalThis & {
    [lockdownMarker]?: true;
  };
  if (!globals[lockdownMarker]) {
    // Boxel's trusted host Loader still uses lexical direct eval to capture
    // AMD registrations. Preserve that host-only evaluator while SES locks
    // down the shared intrinsics. Compartment.evaluate still uses SES's
    // confined evaluator and receives only the endowments declared below.
    lockdown({
      evalTaming: 'unsafe-eval',
      // The start compartment is the trusted Ember host, not realm code. SES's
      // default causal console is frozen, which prevents the host test harness
      // (and normal host diagnostics tooling) from temporarily stubbing
      // console methods. Preserve the platform console here; it is not an
      // endowment of user-realm compartments.
      consoleTaming: 'unsafe',
      // Keep the trusted Host's existing Error constructors, stacks, and
      // top-of-turn handlers. Boxel's standard error surfaces depend on the
      // platform stack, and the compartment is never endowed with host Error
      // objects whose diagnostics would become a capability leak.
      errorTaming: 'unsafe',
      errorTrapping: 'none',
      unhandledRejectionTrapping: 'none',
      // Existing cards use localeCompare/toLocaleString for presentation.
      // SES's safe locale taming replaces those shared intrinsics with
      // non-locale fallbacks (for example, 9035 instead of 9,035), which
      // changes both sandbox output and the trusted Host after lockdown.
      // Browser locale is presentation context, not Store/Realm authority;
      // retain the platform methods for compatibility across both runtimes.
      localeTaming: 'unsafe',
      // Monaco and other webpack/Rollup-produced host libraries assign an
      // own `constructor` while establishing generated prototype chains.
      // Endo documents override taming as a compatibility (not security)
      // tradeoff; `severe` enables that shadowing after intrinsics are frozen.
      overrideTaming: 'severe',
    });
    globals[lockdownMarker] = true;
  }
}

function safeURLGlobals(): Record<string, unknown> {
  let HostURL = globalThis.URL;
  let HostURLSearchParams = globalThis.URLSearchParams;
  let sandboxURLs = new WeakSet<object>();
  let sandboxURLSearchParams = new WeakSet<object>();

  let wrapSearchParams = (value: URLSearchParams): URLSearchParams => {
    Object.setPrototypeOf(value, SandboxURLSearchParams.prototype);
    sandboxURLSearchParams.add(value);
    return value;
  };

  let wrapURL = (value: URL): URL => {
    Object.setPrototypeOf(value, SandboxURL.prototype);
    sandboxURLs.add(value);
    return value;
  };

  let copyPrototypeProperties = (
    target: object,
    source: object,
    omitted: PropertyKey[],
  ) => {
    for (let key of Reflect.ownKeys(source)) {
      if (omitted.includes(key)) {
        continue;
      }
      let descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor) {
        Object.defineProperty(target, key, descriptor);
      }
    }
  };

  function SandboxURL(input: string | URL, base?: string | URL) {
    if (!new.target) {
      throw new TypeError("URL constructor must be called with 'new'");
    }
    return wrapURL(new HostURL(input, base));
  }

  copyPrototypeProperties(SandboxURL.prototype, HostURL.prototype, [
    'constructor',
    'searchParams',
  ]);
  let hostSearchParamsGetter = Object.getOwnPropertyDescriptor(
    HostURL.prototype,
    'searchParams',
  )?.get;
  if (!hostSearchParamsGetter) {
    throw new Error('URL.searchParams is unavailable');
  }
  Object.defineProperty(SandboxURL.prototype, 'searchParams', {
    configurable: false,
    enumerable: true,
    get(this: URL) {
      return wrapSearchParams(hostSearchParamsGetter.call(this));
    },
  });
  Object.defineProperties(SandboxURL, {
    canParse: {
      value: (input: string | URL, base?: string | URL) =>
        HostURL.canParse(input, base),
    },
    parse: {
      value: (input: string | URL, base?: string | URL) =>
        HostURL.canParse(input, base)
          ? wrapURL(new HostURL(input, base))
          : null,
    },
    [Symbol.hasInstance]: {
      value: (value: unknown) =>
        typeof value === 'object' && value !== null && sandboxURLs.has(value),
    },
  });

  function SandboxURLSearchParams(
    init?: string | string[][] | Record<string, string> | URLSearchParams,
  ) {
    if (!new.target) {
      throw new TypeError(
        "URLSearchParams constructor must be called with 'new'",
      );
    }
    return wrapSearchParams(new HostURLSearchParams(init));
  }
  copyPrototypeProperties(
    SandboxURLSearchParams.prototype,
    HostURLSearchParams.prototype,
    ['constructor'],
  );
  Object.defineProperty(SandboxURLSearchParams, Symbol.hasInstance, {
    value: (value: unknown) =>
      typeof value === 'object' &&
      value !== null &&
      sandboxURLSearchParams.has(value),
  });

  // Deliberately do not expose URL.createObjectURL/revokeObjectURL. Cards get
  // URL parsing and mutable URLSearchParams values, not ambient Blob registries
  // or any other host-global authority.
  return {
    URL: harden(SandboxURL),
    URLSearchParams: harden(SandboxURLSearchParams),
  };
}

export default class RealmCompartmentModuleRuntime {
  private templateByComponent = new WeakMap<object, CapturedTemplate>();
  private trustedExportByValue = new WeakMap<
    object,
    SandboxTrustedExportIdentity
  >();
  private trustedModuleFacades = new Map<string, Record<string, unknown>>();
  private explicitRuntimeFacades = new Map<string, Record<string, unknown>>();
  private cardCrudFunctionsContextName = Object.freeze({
    name: 'CardCrudFunctionsContext',
  });
  private cardAPIRuntimeFacade!: Record<string, unknown>;
  private enumFieldRuntimeFacade!: Record<string, unknown>;
  private inertHostCommandFacades = new Map<string, Record<string, unknown>>();
  private formatOnlyModuleFacades = new Map<
    string,
    Record<string, SandboxFormatReference>
  >();
  private trustedExports = new Map<string, object>();
  private fieldMetadataByPrototype = new WeakMap<
    object,
    Map<string, CapturedCardFieldMetadata>
  >();
  private definitionKindByPrototype = new WeakMap<
    object,
    'card' | 'field' | 'file'
  >();
  private initialCardFieldsByInstance = new WeakMap<
    object,
    Record<string, unknown>
  >();
  private handleByComponent = new WeakMap<object, string>();
  private componentByHandle = new Map<string, object>();
  private componentInstanceByHandle = new Map<
    string,
    Record<string, unknown>
  >();
  private componentEffectQueueByHandle = new Map<
    string,
    SandboxComponentEffect[]
  >();
  private componentActionTailByHandle = new Map<string, Promise<void>>();
  private nextComponentHandle = 0;
  private nextComponentInstanceHandle = 0;
  private moduleEvaluations = 0;
  private moduleCacheHits = 0;
  private evaluatingStylesheets: string[] = [];
  private compartment: Compartment;
  private loader: Loader;
  private moduleEvaluator: ReturnType<
    typeof createRealmSandboxCompartment
  >['moduleEvaluator'];
  private isTrustedImport: (moduleIdentifier: string) => boolean | string;

  readonly ambientReport: CompartmentAmbientReport;

  constructor(
    readonly principal: string,
    private options: RealmCompartmentRuntimeOptions,
  ) {
    ensureLockdown();

    let decoratorRuntime =
      options.decoratorRuntime ??
      (globalThis as typeof globalThis & { dt7948?: unknown }).dt7948;
    if (!decoratorRuntime) {
      throw new Error('Decorator runtime is unavailable for card evaluation');
    }

    let globals: Record<string, unknown> = {
      dt7948: decoratorRuntime,
      ...safeURLGlobals(),
    };
    if (options.documentFacade) {
      globals.document = options.documentFacade;
    }
    if (options.mathFacade) {
      globals.Math = options.mathFacade;
    }
    let sandbox = createRealmSandboxCompartment(
      `Boxel realm principal ${principal}`,
      globals,
    );
    this.compartment = sandbox.compartment;
    this.moduleEvaluator = sandbox.moduleEvaluator;
    this.isTrustedImport = options.isTrustedImport ?? defaultTrustedImport;
    this.ambientReport = harden(
      this.compartment.evaluate(`({
        window: typeof window,
        document: typeof document,
        localStorage: typeof localStorage,
        fetch: typeof fetch,
        XMLHttpRequest: typeof XMLHttpRequest,
        URL: typeof URL,
        URLSearchParams: typeof URLSearchParams
      })`) as CompartmentAmbientReport,
    );

    this.loader = new Loader(options.fetch, options.resolveImport, {
      virtualNetwork: options.virtualNetwork,
      moduleEvaluator: (source, moduleIdentifier) =>
        this.evaluateRegistration(source, moduleIdentifier),
      // The ordinary Loader exposes itself as import.meta.loader. That is a
      // trusted-runtime convenience and must never cross into realm code.
      moduleMeta: (moduleIdentifier) => harden({ url: moduleIdentifier }),
    });
    this.installRuntimeFacades();
  }

  async evaluateTemplate(
    moduleIdentifier: string,
    exportName: string,
    format: string,
  ): Promise<SandboxTemplateBundle> {
    let wasLoaded = this.loader.isModuleLoaded(moduleIdentifier);
    let module =
      await this.loader.import<Record<string, unknown>>(moduleIdentifier);
    if (wasLoaded) {
      this.moduleCacheHits++;
    } else {
      this.moduleEvaluations++;
    }

    let cardType = module[exportName] as Record<string, unknown> | undefined;
    if (!cardType) {
      throw new Error(
        `Compartment module ${moduleIdentifier} has no ${exportName} export`,
      );
    }
    let component = cardType[format] ?? cardType.isolated;
    if (this.isFormatReference(component)) {
      throw new Error(
        `Compartment format ${format} is delegated to ${component.module}#${component.name}`,
      );
    }
    if (
      (typeof component !== 'object' || component === null) &&
      typeof component !== 'function'
    ) {
      throw new Error(
        `Compartment card ${exportName} has no ${format} template`,
      );
    }
    if (!this.capturedTemplateForComponent(component as object)) {
      throw new Error(
        `Compartment did not capture the ${format} template for ${exportName}`,
      );
    }
    return structuredClone(
      this.bundleFor(component as object, format === 'head'),
    );
  }

  // QUnit realm adapters install live class objects with Loader.shimModule().
  // Those fixtures intentionally have no source text for SES to evaluate and
  // therefore cannot participate in template capture. Keep this escape hatch
  // test-only: production modules must always cross the explicit template
  // bundle boundary above.
  async trustedTestShimComponent(
    moduleIdentifier: string,
    exportName: string,
    format: string,
  ): Promise<unknown> {
    if (!isTesting()) {
      return undefined;
    }
    let module =
      await this.loader.import<Record<string, unknown>>(moduleIdentifier);
    if (!this.loader.isModuleShimmed(moduleIdentifier)) {
      return undefined;
    }
    let cardType = module[exportName] as Record<string, unknown> | undefined;
    return cardType?.[format] ?? cardType?.isolated;
  }

  async evaluateCardTypeMetadata(
    moduleIdentifier: string,
    exportName: string,
  ): Promise<SandboxCardTypeMetadata> {
    let cardType = await this.importCardType(moduleIdentifier, exportName);
    let displayName =
      typeof cardType.displayName === 'string'
        ? cardType.displayName.slice(0, 256)
        : undefined;
    let headerColor =
      typeof cardType.headerColor === 'string'
        ? cardType.headerColor.slice(0, 128)
        : null;
    let icon =
      (typeof cardType.icon === 'object' && cardType.icon !== null) ||
      typeof cardType.icon === 'function'
        ? this.trustedExportByValue.get(cardType.icon as object)
        : undefined;
    // SandboxCardDef intentionally does not carry Base's executable default
    // templates. A missing format therefore means "use the trusted Base
    // fallback" rather than "render nothing". Export that decision as inert
    // metadata so the host never needs to introspect the authored class.
    let authoredTemplateFormats = [
      'isolated',
      'embedded',
      'fitted',
      'atom',
      'edit',
      'head',
      'markdown',
    ].filter((format) => cardType[format] != null);
    return structuredClone({
      definitionKind: this.cardDefinitionKind(cardType),
      ancestorTypes: this.cardAncestorTypes(cardType),
      displayName,
      fields: this.cardFieldMetadata(cardType),
      headerColor,
      hasCustomEditTemplate: cardType.edit != null,
      hasCustomIsolatedTemplate: cardType.isolated != null,
      authoredTemplateFormats,
      icon,
      prefersFullSandbox: cardType.prefersFullSandbox === true,
      prefersWideFormat: cardType.prefersWideFormat === true,
    });
  }

  async evaluateCardProjection(
    moduleIdentifier: string,
    exportName: string,
    snapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let cardType = await this.importCardType(moduleIdentifier, exportName);
    let CardType = cardType as unknown as new (
      fields?: Record<string, unknown>,
    ) => Record<string, unknown>;
    let safeSnapshot = this.cloneIntoCompartment(this.jsonClone(snapshot)) as
      | Record<string, unknown>
      | undefined;
    let instance = new CardType(safeSnapshot);
    this.materializeComputedFields(instance, CardType);
    let projection = this.jsonClone(instance) as Record<string, unknown>;
    this.materializeAuthoredGetters(
      instance,
      Object.getPrototypeOf(instance) as object | undefined,
      projection,
    );
    return structuredClone(projection);
  }

  async hasModuleExport(
    moduleIdentifier: string,
    exportName: string,
  ): Promise<boolean> {
    let module =
      await this.loader.import<Record<string, unknown>>(moduleIdentifier);
    return Object.prototype.hasOwnProperty.call(module, exportName);
  }

  async invokeCardMethod(
    moduleIdentifier: string,
    exportName: string,
    snapshot: Record<string, unknown>,
    methodName: string,
    args: unknown[] = [],
  ): Promise<SandboxCardMethodResult> {
    let cardType = await this.importCardType(moduleIdentifier, exportName);
    let CardType = cardType as unknown as new (
      fields?: Record<string, unknown>,
    ) => Record<string, unknown>;
    let safeSnapshot = this.cloneIntoCompartment(this.jsonClone(snapshot)) as
      | Record<string, unknown>
      | undefined;
    let instance = new CardType(safeSnapshot);
    // Legacy field decorators initialize after `super()`. Reapply the inert
    // snapshot so method receivers observe data, never field-definition
    // descriptors, regardless of decorator transform order.
    Object.assign(instance, safeSnapshot);
    let method = instance[methodName];
    if (typeof method !== 'function') {
      throw new Error(
        `Compartment card ${exportName} has no method ${methodName}`,
      );
    }
    let safeArgs = this.cloneIntoCompartment(this.jsonClone(args)) as unknown[];
    let value = await method.apply(instance, safeArgs);
    if (value === undefined) {
      return {};
    }
    if (value !== null && typeof value === 'object') {
      let constructor = (value as { constructor?: unknown }).constructor;
      let identity =
        constructor &&
        (typeof constructor === 'object' || typeof constructor === 'function')
          ? this.loader.identify(constructor)
          : undefined;
      if (identity) {
        let attributes = this.jsonClone(value) as Record<string, unknown>;
        let constructorFields = this.initialCardFieldsByInstance.get(value);
        if (constructorFields) {
          Object.assign(attributes, this.jsonClone(constructorFields));
        }
        return structuredClone({
          card: {
            type: identity,
            attributes,
          },
        });
      }
    }
    return structuredClone({ returnValue: this.jsonClone(value) });
  }

  get stats() {
    return {
      moduleEvaluations: this.moduleEvaluations,
      moduleCacheHits: this.moduleCacheHits,
    };
  }

  invalidateModule(moduleIdentifier: string) {
    return this.loader.invalidateModule(moduleIdentifier);
  }

  installFormatOnlyImport(descriptor: SandboxFormatOnlyImportDescriptor) {
    this.loader.shimModule(
      descriptor.module,
      this.formatOnlyModuleFacade(descriptor),
    );
  }

  destroy() {
    this.loader.dispose();
    this.componentByHandle.clear();
    this.componentInstanceByHandle.clear();
    this.componentEffectQueueByHandle.clear();
    this.componentActionTailByHandle.clear();
  }

  instantiateComponent(
    componentHandle: string,
    args: Record<string, unknown>,
  ): SandboxComponentInstanceDescriptor {
    let component = this.componentByHandle.get(componentHandle);
    if (!component || typeof component !== 'function') {
      throw new Error(
        `Unknown sandbox component handle ${componentHandle} for principal ${this.principal}`,
      );
    }
    let effects: SandboxComponentEffect[] = [];
    let instance = new (component as new (
      owner: undefined,
      args: Record<string, unknown>,
    ) => Record<string, unknown>)(undefined, this.componentArgs(args, effects));
    let instanceHandle = `sandbox-instance-${this.nextComponentInstanceHandle++}`;
    this.componentInstanceByHandle.set(instanceHandle, instance);
    effects.length = 0;
    this.componentEffectQueueByHandle.set(instanceHandle, effects);
    return this.describeComponentInstance(instanceHandle, instance);
  }

  invokeComponentAction(
    instanceHandle: string,
    action: string,
    args: unknown[],
  ): SandboxComponentActionResult | Promise<SandboxComponentActionResult> {
    let pending = this.componentActionTailByHandle.get(instanceHandle);
    if (pending) {
      let result = pending.then(() =>
        this.invokeComponentActionNow(instanceHandle, action, args),
      );
      this.trackComponentAction(instanceHandle, result);
      return result;
    }
    let result = this.invokeComponentActionNow(instanceHandle, action, args);
    if (result instanceof Promise) {
      this.trackComponentAction(instanceHandle, result);
    }
    return result;
  }

  private invokeComponentActionNow(
    instanceHandle: string,
    action: string,
    args: unknown[],
  ): SandboxComponentActionResult | Promise<SandboxComponentActionResult> {
    let instance = this.componentInstanceByHandle.get(instanceHandle);
    if (!instance) {
      throw new Error(`Unknown sandbox component instance ${instanceHandle}`);
    }
    let handler = instance[action];
    if (typeof handler !== 'function') {
      throw new Error(`Unknown sandbox component action ${action}`);
    }
    let effects = this.componentEffectQueueByHandle.get(instanceHandle);
    if (!effects) {
      throw new Error(
        `Missing sandbox component effect queue ${instanceHandle}`,
      );
    }
    effects.length = 0;
    let safeArgs = this.cloneIntoCompartment(
      this.jsonClone(projectSandboxActionArguments(args)),
    );
    let finish = (returnValue: unknown): SandboxComponentActionResult => {
      let safeReturnValue: unknown;
      if (returnValue !== undefined) {
        try {
          safeReturnValue = this.jsonClone(returnValue);
        } catch {
          // Executable or cyclic return values do not cross the boundary.
        }
      }
      return harden({
        ...this.describeComponentInstance(instanceHandle, instance),
        effects: effects.splice(0),
        ...(safeReturnValue !== undefined
          ? { returnValue: safeReturnValue }
          : {}),
      });
    };
    let returnValue = handler.apply(instance, safeArgs);
    if (
      returnValue &&
      typeof (returnValue as { then?: unknown }).then === 'function'
    ) {
      return Promise.resolve(returnValue).then(finish);
    }
    return finish(returnValue);
  }

  private trackComponentAction(
    instanceHandle: string,
    result: Promise<SandboxComponentActionResult>,
  ): void {
    let tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.componentActionTailByHandle.set(instanceHandle, tail);
    void tail.finally(() => {
      if (this.componentActionTailByHandle.get(instanceHandle) === tail) {
        this.componentActionTailByHandle.delete(instanceHandle);
      }
    });
  }

  releaseComponentInstance(instanceHandle: string): void {
    this.componentInstanceByHandle.delete(instanceHandle);
    this.componentEffectQueueByHandle.delete(instanceHandle);
    this.componentActionTailByHandle.delete(instanceHandle);
  }

  readComponentProperty(
    handle: string,
    property: string,
    args: Record<string, unknown> = {},
  ): unknown {
    let liveInstance = this.componentInstanceByHandle.get(handle);
    if (liveInstance) {
      return this.jsonClone(liveInstance[property]);
    }
    let instance = this.instantiateComponent(handle, args);
    return this.readComponentProperty(instance.handle, property);
  }

  private evaluateRegistration(source: string, moduleIdentifier: string) {
    let registration = this.moduleEvaluator(source, moduleIdentifier);
    let stylesheets = registration.dependencyList
      .filter((dependency) => dependency.endsWith('.glimmer-scoped.css'))
      .map((dependency) => new URL(dependency, moduleIdentifier).href);

    for (let dependency of registration.dependencyList) {
      if (dependency === 'exports' || dependency === '__import_meta__') {
        continue;
      }
      if (dependency.endsWith('.glimmer-scoped.css')) {
        let stylesheet = new URL(dependency, moduleIdentifier).href;
        if (!this.loader.isModuleLoaded(stylesheet)) {
          this.loader.shimModule(stylesheet, {});
        }
      } else {
        if (this.isHostCommandImport(dependency)) {
          this.loader.shimModule(
            dependency,
            this.inertHostCommandFacade(dependency),
          );
          continue;
        }
        let trustedIdentity = this.trustedImportIdentity(dependency);
        if (!trustedIdentity) {
          continue;
        }
        let facade = this.isCardAPIImport(trustedIdentity)
          ? this.cardAPIRuntimeFacade
          : this.isBaseEnumImport(trustedIdentity)
            ? this.enumFieldRuntimeFacade
            : (this.explicitRuntimeFacades.get(trustedIdentity) ??
              this.trustedModuleFacade(trustedIdentity));
        this.loader.shimModule(dependency, facade);
      }
    }

    let implementation = registration.implementation;
    return {
      dependencyList: registration.dependencyList,
      implementation: (...dependencies: unknown[]) => {
        let previousStylesheets = this.evaluatingStylesheets;
        this.evaluatingStylesheets = stylesheets;
        try {
          implementation(...dependencies);
        } finally {
          this.evaluatingStylesheets = previousStylesheets;
        }
      },
    };
  }

  private isHostCommandImport(moduleIdentifier: string): boolean {
    return [
      '@cardstack/boxel-host/commands/',
      '@cardstack/boxel-host/tools/',
      'https://packages/@cardstack/boxel-host/commands/',
      'https://packages/@cardstack/boxel-host/tools/',
    ].some((prefix) => moduleIdentifier.startsWith(prefix));
  }

  private isCardAPIImport(moduleIdentifier: string): boolean {
    if (
      moduleIdentifier === '@cardstack/base/card-api' ||
      moduleIdentifier === 'https://cardstack.com/base/card-api'
    ) {
      return true;
    }
    try {
      return /\/card-api(?:\.gts)?$/.test(new URL(moduleIdentifier).pathname);
    } catch {
      return false;
    }
  }

  private isBaseEnumImport(moduleIdentifier: string): boolean {
    if (
      moduleIdentifier === '@cardstack/base/enum' ||
      moduleIdentifier === 'https://cardstack.com/base/enum'
    ) {
      return true;
    }
    try {
      return /\/enum(?:\.gts)?$/.test(new URL(moduleIdentifier).pathname);
    } catch {
      return false;
    }
  }

  private inertHostCommandFacade(
    moduleIdentifier: string,
  ): Record<string, unknown> {
    let cached = this.inertHostCommandFacades.get(moduleIdentifier);
    if (cached) {
      return cached;
    }
    let commandTokens = new Map<string, object>();
    let facade = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, property) => {
        if (typeof property !== 'string') {
          return undefined;
        }
        let token = commandTokens.get(property);
        if (!token) {
          token = class SandboxHostCommandToken {
            execute(): never {
              throw new Error(
                `Sandbox host command ${moduleIdentifier}#${property} requires an explicit host capability`,
              );
            }
          };
          commandTokens.set(property, token);
        }
        return token;
      },
    });
    harden(facade);
    this.inertHostCommandFacades.set(moduleIdentifier, facade);
    return facade;
  }

  private formatOnlyModuleFacade(
    descriptor: SandboxFormatOnlyImportDescriptor,
  ): Record<string, SandboxFormatReference> {
    let cacheKey = `${descriptor.module}#${[...descriptor.exports].sort().join(',')}`;
    let cached = this.formatOnlyModuleFacades.get(cacheKey);
    if (cached) {
      return cached;
    }
    let facade = Object.fromEntries(
      descriptor.exports.map((name) => [
        name,
        harden({
          kind: 'sandbox-format-reference',
          module: descriptor.module,
          name,
        }) satisfies SandboxFormatReference,
      ]),
    );
    harden(facade);
    this.formatOnlyModuleFacades.set(cacheKey, facade);
    return facade;
  }

  private isFormatReference(value: unknown): value is SandboxFormatReference {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'sandbox-format-reference'
    );
  }

  private trustedImportIdentity(moduleIdentifier: string): string | undefined {
    let result = this.isTrustedImport(moduleIdentifier);
    return typeof result === 'string'
      ? result
      : result
        ? moduleIdentifier
        : undefined;
  }

  private async importCardType(
    moduleIdentifier: string,
    exportName: string,
  ): Promise<Record<string, unknown>> {
    let module =
      await this.loader.import<Record<string, unknown>>(moduleIdentifier);
    let cardType = module[exportName];
    if (
      (typeof cardType !== 'object' || cardType === null) &&
      typeof cardType !== 'function'
    ) {
      throw new Error(
        `Compartment module ${moduleIdentifier} has no ${exportName} export`,
      );
    }
    return cardType as Record<string, unknown>;
  }

  private installRuntimeFacades() {
    this.cardAPIRuntimeFacade = this.cardAPIFacade(
      'https://cardstack.com/base/card-api',
    );
    this.loader.shimModule(
      'https://cardstack.com/base/card-api',
      this.cardAPIRuntimeFacade,
    );
    this.loader.shimModule(
      '@cardstack/base/card-api',
      this.cardAPIRuntimeFacade,
    );
    this.enumFieldRuntimeFacade = this.enumFieldFacade();
    this.installExplicitRuntimeFacade(
      '@glimmer/component',
      Object.freeze({ default: this.componentBase() }),
    );
    this.installExplicitRuntimeFacade(
      '@ember/component',
      this.emberComponentFacade(),
    );
    this.installExplicitRuntimeFacade(
      '@ember/component/template-only',
      harden({
        // A compiled <template> assigns its captured descriptor to the value
        // returned by templateOnly(). The compartment only needs a fresh,
        // constructable identity here; the host reifies the descriptor after
        // it crosses the explicit template boundary.
        default: () => this.componentBase(),
      }),
    );
    this.installExplicitRuntimeFacade(
      '@ember/template-factory',
      this.templateFactoryFacade(),
    );
    this.installExplicitRuntimeFacade(
      '@ember/modifier',
      harden({ on: this.trustedExport('@ember/modifier', 'on') }),
    );
    this.installExplicitRuntimeFacade(
      '@ember/object',
      this.decoratorFacade('@ember/object', ['action']),
    );
    this.installExplicitRuntimeFacade(
      '@glimmer/tracking',
      this.decoratorFacade('@glimmer/tracking', ['cached', 'tracked']),
    );
    let provideConsumeContextFacade = this.provideConsumeContextFacade();
    this.installExplicitRuntimeFacade(
      'ember-provide-consume-context',
      provideConsumeContextFacade,
    );
    // This historical package has a bare (non-@scope) specifier. Loader's
    // URL normalization can make it realm-relative before AMD dependency
    // registration sees it, so cover that equivalent spelling with the same
    // inert facade. No realm source is fetched or trusted by this alias.
    this.loader.shimModule(
      new URL('ember-provide-consume-context', this.principal).href,
      provideConsumeContextFacade,
    );
    this.installExplicitRuntimeFacade(
      '@ember/helper',
      harden(
        Object.fromEntries(
          ['array', 'concat', 'fn', 'get', 'hash'].map((name) => [
            name,
            this.trustedExport('@ember/helper', name),
          ]),
        ),
      ),
    );
    this.installExplicitRuntimeFacade(
      '@cardstack/runtime-common',
      this.runtimeCommonFacade(),
    );
  }

  private installExplicitRuntimeFacade(
    moduleIdentifier: string,
    facade: Record<string, unknown>,
  ) {
    this.explicitRuntimeFacades.set(moduleIdentifier, facade);
    this.loader.shimModule(moduleIdentifier, facade);
  }

  private runtimeCommonFacade() {
    // These are pure data transforms plus inert realm/menu identity symbols.
    // Keep this list explicit: the full runtime-common namespace also contains
    // host/runtime facilities that realm-authored code must not receive.
    let Command = this.sandboxCommandBase();
    return Object.freeze({
      Command,
      Tool: Command,
      CardCrudFunctionsContextName: this.cardCrudFunctionsContextName,
      baseRRI,
      codeRef,
      getMenuItems,
      realmURL,
      searchEntryWireQueryFromQuery: sandboxSearchEntryWireQueryFromQuery,
    });
  }

  private enumFieldFacade() {
    let normalizeOptions = (rawOptions: unknown[]) =>
      (rawOptions ?? []).map((option) =>
        option && typeof option === 'object' && 'value' in option
          ? option
          : Object.freeze({ value: option, label: String(option) }),
      );
    let enumField = (
      Base: unknown,
      config: {
        options?: unknown;
        defaultOptions?: unknown[];
        displayName?: string;
        icon?: unknown;
      } = {},
    ) => {
      if (typeof Base !== 'function') {
        throw new Error('enumField requires a FieldDef constructor');
      }
      let BaseField = Base as new (...args: unknown[]) => object;
      class SandboxEnumField extends BaseField {
        static configuration =
          typeof config.options === 'function'
            ? function (this: unknown) {
                return {
                  enum: {
                    options: (
                      config.options as (this: unknown) => unknown
                    ).call(this),
                  },
                };
              }
            : Object.freeze({ enum: { options: config.options } });
        static defaultOptions =
          typeof config.options === 'function' &&
          Array.isArray(config.defaultOptions) &&
          config.defaultOptions.length > 0
            ? config.defaultOptions
            : undefined;
        static displayName =
          config.displayName ??
          (Base as unknown as { displayName?: unknown }).displayName;
        static icon =
          config.icon ?? (Base as unknown as { icon?: unknown }).icon;
      }
      let identity =
        this.trustedExportByValue.get(Base) ?? this.loader.identify(Base);
      if (identity) {
        // enumField creates an anonymous presentation specialization. Its
        // persisted field type remains the trusted Base FieldDef while the
        // compartment retains the enum configuration for authored logic.
        this.trustedExportByValue.set(SandboxEnumField, identity);
      }
      return SandboxEnumField;
    };
    return Object.freeze({
      default: enumField,
      enumAllowedValues: (rawOptions: unknown[]) =>
        normalizeOptions(rawOptions).map(
          (option) => (option as { value: unknown }).value,
        ),
      enumConfig: (input: unknown) => input,
      normalizeEnumOptions: normalizeOptions,
    });
  }

  private provideConsumeContextFacade() {
    let consume = (contextName: unknown) => {
      if (contextName !== this.cardCrudFunctionsContextName) {
        throw new Error('Sandbox context is not available');
      }
      return (
        _target: object,
        _property: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => ({
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get(this: { args?: Record<string, unknown> }) {
          let viewCard = this.args?.viewCard;
          return Object.freeze({
            ...(typeof viewCard === 'function' ? { viewCard } : {}),
          });
        },
      });
    };
    return Object.freeze({ consume });
  }

  private sandboxCommandBase() {
    return class SandboxCommand {
      static actionVerb = 'Apply';

      ignoreInputFields = ['cardInfo'];
      requireInputFields: string[] = [];
      name = this.constructor.name;
      description = '';

      protected readonly toolContext: object;

      constructor(toolContext: object) {
        this.toolContext = toolContext;
      }

      protected get commandContext(): object {
        return this.toolContext;
      }

      async execute(input?: unknown): Promise<unknown> {
        let inputCard = input;
        if (input !== undefined) {
          let InputType = await (
            this as unknown as {
              getInputType(): Promise<
                new (fields?: Record<string, unknown>) => unknown
              >;
            }
          ).getInputType();
          if (InputType && !(input instanceof InputType)) {
            inputCard = new InputType(input as Record<string, unknown>);
          }
        }
        return (
          this as unknown as { run(inputValue: unknown): Promise<unknown> }
        ).run(inputCard);
      }
    };
  }

  private decoratorFacade(moduleIdentifier: string, names: string[]) {
    let facade: Record<string, unknown> = Object.create(null);
    for (let name of names) {
      let decorator = (
        _target: object,
        _property: string,
        descriptor: PropertyDescriptor,
      ) => descriptor;
      facade[name] = decorator;
      this.trustedExportByValue.set(decorator, {
        module: moduleIdentifier,
        name,
      });
    }
    return Object.freeze(facade);
  }

  private emberComponentFacade() {
    return harden({
      setComponentTemplate: (
        factory: () => TemplateFactoryResult,
        component: object,
      ) => {
        let descriptor = factory()?.parsedLayout;
        if (!descriptor) {
          throw new Error('Card template factory returned no layout');
        }
        this.templateByComponent.set(
          component,
          this.captureDescriptor(descriptor),
        );
        return component;
      },
    });
  }

  private templateFactoryFacade() {
    return harden({
      createTemplateFactory: (descriptor: TemplateFactoryDescriptor) =>
        harden(() => ({ parsedLayout: descriptor })),
    });
  }

  private trustedModuleFacade(
    moduleIdentifier: string,
  ): Record<string, unknown> {
    let cached = this.trustedModuleFacades.get(moduleIdentifier);
    if (cached) {
      return cached;
    }
    let target = Object.create(null) as Record<string, unknown>;
    let facade = new Proxy(target, {
      get: (_target, property) => {
        if (typeof property !== 'string') {
          return undefined;
        }
        return this.trustedExport(moduleIdentifier, property);
      },
    });
    harden(facade);
    this.trustedModuleFacades.set(moduleIdentifier, facade);
    return facade;
  }

  private trustedExport(moduleIdentifier: string, name: string): object {
    let key = `${moduleIdentifier}|${name}`;
    let cached = this.trustedExports.get(key);
    if (cached) {
      return cached;
    }
    let token = function SandboxTrustedExport() {};
    this.trustedExports.set(key, token);
    this.trustedExportByValue.set(token, { module: moduleIdentifier, name });
    return token;
  }

  private cardAPIFacade(moduleIdentifier: string) {
    let thisRuntime = this;
    let initialFields = Symbol('sandbox-card-initial-fields');
    class SandboxBaseDef {
      static baseDef: undefined;

      constructor(fields?: Record<string, unknown>) {
        if (fields) {
          thisRuntime.initialCardFieldsByInstance.set(this, fields);
          Object.defineProperty(this, initialFields, {
            configurable: false,
            enumerable: false,
            value: fields,
          });
          Object.assign(this, fields);
        }
      }
    }
    class SandboxCardDef extends SandboxBaseDef {}
    class SandboxFieldDef extends SandboxBaseDef {}
    class SandboxFileDef extends SandboxFieldDef {}
    this.definitionKindByPrototype.set(SandboxCardDef.prototype, 'card');
    this.definitionKindByPrototype.set(SandboxFieldDef.prototype, 'field');
    this.definitionKindByPrototype.set(SandboxFileDef.prototype, 'file');
    let SandboxComponent = this.componentBase();
    let field = (target: object, name: string, descriptor: unknown) => {
      let initializer =
        typeof descriptor === 'object' && descriptor !== null
          ? (descriptor as { initializer?: unknown }).initializer
          : undefined;
      if (typeof name === 'string' && typeof initializer === 'function') {
        let definition = initializer();
        if (typeof definition === 'object' && definition !== null) {
          let kind = (definition as { type?: unknown }).type;
          if (
            kind !== 'contains' &&
            kind !== 'containsMany' &&
            kind !== 'linksTo' &&
            kind !== 'linksToMany'
          ) {
            return descriptor;
          }
          let card = (definition as { card?: unknown }).card;
          if (
            (typeof card !== 'object' || card === null) &&
            typeof card !== 'function'
          ) {
            return descriptor;
          }
          let fields = this.fieldMetadataByPrototype.get(target);
          if (!fields) {
            fields = new Map();
            this.fieldMetadataByPrototype.set(target, fields);
          }
          // Keep the compartment-local constructor only inside this runtime.
          // Once module evaluation finishes Loader can identify authored
          // types, and cardFieldMetadata converts it to an inert CodeRef. No
          // executable value crosses into the Host.
          let computeVia = (definition as { computeVia?: unknown }).computeVia;
          fields.set(name, {
            kind,
            card,
            ...(typeof computeVia === 'function'
              ? {
                  computeVia:
                    computeVia as CapturedCardFieldMetadata['computeVia'],
                }
              : {}),
          });
        }
        let originalInitializer = initializer;
        return {
          ...(descriptor as Record<string, unknown>),
          initializer(this: Record<PropertyKey, unknown>) {
            let supplied = this[initialFields];
            if (
              supplied &&
              typeof supplied === 'object' &&
              Object.prototype.hasOwnProperty.call(supplied, name)
            ) {
              return (supplied as Record<string, unknown>)[name];
            }
            return originalInitializer.call(this);
          },
        };
      }
      return descriptor;
    };
    let relationshipType = (cardOrThunk: unknown) => {
      if (
        typeof cardOrThunk === 'function' &&
        !('baseDef' in cardOrThunk) &&
        !Object.prototype.hasOwnProperty.call(cardOrThunk, 'prototype') &&
        !this.trustedExportByValue.has(cardOrThunk)
      ) {
        return (cardOrThunk as () => unknown)();
      }
      return cardOrThunk;
    };
    let definition = (
      type: SandboxCardFieldMetadata['kind'],
      cardOrThunk: unknown,
      options?: { computeVia?: unknown },
    ) => {
      let computeVia = options?.computeVia;
      let card = relationshipType(cardOrThunk);
      if (
        (typeof card !== 'object' || card === null) &&
        typeof card !== 'function'
      ) {
        throw new Error(`Invalid ${type} field definition`);
      }
      return Object.freeze({
        type,
        card,
        ...(typeof computeVia === 'function'
          ? {
              computeVia:
                computeVia as SandboxCardFieldDefinition['computeVia'],
            }
          : {}),
      }) satisfies SandboxCardFieldDefinition;
    };
    let contains = (card: unknown, options?: { computeVia?: unknown }) =>
      definition('contains', card, options);
    let containsMany = (card: unknown, options?: { computeVia?: unknown }) =>
      definition('containsMany', card, options);
    let linksTo = (cardOrThunk: unknown, options?: { computeVia?: unknown }) =>
      definition('linksTo', cardOrThunk, options);
    let linksToMany = (
      cardOrThunk: unknown,
      options?: { computeVia?: unknown },
    ) => definition('linksToMany', cardOrThunk, options);
    let getFields = (
      value: unknown,
      options?: { includeComputeds?: boolean },
    ) => this.compartmentFieldMap(value, options?.includeComputeds !== false);
    let facade: Record<string, unknown> = {
      CardDef: SandboxCardDef,
      FieldDef: SandboxFieldDef,
      FileDef: SandboxFileDef,
      Component: SandboxComponent,
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      getFields,
    };
    for (let [name, value] of Object.entries(facade)) {
      if (
        (typeof value === 'object' && value !== null) ||
        typeof value === 'function'
      ) {
        this.trustedExportByValue.set(value, {
          module: moduleIdentifier,
          name,
        });
      }
    }
    let facadeWithTypeTokens = new Proxy(facade, {
      get: (target, property, receiver) => {
        if (Reflect.has(target, property)) {
          return Reflect.get(target, property, receiver);
        }
        return typeof property === 'string'
          ? this.trustedExport(moduleIdentifier, property)
          : undefined;
      },
    });
    // Keep the facade namespace shallowly immutable without recursively
    // freezing its inert class tokens. Decorator-transforms and ordinary
    // subclassing expect writable prototype constructors; these tokens carry
    // no host authority and are private to this realm principal's runtime.
    return Object.freeze(facadeWithTypeTokens);
  }

  private compartmentFieldMap(
    value: unknown,
    includeComputeds: boolean,
  ): Record<
    string,
    { fieldType: SandboxCardFieldMetadata['kind']; card: object }
  > {
    let prototype =
      typeof value === 'function'
        ? (value as { prototype?: object }).prototype
        : value && typeof value === 'object'
          ? Object.getPrototypeOf(value)
          : undefined;
    let result: Record<
      string,
      { fieldType: SandboxCardFieldMetadata['kind']; card: object }
    > = Object.create(null);
    while (prototype && prototype !== Object.prototype) {
      for (let [name, field] of this.fieldMetadataByPrototype.get(prototype) ??
        []) {
        if (!includeComputeds && field.computeVia) {
          continue;
        }
        result[name] ??= { fieldType: field.kind, card: field.card };
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return result;
  }

  private materializeComputedFields(
    instance: Record<string, unknown>,
    CardType: new (fields?: Record<string, unknown>) => Record<string, unknown>,
  ) {
    let fields = new Map<string, CapturedCardFieldMetadata>();
    let prototypes: object[] = [];
    let prototype: object | null | undefined = CardType.prototype;
    while (prototype && prototype !== Object.prototype) {
      prototypes.unshift(prototype);
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    for (let currentPrototype of prototypes) {
      for (let entry of this.fieldMetadataByPrototype.get(currentPrototype) ??
        []) {
        fields.set(entry[0], entry[1]);
      }
    }

    let supplied = this.initialCardFieldsByInstance.get(instance) ?? {};
    for (let [name, field] of fields) {
      let hasSupplied = Object.prototype.hasOwnProperty.call(supplied, name);
      let value = hasSupplied ? supplied[name] : undefined;
      if (!hasSupplied && field.computeVia) {
        try {
          value = field.computeVia.call(instance);
        } catch {
          // Projection is best-effort per field. A branch that depends on
          // unavailable browser authority must not erase independent computed
          // values. If the Realm/index supplied a value, the hasSupplied path
          // above keeps it without executing computeVia at all.
          value = undefined;
        }
      }
      instance[name] = this.materializeCompartmentFieldValue(value, field);
    }
  }

  private materializeAuthoredGetters(
    instance: Record<string, unknown>,
    authoredPrototype: object | undefined,
    projection: Record<string, unknown>,
  ) {
    let prototype = authoredPrototype;
    while (
      prototype &&
      prototype !== Object.prototype &&
      !this.definitionKindByPrototype.has(prototype)
    ) {
      for (let name of Object.getOwnPropertyNames(prototype)) {
        if (
          name === 'constructor' ||
          name === '__proto__' ||
          name === 'prototype' ||
          Object.prototype.hasOwnProperty.call(projection, name)
        ) {
          continue;
        }
        let getter = Object.getOwnPropertyDescriptor(prototype, name)?.get;
        if (!getter) {
          continue;
        }
        try {
          // Ordinary CardDef getters are part of the model contract consumed
          // by authored templates just like computeVia fields. Evaluate them
          // against inert compartment data and only return JSON-safe results.
          projection[name] = this.jsonClone(getter.call(instance));
        } catch {
          // A getter that needs unavailable authority must not erase other
          // independent projection values.
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | undefined;
    }
  }

  private materializeCompartmentFieldValue(
    value: unknown,
    field: CapturedCardFieldMetadata,
  ): unknown {
    if (
      value == null ||
      field.kind === 'linksTo' ||
      field.kind === 'linksToMany'
    ) {
      return value;
    }
    if (field.kind === 'containsMany') {
      return Array.isArray(value)
        ? value.map((entry) =>
            this.materializeCompartmentValue(entry, field.card),
          )
        : [];
    }
    return this.materializeCompartmentValue(value, field.card);
  }

  private materializeCompartmentValue(value: unknown, card: object): unknown {
    if (!this.authoredDefinitionKind(card)) {
      return value;
    }
    let CardType = card as new (
      fields?: Record<string, unknown>,
    ) => Record<string, unknown>;
    let instance =
      value instanceof CardType
        ? (value as Record<string, unknown>)
        : new CardType(
            value !== null && typeof value === 'object' && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : { value },
          );
    this.materializeComputedFields(instance, CardType);
    return instance;
  }

  private authoredDefinitionKind(card: object) {
    let prototype = (card as { prototype?: object }).prototype;
    while (prototype && prototype !== Object.prototype) {
      let kind = this.definitionKindByPrototype.get(prototype);
      if (kind) {
        return kind;
      }
      prototype = Object.getPrototypeOf(prototype) as object | undefined;
    }
    return undefined;
  }

  private cardFieldMetadata(
    cardType: Record<string, unknown>,
  ): Record<string, SandboxCardFieldMetadata> {
    let fields: Record<string, SandboxCardFieldMetadata> = Object.create(null);
    let prototype: object | null | undefined = (
      cardType as { prototype?: object }
    ).prototype;
    while (prototype && prototype !== Object.prototype) {
      for (let [name, captured] of this.fieldMetadataByPrototype.get(
        prototype,
      ) ?? []) {
        let type =
          this.trustedExportByValue.get(captured.card) ??
          this.loader.identify(captured.card);
        if (!type) {
          type = {
            module: 'https://cardstack.com/base/card-api',
            name:
              captured.kind === 'linksTo' || captured.kind === 'linksToMany'
                ? 'CardDef'
                : 'FieldDef',
          };
        }
        if (type) {
          let rawDisplayName = (captured.card as { displayName?: unknown })
            .displayName;
          let displayName =
            typeof rawDisplayName === 'string'
              ? rawDisplayName.slice(0, 256)
              : undefined;
          fields[name] ??= { kind: captured.kind, type, displayName };
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return fields;
  }

  private cardDefinitionKind(
    cardType: Record<string, unknown>,
  ): 'card' | 'field' | 'file' {
    let prototype: object | null | undefined = (
      cardType as { prototype?: object }
    ).prototype;
    while (prototype && prototype !== Object.prototype) {
      let kind = this.definitionKindByPrototype.get(prototype);
      if (kind) {
        return kind;
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    throw new Error('Sandbox export is not a CardDef or FieldDef');
  }

  private cardAncestorTypes(
    cardType: Record<string, unknown>,
  ): SandboxTrustedExportIdentity[] {
    let ancestors: SandboxTrustedExportIdentity[] = [];
    let constructor = Object.getPrototypeOf(cardType) as object | null;
    while (constructor && constructor !== Function.prototype) {
      let identity =
        this.trustedExportByValue.get(constructor) ??
        this.loader.identify(constructor);
      if (identity) {
        ancestors.push(identity);
      }
      constructor = Object.getPrototypeOf(constructor) as object | null;
    }
    return ancestors;
  }

  private captureDescriptor(
    descriptor: TemplateFactoryDescriptor,
  ): CapturedTemplate {
    if (
      typeof descriptor.id !== 'string' ||
      typeof descriptor.block !== 'string' ||
      typeof descriptor.moduleName !== 'string'
    ) {
      throw new Error('Card template descriptor has an invalid shape');
    }
    let block = JSON.parse(descriptor.block) as unknown;
    validateTemplateDOMPolicy(block, this.options.validateInlineStyle);
    let scope = descriptor.scope?.() ?? [];
    if (!Array.isArray(scope)) {
      throw new Error('Card template descriptor has an invalid scope');
    }
    return {
      descriptor: {
        id: descriptor.id,
        block: descriptor.block,
        moduleName: descriptor.moduleName,
        isStrictMode: descriptor.isStrictMode === true,
        stylesheets: [...this.evaluatingStylesheets],
      },
      scope,
    };
  }

  // Ember components inherit their template when a subclass does not install
  // one of its own. Realm cards use that ordinary behavior to specialize a
  // component's actions/state while reusing a template exported by another
  // same-realm module. The sandbox cannot ask Ember to introspect the live
  // class, so make that implicit lookup explicit inside the compartment.
  //
  // Cache the inherited descriptor against the leaf component. bundleFor()
  // must instantiate that leaf (not the template owner), otherwise overridden
  // getters/actions disappear at the boundary.
  private capturedTemplateForComponent(
    component: object,
  ): CapturedTemplate | undefined {
    let captured = this.templateByComponent.get(component);
    if (captured) {
      return captured;
    }
    let ancestor = Object.getPrototypeOf(component) as object | null;
    while (ancestor) {
      captured = this.templateByComponent.get(ancestor);
      if (captured) {
        this.templateByComponent.set(component, captured);
        return captured;
      }
      ancestor = Object.getPrototypeOf(ancestor) as object | null;
    }
    return undefined;
  }

  private bundleFor(
    root: object,
    inertHeadElements = false,
  ): SandboxTemplateBundle {
    let ids = new WeakMap<object, string>();
    let nextId = 0;
    let templates: Record<string, SandboxTemplateDescriptor> =
      Object.create(null);
    let visit = (component: object): string => {
      let existing = ids.get(component);
      if (existing) {
        return existing;
      }
      let captured = this.capturedTemplateForComponent(component);
      if (!captured) {
        throw new Error('Template scope references an uncaptured component');
      }
      let id = `component-${nextId++}`;
      ids.set(component, id);
      let block = JSON.parse(captured.descriptor.block) as unknown;
      if (
        !inertHeadElements &&
        templateContainsLiteralElement(block, 'style')
      ) {
        throw new Error(
          'SES templates must use <style scoped>; unscoped <style> would affect the shared host document',
        );
      }
      templates[id] = {
        ...captured.descriptor,
        block: JSON.stringify(
          inertHeadElements ? inertHeadTemplateElements(block) : block,
        ),
        scope: [],
        instance: this.componentInstanceDescriptor(component),
      };
      templates[id].scope = captured.scope.map((value) =>
        this.scopeReference(value, visit),
      );
      return id;
    };
    let rootId = visit(root);
    return harden({ root: rootId, templates });
  }

  private componentBase() {
    return class SandboxComponentBase {
      readonly args: Record<string, unknown>;

      constructor(_owner: unknown, args: Record<string, unknown> = {}) {
        this.args = args;
      }
    };
  }

  private componentInstanceDescriptor(
    component: object,
  ): SandboxComponentInstanceDescriptor {
    if (typeof component !== 'function') {
      throw new Error('Captured template component is not constructable');
    }
    let handle = this.handleByComponent.get(component);
    if (!handle) {
      handle = `sandbox-component-${this.nextComponentHandle++}`;
      this.handleByComponent.set(component, handle);
      this.componentByHandle.set(handle, component);
    }
    let instance = new (component as new (
      owner: undefined,
      args: Record<string, unknown>,
    ) => Record<string, unknown>)(undefined, this.componentArgs({}));
    return this.describeComponentInstance(handle, instance);
  }

  private describeComponentInstance(
    handle: string,
    instance: Record<string, unknown>,
  ): SandboxComponentInstanceDescriptor {
    let state: Record<string, unknown> = {};
    let actions = new Set<string>();
    for (let key of Object.keys(instance).sort()) {
      if (key !== 'args') {
        let value = instance[key];
        if (typeof value === 'function') {
          actions.add(key);
        } else if (typeof value !== 'symbol') {
          state[key] = this.jsonClone(value);
        }
      }
    }
    let getters = new Set<string>();
    let prototype = Object.getPrototypeOf(instance) as object | null;
    while (prototype && prototype !== Object.prototype) {
      for (let name of Object.getOwnPropertyNames(prototype).sort()) {
        let descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (name !== 'constructor' && typeof descriptor?.get === 'function') {
          getters.add(name);
        } else if (
          name !== 'constructor' &&
          typeof descriptor?.value === 'function'
        ) {
          actions.add(name);
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return harden({
      handle,
      state,
      getters: [...getters],
      actions: [...actions],
    });
  }

  private componentArgs(
    args: Record<string, unknown>,
    effects?: SandboxComponentEffect[],
  ): Record<string, unknown> {
    let grantsViewCard =
      typeof args.viewCard === 'function' ||
      args[sandboxViewCardCapabilityArgument] === true;
    let grantsSet =
      typeof args.set === 'function' ||
      args[sandboxSetCapabilityArgument] === true;
    let clonedArgs = this.jsonClone(args);
    delete clonedArgs[sandboxViewCardCapabilityArgument];
    delete clonedArgs[sandboxSetCapabilityArgument];
    let model = clonedArgs.model;
    let href: string | undefined;
    if (
      typeof model === 'object' &&
      model !== null &&
      typeof model[sandboxRealmURLArgument] === 'string'
    ) {
      href = model[sandboxRealmURLArgument];
      delete model[sandboxRealmURLArgument];
    }
    let compartmentArgs = this.cloneIntoCompartment(clonedArgs) as Record<
      string,
      unknown
    >;
    if (grantsViewCard && effects) {
      compartmentArgs.viewCard = harden(
        (target: unknown, format?: unknown, options?: unknown): undefined => {
          let targetID =
            typeof target === 'string'
              ? target
              : typeof target === 'object' &&
                  target !== null &&
                  'href' in target &&
                  typeof target.href === 'string'
                ? target.href
                : typeof target === 'object' &&
                    target !== null &&
                    'id' in target &&
                    typeof target.id === 'string'
                  ? target.id
                  : undefined;
          if (!targetID) {
            return;
          }
          let safeOptions: unknown;
          if (options !== undefined) {
            try {
              safeOptions = this.jsonClone(options);
            } catch {
              // Capability arguments are data-only. Invalid/cyclic option
              // bags are omitted while the validated navigation target is
              // still allowed to proceed.
            }
          }
          effects.push({
            type: 'view-card',
            target: targetID,
            ...(typeof format === 'string' ? { format } : {}),
            ...(typeof safeOptions === 'object' && safeOptions !== null
              ? { options: safeOptions as Record<string, unknown> }
              : {}),
          });
        },
      );
    }
    if (grantsSet && effects) {
      compartmentArgs.set = harden((value: unknown): undefined => {
        let safeValue = this.jsonClone(value);
        if (value !== null && typeof value === 'object') {
          let constructorFields = this.initialCardFieldsByInstance.get(value);
          if (constructorFields) {
            Object.assign(safeValue, this.jsonClone(constructorFields));
          }
        }
        effects.push({ type: 'set', value: safeValue });
      });
    }
    let compartmentModel = compartmentArgs.model;
    if (
      href &&
      typeof compartmentModel === 'object' &&
      compartmentModel !== null
    ) {
      Object.defineProperty(compartmentModel, realmURL, {
        configurable: false,
        enumerable: false,
        value: Object.freeze({ href }),
      });
    }
    return compartmentArgs;
  }

  private cloneIntoCompartment(value: unknown): unknown {
    // This is a data boundary, but Compartment.evaluate still applies SES's
    // mandatory source transforms to the expression below. Escape characters
    // that can form HTML-comment tokens before embedding the JSON text in
    // source. JSON.parse restores the original data inside the compartment.
    // This keeps strings such as Mermaid's `-->` and authored `<!-- ... -->`
    // comments from being mistaken for executable legacy HTML comments.
    let json = JSON.stringify(value)
      .split('<')
      .join('\\u003c')
      .split('>')
      .join('\\u003e')
      .split('\u2028')
      .join('\\u2028')
      .split('\u2029')
      .join('\\u2029');
    return this.compartment.evaluate(`JSON.parse(${JSON.stringify(json)})`);
  }

  private scopeReference(
    value: unknown,
    visit: (component: object) => string,
  ): SandboxScopeReference {
    if (
      (typeof value === 'object' && value !== null) ||
      typeof value === 'function'
    ) {
      let component = value as object;
      if (this.capturedTemplateForComponent(component)) {
        return harden({ kind: 'component', component: visit(component) });
      }
      let identity = this.trustedExportByValue.get(component);
      if (identity) {
        return harden({
          kind: 'trusted-export',
          module: identity.module,
          name: identity.name,
        });
      }
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new Error('Template scope contains an ungranted executable value');
    }
    return harden({ kind: 'value', value: this.jsonClone(value) });
  }

  private jsonClone(value: unknown): any {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      // Report one stable boundary error instead of leaking a value-specific
      // serialization failure across the compartment.
    }
    if (json === undefined) {
      throw new Error('Sandbox boundary contains a non-JSON value');
    }
    return JSON.parse(json);
  }
}

function defaultTrustedImport(moduleIdentifier: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(moduleIdentifier).split('\\').join('/');
  } catch {
    return false;
  }
  if (
    decoded
      .split(/[/?#]/)
      .some((segment) => segment === '.' || segment === '..')
  ) {
    return false;
  }
  return (
    moduleIdentifier === '@ember/component' ||
    moduleIdentifier === '@ember/object' ||
    moduleIdentifier === '@ember/helper' ||
    moduleIdentifier === '@ember/modifier' ||
    moduleIdentifier === '@ember/component/template-only' ||
    moduleIdentifier === '@ember/template-factory' ||
    moduleIdentifier === 'ember-provide-consume-context' ||
    moduleIdentifier === '@glimmer/component' ||
    moduleIdentifier === '@glimmer/tracking' ||
    moduleIdentifier === '@cardstack/runtime-common' ||
    moduleIdentifier.startsWith('https://cardstack.com/base/') ||
    moduleIdentifier.startsWith('@cardstack/base/') ||
    moduleIdentifier.startsWith('https://cardstack.com/catalog/') ||
    moduleIdentifier.startsWith('@cardstack/catalog/') ||
    moduleIdentifier.startsWith('@cardstack/boxel-icons/') ||
    moduleIdentifier.startsWith('@cardstack/boxel-ui/')
  );
}
