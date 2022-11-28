import { RealmPaths } from "./paths";
import type { CardRef } from "./card-ref";

export const baseRealm = new RealmPaths("https://cardstack.com/base/");

export const catalogEntryRef: CardRef = {
  module: `${baseRealm.url}catalog-entry`,
  name: "CatalogEntry",
};
export const baseCardRef: CardRef = {
  module: `${baseRealm.url}card-api`,
  name: "Card",
};

export const isField = Symbol("cardstack-field");
export const primitive = Symbol("cardstack-primitive");
