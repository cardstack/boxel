import Route from '@ember/routing/route';

import { ComponentLike } from '@glint/template';

import { cardTypeIcon } from '@cardstack/runtime-common';

import type { Model as ParentModel } from '../render';

export interface Model {
  Component: ComponentLike;
}

export default class RenderRoute extends Route<Model> {
  async model() {
    let instance = this.modelFor('render') as ParentModel;
    return { Component: cardTypeIcon(instance) };
  }
}
