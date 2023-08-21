import {
  type CardBaseConstructor,
  type Field,
  type CardBase,
} from 'https://cardstack.com/base/card-api';
import { Loader } from './loader';
import { isField } from './constants';
import { CardError } from './error';

export type CardRef =
  | {
      module: string;
      name: string;
    }
  | {
      type: 'ancestorOf';
      card: CardRef;
    }
  | {
      type: 'fieldOf';
      card: CardRef;
      field: string;
    };

// we don't track ExportedCardRef because Loader.identify already handles those
let localIdentities = new WeakMap<
  typeof CardBase,
  | { type: 'ancestorOf'; card: typeof CardBase }
  | { type: 'fieldOf'; card: typeof CardBase; field: string }
>();

export function isCardRef(ref: any): ref is CardRef {
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
    return isCardRef(ref.card);
  } else if (ref.type === 'fieldOf') {
    if (!('card' in ref) || !('field' in ref)) {
      return false;
    }
    if (typeof ref.card !== 'object' || typeof ref.field !== 'string') {
      return false;
    }
    return isCardRef(ref.card);
  }
  return false;
}

export function isCard(card: any): card is typeof CardBase {
  return typeof card === 'function' && 'baseCard' in card;
}

export async function loadCard(
  ref: CardRef,
  opts: { loader: Loader; relativeTo?: URL },
): Promise<typeof CardBase> {
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

  if (isCard(maybeCard)) {
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
): CardRef | undefined {
  if (!isCard(card)) {
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

export function getField<CardT extends CardBaseConstructor>(
  card: CardT,
  fieldName: string,
): Field<CardBaseConstructor> | undefined {
  let obj: object | null = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let result: Field<CardBaseConstructor> | undefined = (desc?.get as any)?.[
      isField
    ];
    if (result !== undefined && isCard(result.card)) {
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
  card: CardBaseConstructor,
): CardBaseConstructor | undefined {
  let superCard = Reflect.getPrototypeOf(card);
  if (isCard(superCard)) {
    localIdentities.set(superCard, {
      type: 'ancestorOf',
      card,
    });
    return superCard;
  }
  return undefined;
}

export function moduleFrom(ref: CardRef): string {
  if (!('type' in ref)) {
    return ref.module;
  } else {
    return moduleFrom(ref.card);
  }
}

export function humanReadable(ref: CardRef): string {
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
