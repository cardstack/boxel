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
import { action } from '@ember/object';

interface AdoptionChainManagerArgs {
  named: { importResource: ImportResource | undefined; loader: Loader };
}

export type ElementInFile = CardInFile; // can add more types here

interface CardInFile {
  cardType: CardType;
  card: typeof BaseDef;
}

// forwards the card type resource (doesn't care about the card type resource)
export class AdoptionChainManager extends Resource<AdoptionChainManagerArgs> {
  importResource: ImportResource | undefined;
  ready: Promise<void> | undefined;
  @tracked elementsInFile: ElementInFile[] = [];
  @tracked selected: ElementInFile | undefined;

  modify(_positional: never[], named: AdoptionChainManagerArgs['named']) {
    this.importResource = named['importResource'];
    this.ready = this.load.perform();
  }

  get isLoading() {
    return this.load.isRunning;
  }

  get selectedElement() {
    return this.selected;
  }

  get selectedCardType() {
    return this.selected?.cardType;
  }

  isSelected(el: ElementInFile) {
    return el == this.selected;
  }

  @action
  select(el: ElementInFile) {
    this.selected = el;
  }

  private load = restartableTask(async () => {
    await this.importResource?.loaded;
    let module = this.importResource?.module;
    if (module === undefined) {
      throw new Error('module is undefined');
    }
    let cards = cardsOrFieldsFromModule(module);
    cards.map((card) => {
      this.elementsInFile.push({
        cardType: getCardType(this, () => card),
        card: card,
      });
    });
    if (this.elementsInFile.length > 0) {
      this.selected = this.elementsInFile[0];
    }
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
