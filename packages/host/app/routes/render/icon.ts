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
    let parentModel = this.modelFor('render') as ParentModel;
    let instance: CardDef;
    if (!parentModel) {
      // this is to support in-browser rendering, where we actually don't have the
      // ability to lookup the parent route using RouterService.recognizeAndLoad()
      instance = (globalThis as any).__renderInstance;
    } else {
      instance = parentModel.instance;
    }
    return { Component: cardTypeIcon(instance) };
  }
}
