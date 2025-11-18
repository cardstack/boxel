import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import window from 'ember-window-mock';

import { isCardInstance, isLocalId } from '@cardstack/runtime-common';

import { SpecSelection } from '@cardstack/host/utils/local-storage-keys';

import type { CardDef, BaseDef } from 'https://cardstack.com/base/card-api';

import type CardService from './card-service';
import type StoreService from './store';

export default class SpecPanelService extends Service {
  @tracked specSelection = window.localStorage.getItem(SpecSelection);
  @service declare private store: StoreService;
  @service declare private cardService: CardService;

  setSelection = (id: string | null) => {
    this.specSelection = id;
    if (id && isLocalId(id)) {
      this.storeWhenIdAssignedTask.perform(id);
    } else {
      this.persistSelection(id);
    }
  };

  private storeWhenIdAssignedTask = task(async (localId: string) => {
    let instance = this.store.peek(localId);
    if (!isCardInstance(instance)) {
      return;
    }
    if (instance.id) {
      this.persistSelection(instance.id);
    } else {
      let api = await this.cardService.getAPI();
      api.subscribeToChanges(instance, this.listenForCardId);
    }
  });

  private listenForCardId = (instance: BaseDef, field: string) => {
    if (field === 'id' && isCardInstance(instance) && instance.id) {
      this.promoteToRemoteIdTask.perform(instance);
    }
  };

  private promoteToRemoteIdTask = task(async (instance: CardDef) => {
    this.persistSelection(instance.id);
    let api = await this.cardService.getAPI();
    api.unsubscribeFromChanges(instance, this.listenForCardId);
  });

  private persistSelection(id: string | null) {
    if (id == null) {
      window.localStorage.removeItem(SpecSelection);
    } else {
      window.localStorage.setItem(SpecSelection, id);
    }
  }

  resetSelection() {
    this.specSelection = null;
    window.localStorage.removeItem(SpecSelection);
  }
}
