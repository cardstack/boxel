import { ImportResource } from './import';
import { Resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { Loader } from '@cardstack/runtime-common/loader';
import { getOwner } from '@ember/application';
import { type BaseDef } from 'https://cardstack.com/base/card-api';
import type LoaderService from '../services/loader-service';
import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';
import { restartableTask } from 'ember-concurrency';

interface AdoptionChainManagerArgs {
  named: { importResource: ImportResource | undefined; loader: Loader };
}

// forwards the card type resource (doesn't care about the card type resource)
export class AdoptionChainManager extends Resource<AdoptionChainManagerArgs> {
  importResource: ImportResource | undefined;
  @tracked cards: (typeof BaseDef)[] = [];
  @tracked _cardTypes: CardType[] = []; // all cards exported in module
  ready: Promise<void> | undefined;

  modify(_positional: never[], named: AdoptionChainManagerArgs['named']) {
    this.importResource = named['importResource'];
    this.ready = this.load.perform();
  }

  get loading() {
    return this.load.isRunning;
  }

  get cardTypes() {
    return this._cardTypes;
  }

  get types() {
    return this._cardTypes.map((t) => t.type);
  }

  get defaultType() {
    return this.types[0];
  }

  get loadingAllChains() {
    return this._cardTypes.some((t) => t.loading);
  }

  private load = restartableTask(async () => {
    await this.importResource?.loaded;
    let module = this.importResource?.module;
    if (module === undefined) {
      throw new Error('module is undefined');
    }
    this.cards = cardsOrFieldsFromModule(module);
    this._cardTypes = this.cards.map((c) => getCardType(this, () => c));
  });
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

export function adoptionChainManager(
  parent: object,
  importResource: ImportResource | undefined,
) {
  return AdoptionChainManager.from(parent, () => ({
    named: {
      importResource,
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service',
        ) as LoaderService
      ).loader,
    },
  })) as AdoptionChainManager;
}
