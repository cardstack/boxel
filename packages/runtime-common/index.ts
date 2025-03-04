import { CardResource } from './card-document';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

// a card resource but with optional "id" and "type" props
export type LooseCardResource = Omit<CardResource, 'id' | 'type'> & {
  type?: 'card';
  id?: string;
};

export interface LooseSingleCardDocument {
  data: LooseCardResource;
  included?: CardResource<Saved>[];
}

export type PatchData = {
  attributes?: CardResource['attributes'];
  relationships?: CardResource['relationships'];
};

export { Deferred } from './deferred';
export { CardError } from './error';

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
  meta: FileMeta | DirectoryMeta;
}

export interface FileMeta {
  kind: 'file';
  lastModified: number | null;
}

export interface DirectoryMeta {
  kind: 'directory';
}

export interface RealmCards {
  url: string | null;
  realmInfo: RealmInfo;
  cards: CardDef[];
}

export interface RealmPrerenderedCards {
  url: string | null;
  realmInfo: RealmInfo;
  prerenderedCards: PrerenderedCard[];
}

import { RealmPaths, type LocalPath } from './paths';
import { CardTypeFilter, Query, EveryFilter } from './query';
import { Loader } from './loader';
export * from './commands';
export * from './constants';
export * from './queue';
export * from './expression';
export * from './index-query-engine';
export * from './index-writer';
export * from './index-structure';
export * from './db';
export * from './worker';
export * from './stream';
export * from './realm';
export * from './fetcher';
export * from './scoped-css';
export * from './utils';
export * from './authorization-middleware';
export * from './query';
export { mergeRelationships } from './merge-relationships';
export { makeLogDefinitions, logger } from './log';
export { RealmPaths, Loader, type LocalPath };
export { NotLoaded, isNotLoadedError } from './not-loaded';
export {
  cardTypeDisplayName,
  cardTypeIcon,
} from './helpers/card-type-display-name';
export { maybeRelativeURL, maybeURL, relativeURL } from './url';

export const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];
export { createResponse } from './create-response';

export * from './realm-permission-queries';
export * from './user-queries';

// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call((globalThis as any).process) ===
  '[object process]';

export { SupportedMimeType } from './router';
export { VirtualNetwork, type ResponseWithNodeStream } from './virtual-network';
export { RealmAuthDataSource } from './realm-auth-data-source';

export type {
  Kind,
  RealmAdapter,
  FileRef,
  RealmInfo,
  TokenClaims,
  RealmPermissions,
  RealmSession,
} from './realm';

import type { Saved } from './card-document';

import type { CodeRef } from './code-ref';
export type { CodeRef };

export * from './code-ref';

export type {
  CardResource,
  CardDocument,
  CardFields,
  SingleCardDocument,
  Relationship,
  Meta,
  CardResourceMeta,
} from './card-document';
export type { JWTPayload } from './realm-auth-client';
export {
  isMeta,
  isCardResource,
  isCardDocument,
  isRelationship,
  isCardCollectionDocument,
  isSingleCardDocument,
  isCardDocumentString,
} from './card-document';
export { sanitizeHtml } from './dompurify-runtime';
export { markedSync, markdownToHtml } from './marked-sync';
export { getPlural } from './pluralize-runtime';

import type {
  CardDef,
  FieldDef,
  BaseDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { RealmInfo } from './realm';
import { PrerenderedCard } from './index-query-engine';

export const maxLinkDepth = 5;

export interface MatrixCardError {
  id?: string;
  error: Error;
}

export function isMatrixCardError(
  maybeError: any,
): maybeError is MatrixCardError {
  return (
    typeof maybeError === 'object' &&
    'error' in maybeError &&
    maybeError.error instanceof Error
  );
}

export type CreateNewCard = (
  ref: CodeRef,
  relativeTo: URL | undefined,
  opts?: {
    isLinkedCard?: boolean;
    doc?: LooseSingleCardDocument;
    realmURL?: URL;
  },
) => Promise<CardDef | undefined>;

export interface CardChooser {
  chooseCard<T extends BaseDef>(
    query: CardCatalogQuery,
    opts?: {
      offerToCreate?: {
        ref: CodeRef;
        relativeTo: URL | undefined;
        realmURL: URL | undefined;
      };
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
      consumingRealm?: URL;
    },
  ): Promise<undefined | T>;
}

export interface FileChooser {
  chooseFile<T>(defaultRealmURL?: URL): Promise<undefined | T>;
}

export async function chooseCard<T extends BaseDef>(
  query: CardCatalogQuery,
  opts?: {
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
      realmURL: URL | undefined;
    };
    multiSelect?: boolean;
    createNewCard?: CreateNewCard;
    preselectedCardTypeQuery?: Query;
    consumingRealm?: URL;
  },
): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CARD_CHOOSER) {
    throw new Error(
      `no cardstack card chooser is available in this environment`,
    );
  }
  let chooser: CardChooser = here._CARDSTACK_CARD_CHOOSER;

  return await chooser.chooseCard<T>(query, opts);
}

