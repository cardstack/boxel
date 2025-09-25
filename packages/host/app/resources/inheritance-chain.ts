import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { loadCardDef } from '@cardstack/runtime-common';

import type { Type } from '@cardstack/host/services/card-type-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    url: string;
    card?: typeof BaseDef;
    cardType?: Type;
  };
}

export type CardInheritanceItem = {
  cardType: Type;
  card: typeof BaseDef;
};

export class InheritanceChainResource extends Resource<Args> {
  @tracked private _value: CardInheritanceItem[] = [];
  @service declare private loaderService: LoaderService;

  modify(_positional: never[], named: Args['named']) {
    let { cardType, card, url } = named;
    if (cardType && card) {
      this.load.perform(url, card, cardType);
    }
  }

  get value() {
    return this._value;
  }

  get isLoading() {
    return this.load.isRunning;
  }

  private load = task(
    async (url: string, card: typeof BaseDef, cardType?: Type) => {
      if (!cardType) {
        throw new Error('Card type not found');
      }
      if (!card) {
        throw new Error('card not found');
      }

      let cardInheritanceChain = [
        {
          cardType,
          card,
        },
      ];

      while (cardType?.super) {
        cardType = cardType.super;

        let superCard = await loadCardDef(cardType.codeRef, {
          loader: this.loaderService.loader,
          relativeTo: new URL(url),
        });

        cardInheritanceChain.push({
          cardType,
          card: superCard,
        });
      }
      this._value = cardInheritanceChain;
    },
  );
}

export function inheritanceChain(
  parent: object,
  url: () => string,
  card: () => typeof BaseDef | undefined,
  cardType: () => Type | undefined,
) {
  return InheritanceChainResource.from(parent, () => ({
    named: {
      url: url(),
      card: card(),
      cardType: cardType(),
    },
  }));
}
