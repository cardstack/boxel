import { associateDestroyableChild, destroy } from '@ember/destroyable';
import { getOwner, setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  isRealmIndexCardId,
  ri,
  rri,
  trimJsonExtension,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import { WorkspacePins } from '../components/operator-mode/dashboard/workspace-pins';

import type NetworkService from './network';
import type RealmService from './realm';
import type SessionService from './session';

// A failed pin search is tried again on a later lookup, but no sooner than
// this, so a realm that is down isn't searched on every render.
const RETRY_FAILED_SEARCH_MS = 30_000;

// Each workspace's pins, read once per realm and kept current, so a card's
// menu can say right away whether the card is pinned.
export default class WorkspacePinsService extends Service {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private session: SessionService;

  // Each realm's reader has its own owner, so logging out, or searching
  // again after a failure, can end its search and realm subscription.
  #pinsByRealm = new Map<
    string,
    { owner: object; pins: WorkspacePins; failedAt?: number }
  >();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    for (let { owner } of this.#pinsByRealm.values()) {
      destroy(owner);
    }
    this.#pinsByRealm.clear();
  }

  // What a card's menu offers: undefined while the card's workspace pins
  // load, and whenever the user can't pin it — they can't write to its
  // realm, the realm's index card isn't a Workspace, or it is the index card.
  pinStateFor(
    cardId: RealmResourceIdentifier,
  ): { pinned: boolean } | undefined {
    let realmKey = this.realm.realmURLOf(cardId);
    if (!realmKey || !this.realm.canWrite(realmKey)) {
      return undefined;
    }
    let id = rri(trimJsonExtension(cardId));
    if (isRealmIndexCardId(id, ri(realmKey), this.network.virtualNetwork)) {
      return undefined;
    }
    let pins = this.pinsFor(realmKey);
    if (!pins.isWorkspace) {
      return undefined;
    }
    // A pin may name its card by URL or by registered prefix, so both sides
    // are compared by the URL they name.
    let target = this.urlOf(id);
    return {
      pinned: pins.cardIds.some((pinId) => this.urlOf(pinId) === target),
    };
  }

  private urlOf(id: RealmResourceIdentifier): string {
    return trimJsonExtension(this.network.virtualNetwork.keyForIdentifier(id));
  }

  private pinsFor(realmKey: string): WorkspacePins {
    let entry = this.#pinsByRealm.get(realmKey);
    if (entry?.pins.failed) {
      entry.failedAt ??= Date.now();
      if (Date.now() - entry.failedAt >= RETRY_FAILED_SEARCH_MS) {
        destroy(entry.owner);
        entry = undefined;
      }
    }
    if (!entry) {
      let realm = ri(realmKey);
      let realmURL = this.network.virtualNetwork.toURL(realm).href;
      // The search looks its services up through its parent's owner.
      let owner = associateDestroyableChild(this, {});
      setOwner(owner, getOwner(this)!);
      entry = {
        owner,
        pins: new WorkspacePins(owner, () => ({ realm, realmURL })),
      };
      this.#pinsByRealm.set(realmKey, entry);
    }
    return entry.pins;
  }
}

declare module '@ember/service' {
  interface Registry {
    'workspace-pins': WorkspacePinsService;
  }
}
