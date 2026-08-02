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

export interface SandboxTemplateBundle {
  root: string;
  templates: Record<string, SandboxTemplateDescriptor>;
}

export interface SandboxTrustedExportIdentity {
  module: string;
  name: string;
}

export interface SandboxCardFieldMetadata {
  kind: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  type: SandboxTrustedExportIdentity;
}

export interface SandboxCardTypeMetadata {
  displayName?: string;
  fields: Record<string, SandboxCardFieldMetadata>;
  headerColor: string | null;
  hasCustomEditTemplate: boolean;
  hasCustomIsolatedTemplate: boolean;
  authoredTemplateFormats: string[];
  icon?: SandboxTrustedExportIdentity;
  prefersWideFormat: boolean;
}

export interface CompartmentAmbientReport {
  window: string;
  document: string;
  localStorage: string;
  fetch: string;
  XMLHttpRequest: string;
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

export interface RealmCompartmentRuntimeOptions {
  fetch: typeof fetch;
  resolveImport: (moduleIdentifier: string) => string;
  virtualNetwork?: VirtualNetwork;
  decoratorRuntime?: unknown;
  documentFacade?: object;
  mathFacade?: object;
  isTrustedImport?: (moduleIdentifier: string) => boolean | string;
}

const lockdownMarker = Symbol.for('boxel.realm-compartment.lockdown');
export const sandboxRealmURLArgument = '__boxelSandboxRealmURL';

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
      // Monaco and other webpack/Rollup-produced host libraries assign an
      // own `constructor` while establishing generated prototype chains.
      // Endo documents override taming as a compatibility (not security)
      // tradeoff; `severe` enables that shadowing after intrinsics are frozen.
      overrideTaming: 'severe',
    });
    globals[lockdownMarker] = true;
  }
}

