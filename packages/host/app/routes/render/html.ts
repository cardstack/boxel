import Route from '@ember/routing/route';

import { isValidFormat } from '@cardstack/runtime-common';

import type {
  BoxComponent,
  CardDef,
  Format,
} from 'https://cardstack.com/base/card-api';

import { getClass, getTypes } from './meta';

import type { Model as ParentModel } from '../render';

export interface Model {
  instance: CardDef;
  format: Format;
  Component: BoxComponent;
}

export default class RenderRoute extends Route<Model> {
  async model({
    format,
    ancestor_level,
  }: {
    format: string;
    ancestor_level: string;
  }) {
    let instance = this.modelFor('render') as ParentModel;
    if (!isValidFormat(format)) {
      throw new Error('todo: invalid format');
    }
    let level = Number(ancestor_level);
    if (isNaN(level)) {
      throw new Error('not a valid ancestor_level');
    }
    let componentCodeRef = getTypes(getClass(instance))[level];
    if (!componentCodeRef) {
      throw new Error(`ancestor_level ${level} does not exist`);
    }

    let Component = instance.constructor.getComponent(instance, undefined, {
      componentCodeRef,
    });
    return { format, instance, Component };
  }
}
