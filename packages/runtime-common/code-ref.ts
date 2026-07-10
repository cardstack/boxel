import type {
  BaseDefConstructor,
  Field,
  BaseDef,
  CardDef,
  FieldDef,
  FieldConstructor,
} from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';
import { Loader } from './loader.ts';
import {
  isField,
  isSpec,
  primitive,
  fields,
  fieldsUntracked,
  isBaseInstance,
  meta,
  relativeTo,
} from './constants.ts';
import { CardError } from './error.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { LooseCardResource, FileMetaResource } from './index.ts';
import {
  isUrlLike,
  trimExecutableExtension,
  resolveRRIReference,
} from './index.ts';
import type { RuntimeDependencyTrackingContext } from './dependency-tracker.ts';

export type ResolvedCodeRef = {
  module: RealmResourceIdentifier;
  name: string;
};

export type CodeRef =
  | ResolvedCodeRef
  | {
      type: 'ancestorOf';
      card: CodeRef; //TODO: consider changing this key to ref, this will break serializations
    }
  | {
      type: 'fieldOf';
      card: CodeRef; //TODO: consider changing this key to ref, this will break serializations
      field: string;
    };

// we don't track ExportedCardRef because Loader.identify already handles those
let localIdentities = new WeakMap<
  typeof BaseDef,
  | { type: 'ancestorOf'; card: typeof BaseDef }
  | { type: 'fieldOf'; card: typeof BaseDef; field: string }
>();

// Pure shape predicates live in `card-document-shape.ts` so callers that
// only need to recognize a CodeRef don't pull the transitive runtime
// chain rooted in this file. Re-exported here for backward compat; the
// local imports let the remainder of this file call them directly.
import { isResolvedCodeRef, isCodeRef } from './card-document-shape.ts';
export { isResolvedCodeRef, isCodeRef };

export function assertIsResolvedCodeRef(
  ref: unknown,
  message = 'Expected ResolvedCodeRef',
): asserts ref is ResolvedCodeRef {
  if (!isResolvedCodeRef(ref as CodeRef | {})) {
    throw new Error(message);
  }
}

export function isBaseDef(cardOrField: any): cardOrField is typeof BaseDef {
  return typeof cardOrField === 'function' && 'baseDef' in cardOrField;
}

export function isBaseDefInstance(value: unknown): value is BaseDef {
  return typeof value === 'object' && value !== null && isBaseInstance in value;
}

export function isCardDef(card: any): card is typeof CardDef;
export function isCardDef(codeRef: CodeRef, loader: Loader): Promise<boolean>;
export function isCardDef(
  cardOrCodeRef: any,
  loader?: Loader,
): boolean | Promise<boolean> {
  if (isCodeRef(cardOrCodeRef)) {
    if (!loader) {
      throw new Error(
        'Loader is required to check if a code ref is a card def',
      );
    }
    return loadCardDef(cardOrCodeRef, { loader })
      .then((card) => isCardDef(card))
      .catch(() => false);
  }
  return isBaseDef(cardOrCodeRef) && 'isCardDef' in cardOrCodeRef;
}

export function isCardInstance<T extends CardDef>(card: any): card is T {
  return isCardDef(card?.constructor);
}

export function isFieldDef(field: any): field is typeof FieldDef {
  return isBaseDef(field) && 'isFieldDef' in field;
}

export function isFileDef(def: any): def is typeof FileDef {
  return isBaseDef(def) && 'isFileDef' in def;
}

export function isListingDef(def: any): boolean {
  return isCardDef(def) && 'isListingDef' in def;
}

export function isListingInstance(card: any): boolean {
  return isListingDef(card?.constructor);
}

export function isFieldInstance<T extends FieldDef>(
  fieldInstance: any,
): fieldInstance is T {
  return isFieldDef(fieldInstance?.constructor);
}

