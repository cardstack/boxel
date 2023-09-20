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
import { TrackedMap } from 'tracked-built-ins';

interface AdoptionChainManagerArgs {
  named: { importResource: ImportResource | undefined; loader: Loader };
}

type ElementInFile = CardInFile;

// There should be a more generic interface to this
interface CardInFile {
  cardType: CardType;
  card: typeof BaseDef;
}

// forwards the card type resource (doesn't care about the card type resource)
export class AdoptionChainManager extends Resource<AdoptionChainManagerArgs> {
  importResource: ImportResource | undefined;
  @tracked cards: (typeof BaseDef)[] = [];
  ready: Promise<void> | undefined;
  @tracked elementsInFile: ElementInFile[] = [];
  selections = new TrackedMap<ElementInFile, boolean>();

  modify(_positional: never[], named: AdoptionChainManagerArgs['named']) {
    this.importResource = named['importResource'];
    this.ready = this.load.perform();
  }

  get loading() {
    return this.load.isRunning;
  }

  isSelected(elementsInFile: CardInFile | undefined) {
    if (elementsInFile === undefined) {
      return false;
    }
    return this.selections.get(elementsInFile) || false;
  }

  get selectedElement() {
    for (let [el, selected] of this.selections.entries()) {
      if (selected) {
        return el;
      }
    }
    return undefined;
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
      this.selections.set(this.elementsInFile[0], true);
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
