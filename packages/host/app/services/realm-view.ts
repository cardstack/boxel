import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type { ExactRealmView } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import {
  RealmViewController,
  type RealmViewControllerOptions,
} from '@cardstack/host/lib/realm-view-controller';

import type LoaderService from './loader-service';
import type NetworkService from './network';
import type SessionService from './session';
import type StoreService from './store';

export default class RealmViewService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private session: SessionService;
  @service declare private store: StoreService;

  @tracked selected: ExactRealmView | undefined;
  private controller: RealmViewController;

  constructor(owner: Owner) {
    super(owner);
    let options: RealmViewControllerOptions = {
      enabled: config.featureFlags?.DECK_COLLABORATION === true,
      fetch: (request) => this.network.authedFetch(request),
      rebuildHostGraph: async (reason) => {
        this.loaderService.resetLoader({ clearFetchCache: true, reason });
        await this.store.refreshReferencesForRealmViewChange(reason);
      },
    };
    this.controller = new RealmViewController(options);
    this.session.register(this);
  }

  async selectBranch(
    realmURL: string | URL,
    branch: string,
  ): Promise<ExactRealmView> {
    let selected = await this.controller.selectBranch(realmURL, branch);
    this.selected = selected;
    return selected;
  }

  async selectLive(): Promise<void> {
    await this.controller.selectLive();
    this.selected = undefined;
  }

  resetState(): void {
    this.controller.invalidate();
    this.selected = undefined;
  }
}

declare module '@ember/service' {
  interface Registry {
    'realm-view': RealmViewService;
  }
}