export function isFileDefInstance<T extends FileDef>(
  fileInstance: any,
): fileInstance is T {
  return isFileDef(fileInstance?.constructor);
}

export function isPrimitive(def: any) {
  return isBaseDef(def) && primitive in def;
}

export function isSpecCard(def: any) {
  return isBaseDef(def) && isSpec in def;
}

// Loader-only bare specifiers (e.g. `@cardstack/boxel-host/commands/foo`)
// have no registered realm-prefix mapping — `VirtualNetwork.resolveURL`
// would URL-join them to `relativeTo` and produce a nonexistent realm
// path. Throw on that exact case so callers' surrounding try/catch
// leaves the original ref alone for the loader's importMap shim to
// resolve. (URL-like refs and registered prefixes resolve normally.)
export function resolveModuleHref(
  module: string,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  virtualNetwork: VirtualNetwork,
): string {
  if (!isUrlLike(module) && !virtualNetwork.isRegisteredPrefix(module)) {
    throw new Error(
      `Cannot resolve bare package specifier "${module}" — no matching prefix mapping registered`,
    );
  }
  return virtualNetwork.resolveURL(module, relativeTo).href;
}

export function codeRefWithAbsoluteIdentifier(
  ref: CodeRef,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  opts: { trimExecutableExtension?: true } | undefined,
  // Optional: when a VirtualNetwork is supplied the module is resolved through
  // it (legacy callers). When omitted, the module is resolved in RRI space via
  // `resolveRRIReference` — no VirtualNetwork — since code refs are canonical
  // RRI; relative modules join against `relativeTo`, absolute/prefix modules
  // pass through unchanged.
  virtualNetwork?: VirtualNetwork,
): CodeRef {
  if (!('type' in ref)) {
    try {
      let moduleHref = (
        virtualNetwork
          ? resolveModuleHref(ref.module, relativeTo, virtualNetwork)
          : resolveRRIReference(ref.module, relativeTo)
      ) as RealmResourceIdentifier;
      if (opts?.trimExecutableExtension) {
        moduleHref = trimExecutableExtension(moduleHref);
      }
      return { ...ref, module: moduleHref };
    } catch {
      return { ...ref };
    }
  }
  return {
    ...ref,
    card: codeRefWithAbsoluteIdentifier(
      ref.card,
      relativeTo,
      undefined,
      virtualNetwork,
    ),
  };
}

export async function getClass(ref: ResolvedCodeRef, loader: Loader) {
  let module = await loader.import<Record<string, any>>(ref.module);
  return module[ref.name];
}

export async function loadCardDef(
  ref: CodeRef,
  opts: {
    loader: Loader;
    relativeTo?: RealmResourceIdentifier | URL;
    dependencyTrackingContext?: RuntimeDependencyTrackingContext;
  },
): Promise<typeof BaseDef> {
  let maybeCard: unknown;
  let loader = opts.loader;
  let virtualNetwork = loader.getVirtualNetwork();
  if (!virtualNetwork) {
    throw new Error(
      `loadCardDef requires a Loader configured with a VirtualNetwork`,
    );
  }
  if (!('type' in ref)) {
    let resolvedModuleURL = resolveModuleHref(
      ref.module,
      opts?.relativeTo,
      virtualNetwork,
    );
    let module = await loader.import<Record<string, any>>(
      resolvedModuleURL,
      opts.dependencyTrackingContext,
    );
    maybeCard = module[ref.name];
  } else if (ref.type === 'ancestorOf') {
    let child = await loadCardDef(ref.card, opts);
    maybeCard = getAncestor(child);
  } else if (ref.type === 'fieldOf') {
    let parent = await loadCardDef(ref.card, opts);
    let field = getField(parent, ref.field);
    maybeCard = field?.card;
  } else {
    throw assertNever(ref);
  }

  if (isBaseDef(maybeCard)) {
    return maybeCard;
  }

  let resolvedFromRef = resolveModuleHref(
    moduleFrom(ref),
    opts?.relativeTo,
    virtualNetwork,
  );
  let err = new CardError(
    `Cannot find card ${humanReadable(ref)}. Make sure ${resolvedFromRef} exports ${exportFrom(ref)}`,
    {
      status: 404,
    },
  );
  err.deps = [moduleFrom(ref)];
  throw err;
}

