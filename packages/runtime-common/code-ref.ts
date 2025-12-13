import type {
  BaseDefConstructor,
  Field,
  BaseDef,
  CardDef,
  FieldDef,
  FieldConstructor,
} from 'https://cardstack.com/base/card-api';
import { Loader } from './loader';
import {
  isField,
  primitive,
  fields,
  fieldsUntracked,
  isBaseInstance,
} from './constants';
import { CardError } from './error';
import { meta, relativeTo } from './constants';
import type { LooseCardResource } from './index';
import { isUrlLike, trimExecutableExtension } from './index';

export type ResolvedCodeRef = {
  module: string;
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

export function isResolvedCodeRef(ref?: CodeRef | {}): ref is ResolvedCodeRef {
  if (ref && 'module' in ref && 'name' in ref) {
    return true;
  } else {
    return false;
  }
}

export function isCodeRef(ref: any): ref is CodeRef {
  if (!ref || typeof ref !== 'object') {
    return false;
  }
  if (!('type' in ref)) {
    if (!('module' in ref) || !('name' in ref)) {
      return false;
    }
    return typeof ref.module === 'string' && typeof ref.name === 'string';
  } else if (ref.type === 'ancestorOf') {
    if (!('card' in ref)) {
      return false;
    }
    return isCodeRef(ref.card);
  } else if (ref.type === 'fieldOf') {
    if (!('card' in ref) || !('field' in ref)) {
      return false;
    }
    if (typeof ref.card !== 'object' || typeof ref.field !== 'string') {
      return false;
    }
    return isCodeRef(ref.card);
  }
  return false;
}

export function isBaseDef(cardOrField: any): cardOrField is typeof BaseDef {
  return typeof cardOrField === 'function' && 'baseDef' in cardOrField;
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

export function isFieldInstance<T extends FieldDef>(
  fieldInstance: any,
): fieldInstance is T {
  return isFieldDef(fieldInstance?.constructor);
}

export function isPrimitive(def: any) {
  return isBaseDef(def) && primitive in def;
}

export function codeRefWithAbsoluteURL(
  ref: CodeRef,
  relativeTo?: URL | undefined,
  opts?: { trimExecutableExtension?: true },
): CodeRef {
  if (!('type' in ref)) {
    if (isUrlLike(ref.module)) {
      let moduleURL = new URL(ref.module, relativeTo);
      if (opts?.trimExecutableExtension) {
        moduleURL = trimExecutableExtension(moduleURL);
      }
      return { ...ref, module: moduleURL.href };
    } else {
      return { ...ref };
    }
  }
  return { ...ref, card: codeRefWithAbsoluteURL(ref.card, relativeTo) };
}

export async function getClass(ref: ResolvedCodeRef, loader: Loader) {
  let module = await loader.import<Record<string, any>>(ref.module);
  return module[ref.name];
}

export async function loadCardDef(
  ref: CodeRef,
  opts: { loader: Loader; relativeTo?: URL },
): Promise<typeof BaseDef> {
  let maybeCard: unknown;
  let loader = opts.loader;
  if (!('type' in ref)) {
    let resolvedModuleURL = new URL(ref.module, opts?.relativeTo).href;
    let module = await loader.import<Record<string, any>>(resolvedModuleURL);
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

  let err = new CardError(`Unable to loadCard ${humanReadable(ref)}`, {
    status: 404,
  });
  err.deps = [moduleFrom(ref)];
  throw err;
}

export function identifyCard(
  card: typeof BaseDef | undefined,
  maybeRelativeURL?: ((possibleURL: string) => string) | null,
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
    return maybeRelativeURL
      ? { ...ref, module: maybeRelativeURL(ref.module) }
      : ref;
  }

  let local = localIdentities.get(card);
  if (!local) {
    return undefined;
  }
  let innerRef = identifyCard(local.card, maybeRelativeURL, visited);
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
  let resolved = codeRefWithAbsoluteURL(
    adoptsFrom,
    instance[relativeTo] || new URL(instance.id),
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
    if (typeof URL.canParse === 'function' && !URL.canParse(id)) {
      return undefined;
    }
    try {
      return new URL(id);
    } catch {
      return undefined;
    }
  })();
  let resolveRelativeRef = (ref: CodeRef): ResolvedCodeRef | undefined => {
    if (!baseURL) {
      return undefined;
    }
    let resolved = codeRefWithAbsoluteURL(ref, baseURL);
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
  moduleURL: string,
  setModuleURL: (newURL: string) => void,
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
  resourceJson: LooseCardResource,
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
