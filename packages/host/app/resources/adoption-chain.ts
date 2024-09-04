import { ImportResource } from './import';
import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { Loader } from '@cardstack/runtime-common/loader';
import { getOwner } from '@ember/application';
import type LoaderService from '../services/loader-service';
import { service } from '@ember/service';
import { type BaseDef } from 'https://cardstack.com/base/card-api';
import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

interface AdoptionChainResourceArgs {
  named: { module: ImportResource | undefined; loader: Loader };
}

export class AdoptionChainResource extends Resource<AdoptionChainResourceArgs> {
  @service declare loaderService: LoaderService;
  @tracked cards: (typeof BaseDef)[] = [];
  @tracked _cardTypes: CardType[] = [];

  modify(_positional: never[], named: AdoptionChainResourceArgs['named']) {
    let importResource = named['module'];
    if (importResource && importResource.module) {
      let module = importResource.module;
      this.cards = cardsOrFieldsFromModule(module);
      this._cardTypes = this.cards.map((c) => getCardType(this, () => c));
    }
  }

  get types() {
    return this._cardTypes.map((t) => t.type);
  }
}

function cardsOrFieldsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): (typeof BaseDef)[] {
  return Object.values(module).filter(isCardOrField);
}

export function isCardOrField(cardOrField: any): cardOrField is typeof BaseDef {
  return typeof cardOrField === 'function' && 'baseDef' in cardOrField;
}

export function adoptionChainResource(
  parent: object,
  module: ImportResource | undefined,
) {
  return AdoptionChainResource.from(parent, () => ({
    named: {
      module,
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service',
        ) as LoaderService
      ).loader,
    },
  })) as AdoptionChainResource;
}
