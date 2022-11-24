import {
  type Card,
  type CardConstructor,
  type Field,
} from "https://cardstack.com/base/card-api";
import { Loader } from "./loader";
import { isField, primitive } from "./constants";

export type CardRef =
  | {
      module: string;
      name: string;
    }
  | {
      type: "ancestorOf";
      card: CardRef;
      name: string;
    }
  | {
      type: "fieldOf";
      card: CardRef;
      field: string;
      name: string;
    };

let identities = new WeakMap<typeof Card, CardRef>();

export function isCardRef(ref: any): ref is CardRef {
  if (typeof ref !== "object") {
    return false;
  }
  if (!("type" in ref)) {
    if (!("module" in ref) || !("name" in ref)) {
      return false;
    }
    return typeof ref.module === "string" && typeof ref.name === "string";
  } else if (ref.type === "ancestorOf") {
    if (!("card" in ref)) {
      return false;
    }
    return isCardRef(ref.card);
  } else if (ref.type === "fieldOf") {
    if (!("card" in ref) || !("field" in ref)) {
      return false;
    }
    if (typeof ref.card !== "object" || typeof ref.field !== "string") {
      return false;
    }
    return isCardRef(ref.card);
  }
  return false;
}

export function isCard(card: any): card is typeof Card {
  return typeof card === "function" && "baseCard" in card;
}

export async function loadCard(
  ref: CardRef,
  opts?: { loader?: Loader; relativeTo?: URL }
): Promise<typeof Card | undefined> {
  let maybeCard: unknown;
  let loader = opts?.loader ?? Loader.getLoader();
  if (!("type" in ref)) {
    let module = await loader.import<Record<string, any>>(
      new URL(ref.module, opts?.relativeTo).href
    );
    maybeCard = module[ref.name];
  } else if (ref.type === "ancestorOf") {
    let child = (await loadCard(ref.card, opts)) ?? {};
    if (!child) {
      return undefined;
    }
    maybeCard = Reflect.getPrototypeOf(child);
    if (!identifyCard(maybeCard) && isCard(maybeCard)) {
      identities.set(maybeCard, ref);
    }
  } else if (ref.type === "fieldOf") {
    let parent = (await loadCard(ref.card, opts)) ?? {};
    if (!parent || !isCard(parent)) {
      return undefined;
    }
    let field = getField(parent, ref.field);
    maybeCard = field?.card;
  } else {
    throw assertNever(ref);
  }

  return isCard(maybeCard) ? maybeCard : undefined;
}

export function identifyCard(card: unknown): CardRef | undefined {
  if (!isCard(card)) {
    return undefined;
  }
  let cached = identities.get(card);
  if (cached) {
    return cached;
  }
  let ref = Loader.identify(card);
  if (ref) {
    identities.set(card, ref);
  }
  return ref;
}

export function getField<CardT extends CardConstructor>(
  card: CardT,
  fieldName: string
): Field<CardConstructor> | undefined {
  let obj: object | null = card.prototype;
  while (obj) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, fieldName);
    let result: Field<CardConstructor> | undefined = (desc?.get as any)?.[
      isField
    ];
    if (result !== undefined) {
      let ref = !(primitive in card) ? identifyCard(card) : undefined;
      if (!(primitive in result.card)) {
        if (ref && !identifyCard(result.card) && isCard(result.card)) {
          identities.set(result.card, {
            type: "fieldOf",
            field: fieldName,
            card: ref,
            name: result.card.name,
          });
        }
      }
      return result;
    }
    obj = Reflect.getPrototypeOf(obj);
  }
  return undefined;
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
