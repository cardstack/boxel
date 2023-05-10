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
  FastBootInstance,
  ResponseWithNodeStream,
} from './realm';

import type { Saved } from './card-document';

import type { CardRef } from './card-ref';
export type { CardRef };

export * from './card-ref';

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
} from './card-document';

import type { Card, CardBase } from 'https://cardstack.com/base/card-api';

export const maxLinkDepth = 5;
export const assetsDir = '__boxel/';

export interface CardChooser {
  chooseCard<T extends CardBase>(
    query: Query,
    opts?: { offerToCreate: CardRef }
  ): Promise<undefined | T>;
}

export async function chooseCard<T extends CardBase>(
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
  create<T extends CardBase>(
    ref: CardRef,
    relativeTo?: URL
  ): Promise<undefined | T>;
}

export async function createNewCard<T extends Card>(
  ref: CardRef,
  relativeTo?: URL
): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CREATE_NEW_CARD) {
    throw new Error(
      `no cardstack card creator is available in this environment`
    );
  }
  let cardCreator: CardCreator = here._CARDSTACK_CREATE_NEW_CARD;

  return await cardCreator.create<T>(ref, relativeTo);
}

export interface Actions {
  createCard: (
    cardClass: typeof Card,
    opts?: { createInPlace?: boolean }
  ) => Promise<Card | undefined>;
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
  ref: CardRef,
  relativeTo: URL | undefined
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
