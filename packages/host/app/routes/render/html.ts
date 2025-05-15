import Route from '@ember/routing/route';

import { isValidFormat } from '@cardstack/runtime-common';

import type {
  BoxComponent,
  CardDef,
  Format,
} from 'https://cardstack.com/base/card-api.gts';

import type { Model as ParentModel } from '../render';

export interface Model {
  instance: CardDef;
  format: Format;
  Component: BoxComponent;
}

export default class RenderRoute extends Route<Model> {
  async model({ format }: { format: string }) {
    let instance = this.modelFor('render') as ParentModel;
    if (!isValidFormat(format)) {
      throw new Error('todo: invalid format');
    }
    let Component = instance.constructor.getComponent(instance);
    return { format, instance, Component };
  }
}
