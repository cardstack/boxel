import { Resource, useResource } from 'ember-resources';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import {
  identifyCard,
  internalKeyFor,
  baseRealm,
  moduleFrom,
  getAncestor,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { getOwner } from '@ember/application';
import type LoaderService from '../services/loader-service';
import type { Card, FieldType } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { Constructable } from '../lib/types';

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

  async toType(card: typeof Card): Promise<Type> {
    let maybeRef = identifyCard(card);
    if (!maybeRef) {
      throw new Error(`cannot identify card ${card.name}`);
    }
    let ref = maybeRef;
    let id = internalKeyFor(ref, undefined);
    let cached = this.typeCache.get(id);
    if (cached) {
      return cached;
    }

    let api = await this.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`
    );
    let { id: _remove, ...fields } = api.getFields(card);
    let superCard = getAncestor(card);
    let superType: Type | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard);
    }
    let fieldTypes: Type['fields'] = await Promise.all(
      Object.entries(fields).map(async ([name, field]) => ({
        name,
        type: field.fieldType,
        card: await this.toType(field.card),
      }))
    );
    let type: Type = {
      id,
      module: moduleFrom(ref),
      super: superType,
      fields: fieldTypes,
    };
    this.typeCache.set(id, type);
    return type;
  }
}

export function getCardType(parent: object, card: () => typeof Card) {
  return useResource(parent, CardType as Constructable<Resource>, () => ({
    named: {
      card: card(),
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service'
        ) as LoaderService
      ).loader,
    },
  })) as CardType;
}
