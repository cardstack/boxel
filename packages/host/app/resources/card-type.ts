import { Resource } from 'ember-resources';
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
  BaseDef,
  Field,
  FieldType,
} from 'https://cardstack.com/base/card-api';
import { isCodeRef, type CodeRef } from '@cardstack/runtime-common/code-ref';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    definition: typeof BaseDef;
    loader: Loader;
  };
}
export interface Type {
  id: string;
  module: string;
  displayName: string;
  super: Type | undefined;
  fields: { name: string; card: Type | CodeRef; type: FieldType }[];
}

export class CardType extends Resource<Args> {
  @tracked type: Type | undefined;
  declare loader: Loader;
  typeCache: Map<string, Type> = new Map();

  modify(_positional: never[], named: Args['named']) {
    let { definition, loader } = named;
    this.loader = loader;
    this.assembleType.perform(definition);
  }

  private assembleType = restartableTask(async (card: typeof BaseDef) => {
    let maybeType = await this.toType(card);
    if (isCodeRef(maybeType)) {
      throw new Error(`bug: should never get here`);
    }
    this.type = maybeType;
  });

  async toType(
    card: typeof BaseDef,
    stack: (typeof BaseDef)[] = [],
  ): Promise<Type | CodeRef> {
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
      `${baseRealm.url}card-api`,
    );
    let { id: _remove, ...fields } = api.getFields(card);
    let superCard = getAncestor(card);
    let superType: Type | CodeRef | undefined;
    if (superCard && card !== superCard) {
      superType = await this.toType(superCard, [card, ...stack]);
    }
    if (isCodeRef(superType)) {
      throw new Error(
        `bug: encountered cycle in card ancestor: ${[
          superType,
          ...stack.map((c) => identifyCard(c)),
        ]
          .map((r) => JSON.stringify(r))
          .join()}`,
      );
    }
    let fieldTypes: Type['fields'] = await Promise.all(
      Object.entries(fields).map(
        async ([name, field]: [string, Field<typeof BaseDef, any>]) => ({
          name,
          type: field.fieldType,
          card: await this.toType(field.card, [card, ...stack]),
        }),
      ),
    );
    let type: Type = {
      id,
      module: moduleFrom(ref),
      super: superType,
      displayName: card.prototype.constructor.displayName || 'Card',
      fields: fieldTypes,
    };
    this.typeCache.set(id, type);
    return type;
  }
}

export function getCardType(parent: object, card: () => typeof BaseDef) {
  return CardType.from(parent, () => ({
    named: {
      definition: card(),
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service',
        ) as LoaderService
      ).loader,
    },
  })) as CardType;
}
