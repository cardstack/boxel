import Route from '@ember/routing/route';

import { cardTypeIcon } from '@cardstack/runtime-common';

import type { CardOrFieldTypeIcon } from 'https://cardstack.com/base/card-api';

import type { Model as ParentModel } from '../render';

export interface Model {
  Component: CardOrFieldTypeIcon;
}

export default class RenderRoute extends Route<Model> {
  async model() {
    let instance = this.modelFor('render') as ParentModel;
    return { Component: cardTypeIcon(instance) };
  }
}
