import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { CardRef, internalKeyFor, baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { getOwner } from '@ember/application';
import type LoaderService from '../services/loader-service';
import type { Card, FieldType } from 'https://cardstack.com/base/card-api';
type CardAPI = typeof import('https://cardstack.com/base/card-api');

interface Args {
  named: {
    card: typeof Card;
    loader: Loader;
  };
}
export interface Type {
  id: string;
  module: string;
  super: Type | undefined;
  fields: { name: string; card: Type; type: FieldType }[];
}

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  loader: Loader;
  typeCache: Map<string, Type> = new Map();

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { card, loader } = args.named;
    this.loader = loader;
    taskFor(this.assembleType).perform(card);
  }

  @restartableTask private async assembleType(card: typeof Card) {
    this.type = await this.toType(card);
  }

  async toType(
    card: typeof Card,
    context?: { from: CardRef; module: string }
  ): Promise<Type> {
    let exportedCardRef = this.loader.identify(card);
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

    let api = await this.loader.import<CardAPI>(`${baseRealm.url}card-api`);
    let { id: remove, ...fields } = api.getFields(card);
    let superCard = Reflect.getPrototypeOf(card) as typeof Card | null;
    let superType: Type | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, {
        from: { type: 'ancestorOf', card: ref },
        module,
      });
    }
    let fieldTypes: Type['fields'] = await Promise.all(
      Object.entries(fields).map(async ([name, field]) => ({
        name,
        type: field.fieldType,
        card: await this.toType(field.card, {
          from: { type: 'fieldOf', field: name, card: ref },
          module,
        }),
      }))
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
    named: {
      card: card(),
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service'
        ) as LoaderService
      ).loader,
    },
  }));
}
