import {
  type BaseDefConstructor,
  type Field,
  type BaseDef,
  type CardDef,
  type FieldDef,
} from 'https://cardstack.com/base/card-api';
import { Loader } from './loader';
import { isField } from './constants';
import { CardError } from './error';
import { trimExecutableExtension } from './index';

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

export function isResolvedCodeRef(ref?: CodeRef): ref is ResolvedCodeRef {
  if (ref && 'module' in ref && 'name' in ref) {
    return true;
  } else {
    return false;
  }
}

export function isCodeRef(ref: any): ref is CodeRef {
  if (typeof ref !== 'object') {
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

export function isCardDef(card: any): card is typeof CardDef {
  return isBaseDef(card) && 'isCardDef' in card;
}

export function isCardInstance(card: any): card is CardDef {
  return isCardDef(card?.constructor);
}

export function isFieldDef(field: any): field is typeof FieldDef {
  return isBaseDef(field) && 'isFieldDef' in field;
}

export function codeRefWithAbsoluteURL(
  ref: CodeRef,
  relativeTo?: URL | undefined,
  opts?: { trimExecutableExtension?: true },
): CodeRef {
  if (!('type' in ref)) {
    let moduleURL = new URL(ref.module, relativeTo);
    if (opts?.trimExecutableExtension) {
      moduleURL = trimExecutableExtension(moduleURL);
    }
    return { ...ref, module: moduleURL.href };
  }
  return { ...ref, card: codeRefWithAbsoluteURL(ref.card, relativeTo) };
}

export async function loadCard(
  ref: CodeRef,
  opts: { loader: Loader; relativeTo?: URL },
): Promise<typeof BaseDef> {
  let maybeCard: unknown;
  let loader = opts.loader;
  if (!('type' in ref)) {
    let module = await loader.import<Record<string, any>>(
      new URL(ref.module, opts?.relativeTo).href,
    );
    maybeCard = module[ref.name];
  } else if (ref.type === 'ancestorOf') {
    let child = await loadCard(ref.card, opts);
    maybeCard = getAncestor(child);
  } else if (ref.type === 'fieldOf') {
    let parent = await loadCard(ref.card, opts);
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
  card: unknown,
  maybeRelativeURL?: ((possibleURL: string) => string) | null,
): CodeRef | undefined {
  if (!isBaseDef(card)) {
    return undefined;
  }

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
  let innerRef = identifyCard(local.card);
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

export function getField<CardT extends BaseDefConstructor>(
  card: CardT,
  fieldName: string,
): Field<BaseDefConstructor> | undefined {
  let obj: object | null = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let result: Field<BaseDefConstructor> | undefined = (desc?.get as any)?.[
      isField
    ];
    if (result !== undefined && isBaseDef(result.card)) {
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

function refEquals(ref1: CodeRef, ref2: CodeRef): boolean {
  // For now, let's only handle for resolved code refs
  if (!isResolvedCodeRef(ref1) || !isResolvedCodeRef(ref2)) {
    return false;
  }
  return ref1.name === ref2.name && ref1.module === ref2.module;
}

async function getAncestorRef(codeRef: CodeRef, loader: Loader) {
  let card = await loadCard(codeRef, { loader: loader });
  let ancestor = getAncestor(card);
  return identifyCard(ancestor);
}

//This function identifies the code ref identity of the card and verifies
//that it is a child of the ancestor
async function isInsideAncestorChain(
  codeRef: CodeRef,
  codeRefAncestor: CodeRef,
  loader: Loader,
): Promise<boolean | undefined> {
  if (refEquals(codeRef, codeRefAncestor)) {
    return true;
  } else {
    let newAncestorRef = await getAncestorRef(codeRef, loader);
    if (newAncestorRef) {
      return isInsideAncestorChain(newAncestorRef, codeRefAncestor, loader);
    } else {
      return undefined;
    }
  }
}

// utility to return subclassType when it exists and is part of the ancestor chain of type
export async function getNarrowestType(
  subclassType: CodeRef | undefined,
  type: CodeRef,
  loader: Loader,
) {
  let narrowTypeExists = false;
  if (subclassType) {
    narrowTypeExists =
      (await isInsideAncestorChain(subclassType, type, loader)) ?? false;
  }
  let narrowestType = narrowTypeExists && subclassType ? subclassType : type;
  return narrowestType;
}
