import { Resource } from 'ember-resources/core';
import { restartableTask } from 'ember-concurrency';
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
import type {
  Card,
  CardBase,
  Field,
  FieldType,
} from 'https://cardstack.com/base/card-api';
import { isCardRef, type CardRef } from '@cardstack/runtime-common/card-ref';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

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
  fields: { name: string; card: Type | CardRef; type: FieldType }[];
}

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  declare loader: Loader;
  typeCache: Map<string, Type> = new Map();

  modify(_positional: never[], named: Args['named']) {
    let { card, loader } = named;
    this.loader = loader;
    this.assembleType.perform(card);
  }

  private assembleType = restartableTask(async (card: typeof Card) => {
    let maybeType = await this.toType(card);
    if (isCardRef(maybeType)) {
      throw new Error(`bug: should never get here`);
    }
    this.type = maybeType;
  });

  async toType(
    card: typeof CardBase,
    stack: (typeof CardBase)[] = []
  ): Promise<Type | CardRef> {
    let maybeRef = identifyCard(card);
    if (!maybeRef) {
      throw new Error(`cannot identify card ${card.name}`);
    }
    let ref = maybeRef;
    if (stack.includes(card)) {
      return ref;
    }
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
    let superType: Type | CardRef | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, [card, ...stack]);
    }
    if (isCardRef(superType)) {
      throw new Error(
        `bug: encountered cycle in card ancestor: ${[
          superType,
          ...stack.map((c) => identifyCard(c)),
        ]
          .map((r) => JSON.stringify(r))
          .join()}`
      );
    }
    let fieldTypes: Type['fields'] = await Promise.all(
      Object.entries(fields).map(
        async ([name, field]: [string, Field<typeof CardBase, any>]) => ({
          name,
          type: field.fieldType,
          card: await this.toType(field.card, [card, ...stack]),
        })
      )
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

export function getCardType(parent: object, card: () => typeof CardBase) {
  return CardType.from(parent, () => ({
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
