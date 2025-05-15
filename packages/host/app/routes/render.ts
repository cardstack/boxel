import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api.gts';

import LoaderService from '../services/loader-service';
import StoreService from '../services/store';

export type Model = CardDef;

export default class RenderRoute extends Route<Model> {
  @service declare store: StoreService;
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;

  async model({ id }: { id: string }) {
    // Make it easy for Puppeteer to do regular Ember transitions
    (globalThis as any).boxelTransitionTo = (
      ...args: Parameters<RouterService['transitionTo']>
    ) => {
      this.router.transitionTo(...args);
    };

    // Opt in to reading the in-progress index, as opposed to the last completed index.
    this.loaderService.setIsIndexing(true);

    let instance = await this.store.get(id);
    if (!isCardInstance(instance)) {
      throw new Error('todo: failed to load');
    }
    return instance;
  }
}
