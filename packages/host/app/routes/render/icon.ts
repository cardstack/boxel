import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';

import { cardTypeIcon } from '@cardstack/runtime-common';

import type {
  CardDef,
  CardOrFieldTypeIcon,
} from 'https://cardstack.com/base/card-api';

import type { Model as ParentModel } from '../render';

export interface Model {
  instance: CardDef;
  Component: CardOrFieldTypeIcon;
}

export default class RenderIconRoute extends Route<Model> {
  beforeModel(transition: Transition) {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    if (!renderModel?.instance) {
      // The lack of an instance is dealt with in the parent route — throwing
      // (or proceeding into model() and throwing there) would clobber the
      // parent's error doc (e.g. "Link Not Found" 404) with a generic 500
      // "Missing render instance". See render/html.ts for why we don't await
      // renderModel?.readyPromise here.
      transition.abort();
    }
  }

  async model(): Promise<Model> {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    // beforeModel aborts the transition when there is no instance, so by the
    // time model() runs we know it's defined.
    let instance = renderModel!.instance!;
    let component = cardTypeIcon(instance);
    if (!component) {
      throw new Error(
        `static icon of ${instance.constructor.name} is undefined — check that the import resolves to a valid icon component`,
      );
    }
    return { instance, Component: component };
  }
}
