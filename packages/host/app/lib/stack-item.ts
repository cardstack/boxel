import {
  type Deferred,
  Loader,
  apiFor,
  loaderFor,
} from '@cardstack/runtime-common';

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
      this.cardResource = getCard(owner, () => card!.id, {
        loader: () => loaderFor(card!),
      });
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
      this.cardResource?.url ??
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

  async setCardURL(url: URL, loader?: Loader) {
    if (this.cardResource) {
      throw new Error(
        `Cannot set cardURL ${url.href} on this stack item when CardResource has already been set`,
      );
    }

    this.cardResource = getCard(this.owner, () => url.href, {
      ...(loader ? { loader: () => loader } : {}),
    });
    await this.cardResource.loaded;
    this.newCard = undefined;
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
