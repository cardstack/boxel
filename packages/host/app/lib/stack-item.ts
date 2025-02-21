import {
  type Deferred,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import {
  type CardResource,
  getCard,
} from '@cardstack/host/resources/card-resource';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

interface Args {
  format: Format;
  owner: object;
  request?: Deferred<CardDef | undefined>;
  stackIndex: number;
  newCard?: { doc: LooseSingleCardDocument; relativeTo: URL | undefined };
  url?: URL;
  cardResource?: CardResource;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
}

export class StackItem {
  format: Format;
  request?: Deferred<CardDef | undefined>;
  stackIndex: number;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
  private owner: object;
  private cardResource?: CardResource;

  constructor(args: Args) {
    let {
      format,
      request,
      stackIndex,
      newCard,
      url,
      cardResource,
      isLinkedCard,
      owner,
    } = args;
    if (!newCard && !cardResource && !url) {
      throw new Error(
        `Cannot create a StackItem without a 'newCard' or a 'cardResource' or a 'url'`,
      );
    }
    if (cardResource) {
      this.cardResource = cardResource;
    } else if (url) {
      this.cardResource = getCard(owner, () => url!.href, {
        isAutoSave: () => true,
      });
    } else if (newCard) {
      this.cardResource = getCard(owner, () => newCard!.doc, {
        relativeTo: newCard.relativeTo,
        isAutoSave: () => true,
      });
    }

    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.isLinkedCard = isLinkedCard;
    this.owner = owner;
  }

  get url() {
    return this.cardResource?.url ? new URL(this.cardResource.url) : undefined;
  }

  get card(): CardDef {
    if (this.cardResource) {
      if (!this.cardResource.card) {
        throw new Error(`The CardResource for this StackItem has no card set`);
      }
      return this.cardResource.card;
    }

    throw new Error(`This StackItem has no card set`);
  }

  get autoSaveState() {
    return this.cardResource?.autoSaveState;
  }

  get title() {
    if (this.cardResource?.card) {
      return this.cardResource.card.title;
    }
    return undefined;
  }

  get cardError() {
    return this.cardResource?.cardError;
  }

  get isWideFormat() {
    if (!this.cardResource || !this.cardResource.card) {
      return false;
    }
    let { constructor } = this.cardResource.card;
    return Boolean(
      constructor &&
        'prefersWideFormat' in constructor &&
        constructor.prefersWideFormat,
    );
  }

  get headerColor() {
    if (!this.cardResource || !this.cardResource.card) {
      return;
    }
    let cardDef = this.cardResource.card.constructor;
    if (!cardDef || !('headerColor' in cardDef)) {
      return;
    }
    if (cardDef.headerColor == null) {
      return;
    }
    return cardDef.headerColor as string;
  }

  get api() {
    let api = this.cardResource?.api;
    if (!api) {
      throw new Error(
        `API for stack item is not available yet--use this.ready() to wait for API availability`,
      );
    }
    return api;
  }

  async ready() {
    await this.cardResource?.loaded;
  }

  clone(args: Partial<Args>) {
    let { format, request, isLinkedCard, owner, cardResource, stackIndex } =
      this;
    return new StackItem({
      cardResource,
      format,
      request,
      isLinkedCard,
      owner,
      stackIndex,
      ...args,
    });
  }
}

export function isIndexCard(stackItem: StackItem) {
  let realmURL = stackItem.card[stackItem.api.realmURL];
  if (!realmURL) {
    return false;
  }
  return stackItem.card.id === `${realmURL.href}index`;
}
