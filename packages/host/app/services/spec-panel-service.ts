import { registerDestructor } from '@ember/destroyable';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import window from 'ember-window-mock';

import { isCardInstance, isLocalId, localId } from '@cardstack/runtime-common';

import { SpecSelection } from '@cardstack/host/utils/local-storage-keys';

import type { CardDef, BaseDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

import type CardService from './card-service';
import type ResetService from './reset';
import type StoreService from './store';

export default class SpecPanelService extends Service {
  @tracked specSelection = window.localStorage.getItem(SpecSelection);
  @service declare private store: StoreService;
  @service declare private cardService: CardService;
  @service declare private reset: ResetService;
  private cachedAPI?: typeof CardAPI;
  private pendingCardIdSubscriptions = new Map<string, CardDef>();

  constructor(...args: ConstructorParameters<typeof Service>) {
    super(...args);
    this.reset.register(this);
    this.resetState();
    registerDestructor(this, () => {
      this.clearPendingCardIdSubscriptions();
    });
  }

  resetState() {
    this.clearPendingCardIdSubscriptions();
    this.specSelection = window.localStorage.getItem(SpecSelection);
  }

  setSelection = (id: string | null) => {
    this.specSelection = id;
    if (id && isLocalId(id)) {
      this.storeWhenIdAssignedTask.perform(id);
    } else {
      this.clearPendingCardIdSubscriptions();
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
      this.cachedAPI = api;
      if (this.pendingCardIdSubscriptions.has(localId)) {
        return;
      }
      this.pendingCardIdSubscriptions.set(localId, instance);
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
    this.pendingCardIdSubscriptions.delete(instance[localId]);
    let api = this.cachedAPI ?? (await this.cardService.getAPI());
    this.cachedAPI = api;
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
    this.clearPendingCardIdSubscriptions();
    this.specSelection = null;
    window.localStorage.removeItem(SpecSelection);
  }

  private clearPendingCardIdSubscriptions() {
    if (this.cachedAPI) {
      for (let instance of this.pendingCardIdSubscriptions.values()) {
        this.cachedAPI.unsubscribeFromChanges(instance, this.listenForCardId);
      }
    }
    this.pendingCardIdSubscriptions.clear();
  }
}
