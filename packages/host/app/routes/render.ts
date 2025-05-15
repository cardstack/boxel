import Route from '@ember/routing/route';
import { service } from '@ember/service';

import { isCardInstance, isValidFormat } from '@cardstack/runtime-common';

import type {
  BoxComponent,
  CardDef,
  Format,
} from 'https://cardstack.com/base/card-api.gts';

import StoreService from '../services/store';

export interface Model {
  instance: CardDef;
  format: Format;
  Component: BoxComponent;
}

export default class RenderRoute extends Route<Model> {
  @service declare store: StoreService;

  async model({ id, format }: { id: string; format: string }) {
    let instance = await this.store.get(id);
    if (!isCardInstance(instance)) {
      throw new Error('todo: failed to load');
    }
    if (!isValidFormat(format)) {
      throw new Error('todo: invalid format');
    }
    let Component = instance.constructor.getComponent(instance);
    return { format, instance, Component };
  }
}
