import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

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

export default class RenderHtmlRoute extends Route<Model> {
  @service declare router: RouterService;

  async model(
    {
      format,
      ancestor_level,
    }: {
      format: string;
      ancestor_level: string;
    },
    transition: Transition,
  ): Promise<Model> {
    let parentModel = this.modelFor('render') as ParentModel;
    let instance: CardDef;
    if (!parentModel) {
      // this is to support in-browser rendering, where we actually don't have the
      // ability to lookup the parent route using RouterService.recognizeAndLoad()
      instance = (globalThis as any).__renderInstance;
    } else {
      instance = parentModel.instance;
    }
    if (!instance) {
      transition.abort();
      return Promise.reject();
    }

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
