import Route from '@ember/routing/route';

import { service } from '@ember/service';

import { isEqual } from 'lodash';

import {
  baseRef,
  CodeRef,
  identifyCard,
  internalKeyFor,
  type SingleCardDocument,
  type PrerenderMeta,
} from '@cardstack/runtime-common';

import {
  directModuleDeps,
  recursiveModuleDeps,
} from '@cardstack/host/lib/prerender-util';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import type { BaseDef, CardDef } from 'https://cardstack.com/base/card-api';

import type { Model as ParentModel } from '../render';

export type Model = PrerenderMeta;

export default class RenderRoute extends Route<Model> {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  async model() {
    let api = await this.cardService.getAPI();
    let parentModel = this.modelFor('render') as ParentModel;
    let instance: CardDef;
    if (!parentModel) {
      // this is to support in-browser rendering, where we actually don't have the
      // ability to lookup the parent route using RouterService.recognizeAndLoad()
      instance = (globalThis as any).__renderInstance;
    } else {
      instance = parentModel.instance;
    }

    let serialized = api.serializeCard(instance, {
      includeComputeds: true,
    }) as SingleCardDocument;

    let moduleDeps = directModuleDeps(serialized.data, new URL(instance.id));
    // TODO eventually we need to include instance deps in here
    let deps = [
      ...(await recursiveModuleDeps(moduleDeps, this.loaderService.loader)),
    ];

    let Klass = getClass(instance);

    let types = getTypes(Klass);
    let displayNames = getDisplayNames(Klass);
    let searchDoc = await api.searchDoc(instance);
    // Add a "pseudo field" to the search doc for the card type. We use the
    // "_" prefix to make a decent attempt to not pollute the userland
    // namespace for cards
    searchDoc._cardType = getFriendlyCardType(Klass);

    return {
      serialized,
      displayNames,
      types: types.map((t) => internalKeyFor(t, undefined)),
      searchDoc,
      deps,
    };
  }
}

export function getClass(instance: CardDef): typeof CardDef {
  return Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef;
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

function getDisplayNames(klass: typeof BaseDef): string[] {
  let displayNames = [];
  let current: typeof BaseDef | undefined = klass;

  while (current) {
    let ref = identifyCard(current);
    if (!ref || isEqual(ref, baseRef)) {
      break;
    }
    displayNames.push(current.displayName);
    current = Reflect.getPrototypeOf(current) as typeof BaseDef | undefined;
  }
  return displayNames;
}

function getFriendlyCardType(card: typeof CardDef) {
  if (card.displayName === 'Card') {
    return card.name;
  } else {
    return card.displayName;
  }
}
