import Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import window from 'ember-window-mock';
import { TrackedObject } from 'tracked-built-ins';

import { isCardInstance, localId, isLocalId } from '@cardstack/runtime-common';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import {
  type CardDef,
  type BaseDef,
  type Format,
} from 'https://cardstack.com/base/card-api';

import type CardService from './card-service';
import type StoreService from './store';

export interface PlaygroundSelection {
  cardId: string;
  format: Format;
  fieldIndex?: number;
}

export default class PlaygroundPanelService extends Service {
  @service declare private cardService: CardService;
  @service declare private store: StoreService;
  private playgroundSelections: Record<string, PlaygroundSelection>; // TrackedObject<moduleId, PlaygroundSelection>
  private selectionsForNewInstances = new Map<
    string,
    {
      moduleId: string;
      format: Format;
      fieldIndex: number | undefined;
    }
  >();
  constructor(owner: Owner) {
    super(owner);
    let selections = window.localStorage.getItem(PlaygroundSelections);

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
    this.playgroundSelections[moduleId] = { cardId, format, fieldIndex };
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
      let { moduleId, format, fieldIndex } = selections;
      this.selectionsForNewInstances.delete(instance[localId]);
      schedule('afterRender', () =>
        this.persistSelections(moduleId, instance.id, format, fieldIndex),
      );
    }
    let api = await this.cardService.getAPI();
    api.unsubscribeFromChanges(instance, this.listenForCardId);
  });

  setStorage = () => {
    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify(this.playgroundSelections),
    );
  };

  getSelection = (moduleId: string) => {
    return this.playgroundSelections[moduleId];
  };

  removeSelectionsByCardId = (cardId: string) => {
    let foundItems = Object.entries(this.playgroundSelections).filter(
      ([_key, val]) => val.cardId === cardId,
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
}
