import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';

import { service } from '@ember/service';

import { isEqual } from 'lodash';

import type { CodeRef } from '@cardstack/runtime-common';
import {
  baseRef,
  identifyCard,
  internalKeyFor,
  maybeRelativeURL,
  relationshipEntries,
  realmURL,
  type SingleCardDocument,
  type PrerenderMeta,
  type RenderError,
} from '@cardstack/runtime-common';

import {
  directModuleDeps,
  recursiveModuleDeps,
} from '@cardstack/host/lib/prerender-util';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import type { BaseDef, CardDef } from 'https://cardstack.com/base/card-api';

import { friendlyCardType } from '../../utils/render-error';

import type { Model as ParentModel } from '../render';

export type Model = PrerenderMeta | RenderError | undefined;

export default class RenderMetaRoute extends Route<Model> {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  async model(_: unknown, transition: Transition) {
    let api = await this.cardService.getAPI();
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    await parentModel?.readyPromise;
    let instance: CardDef;
    if (!parentModel) {
      // this is to support in-browser rendering, where we actually don't have the
      // ability to lookup the parent route using RouterService.recognizeAndLoad()
      instance = (globalThis as any).__renderInstance;
    } else {
      instance = parentModel.instance;
    }

    if (!instance) {
      // the lack of an instance is dealt with in the parent route
      transition.abort();
      return;
    }

    let serialized = api.serializeCard(instance, {
      includeComputeds: true,
      maybeRelativeURL: (url: string) =>
        maybeRelativeURL(
          new URL(url),
          new URL(instance.id),
          instance[realmURL],
        ),
    }) as SingleCardDocument;
    for (let { relationship } of relationshipEntries(
      serialized.data.relationships,
    )) {
      // we want to emulate the file serialization here
      delete relationship.data;
    }

    let moduleDeps = directModuleDeps(serialized.data, new URL(instance.id));
    // TODO eventually we need to include instance deps in here
    let deps = [
      ...(await recursiveModuleDeps(moduleDeps, this.loaderService.loader)),
    ];

    let Klass = getClass(instance);

    let types = getTypes(Klass);
    let displayNames = getDisplayNames(Klass);
    let searchDoc = api.searchDoc(instance);
    // Add a "pseudo field" to the search doc for the card type. We use the
    // "_" prefix to make a decent attempt to not pollute the userland
    // namespace for cards
    searchDoc._cardType = friendlyCardType(Klass);

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
    displayNames.push(normalizeDisplayName(current));
    current = Reflect.getPrototypeOf(current) as typeof BaseDef | undefined;
  }
  return displayNames;
}

function normalizeDisplayName(current: typeof BaseDef): string {
  let name = current.displayName;
  if (
    (name === 'Card' && current.name !== 'CardDef') ||
    (name === 'Field' && current.name !== 'FieldDef') ||
    (name === 'Base' && current.name !== 'BaseDef')
  ) {
    return current.name;
  }
  return name;
}
