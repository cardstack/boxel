import Route from '@ember/routing/route';

import { cardTypeIcon } from '@cardstack/runtime-common';

import type {
  CardOrFieldTypeIcon,
  CardDef,
} from 'https://cardstack.com/base/card-api';

import type { Model as ParentModel } from '../render';

export interface Model {
  Component: CardOrFieldTypeIcon;
}

export default class RenderIconRoute extends Route<Model> {
  async model() {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    let instance: CardDef | undefined = renderModel?.instance;
    if (!instance) {
      throw new Error('Missing render instance');
    }
    return { Component: cardTypeIcon(instance) };
  }
}