export default class RealmCompartmentModuleRuntime {
  private templateByComponent = new WeakMap<object, CapturedTemplate>();
  private trustedExportByValue = new WeakMap<
    object,
    SandboxTrustedExportIdentity
  >();
  private trustedModuleFacades = new Map<string, Record<string, unknown>>();
  private trustedExports = new Map<string, object>();
  private fieldMetadataByPrototype = new WeakMap<
    object,
    Map<string, SandboxCardFieldMetadata>
  >();
  private handleByComponent = new WeakMap<object, string>();
  private componentByHandle = new Map<string, object>();
  private componentInstanceByHandle = new Map<
    string,
    Record<string, unknown>
  >();
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
    options: RealmCompartmentRuntimeOptions,
  ) {
    ensureLockdown();

    let decoratorRuntime =
      options.decoratorRuntime ??
      (globalThis as typeof globalThis & { dt7948?: unknown }).dt7948;
    if (!decoratorRuntime) {
      throw new Error('Decorator runtime is unavailable for card evaluation');
    }

    let globals: Record<string, unknown> = { dt7948: decoratorRuntime };
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
        XMLHttpRequest: typeof XMLHttpRequest
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
    if (
      (typeof component !== 'object' || component === null) &&
      typeof component !== 'function'
    ) {
      throw new Error(
        `Compartment card ${exportName} has no ${format} template`,
      );
    }
    if (!this.templateByComponent.has(component as object)) {
      throw new Error(
        `Compartment did not capture the ${format} template for ${exportName}`,
      );
    }
    return structuredClone(this.bundleFor(component as object));
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
      displayName,
      fields: this.cardFieldMetadata(cardType),
      headerColor,
      hasCustomEditTemplate: cardType.edit != null,
      hasCustomIsolatedTemplate: cardType.isolated != null,
      authoredTemplateFormats,
      icon,
      prefersWideFormat: cardType.prefersWideFormat === true,
    });
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

  destroy() {
    this.loader.dispose();
    this.componentByHandle.clear();
    this.componentInstanceByHandle.clear();
  }

  instantiateComponent(
    componentHandle: string,
    args: Record<string, unknown>,
  ): SandboxComponentInstanceDescriptor {
    let component = this.componentByHandle.get(componentHandle);
    if (!component || typeof component !== 'function') {
      throw new Error(`Unknown sandbox component handle ${componentHandle}`);
    }
    let instance = new (component as new (
      owner: undefined,
      args: Record<string, unknown>,
    ) => Record<string, unknown>)(undefined, this.componentArgs(args));
    let instanceHandle = `sandbox-instance-${this.nextComponentInstanceHandle++}`;
    this.componentInstanceByHandle.set(instanceHandle, instance);
    return this.describeComponentInstance(instanceHandle, instance);
  }

  async invokeComponentAction(
    instanceHandle: string,
    action: string,
    args: unknown[],
  ): Promise<SandboxComponentInstanceDescriptor> {
    let instance = this.componentInstanceByHandle.get(instanceHandle);
    if (!instance) {
      throw new Error(`Unknown sandbox component instance ${instanceHandle}`);
    }
    let handler = instance[action];
    if (typeof handler !== 'function') {
      throw new Error(`Unknown sandbox component action ${action}`);
    }
    let safeArgs = this.cloneIntoCompartment(this.jsonClone(args));
    await handler.apply(instance, safeArgs);
    return this.describeComponentInstance(instanceHandle, instance);
  }

  releaseComponentInstance(instanceHandle: string): void {
    this.componentInstanceByHandle.delete(instanceHandle);
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
        let trustedIdentity = this.trustedImportIdentity(dependency);
        if (!trustedIdentity || this.loader.isModuleLoaded(dependency)) {
          continue;
        }
        this.loader.shimModule(
          dependency,
          this.trustedModuleFacade(trustedIdentity),
        );
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
    this.loader.shimModule(
      'https://cardstack.com/base/card-api',
      this.cardAPIFacade('https://cardstack.com/base/card-api'),
    );
    this.loader.shimModule(
      '@cardstack/base/card-api',
      this.cardAPIFacade('@cardstack/base/card-api'),
    );
    this.loader.shimModule(
      '@glimmer/component',
      Object.freeze({ default: this.componentBase() }),
    );
    this.loader.shimModule('@ember/component', this.emberComponentFacade());
    this.loader.shimModule(
      '@ember/template-factory',
      this.templateFactoryFacade(),
    );
    this.loader.shimModule(
      '@ember/modifier',
      harden({ on: this.trustedExport('@ember/modifier', 'on') }),
    );
    this.loader.shimModule(
      '@ember/object',
      this.decoratorFacade('@ember/object', ['action']),
    );
    this.loader.shimModule(
      '@glimmer/tracking',
      this.decoratorFacade('@glimmer/tracking', ['cached', 'tracked']),
    );
    this.loader.shimModule(
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
    this.loader.shimModule(
      '@cardstack/runtime-common',
      this.runtimeCommonFacade(),
    );
  }

  private runtimeCommonFacade() {
    // These are pure data transforms plus inert realm/menu identity symbols.
    // Keep this list explicit: the full runtime-common namespace also contains
    // host/runtime facilities that realm-authored code must not receive.
    return Object.freeze({
      baseRRI,
      codeRef,
      getMenuItems,
      realmURL,
      searchEntryWireQueryFromQuery: sandboxSearchEntryWireQueryFromQuery,
    });
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
    class SandboxBaseDef {
      static baseDef: undefined;
    }
    class SandboxCardDef extends SandboxBaseDef {}
    class SandboxFieldDef extends SandboxBaseDef {}
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
          let trustedType = this.trustedExportByValue.get(
            (definition as { card?: object }).card ?? {},
          );
          if (trustedType) {
            let fields = this.fieldMetadataByPrototype.get(target);
            if (!fields) {
              fields = new Map();
              this.fieldMetadataByPrototype.set(target, fields);
            }
            fields.set(name, {
              kind,
              type: trustedType,
            });
          }
        }
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
    ) => Object.freeze({ type, card: relationshipType(cardOrThunk) });
    let contains = (card: unknown) => definition('contains', card);
    let containsMany = (card: unknown) => definition('containsMany', card);
    let linksTo = (cardOrThunk: unknown) => definition('linksTo', cardOrThunk);
    let linksToMany = (cardOrThunk: unknown) =>
      definition('linksToMany', cardOrThunk);
    let facade = {
      CardDef: SandboxCardDef,
      FieldDef: SandboxFieldDef,
      Component: SandboxComponent,
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
    };
    for (let [name, value] of Object.entries(facade)) {
      this.trustedExportByValue.set(value, { module: moduleIdentifier, name });
    }
    // Keep the facade namespace shallowly immutable without recursively
    // freezing its inert class tokens. Decorator-transforms and ordinary
    // subclassing expect writable prototype constructors; these tokens carry
    // no host authority and are private to this realm principal's runtime.
    return Object.freeze(facade);
  }

  private cardFieldMetadata(
    cardType: Record<string, unknown>,
  ): Record<string, SandboxCardFieldMetadata> {
    let fields: Record<string, SandboxCardFieldMetadata> = Object.create(null);
    let prototype: object | null | undefined = (
      cardType as { prototype?: object }
    ).prototype;
    while (prototype && prototype !== Object.prototype) {
      for (let [name, metadata] of this.fieldMetadataByPrototype.get(
        prototype,
      ) ?? []) {
        fields[name] ??= metadata;
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    return fields;
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
    if (templateContainsLiteralElement(block, 'style')) {
      throw new Error(
        'SES templates must use <style scoped>; unscoped <style> would affect the shared host document',
      );
    }
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

  private bundleFor(root: object): SandboxTemplateBundle {
    let ids = new WeakMap<object, string>();
    let nextId = 0;
    let templates: Record<string, SandboxTemplateDescriptor> =
      Object.create(null);
    let visit = (component: object): string => {
      let existing = ids.get(component);
      if (existing) {
        return existing;
      }
      let captured = this.templateByComponent.get(component);
      if (!captured) {
        throw new Error('Template scope references an uncaptured component');
      }
      let id = `component-${nextId++}`;
      ids.set(component, id);
      templates[id] = {
        ...captured.descriptor,
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
  ): Record<string, unknown> {
    let clonedArgs = this.jsonClone(args);
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
    let json = JSON.stringify(value);
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
      if (this.templateByComponent.has(component)) {
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
    moduleIdentifier === '@ember/object' ||
    moduleIdentifier === '@ember/helper' ||
    moduleIdentifier === '@ember/modifier' ||
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
