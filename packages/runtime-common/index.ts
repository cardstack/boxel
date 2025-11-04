import type { CardResource, Meta } from './resource-types';
import type { ResolvedCodeRef } from './code-ref';
import type { RenderRouteOptions } from './render-route-options';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import type { ErrorEntry } from './index-writer';

// a card resource but with optional "id" and "type" props
export type LooseCardResource = Omit<CardResource, 'id' | 'type'> & {
  type?: 'card';
  id?: string;
};

export interface LooseSingleCardDocument {
  data: LooseCardResource;
  included?: CardResource[];
}

export type PatchData = {
  attributes?: CardResource['attributes'];
  relationships?: CardResource['relationships'];
  meta?: {
    fields: Meta['fields'];
  };
};

// Shared type produced by the host app when visiting the render.meta route and
// consumed by the server.
export interface PrerenderMeta {
  serialized: SingleCardDocument | null;
  searchDoc: Record<string, any> | null;
  displayNames: string[] | null;
  deps: string[] | null;
  types: string[] | null;
}

export interface RenderResponse extends PrerenderMeta {
  isolatedHTML: string | null;
  atomHTML: string | null;
  embeddedHTML: Record<string, string> | null;
  fittedHTML: Record<string, string> | null;
  iconHTML: string | null;
  error?: RenderError;
}

export interface RenderError extends ErrorEntry {
  evict?: boolean;
}

export type Prerenderer = (args: {
  realm: string;
  url: string;
  userId: string;
  permissions: RealmPermissions;
  renderOptions?: RenderRouteOptions;
}) => Promise<RenderResponse>;

export type RealmAction = 'read' | 'write' | 'realm-owner' | 'assume-user';

export interface RealmPermissions {
  [username: string]: RealmAction[];
}

export { Deferred } from './deferred';
export {
  CardError,
  isCardError,
  formattedError,
  type CardErrorJSONAPI,
  type CardErrorsJSONAPI,
  isCardErrorJSONAPI,
} from './error';

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
  resourceCreatedAt?: number;
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
// TODO should we use the secure form once we start letting lid's drive the id
// on the server? address in CS-8343
export { v4 as uuidv4 } from '@lukeed/uuid'; // isomorphic UUID's using Math.random
import type { LocalPath } from './paths';
import type { CardTypeFilter, Query, EveryFilter } from './query';
import { Loader } from './loader';
export * from './paths';
export * from './cached-fetch';
export * from './definitions';
export * from './catalog';
export * from './commands';
export * from './constants';
export * from './document';
export * from './matrix-constants';
export * from './matrix-client';
export * from './queue';
export * from './expression';
export * from './index-query-engine';
export * from './index-writer';
export * from './index-structure';
export * from './db';
export * from './lint';
export * from './worker';
export * from './stream';
export * from './realm';
export * from './realm-index-updater';
export * from './reindex-config';
export * from './fetcher';
export * from './scoped-css';
export * from './html-utils';
export * from './utils';
export * from './authorization-middleware';
export * from './resource-types';
export * from './query';
export * from './formats';
export { mergeRelationships } from './merge-relationships';
export { makeLogDefinitions, logger } from './log';
export { Loader };
export { NotLoaded, isNotLoadedError } from './not-loaded';
export {
  cardTypeDisplayName,
  cardTypeIcon,
  getFieldIcon,
} from './helpers/card-type-display-name';
export * from './helpers/ensure-extension';
export * from './url';
export * from './render-route-options';
export * from './publishability';

export const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];
export { createResponse } from './create-response';

export * from './db-queries/db-types';
export * from './db-queries/realm-permission-queries';
export * from './db-queries/session-room-queries';
export * from './db-queries/user-queries';

// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call((globalThis as any).process) ===
  '[object process]';

export { SupportedMimeType } from './router';
export {
  isUrlLike,
  VirtualNetwork,
  type ResponseWithNodeStream,
} from './virtual-network';
export { RealmAuthDataSource } from './realm-auth-data-source';

export type {
  Kind,
  RealmAdapter,
  FileRef,
  RealmInfo,
  TokenClaims,
  RealmSession,
} from './realm';

import type { CodeRef } from './code-ref';
export type { CodeRef };

export * from './code-ref';
export * from './serializers';

export type { CardDocument, SingleCardDocument } from './document-types';
export type {
  CardResource,
  ModuleResource,
  CardResourceMeta,
  ResourceID,
  Meta,
  Saved,
  Relationship,
  CardFields,
} from './resource-types';
export {
  isCardDocument,
  isCardCollectionDocument,
  isSingleCardDocument,
  isCardDocumentString,
} from './document-types';
export {
  isMeta,
  isCardResource,
  isModuleResource,
  isRelationship,
} from './resource-types';

