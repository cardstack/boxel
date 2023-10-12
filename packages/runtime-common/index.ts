import { CardResource } from './card-document';

// a card resource but with optional "id" and "type" props
export type LooseCardResource = Omit<CardResource, 'id' | 'type'> & {
  type?: 'card';
  id?: string;
};

export interface LooseSingleCardDocument {
  data: LooseCardResource;
  included?: CardResource<Saved>[];
}

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
  meta: {
    kind: 'directory' | 'file';
  };
}
import { RealmPaths } from './paths';
import { Query } from './query';
export {
  aiBotUsername,
  baseRealm,
  catalogEntryRef,
  baseCardRef,
  isField,
  primitive,
} from './constants';
export { makeLogDefinitions, logger } from './log';
export { RealmPaths };
export { NotLoaded, isNotLoadedError } from './not-loaded';
export { NotReady, isNotReadyError } from './not-ready';
export { cardTypeDisplayName } from './helpers/card-type-display-name';
export { maybeRelativeURL, maybeURL, relativeURL } from './url';

export const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];
export { createResponse } from './create-response';

// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call((globalThis as any).process) ===
  '[object process]';

export { Realm } from './realm';
export { SupportedMimeType } from './router';
export { Loader } from './loader';
export type {
  Kind,
  RealmAdapter,
  FileRef,
  ResponseWithNodeStream,
  RealmInfo,
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
} from './card-document';
export {
  isMeta,
  isCardResource,
  isCardDocument,
  isRelationship,
  isCardCollectionDocument,
  isSingleCardDocument,
  isCardDocumentString,
} from './card-document';
export { sanitizeHtml } from './dompurify';
export { getPlural } from './pluralize';

import type {
  CardDef,
  BaseDef,
  Format,
} from 'https://cardstack.com/base/card-api';

export const maxLinkDepth = 5;
export const assetsDir = '__boxel/';
export const boxelUIAssetsDir = '@cardstack/boxel-ui/';

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
  opts?: { isLinkedCard?: boolean; doc?: LooseSingleCardDocument },
) => Promise<CardDef | undefined>;

export interface CardChooser {
  chooseCard<T extends BaseDef>(
    query: Query,
    opts?: {
      offerToCreate?: CodeRef;
      multiSelect?: boolean;
      createNewCard?: CreateNewCard;
    },
  ): Promise<undefined | T>;
}

export async function chooseCard<T extends BaseDef>(
  query: Query,
  opts?: {
    offerToCreate?: CodeRef;
    multiSelect?: boolean;
    createNewCard?: CreateNewCard;
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

export interface CardSearch {
  getCards(
    query: Query,
    realms?: string[],
  ): {
    instances: CardDef[];
    ready: Promise<void>;
    isLoading: boolean;
  };
  getLiveCards(
    query: Query,
    realms?: string[],
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>,
  ): {
    instances: CardDef[];
    isLoading: boolean;
  };
}

export function getCards(query: Query, realms?: string[]) {
  let here = globalThis as any;
  let finder: CardSearch = here._CARDSTACK_CARD_SEARCH;
  return finder?.getCards(query, realms);
}

export function getLiveCards(
  query: Query,
  realms?: string[],
  doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>,
) {
  let here = globalThis as any;
  let finder: CardSearch = here._CARDSTACK_CARD_SEARCH;
  return finder?.getLiveCards(query, realms, doWhileRefreshing);
}

export interface CardCreator {
  create<T extends CardDef>(
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: { doc?: LooseSingleCardDocument },
  ): Promise<undefined | T>;
}

export async function createNewCard<T extends CardDef>(
  ref: CodeRef,
  relativeTo: URL | undefined,
  opts?: { doc?: LooseSingleCardDocument },
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
  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void;
}

export function subscribeToRealm(
  realmURL: string,
  cb: (ev: MessageEvent) => void,
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

export interface Actions {
  createCard: (
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: { isLinkedCard?: boolean; doc?: LooseSingleCardDocument }, //TODO: consider renaming isLinkedCard to be more semantic
  ) => Promise<CardDef | undefined>;
  viewCard: (
    card: CardDef,
    format?: Format,
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
    fieldName?: string,
  ) => void;
  createCardDirectly: (
    doc: LooseSingleCardDocument,
    relativeTo: URL | undefined,
  ) => Promise<void>;
  doWithStableScroll: (
    card: CardDef,
    changeSizeCallback: () => Promise<void>,
  ) => Promise<void>;
  // more CRUD ops to come...
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
