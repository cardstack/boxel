import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import {
  internalKeyFor,
  type PrerenderTypes,
  type RenderError,
} from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { getClass, getTypes } from './meta';

import type { Model as ParentModel } from '../render';

export type Model = PrerenderTypes | RenderError | undefined;

// Lightweight sibling of render.meta. The runner needs the ancestor
// type chain to drive the fitted/embedded format renders, but those
// renders are also what mark linksTo / linksToMany fields as "used"
// so the final render.meta's search doc walks them. Running a full
// serializeCard + searchDoc here just to read the type list paid for
// a duplicate traversal — this route returns only the type chain so
// the heavy work happens exactly once, after the format renders.
export default class RenderTypesRoute extends Route<Model> {
  @service declare network: NetworkService;

  async model(_: unknown, transition: Transition) {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we
    // actually don't have the ability to lookup the parent route using
    // RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    await renderModel?.readyPromise;
    let instance: CardDef | undefined = renderModel?.instance;

    if (!instance) {
      // the lack of an instance is dealt with in the parent route
      transition.abort();
      return;
    }

    let Klass = getClass(instance);
    let vn = this.network.virtualNetwork;
    let types = getTypes(Klass).map((t) => internalKeyFor(t, undefined, vn));

    return { types };
  }
}
