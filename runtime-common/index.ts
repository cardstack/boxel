import { CardResource } from "./search-index";

// a card resource but with optional "id" and "type" props
export type LooseCardResource = Omit<CardResource, "id" | "type"> & {
  type?: "card";
  id?: string;
};

export interface LooseCardDocument {
  data: LooseCardResource;
}

export { Deferred } from "./deferred";

export interface ResourceObject {
  type: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface ResourceObjectWithId extends ResourceObject {
  id: string;
}

export interface DirectoryEntryRelationship {
  links: {
    related: string;
  };
  meta: {
    kind: "directory" | "file";
  };
}
import { RealmPaths } from "./paths";
import { Query } from "./query";
export const baseRealm = new RealmPaths("https://cardstack.com/base/");
export { RealmPaths };

export const executableExtensions = [".js", ".gjs", ".ts", ".gts"];

import type { ExportedCardRef } from "./search-index";
export const catalogEntryRef: ExportedCardRef = {
  module: `${baseRealm.url}catalog-entry`,
  name: "CatalogEntry",
};
export const baseCardRef: ExportedCardRef = {
  module: `${baseRealm.url}card-api`,
  name: "Card",
};

type Format = "isolated" | "embedded" | "edit";
export interface NewCardArgs {
  type: "new";
  realmURL: string;
  cardSource: ExportedCardRef;
  initialAttributes?: LooseCardResource["attributes"];
}
export interface ExistingCardArgs {
  type: "existing";
  url: string;
  // this is just used for test fixture data. as soon as we
  // have an actual ember service for the API we should just
  //  mock that instead
  json?: LooseCardDocument;
  format?: Format;
}

// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call(globalThis.process) === "[object process]";

/* Any new externally consumed modules should be added here,
 * along with the exports from the modules that are consumed.
 * These exports are paired with the host/app/app.ts which is
 * responsible for loading the external modules and making them
 * available in the window.RUNTIME_SPIKE_EXTERNALS Map. Any changes
 * to the externals below should also be reflected in the
 * host/app/app.ts file.
 */

export const externalsMap: Map<string, string[]> = new Map([
  [
    "@cardstack/runtime-common",
    ["Loader", "Deferred", "isCardResource", "chooseCard", "baseCardRef"],
  ],
  ["@glimmer/component", ["default"]],
  ["@ember/component", ["setComponentTemplate", "default"]],
  ["@ember/component/template-only", ["default"]],
  ["@ember/template-factory", ["createTemplateFactory"]],
  ["@glimmer/tracking", ["tracked"]],
  ["@ember/object", ["action", "get"]],
  ["@ember/helper", ["get", "fn"]],
  ["@ember/modifier", ["on"]],
  ["@ember/destroyable", ["registerDestructor"]],
  ["ember-resources", ["Resource", "useResource"]],
  ["ember-concurrency", ["task", "restartableTask"]],
  ["ember-concurrency-ts", ["taskFor"]],
  ["ember-modifier", ["default"]],
  ["flat", ["flatten", "unflatten"]],
  ["lodash", ["flatMap", "startCase", "get", "set"]],
  ["tracked-built-ins", ["TrackedWeakMap"]],
  ["date-fns", ["parseISO", "format", "parse"]],
]);

export { Realm } from "./realm";
export { Loader } from "./loader";
export type { Kind, RealmAdapter, FileRef } from "./realm";

export type {
  CardRef,
  ExportedCardRef,
  CardResource,
  CardDocument,
  CardDefinition,
} from "./search-index";
export {
  isCardResource,
  isCardDocument,
  isCardCollectionDocument,
  isCardSingleResourceDocument,
} from "./search-index";

// @ts-ignore tsc doesn't understand .gts files
import type CardAPI from "https://cardstack.com/base/card-api";
// @ts-ignore tsc doesn't understand .gts files
import type { Card } from "https://cardstack.com/base/card-api";
export { CardAPI, Card };

export interface CardChooser {
  chooseCard<T extends Card>(query: Query): Promise<undefined | T>;
}

export async function chooseCard<T extends Card>(
  query: Query
): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CARD_CHOOSER) {
    throw new Error(
      `no cardstack card chooser is available in this environment`
    );
  }
  let chooser: CardChooser = here._CARDSTACK_CARD_CHOOSER;

  return await chooser.chooseCard<T>(query);
}

export function hasExecutableExtension(path: string): boolean {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

export function trimExecutableExtension(url: URL): URL {
  for (let extension of executableExtensions) {
    if (url.href.endsWith(extension)) {
      return new URL(url.href.replace(new RegExp(`\\${extension}$`), ""));
    }
  }
  return url;
}
