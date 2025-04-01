import {
  type Deferred,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { Format } from 'https://cardstack.com/base/card-api';

interface Args {
  format: Format;
  request?: Deferred<string>;
  stackIndex: number;
  newCard?: { doc: LooseSingleCardDocument; relativeTo: URL | undefined };
  url?: string;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
}

export class StackItem {
  format: Format;
  request?: Deferred<string>;
  stackIndex: number;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
  #url: string | undefined;

  constructor(args: Args) {
    let { format, request, stackIndex, newCard, url, isLinkedCard } = args;
    if (!newCard && !url) {
      throw new Error(
        `Cannot create a StackItem without a 'newCard' or a 'url'`,
      );
    }

    this.#url = url?.replace(/\.json$/, '');
    this.format = format;
    this.request = request;
    this.stackIndex = stackIndex;
    this.isLinkedCard = isLinkedCard;
  }

  get url() {
    return this.#url;
  }

  clone(args: Partial<Args>) {
    let { url, format, request, isLinkedCard, stackIndex } = this;
    return new StackItem({
      format,
      request,
      isLinkedCard,
      url,
      stackIndex,
      ...args,
    });
  }
}
