import { destroy } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import { PublishRealmActions } from '@cardstack/host/lib/publish-realm-actions';

import type SessionService from './session';
import type { SessionParticipant } from './session';

// One set of publish commands per workspace, kept for the session. Every
// place that opens a workspace's publish dialog (its dashboard tile, Get
// started, host mode) uses the same one, so a publish started from one shows
// its progress and errors in all of them, and closing or leaving the place
// that started it doesn't cancel it.
export default class RealmPublishingService
  extends Service
  implements SessionParticipant
{
  @service declare private session: SessionService;

  #actions = new Map<string, PublishRealmActions>();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  // Logging out cancels running publishes and drops their errors, so none
  // carries over to the next session.
  resetState() {
    for (let actions of this.#actions.values()) {
      destroy(actions);
    }
    this.#actions.clear();
  }

  actionsFor(realmURL: string): PublishRealmActions {
    let key = ensureTrailingSlash(realmURL);
    let actions = this.#actions.get(key);
    if (!actions) {
      actions = new PublishRealmActions(this, key);
      this.#actions.set(key, actions);
    }
    return actions;
  }
}

declare module '@ember/service' {
  interface Registry {
    'realm-publishing': RealmPublishingService;
  }
}
