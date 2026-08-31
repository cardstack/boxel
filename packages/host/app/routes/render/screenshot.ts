import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { SCREENSHOT_DEFAULT_BACKGROUND } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';

import { getClass } from './meta';

import type { Model as ParentModel } from '../render';
import type { BoxComponent, CardDef } from '@cardstack/base/card-api';

export interface Model {
  instance: CardDef;
  name: string;
  width: number;
  height: number;
  background: string;
  Component: BoxComponent;
}

// Renders one declared screenshot's capture-only component (the `render`
// slot of a `static screenshots` entry) into a fixed-size box for the
// capture engine. Format-based entries never come here — they re-render
// their display format through render.html; this route exists because a
// capture-only component has no format slot for that route to look up.
export default class RenderScreenshotRoute extends Route<Model> {
  @service declare private cardService: CardService;

  beforeModel(transition: Transition) {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we
    // actually don't have the ability to lookup the parent route using
    // RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    if (!renderModel?.instance) {
      // the lack of an instance is dealt with in the parent route
      transition.abort();
    }
  }

  async model({ name }: { name: string }): Promise<Model> {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    // beforeModel aborts the transition when there is no instance, so by the
    // time model() runs we know it's defined.
    let instance = renderModel!.instance!;

    let api = await this.cardService.getAPI();
    let Klass = getClass(instance) as typeof CardDef;
    let spec = api.getScreenshots(Klass)[name];
    if (!spec) {
      throw new Error(
        `card declares no screenshot named "${name}" — nothing to render`,
      );
    }
    if (!spec.render) {
      throw new Error(
        `declared screenshot "${name}" reuses format "${spec.format}" — it renders through render.html, not this route`,
      );
    }

    let Component = instance.constructor.getComponent(instance, undefined, {
      componentOverride: spec.render,
    });

    return {
      instance,
      name,
      width: spec.width,
      height: spec.height,
      background: spec.background ?? SCREENSHOT_DEFAULT_BACKGROUND,
      Component,
    };
  }
}