export function identifyCard(
  card: typeof BaseDef | undefined,
  maybeRelativeReference?: ((possibleReference: string) => string) | null,
  visited = new WeakSet<typeof BaseDef>(),
): CodeRef | undefined {
  if (!card) {
    return undefined;
  }
  if (!isBaseDef(card)) {
    return undefined;
  }
  if (visited.has(card)) {
    console.warn(`encountered cycle in identifyCard() for ${card.name}`);
    return undefined;
  }
  visited.add(card);

  let ref = Loader.identify(card);
  if (ref) {
    return maybeRelativeReference
      ? {
          ...ref,
          module: maybeRelativeReference(ref.module) as RealmResourceIdentifier,
        }
      : (ref as ResolvedCodeRef);
  }

  let local = localIdentities.get(card);
  if (!local) {
    return undefined;
  }
  let innerRef = identifyCard(local.card, maybeRelativeReference, visited);
  if (!innerRef) {
    return undefined;
  }
  if (local.type === 'ancestorOf') {
    return {
      type: 'ancestorOf',
      card: innerRef,
    };
  } else {
    return {
      type: 'fieldOf',
      field: local.field,
      card: innerRef,
    };
  }
}

export function getField<T extends BaseDef>(
  instanceOrClass: T | typeof BaseDef,
  fieldName: string,
  opts?: { untracked?: true },
): Field<BaseDefConstructor> | undefined {
  let instance: BaseDef | undefined;
  let card: typeof BaseDef;
  if (
    typeof instanceOrClass === 'object' &&
    isBaseInstance in instanceOrClass
  ) {
    instance = instanceOrClass;
    card = Reflect.getPrototypeOf(instance)!.constructor as typeof BaseDef;
  } else {
    card = instanceOrClass;
  }
  let obj: object | null = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let result: Field<BaseDefConstructor> | undefined = (desc?.get as any)?.[
      isField
    ];
    if (result !== undefined && isBaseDef(result.card)) {
      let fieldOverride: typeof BaseDef | undefined;
      if (opts?.untracked) {
        fieldOverride =
          instance && isCardInstance(instance)
            ? instance[fieldsUntracked]?.[fieldName]
            : undefined;
      } else {
        fieldOverride =
          instance && isCardInstance(instance)
            ? instance[fields]?.[fieldName]
            : undefined;
      }
      if (fieldOverride) {
        let cardThunk = fieldOverride;
        let { computeVia, name, queryDefinition } = result;
        let originalField = result;
        let declaredCardThunk =
          (originalField as any).declaredCardResolver ??
          (() => originalField.card as BaseDefConstructor);
        result = new (originalField.constructor as unknown as Field & {
          new (args: FieldConstructor<unknown>): Field;
        })({
          cardThunk: () => cardThunk,
          declaredCardThunk,
          computeVia,
          name,
          isPolymorphic: true,
          queryDefinition,
        }) as Field;
      }
      localIdentities.set(result.card, {
        type: 'fieldOf',
        field: fieldName,
        card,
      });
      return result;
    }
    obj = Reflect.getPrototypeOf(obj);
  }
  return undefined;
}

export function normalizeCodeRef(ref: CodeRef): {
  module: string;
  name: string;
} {
  if (!('type' in ref)) {
    return { module: ref.module, name: ref.name };
  }
  return normalizeCodeRef(ref.card);
}

export function getAncestor(
  card: BaseDefConstructor,
): BaseDefConstructor | undefined {
  let superCard = Reflect.getPrototypeOf(card);
  if (isBaseDef(superCard)) {
    localIdentities.set(superCard, {
      type: 'ancestorOf',
      card,
    });
    return superCard;
  }
  return undefined;
}

