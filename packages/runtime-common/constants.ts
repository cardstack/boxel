import { RealmPaths } from "./paths";
import type { ExportedCardRef } from "./card-ref";

export const baseRealm = new RealmPaths("https://cardstack.com/base/");

export const catalogEntryRef: ExportedCardRef = {
  module: `${baseRealm.url}catalog-entry`,
  name: "CatalogEntry",
};
export const baseCardRef: ExportedCardRef = {
  module: `${baseRealm.url}card-api`,
  name: "Card",
};
