import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import { type Type } from '../services/card-type';

import type CardTypeService from '../services/card-type';

interface Args {
  named: {
    definition: typeof BaseDef;
  };
}

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  @service declare private cardTypeService: CardTypeService;
  ready: Promise<void> | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { definition } = named;
    this.ready = this.assembleType.perform(definition);
  }

  get isLoading() {
    return this.assembleType.isRunning;
  }

  private assembleType = restartableTask(async (card: typeof BaseDef) => {
    this.type = await this.cardTypeService.assembleType(card);
  });
}

export function getCardType(parent: object, card: () => typeof BaseDef) {
  return CardType.from(parent, () => ({
    named: {
      definition: card(),
    },
  })) as CardType;
}