export function moduleFrom(ref: CodeRef): string {
  if (!('type' in ref)) {
    return ref.module;
  } else {
    return moduleFrom(ref.card);
  }
}

// Reduce a module reference to a single canonical key, collapsing every
// equivalent spelling the VirtualNetwork knows about — a prefix-form RRI
// (`@cardstack/base/foo`), the real URL it maps to, and any virtual-URL alias
// registered via `addURLMapping` (e.g. `https://cardstack.com/base/foo`) — so
// two refs that point at the same module compare equal regardless of how they
// were written. The client-side counterpart to the server's `internalKeyFor`,
// extended to also fold `addURLMapping` aliases (which `resolveURL` alone
// leaves untouched). Used wherever a code ref carried in a query is compared
// against a ref derived from a loaded module.
export function canonicalModuleKey(
  module: string,
  virtualNetwork: VirtualNetwork,
): string {
  let href: string;
  try {
    // Resolves a prefix-form RRI to its mapped URL; an absolute URL is parsed
    // and returned unchanged. Memoized, so this stays cheap on hot paths.
    href = virtualNetwork.toURLHref(module);
  } catch {
    // Unresolvable reference (e.g. a scoped prefix with no mapping): fall back
    // to the raw form. Exact-string equality already covers the only way two
    // such refs can be equal.
    return module;
  }
  // `toURLHref` leaves an absolute URL untouched, so a virtual spelling and its
  // real target (registered via `addURLMapping`) stay distinct without this.
  // Collapse virtual onto real; real and unmapped URLs pass through.
  try {
    let real = virtualNetwork.mapURL(href, 'virtual-to-real');
    if (real) {
      href = real.href;
    }
  } catch {
    // `href` wasn't a parseable absolute URL — leave it as resolved.
  }
  // Collapse the real URL onto its portable prefix form when a registered realm
  // prefix matches, so `@scope/…` and the real URL also land on one key.
  return virtualNetwork.unresolveURL(href);
}

function exportFrom(ref: CodeRef): string {
  if (!('type' in ref)) {
    return ref.name;
  } else {
    return exportFrom(ref.card);
  }
}

