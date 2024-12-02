import { type Deferred, apiFor } from '@cardstack/runtime-common';

import {
  type CardResource,
  getCard,
} from '@cardstack/host/resources/card-resource';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

interface Args {
  format: Format;
  owner: object;
  request?: Deferred<CardDef | undefined>;
  stackIndex: number;
  card?: CardDef;
  cardResource?: CardResource;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
}

export class StackItem {
  format: Format;
  request?: Deferred<CardDef | undefined>;
  stackIndex: number;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
  private owner: object;
  private newCard?: CardDef;
  private cardResource?: CardResource;
  private newCardApiPromise: Promise<typeof CardAPI> | undefined;
  private newCardApi: typeof CardAPI | undefined;

  constructor(args: Args) {
    let {
      format,
      request,
      stackIndex,
      card,
      cardResource,
      isLinkedCard,
      owner,
    } = args;
    if (!card && !cardResource) {
      throw new Error(
        `Cannot create a StackItem without a 'card' or a 'cardResource'`,
      );
    }
    if (cardResource) {
      this.cardResource = cardResource;
    } else if (card?.id) {
      // if the card is not actually new--load a resource instead
      this.cardResource = getCard(owner, () => card!.id);
    } else if (card) {
      this.newCard = card;
      this.newCardApiPromise = apiFor(this.card).then(
        (api) => (this.newCardApi = api),
      );
    }

    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.isLinkedCard = isLinkedCard;
    this.owner = owner;
  }

  get url() {
    return (
      (this.cardResource?.url ? new URL(this.cardResource.url) : undefined) ??
      (this.newCard?.id ? new URL(this.newCard.id) : undefined)
    );
  }

  get card(): CardDef {
    if (this.newCard) {
      return this.newCard;
    } else if (this.cardResource) {
      if (!this.cardResource.card) {
        throw new Error(`The CardResource for this StackItem has no card set`);
      }
      return this.cardResource.card;
    }

    throw new Error(`This StackItem has no card set`);
  }

  get title() {
    if (this.newCard) {
      return this.newCard.title;
    } else if (this.cardResource?.card) {
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
    let api = this.cardResource?.api ?? this.newCardApi;
    if (!api) {
      throw new Error(
        `API for stack item is not available yet--use this.ready() to wait for API availability`,
      );
    }
    return api;
  }

  async ready() {
    await Promise.all([this.cardResource?.loaded, this.newCardApiPromise]);
  }

  clone(args: Partial<Args>) {
    let {
      card,
      format,
      request,
      isLinkedCard,
      owner,
      cardResource,
      stackIndex,
    } = this;
    return new StackItem({
      cardResource,
      card,
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
