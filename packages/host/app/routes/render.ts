import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api.gts';

import StoreService from '../services/store';

export type Model = CardDef;

export default class RenderRoute extends Route<Model> {
  @service declare store: StoreService;
  @service declare router: RouterService;

  async model({ id }: { id: string }) {
    (globalThis as any).boxelTransitionTo = (
      ...args: Parameters<RouterService['transitionTo']>
    ) => {
      this.router.transitionTo(...args);
    };
    let instance = await this.store.get(id);
    if (!isCardInstance(instance)) {
      throw new Error('todo: failed to load');
    }
    return instance;
  }
}