export function humanReadable(ref: CodeRef): string {
  if (!('type' in ref)) {
    return `${ref.name} from ${ref.module}`;
  } else if (ref.type === 'ancestorOf') {
    return `Ancestor of ${humanReadable(ref.card)}`;
  } else {
    return `Field ${ref.field} of ${humanReadable(ref.card)}`;
  }
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

// utility to return `typeConstraint` when it exists and is part of the ancestor chain of `type`
export async function getNarrowestType(
  typeConstraint: CodeRef,
  type: CodeRef,
  loader: Loader,
) {
  let narrowTypeExists = false;
  // Since the only place this function is used is inside of the spec preview,
  // We use isCardDef (a shortcut) because it's a faster check to determine if `typeConstraint` is in the same inheritance chain as `type`
  // As `type` is always a card, checking that the typeConstraint isCardDef is a sufficient condition
  // TODO: This will have to be made more generic in consideration of other scenarios. This commit shows a solution that was more generic https://github.com/cardstack/boxel/pull/2105/commits/02e8408b776f4dea179978271b6f1febc0246f9b
  narrowTypeExists = (await isCardDef(typeConstraint, loader)) ?? false;
  let narrowestType =
    narrowTypeExists && typeConstraint ? typeConstraint : type;
  return narrowestType;
}

export function resolveAdoptedCodeRef(
  instance: CardDef,
  virtualNetwork: VirtualNetwork,
) {
  let adoptsFrom = instance[meta]?.adoptsFrom as CodeRef;
  if (!adoptsFrom) {
    throw new Error('Instance missing adoptsFrom');
  }
  let base = instance[relativeTo] || virtualNetwork.toURL(instance.id);
  let resolved = codeRefWithAbsoluteIdentifier(
    adoptsFrom,
    base,
    undefined,
    virtualNetwork,
  );
  if (!isResolvedCodeRef(resolved)) {
    throw new Error('code ref is not resolved');
  }
  return resolved;
}

export function resolveAdoptsFrom(
  card: CardDef,
  // Optional: omit to resolve in RRI space (no VirtualNetwork). The card's id
  // is the canonical base; relative `adoptsFrom` modules join against it.
  virtualNetwork?: VirtualNetwork,
): ResolvedCodeRef | undefined {
  let metadata = (card as any)[meta];
  let adoptsFrom = metadata?.adoptsFrom as CodeRef | undefined;
  let baseURL = (() => {
    let id = (card as any).id;
    if (typeof id !== 'string') {
      return undefined;
    }
    if (!virtualNetwork) {
      return id as RealmResourceIdentifier;
    }
    try {
      return virtualNetwork.toURL(id);
    } catch {
      return undefined;
    }
  })();
  let resolveRelativeRef = (ref: CodeRef): ResolvedCodeRef | undefined => {
    if (!baseURL) {
      return undefined;
    }
    let resolved = codeRefWithAbsoluteIdentifier(
      ref,
      baseURL,
      undefined,
      virtualNetwork,
    );
    return isResolvedCodeRef(resolved) ? resolved : undefined;
  };
  if (isResolvedCodeRef(adoptsFrom)) {
    if (!isRelativePath(adoptsFrom.module)) {
      return adoptsFrom;
    }
    return resolveRelativeRef(adoptsFrom);
  }
  if (!isCodeRef(adoptsFrom)) {
    return undefined;
  }
  if (!hasRelativeModule(adoptsFrom)) {
    return undefined;
  }
  return resolveRelativeRef(adoptsFrom);
}

function hasRelativeModule(ref: CodeRef): boolean {
  if (!('type' in ref)) {
    return isRelativePath(ref.module);
  }
  return hasRelativeModule(ref.card);
}

function isRelativePath(moduleId: unknown): moduleId is string {
  if (typeof moduleId !== 'string') {
    return false;
  }
  if (typeof URL.canParse === 'function') {
    return !URL.canParse(moduleId);
  }
  return (
    !moduleId.includes('://') &&
    !moduleId.startsWith('/') &&
    !moduleId.startsWith('data:')
  );
}

type VisitModuleDep = (
  moduleURL: RealmResourceIdentifier,
  setModuleURL: (newURL: RealmResourceIdentifier) => void,
) => void;

function visitCodeRef(codeRef: CodeRef, visit: VisitModuleDep): void {
  if (!('type' in codeRef)) {
    visit(codeRef.module, (newURL) => {
      codeRef.module = newURL;
    });
  } else {
    visitCodeRef(codeRef.card, visit);
  }
}

export function visitModuleDeps(
  resourceJson: LooseCardResource | FileMetaResource,
  visit: VisitModuleDep,
): void {
  let resourceMeta = resourceJson.meta;
  if (resourceMeta?.adoptsFrom && isCodeRef(resourceMeta.adoptsFrom)) {
    visitCodeRef(resourceMeta.adoptsFrom, visit);
  }
  if (resourceMeta?.fields) {
    for (let fieldMeta of Object.values(resourceMeta.fields)) {
      if (Array.isArray(fieldMeta)) {
        for (let meta of fieldMeta) {
          if (meta.adoptsFrom && isCodeRef(meta.adoptsFrom)) {
            visitCodeRef(meta.adoptsFrom, visit);
          }
        }
      } else {
        if (fieldMeta.adoptsFrom && isCodeRef(fieldMeta.adoptsFrom)) {
          visitCodeRef(fieldMeta.adoptsFrom, visit);
        }
      }
    }
  }
}
