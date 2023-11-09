import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { loadCard } from '@cardstack/runtime-common';

import { CardType, Type } from '@cardstack/host/resources/card-type';

import LoaderService from '@cardstack/host/services/loader-service';

import { BaseDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    url: string;
    card: typeof BaseDef;
    cardTypeResource?: CardType;
  };
}

export type CardInheritance = {
  cardType: Type;
  card: any;
};

export class InheritanceChainResource extends Resource<Args> {
  #loaded!: Promise<void>; // modifier runs at init so we will always have a value
  @tracked private _value: [] = [];
  @service declare loaderService: LoaderService;

  modify(_positional: never[], named: Args['named']) {
    let { cardTypeResource, card, url } = named;
    this.#loaded = this.load.perform(url, card, cardTypeResource);
  }

  get loaded() {
    return this.#loaded;
  }

  get value() {
    return this._value;
  }

  private load = task(
    async (url: string, card: typeof BaseDef, cardTypeResource?: CardType) => {
      if (cardTypeResource) {
        await cardTypeResource!.ready;
        let cardType = cardTypeResource!.type;

        if (!cardType) {
          throw new Error('Card type not found');
        }

        // Chain goes from most specific to least specific
        let cardInheritanceChain = [
          {
            cardType,
            card,
          },
        ];

        while (cardType.super) {
          cardType = cardType.super;

          let superCard = await loadCard(cardType.codeRef, {
            loader: this.loaderService.loader,
            relativeTo: new URL(url), // because the module can be relative
          });

          cardInheritanceChain.push({
            cardType,
            card: superCard,
          });
        }
        this._value = cardInheritanceChain;
      }
    },
  );
}

export function inheritanceChain(
  parent: object,
  url: () => string,
  card: () => typeof BaseDef,
  cardTypeResource: () => CardType,
) {
  return InheritanceChainResource.from(parent, () => ({
    named: {
      url: url(),
      card: card(),
      cardTypeResource: cardTypeResource(),
    },
  })) as InheritanceChainResource;
}