export type { JWTPayload } from './realm-auth-client';
export { sanitizeHtml } from './dompurify-runtime';
export { markedSync, markdownToHtml } from './marked-sync';
export { getPlural } from './pluralize-runtime';

import type {
  CardDef,
  FieldDef,
  BaseDef,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { RealmInfo } from './realm';
import type { PrerenderedCard, QueryResultsMeta } from './index-query-engine';

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
) => Promise<string | undefined>;

export interface CardChooser {
  chooseCard(
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
  ): Promise<undefined | string>;
}

export interface FileChooser {
  chooseFile<T>(defaultRealmURL?: URL): Promise<undefined | T>;
}

export async function chooseCard(
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
): Promise<undefined | string> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CARD_CHOOSER) {
    throw new Error(
      `no cardstack card chooser is available in this environment`,
    );
  }
  let chooser: CardChooser = here._CARDSTACK_CARD_CHOOSER;

  return await chooser.chooseCard(query, opts);
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

import type { CardErrorJSONAPI } from './error';
import type { SingleCardDocument } from './document-types';
export type AutoSaveState = {
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSaved: number | undefined;
  lastSaveError: CardErrorJSONAPI | Error | undefined;
  lastSavedErrorMsg: string | undefined;
};
export type getCard<T extends CardDef = CardDef> = (
  parent: object,
  id: () => string | undefined,
) => // This is a duck type of the CardResource
{
  id: string | undefined;
  card: T | undefined;
  cardError: CardErrorJSONAPI | undefined;
  isLoaded: boolean;
  autoSaveState: AutoSaveState | undefined;
};
export type getCardCollection<T extends CardDef = CardDef> = (
  parent: object,
  ids: () => string[] | undefined,
) => // This is a duck type of the CardResource
{
  ids: string[] | undefined;
  cards: T[];
  cardErrors: CardErrorJSONAPI[];
  isLoaded: boolean;
};
export type getCards<T extends CardDef = CardDef> = (
  parent: object,
  getQuery: () => Query | undefined,
  getRealms?: () => string[] | undefined,
  opts?: {
    isLive?: true;
    doWhileRefreshing?: (() => void) | undefined;
  },
) => // This is a duck type of the SearchResource
{
  instances: T[];
  instancesByRealm: { realm: string; cards: T[] }[];
  isLoading: boolean;
  meta: QueryResultsMeta;
};

export interface CreateOptions {
  realm?: string;
  localDir?: LocalPath;
  relativeTo?: URL | undefined;
}

export interface AddOptions extends CreateOptions {
  doNotPersist?: boolean;
  doNotWaitForPersist?: boolean;
}

export interface Store {
  save(id: string): void;
  create(
    doc: LooseSingleCardDocument,
    opts?: CreateOptions,
  ): Promise<string | CardErrorJSONAPI>;
  add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions & { doNotPersist: true },
  ): Promise<T>;
  add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions & { doNotWaitForPersist: true },
  ): Promise<T>;
  add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions,
  ): Promise<T | CardErrorJSONAPI>;
  peek<T extends CardDef>(id: string): T | CardErrorJSONAPI | undefined;
  peekLive<T extends CardDef>(id: string): T | CardErrorJSONAPI | undefined;
  peekError(id: string): CardErrorJSONAPI | undefined;
  get<T extends CardDef>(id: string): Promise<T | CardErrorJSONAPI>;
  delete(id: string): Promise<void>;
  patch<T extends CardDef>(
    id: string,
    patchData: PatchData,
  ): Promise<T | CardErrorJSONAPI | undefined>;
  search(query: Query, realmURL?: URL): Promise<CardDef[]>;
  getSaveState(id: string): AutoSaveState | undefined;
}

export interface CardCatalogQuery extends Query {
  filter?: CardTypeFilter | EveryFilter;
}

export interface CardCreator {
  create(
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: {
      realmURL?: URL;
      doc?: LooseSingleCardDocument;
    },
  ): Promise<string>;
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

export interface CopyCardsWithCodeRef {
  sourceCard: CardDef;
  codeRef?: ResolvedCodeRef; // if provided the card will point to a new code ref
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

export function isLocalId(id: string) {
  return !id.startsWith('http');
}

export * from './prerendered-card-search';
