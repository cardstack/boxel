import type { Card } from "https://cardstack.com/base/card-api";
import type * as CardAPI from "https://cardstack.com/base/card-api";
import { Loader } from "./loader";
import { baseRealm } from "./constants";

export type ExportedCardRef = {
  module: string;
  name: string;
};

export type CardRef =
  | {
      type: "exportedCard";
      module: string;
      name: string;
    }
  | {
      type: "ancestorOf";
      card: CardRef;
    }
  | {
      type: "fieldOf";
      card: CardRef;
      field: string;
    };

export function isCardRef(ref: any): ref is CardRef {
  if (typeof ref !== "object") {
    return false;
  }
  if (!("type" in ref)) {
    return false;
  }
  if (ref.type === "exportedCard") {
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

export async function loadCard(
  ref: CardRef,
  opts?: { loader?: Loader }
): Promise<{ card: typeof Card; ref: CardRef } | undefined> {
  let maybeCard: unknown;
  let canonicalRef: CardRef | undefined;
  let loader = opts?.loader ?? Loader.getLoader();
  if (ref.type === "exportedCard") {
    let module = await loader.import<Record<string, any>>(ref.module);
    maybeCard = module[ref.name];
    canonicalRef = { ...ref, ...loader.identify(maybeCard) };
  } else if (ref.type === "ancestorOf") {
    let { card: child, ref: childRef } = (await loadCard(ref.card, opts)) ?? {};
    if (!child || !childRef) {
      return undefined;
    }
    maybeCard = Reflect.getPrototypeOf(child) as typeof Card;
    let cardId = loader.identify(maybeCard);
    canonicalRef = cardId
      ? { type: "exportedCard", ...cardId }
      : { ...ref, card: childRef };
  } else if (ref.type === "fieldOf") {
    let { card: parent, ref: parentRef } =
      (await loadCard(ref.card, opts)) ?? {};
    if (!parent || !parentRef) {
      return undefined;
    }
    let api = await loader.import<typeof CardAPI>(`${baseRealm.url}card-api`);
    let field = api.getField(parent, ref.field);
    maybeCard = field?.card;
    let cardId = loader.identify(maybeCard);
    canonicalRef = cardId
      ? { type: "exportedCard", ...cardId }
      : { ...ref, card: parentRef };
  } else {
    throw assertNever(ref);
  }

  if (
    typeof maybeCard === "function" &&
    "baseCard" in maybeCard &&
    canonicalRef
  ) {
    return {
      card: maybeCard as unknown as typeof Card,
      ref: canonicalRef,
    };
  } else {
    return undefined;
  }
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