export async function chooseFile<T extends FieldDef>(): Promise<
  undefined | any
> {
  let here = globalThis as any;
  if (!here._CARDSTACK_FILE_CHOOSER) {
    throw new Error(
      `no cardstack file chooser is available in this environment`,
    );
  }
  let chooser: FileChooser = here._CARDSTACK_FILE_CHOOSER;

  return await chooser.chooseFile<T>();
}

export interface CardSearch {
  getCards(
    getQuery: () => Query | undefined,
    getRealms: () => string[] | undefined,
    opts?: {
      isLive?: true;
      doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
    },
  ): {
    instances: CardDef[];
    loaded: Promise<void>;
    isLoading: boolean;
  };
  getCard<T extends CardDef>(
    url: URL,
    opts?: { loader?: Loader; isLive?: boolean },
  ): {
    card: T | undefined;
    loaded: Promise<void> | undefined;
    cardError?: undefined | { id: string; error: Error };
  };
}

export interface CardCatalogQuery extends Query {
  filter?: CardTypeFilter | EveryFilter;
}

export function getCards(
  getQuery: () => Query | undefined,
  getRealms: () => string[] | undefined,
  opts?: {
    isLive?: true;
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
  },
) {
  let here = globalThis as any;
  let finder: CardSearch = here._CARDSTACK_CARD_SEARCH;
  return finder?.getCards(getQuery, getRealms, opts);
}

export function getCard<T extends CardDef>(
  url: URL,
  opts?: { loader?: Loader; isLive?: boolean },
) {
  let here = globalThis as any;
  if (!here._CARDSTACK_CARD_SEARCH) {
    // on the server we don't need this
    return { card: undefined, loaded: undefined };
  }
  let finder: CardSearch = here._CARDSTACK_CARD_SEARCH;
  return finder?.getCard<T>(url, opts);
}

export interface CardCreator {
  create<T extends CardDef>(
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: {
      realmURL?: URL;
      doc?: LooseSingleCardDocument;
    },
  ): Promise<undefined | T>;
}

export async function createNewCard<T extends CardDef>(
  ref: CodeRef,
  relativeTo: URL | undefined,
  opts?: {
    realmURL?: URL;
    doc?: LooseSingleCardDocument;
  },
): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CREATE_NEW_CARD) {
    throw new Error(
      `no cardstack card creator is available in this environment`,
    );
  }
  let cardCreator: CardCreator = here._CARDSTACK_CREATE_NEW_CARD;

  return await cardCreator.create<T>(ref, relativeTo, opts);
}

export interface RealmSubscribe {
  subscribe(realmURL: string, cb: (ev: RealmEventContent) => void): () => void;
}

export function subscribeToRealm(
  realmURL: string,
  cb: (ev: RealmEventContent) => void,
): () => void {
  let here = globalThis as any;
  if (!here._CARDSTACK_REALM_SUBSCRIBE) {
    // eventually we'll support subscribing to a realm in node since this will
    // be how realms will coordinate with one another, but for now do nothing
    return () => {
      /* do nothing */
    };
  } else {
    let realmSubscribe: RealmSubscribe = here._CARDSTACK_REALM_SUBSCRIBE;
    return realmSubscribe.subscribe(realmURL, cb);
  }
}

export interface SearchQuery {
  instances: CardDef[];
  isLoading: boolean;
}

