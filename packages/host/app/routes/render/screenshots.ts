import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import type { DeclaredScreenshotRoster } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';

import { getClass } from './meta';

import type { Model as ParentModel } from '../render';
import type { CardDef } from '@cardstack/base/card-api';

export type Model = { roster: DeclaredScreenshotRoster } | undefined;

// Lightweight sibling of render.types: returns the card's merged
// `static screenshots` declarations in serialized form so the capture
// engine knows what to capture (and how) without materializing any
// component. An invalid declaration throws here — the engine treats
// that as every slot failing, which is the declaration reader's
// fail-loud posture surfacing at the capture boundary.
export default class RenderScreenshotsRoute extends Route<Model> {
  @service declare private cardService: CardService;

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

    let api = await this.cardService.getAPI();
    // A stale base/card-api build loaded during a deploy overlap may predate
    // this export; no roster then means no declared captures, not an error.
    if (typeof api.serializeDeclaredScreenshots !== 'function') {
      return { roster: {} };
    }
    let Klass = getClass(instance);
    return {
      roster: api.serializeDeclaredScreenshots(
        Klass as typeof CardDef,
      ) as DeclaredScreenshotRoster,
    };
  }
}
