import { CardResource } from "./search-index";

// a card resource but with optional "id" and "type" props
export type LooseCardResource = Omit<CardResource, "id" | "type"> & {
  type?: "card";
  id?: string;
};

export interface LooseSingleCardDocument {
  data: LooseCardResource;
  included?: CardResource<Saved>[];
}

export { Deferred } from "./deferred";
export { CardError } from "./error";

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
export {
  baseRealm,
  catalogEntryRef,
  baseCardRef,
  isField,
  primitive,
} from "./constants";
export { RealmPaths };
export { NotLoaded, isNotLoadedError } from "./not-loaded";

export const executableExtensions = [".js", ".gjs", ".ts", ".gts"];

// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call((globalThis as any).process) ===
  "[object process]";

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
    [
      "Loader",
      "Deferred",
      "isCardResource",
      "isRelationship",
      "isSingleCardDocument",
      "isNotLoadedError",
      "chooseCard",
      "baseCardRef",
      "maxLinkDepth",
      "NotLoaded",
      "CardError",
      "isMetaFieldItem",
      "createNewCard",
      "getField",
      "isField",
      "primitive",
      "identifyCard",
      "loadCard",
      "humanReadable",
    ],
  ],
  ["@cardstack/boxel-ui", ["BoxelInput", "BoxelField"]],
  ["@glimmer/component", ["default"]],
  ["@ember/component", ["setComponentTemplate", "default"]],
  ["@ember/component/template-only", ["default"]],
  ["@ember/template-factory", ["createTemplateFactory"]],
  ["@glimmer/tracking", ["tracked"]],
  ["@ember/object", ["action", "get"]],
  ["@ember/object/internals", ["guidFor"]],
  ["@ember/helper", ["get", "fn", "concat"]],
  ["@ember/modifier", ["on"]],
  ["ember-resources", ["Resource", "useResource"]],
  ["ember-concurrency", ["task", "restartableTask"]],
  ["ember-concurrency-ts", ["taskFor"]],
  ["ember-modifier", ["default", "modifier"]],
  ["flat", ["flatten", "unflatten"]],
  ["lodash", ["flatMap", "startCase", "get", "set", "isEqual", "merge"]],
  ["tracked-built-ins", ["TrackedWeakMap"]],
  ["date-fns", ["parseISO", "format", "parse"]],
]);

export { Realm } from "./realm";
export { Loader } from "./loader";
export type { Kind, RealmAdapter, FileRef } from "./realm";

import type { Saved } from "./search-index";

import type { CardRef } from "./card-ref";
export type { CardRef };

export * from "./card-ref";

export type {
  CardResource,
  CardDocument,
  CardFields,
  SingleCardDocument,
  Relationship,
  Meta,
} from "./search-index";
export {
  isMeta,
  isCardResource,
  isCardDocument,
  isRelationship,
  isCardCollectionDocument,
  isSingleCardDocument,
} from "./search-index";

import type { Card } from "https://cardstack.com/base/card-api";

// TODO hardcoding link traversal depth to 5 for now, eventually this will be
// based on the fields used by the card's template, and/or fields requested in
// JSONAPI request
export const maxLinkDepth = 5;

export interface CardChooser {
  chooseCard<T extends Card>(
    query: Query,
    opts?: { offerToCreate: CardRef }
  ): Promise<undefined | T>;
}

export async function chooseCard<T extends Card>(
  query: Query,
  opts?: { offerToCreate: CardRef }
): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CARD_CHOOSER) {
    throw new Error(
      `no cardstack card chooser is available in this environment`
    );
  }
  let chooser: CardChooser = here._CARDSTACK_CARD_CHOOSER;

  return await chooser.chooseCard<T>(query, opts);
}

export interface CardCreator {
  create<T extends Card>(ref: CardRef): Promise<undefined | T>;
}

export async function createNewCard<T extends Card>(
  ref: CardRef
): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CREATE_NEW_CARD) {
    throw new Error(
      `no cardstack card creator is available in this environment`
    );
  }
  let cardCreator: CardCreator = here._CARDSTACK_CREATE_NEW_CARD;

  return await cardCreator.create<T>(ref);
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

export function internalKeyFor(
  ref: CardRef,
  relativeTo: URL | undefined
): string {
  if (!("type" in ref)) {
    let module = trimExecutableExtension(new URL(ref.module, relativeTo)).href;
    return `${module}/${ref.name}`;
  }
  switch (ref.type) {
    case "ancestorOf":
      return `${internalKeyFor(ref.card, relativeTo)}/ancestor`;
    case "fieldOf":
      return `${internalKeyFor(ref.card, relativeTo)}/fields/${ref.field}`;
  }
}
