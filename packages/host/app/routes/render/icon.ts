import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';

import { cardTypeIcon } from '@cardstack/runtime-common';

import type {
  CardOrFieldTypeIcon,
  CardDef,
} from 'https://cardstack.com/base/card-api';

import type { Model as ParentModel } from '../render';

export type Model = { Component: CardOrFieldTypeIcon } | undefined;

export default class RenderIconRoute extends Route<Model> {
  async model(_: unknown, transition: Transition) {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    await renderModel?.readyPromise;
    let instance: CardDef | undefined = renderModel?.instance;
    if (!instance) {
      // the lack of an instance is dealt with in the parent route — throwing
      // here would clobber the parent's error doc (e.g. "Link Not Found" 404)
      // with a generic 500 "Missing render instance"
      transition.abort();
      return;
    }
    let component = cardTypeIcon(instance);
    if (!component) {
      throw new Error(
        `static icon of ${instance.constructor.name} is undefined — check that the import resolves to a valid icon component`,
      );
    }
    return { Component: component };
  }
}
