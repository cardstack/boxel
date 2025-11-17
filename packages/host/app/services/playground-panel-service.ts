import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import window from 'ember-window-mock';
import { TrackedObject } from 'tracked-built-ins';

import { isCardInstance, localId, isLocalId } from '@cardstack/runtime-common';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type {
  CardDef,
  BaseDef,
  Format,
} from 'https://cardstack.com/base/card-api';

import type CardService from './card-service';
import type OperatorModeStateService from './operator-mode-state-service';

import type StoreService from './store';

export interface PlaygroundSelection {
  cardId: string; // for fields, this is their corresponding spec card's id, since fields do not have a card id
  format: Format; // default is 'isolated' for cards, 'embedded' for fields
  fieldIndex?: number;
  /* fieldIndex `undefined` means we are previewing a card instances. fields MUST have a corresponding index
      based on their position on their spec's containedExamples field. otherwise, it means that we are previewing
      a spec instance on playground instead of the field. */
  url?: string;
}

export default class PlaygroundPanelService extends Service {
  @service declare private cardService: CardService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  playgroundSelections: Record<string, PlaygroundSelection>; // TrackedObject<moduleId, PlaygroundSelection>
  private selectionsForNewInstances = new Map<
    string,
    {
      moduleId: string;
      format: Format;
      fieldIndex: number | undefined;
      url?: string;
    }
  >();
  private storageSnapshot: string | null = null;
  constructor(owner: Owner) {
    super(owner);
    let selections = window.localStorage.getItem(PlaygroundSelections);

    this.storageSnapshot = selections;
    this.playgroundSelections = new TrackedObject(
      selections?.length ? JSON.parse(selections) : {},
    );
  }

  persistSelections = (
    moduleId: string,
    cardId: string,
    format: Format,
    fieldIndex: number | undefined,
  ) => {
    this.syncSelectionsWithStorage();
    let url = this.operatorModeStateService.codePathString;

    this.playgroundSelections[moduleId] = {
      cardId,
      format,
      fieldIndex,
      url,
    };
    if (isLocalId(cardId)) {
      this.storeWhenIdAssignedTask.perform(
        moduleId,
        cardId,
        format,
        fieldIndex,
      );
    } else {
      this.setStorage();
    }
  };

  private get resolvedSelections(): Record<string, PlaygroundSelection> {
    return Object.fromEntries(
      Object.entries(this.playgroundSelections).flatMap(([id, selections]) => {
        if (!isLocalId(id)) {
          return [[id, selections]];
        }
        let instance = this.store.peek(id);
        if (isCardInstance(instance) && instance.id) {
          return [[instance.id, selections]];
        }
        return [];
      }),
    );
  }

  private storeWhenIdAssignedTask = task(
    async (
      moduleId: string,
      instanceId: string,
      format: Format,
      fieldIndex: number | undefined,
    ) => {
      let instance = this.store.peek(instanceId);
      if (!isCardInstance(instance)) {
        return;
      }
      if (instance.id) {
        this.persistSelections(moduleId, instance.id, format, fieldIndex);
      } else {
        let api = await this.cardService.getAPI();
        this.selectionsForNewInstances.set(instance[localId], {
          moduleId,
          format,
          fieldIndex,
          url: this.operatorModeStateService.codePathString,
        });
        api.subscribeToChanges(instance, this.listenForCardId);
      }
    },
  );

  private listenForCardId = (instance: BaseDef, field: string) => {
    if (field === 'id' && isCardInstance(instance) && instance.id) {
      this.promoteToRemoteIdTask.perform(instance);
    }
  };

  private promoteToRemoteIdTask = task(async (instance: CardDef) => {
    let selections = this.selectionsForNewInstances.get(instance[localId]);
    if (selections) {
      this.selectionsForNewInstances.delete(instance[localId]);
      schedule('afterRender', () => this.setStorage());
    }
    let api = await this.cardService.getAPI();
    api.unsubscribeFromChanges(instance, this.listenForCardId);
  });

  setStorage = () => {
    let serialized = JSON.stringify(this.resolvedSelections);
    window.localStorage.setItem(PlaygroundSelections, serialized);
    this.storageSnapshot = serialized;
  };

  resetSelections = () => {
    this.playgroundSelections = new TrackedObject({});
    this.selectionsForNewInstances.clear();
    window.localStorage.removeItem(PlaygroundSelections);
    this.storageSnapshot = null;
  };

  getSelection = (moduleId: string) => {
    this.syncSelectionsWithStorage();
    return this.playgroundSelections[moduleId];
  };

  removeSelectionsByCardId = (cardId: string) => {
    this.syncSelectionsWithStorage();
    let foundItems = Object.entries(this.playgroundSelections).filter(
      ([_key, val]) => this.store.isSameId(val.cardId, cardId),
    );
    if (foundItems.length) {
      foundItems.map((item) => delete this.playgroundSelections[item[0]]);
      this.setStorage();
    }
  };

  // this is a way to check local storage without using `this.playgroundSelections` tracked object (which may throw revalidation bugs if `persistSelections` is called afterwards)
  // this is only used for looking up a selection. Changes made to this will NOT be tracked!
  peekSelection(moduleId: string): PlaygroundSelection | undefined {
    let selections = window.localStorage.getItem(PlaygroundSelections);
    if (!selections?.length) {
      return;
    }
    return JSON.parse(selections)?.[moduleId];
  }

  private syncSelectionsWithStorage() {
    let latest = window.localStorage.getItem(PlaygroundSelections);
    if (latest === this.storageSnapshot) {
      return;
    }
    this.storageSnapshot = latest;
    this.playgroundSelections = new TrackedObject(
      latest?.length ? JSON.parse(latest) : {},
    );
  }
}

declare module '@ember/service' {
  interface Registry {
    'playground-panel-service': PlaygroundPanelService;
  }
}
