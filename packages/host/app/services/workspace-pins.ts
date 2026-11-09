import Service, { service } from '@ember/service';

import {
  isRealmIndexCardId,
  rri,
  trimJsonExtension,
} from '@cardstack/runtime-common';

import { WorkspacePins } from '../components/operator-mode/dashboard/workspace-pins';

import type NetworkService from './network';
import type RealmService from './realm';

// Each workspace's pins, read once per realm and kept current, so a card's
// menu can say right away whether the card is pinned.
export default class WorkspacePinsService extends Service {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  #pinsByRealm = new Map<string, WorkspacePins>();

  // What a card's menu offers: undefined while the card's workspace pins
  // load, and whenever the user can't pin it — they can't write to its
  // realm, the realm's index card isn't a Workspace, or it is the index card.
  pinStateFor(cardId: string): { pinned: boolean } | undefined {
    let realmURL = this.realm.realmURLOf(cardId);
    if (!realmURL || !this.realm.canWrite(realmURL)) {
      return undefined;
    }
    let id = rri(trimJsonExtension(cardId));
    if (
      isRealmIndexCardId(id, new URL(realmURL), this.network.virtualNetwork)
    ) {
      return undefined;
    }
    let pins = this.pinsFor(realmURL);
    if (!pins.isWorkspace) {
      return undefined;
    }
    return { pinned: pins.cardIds.includes(id) };
  }

  private pinsFor(realmURL: string): WorkspacePins {
    let pins = this.#pinsByRealm.get(realmURL);
    if (!pins) {
      let realm = this.realm.realmOf(new URL(realmURL)) ?? realmURL;
      pins = new WorkspacePins(this, () => ({ realm, realmURL }));
      this.#pinsByRealm.set(realmURL, pins);
    }
    return pins;
  }
}

declare module '@ember/service' {
  interface Registry {
    'workspace-pins': WorkspacePinsService;
  }
}
