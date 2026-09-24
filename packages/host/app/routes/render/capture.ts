import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { CAPTURE_DEFAULT_BACKGROUND } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';

import { getClass } from './meta';

import type { Model as ParentModel } from '../render';
import type { BoxComponent, CardDef } from '@cardstack/base/card-api';

export interface Model {
  instance: CardDef;
  name: string;
  // A pdf entry renders the full document flow with no capture box; a raster
  // entry sizes to a declared width×height. The two are mutually exclusive.
  isPdf: boolean;
  width?: number;
  height?: number;
  background: string;
  Component: BoxComponent;
}

// Renders one declared capture's capture-only component (the `render`
// slot of a `static captures` entry). A raster entry renders into a
// fixed-size box the capture engine sizes its viewport to; a pdf entry
// renders the full document flow (no box) that `page.pdf()` paginates under
// print media. Format-based entries never come here — they re-render their
// display format through render.html; this route exists because a
// capture-only component has no format slot for that route to look up.
export default class RenderCaptureRoute extends Route<Model> {
  @service declare private cardService: CardService;

  async beforeModel(transition: Transition) {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    // the global use below is to support in-browser rendering, where we
    // actually don't have the ability to lookup the parent route using
    // RouterService.recognizeAndLoad()
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    // Like the sibling render routes, wait for the parent model to settle
    // before judging `instance` — a navigation that lands before settle
    // should wait, not abort.
    await renderModel?.readyPromise;
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
    let spec = api.getCaptures(Klass)[name];
    if (!spec) {
      throw new Error(
        `card declares no capture named "${name}" — nothing to render`,
      );
    }
    if (!spec.render) {
      throw new Error(
        `declared capture "${name}" reuses format "${spec.format}" — it renders through render.html, not this route`,
      );
    }

    // A raster slot renders into a fixed-size capture box; a pdf slot has no
    // box — it paginates the full print-media render onto the card's own
    // `@page` paper. A raster slot missing its box would reach the template as
    // `width: undefinedpx` and capture a collapsed box rather than failing, so
    // refuse that; a pdf slot is expected to be box-less.
    if (spec.type !== 'pdf' && (spec.width == null || spec.height == null)) {
      throw new Error(`declared capture "${name}" declares no capture box`);
    }

    let Component = instance.constructor.getComponent(instance, undefined, {
      componentOverride: spec.render,
    });

    return {
      instance,
      name,
      isPdf: spec.type === 'pdf',
      width: spec.width,
      height: spec.height,
      background: spec.background ?? CAPTURE_DEFAULT_BACKGROUND,
      Component,
    };
  }
}
