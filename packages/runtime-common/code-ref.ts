import type {
  BaseDefConstructor,
  Field,
  BaseDef,
  CardDef,
  FieldDef,
  FieldConstructor,
} from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import { Loader } from './loader';
import {
  isField,
  isSpec,
  primitive,
  fields,
  fieldsUntracked,
  isBaseInstance,
  meta,
  relativeTo,
} from './constants';
import { CardError } from './error';
import { cardIdToURL } from './card-reference-resolver';
import type { RealmResourceIdentifier } from './card-reference-resolver';
import type { LooseCardResource, FileMetaResource } from './index';
import { trimExecutableExtension } from './index';
import { resolveCardReference } from './card-reference-resolver';
import type { RuntimeDependencyTrackingContext } from './dependency-tracker';

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
import { isResolvedCodeRef, isCodeRef } from './card-document-shape';
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

export function codeRefWithAbsoluteIdentifier(
  ref: CodeRef,
  relativeTo?: RealmResourceIdentifier | URL | undefined,
  opts?: { trimExecutableExtension?: true },
): CodeRef {
  if (!('type' in ref)) {
    try {
      let moduleHref = resolveCardReference(
        ref.module,
        relativeTo,
      ) as RealmResourceIdentifier;
      if (opts?.trimExecutableExtension) {
        moduleHref = trimExecutableExtension(moduleHref);
      }
      return { ...ref, module: moduleHref };
    } catch {
      return { ...ref };
    }
  }
  return { ...ref, card: codeRefWithAbsoluteIdentifier(ref.card, relativeTo) };
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
  if (!('type' in ref)) {
    let resolvedModuleURL = resolveCardReference(ref.module, opts?.relativeTo);
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

  let err = new CardError(
    `Cannot find card ${humanReadable(ref)}. Make sure ${resolveCardReference(moduleFrom(ref), opts?.relativeTo)} exports ${exportFrom(ref)}`,
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
        let { computeVia, name, isUsed, queryDefinition } = result;
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
          isUsed,
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

export function resolveAdoptedCodeRef(instance: CardDef) {
  let adoptsFrom = instance[meta]?.adoptsFrom as CodeRef;
  if (!adoptsFrom) {
    throw new Error('Instance missing adoptsFrom');
  }
  let resolved = codeRefWithAbsoluteIdentifier(
    adoptsFrom,
    instance[relativeTo] || cardIdToURL(instance.id),
  );
  if (!isResolvedCodeRef(resolved)) {
    throw new Error('code ref is not resolved');
  }
  return resolved;
}

export function resolveAdoptsFrom(card: CardDef): ResolvedCodeRef | undefined {
  let metadata = (card as any)[meta];
  let adoptsFrom = metadata?.adoptsFrom as CodeRef | undefined;
  let baseURL = (() => {
    let id = (card as any).id;
    if (typeof id !== 'string') {
      return undefined;
    }
    try {
      return cardIdToURL(id);
    } catch {
      return undefined;
    }
  })();
  let resolveRelativeRef = (ref: CodeRef): ResolvedCodeRef | undefined => {
    if (!baseURL) {
      return undefined;
    }
    let resolved = codeRefWithAbsoluteIdentifier(ref, baseURL);
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