export interface Actions {
  createCard: (
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: {
      // TODO: consider renaming isLinkedCard to be more semantic
      isLinkedCard?: boolean;
      realmURL?: URL; // the realm to create the card in
      doc?: LooseSingleCardDocument; // initial data for the card
      cardModeAfterCreation?: Format; // by default, the new card opens in the stack in edit mode
    },
  ) => Promise<CardDef | undefined>;
  viewCard: (
    cardOrURL: CardDef | URL,
    format?: Format,
    opts?: {
      openCardInRightMostStack?: boolean;
      fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
      fieldName?: string;
    },
  ) => Promise<void>;
  copyURLToClipboard: (card: CardDef | URL | string) => Promise<void>;
  editCard: (card: CardDef) => void;
  copyCard?: (card: CardDef) => Promise<CardDef>;
  saveCard(card: CardDef): Promise<void>;
  delete: (item: CardDef | URL | string) => void;
  doWithStableScroll: (
    card: CardDef,
    changeSizeCallback: () => Promise<void>,
  ) => Promise<void>;
  changeSubmode: (url: URL, submode: 'code' | 'interact') => void;
  getCards: (
    // The reason (getQuery, getRealms) is a thunk is to ensure that the arguments are reactive wrt to ember resource
    // This is the expectation of ember-resources ie`.from` method should be instantiated at the root of the component and expect a thunk
    // The issue is when we wrap `getCards` as an api, we tend to model it as a function that takes arguments (values) thereby enclosing in a scoped context
    // We acknowledge that this is not the "perfect" api but it is a pragmatic solution for now to resolve the tension between card api usage and ember-resources
    getQuery: () => Query | undefined,
    getRealms: () => string[] | undefined,
    opts?: {
      isLive?: true;
      doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>;
    },
  ) => SearchQuery;
}

export function hasExecutableExtension(path: string): boolean {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension) && !path.endsWith('.d.ts')) {
      return true;
    }
  }
  return false;
}

export function trimExecutableExtension(url: URL): URL {
  for (let extension of executableExtensions) {
    if (url.href.endsWith(extension)) {
      return new URL(url.href.replace(new RegExp(`\\${extension}$`), ''));
    }
  }
  return url;
}

export function internalKeyFor(
  ref: CodeRef,
  relativeTo: URL | undefined,
): string {
  if (!('type' in ref)) {
    let module = trimExecutableExtension(new URL(ref.module, relativeTo)).href;
    return `${module}/${ref.name}`;
  }
  switch (ref.type) {
    case 'ancestorOf':
      return `${internalKeyFor(ref.card, relativeTo)}/ancestor`;
    case 'fieldOf':
      return `${internalKeyFor(ref.card, relativeTo)}/fields/${ref.field}`;
  }
}

export function loaderFor(cardOrField: CardDef | FieldDef) {
  let clazz = Reflect.getPrototypeOf(cardOrField)!.constructor;
  let loader = Loader.getLoaderFor(clazz);
  if (!loader) {
    throw new Error(`bug: could not determine loader for card or field`);
  }
  return loader;
}

export async function apiFor(
  cardOrFieldType: typeof CardDef | typeof FieldDef | typeof BaseDef,
): Promise<typeof CardAPI>;
export async function apiFor(
  cardOrField: CardDef | FieldDef | BaseDef,
): Promise<typeof CardAPI>;
export async function apiFor(
  cardOrFieldOrClass:
    | CardDef
    | FieldDef
    | BaseDef
    | typeof CardDef
    | typeof FieldDef
    | typeof BaseDef,
) {
  let loader =
    Loader.getLoaderFor(cardOrFieldOrClass) ??
    loaderFor(cardOrFieldOrClass as CardDef | FieldDef | BaseDef);
  let api = await loader.import<typeof CardAPI>(
    'https://cardstack.com/base/card-api',
  );
  if (!api) {
    throw new Error(`could not load card API`);
  }
  return api;
}

export function splitStringIntoChunks(str: string, maxSizeKB: number) {
  const maxSizeBytes = maxSizeKB * 1024;
  let chunks = [];
  let startIndex = 0;
  while (startIndex < str.length) {
    // Calculate the end index of the chunk based on byte length
    let endIndex = startIndex;
    let byteLength = 0;
    while (endIndex < str.length && byteLength < maxSizeBytes) {
      let charCode = str.charCodeAt(endIndex);
      // we use this approach so that we can have an isomorphic means of
      // determining the byte size for strings, as well as, using Blob (in the
      // browser) to calculate string byte size is pretty expensive
      byteLength += charCode < 0x0080 ? 1 : charCode < 0x0800 ? 2 : 3;
      endIndex++;
    }
    let chunk = str.substring(startIndex, endIndex);
    chunks.push(chunk);
    startIndex = endIndex;
  }
  return chunks;
}

export function uint8ArrayToHex(uint8: Uint8Array) {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}

export function unixTime(epochTimeMs: number) {
  return Math.floor(epochTimeMs / 1000);
}
