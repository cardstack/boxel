import Route from '@ember/routing/route';

import { service } from '@ember/service';

import { isEqual } from 'lodash';

import {
  baseRef,
  CodeRef,
  identifyCard,
  internalKeyFor,
  type PrerenderMeta,
} from '@cardstack/runtime-common';

import CardService from '@cardstack/host/services/card-service';

import { BaseDef, CardDef } from 'https://cardstack.com/base/card-api.gts';

import type { Model as ParentModel } from '../render';

export type Model = PrerenderMeta;

export default class RenderRoute extends Route<Model> {
  @service declare cardService: CardService;

  async model() {
    let api = await this.cardService.getAPI();
    let instance = this.modelFor('render') as ParentModel;

    let serialized = api.serializeCard(instance, {
      includeComputeds: true,
    });

    let Klass = getClass(instance);

    let types = getTypes(Klass);
    let searchDoc = await api.searchDoc(instance);
    // Add a "pseudo field" to the search doc for the card type. We use the
    // "_" prefix to make a decent attempt to not pollute the userland
    // namespace for cards
    searchDoc._cardType = getDisplayName(Klass);

    return {
      serialized,
      displayName: getDisplayName(Klass),
      types: types.map((t) => internalKeyFor(t, undefined)),
      searchDoc,
    };
  }
}

export function getClass(instance: CardDef): typeof CardDef {
  return Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef;
}

function getDisplayName(card: typeof CardDef) {
  if (card.displayName === 'Card') {
    return card.name;
  } else {
    return card.displayName;
  }
}

export function getTypes(klass: typeof BaseDef): CodeRef[] {
  let types = [];
  let current: typeof BaseDef | undefined = klass;

  while (current) {
    let ref = identifyCard(current);
    if (!ref || isEqual(ref, baseRef)) {
      break;
    }
    types.push(ref);
    current = Reflect.getPrototypeOf(current) as typeof BaseDef | undefined;
  }
  return types;
}
