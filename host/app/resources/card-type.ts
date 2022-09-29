import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardRef, internalKeyFor } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { service } from '@ember/service';
import CardAPI from '../services/card-api';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    card: typeof Card;
  };
}
export interface Type {
  id: string;
  module: string;
  super: Type | undefined;
  fields: { name: string; card: Type; type: 'contains' | 'containsMany' }[];
}

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  @service declare cardAPI: CardAPI;
  typeCache: Map<string, Type> = new Map();

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card } = args.named;
    taskFor(this.assembleType).perform(card);
  }

  @restartableTask private async assembleType(card: typeof Card) {
    await this.cardAPI.loaded;
    this.type = this.toType(card);
  }

  toType(card: typeof Card, context?: { from: CardRef; module: string }): Type {
    let exportedCardRef = Loader.identify(card);
    let ref: CardRef;
    let module: string;
    if (exportedCardRef) {
      ref = { type: 'exportedCard', ...exportedCardRef };
      module = exportedCardRef.module;
    } else if (context) {
      ref = context.from;
      module = context.module;
    } else {
      throw new Error(`cannot identify card ${card.name}`);
    }
    let id = internalKeyFor(ref, undefined);
    let cached = this.typeCache.get(id);
    if (cached) {
      return cached;
    }

    let fields = this.cardAPI.api.getFields(card);
    let superCard = Reflect.getPrototypeOf(card) as typeof Card | null;
    let superType: Type | undefined;
    if (superCard && card !== superCard) {
      superType = this.toType(superCard, {
        from: { type: 'ancestorOf', card: ref },
        module,
      });
    }
    let fieldTypes: Type['fields'] = Object.entries(fields).map(
      ([name, field]) => ({
        name,
        type: field.containsMany ? 'containsMany' : 'contains',
        card: this.toType(field.card, {
          from: { type: 'fieldOf', field: name, card: ref },
          module,
        }),
      })
    );
    let type: Type = {
      id,
      module,
      super: superType,
      fields: fieldTypes,
    };
    this.typeCache.set(id, type);
    return type;
  }
}

export function getCardType(parent: object, card: () => typeof Card) {
  return useResource(parent, CardType, () => ({
    named: { card: card() },
  }));
}
