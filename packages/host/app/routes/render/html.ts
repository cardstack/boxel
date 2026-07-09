import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import {
  internalKeyFor,
  isRealmIndexCardId,
  isValidFormat,
  realmURL,
  type CodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';

import { getClass, getTypes } from './meta';

import type { Model as ParentModel } from '../render';
import type { BoxComponent, CardDef, Format } from '@cardstack/base/card-api';

// Stable internal key for the base CardsGrid type. We compare against
// the internalKeyFor representation of the cards-grid module + name so
// the check tolerates whatever resolved form the host's identify path
// produces (e.g. realm-aliased base URLs).
const CARDS_GRID_REF = {
  module: '@cardstack/base/cards-grid',
  name: 'CardsGrid',
} as ResolvedCodeRef;

export interface Model {
  instance: CardDef;
  format: Format;
  Component: BoxComponent;
  // True when this render should be short-circuited to the realm-
  // index boilerplate placeholder instead of running through Glimmer.
  // Set only when `format === 'isolated'`, the card is the realm's
  // default index, the type chain is base CardsGrid, and the realm
  // has not opted in via `includePrerenderedDefaultRealmIndex` on its
  // RealmConfig card. The orchestrator in `card-prerender.gts`
  // honours this flag by substituting the boilerplate string and
  // skipping the actual Glimmer render.
  useRealmIndexBoilerplate?: boolean;
}

export default class RenderHtmlRoute extends Route<Model> {
  @service declare network: NetworkService;
  @service declare router: RouterService;
  @service declare realm: RealmService;

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
      // "Missing render instance".
      // We deliberately do NOT await renderModel?.readyPromise: the in-browser
      // prerender path (card-prerender.gts) runs recognizeAndLoad →
      // renderCardComponent → waitForLinkedData → #ensureRenderReady in that
      // order, and readyPromise is what #ensureRenderReady awaits AFTER the
      // manual render triggers lazy link fetches. Awaiting it here would let
      // the RAF watchdog settle readyPromise before the render pass, dropping
      // runtime deps from captured metadata.
      transition.abort();
    }
  }

  async model({
    format,
    ancestor_level,
  }: {
    format: string;
    ancestor_level: string;
  }): Promise<Model> {
    let parentModel = this.modelFor('render') as ParentModel | undefined;
    let renderModel =
      parentModel ??
      ((globalThis as any).__renderModel as ParentModel | undefined);
    // beforeModel aborts the transition when there is no instance, so by the
    // time model() runs we know it's defined.
    let instance = renderModel!.instance!;

    if (!isValidFormat(format)) {
      throw new Error('todo: invalid format');
    }
    let level = Number(ancestor_level);
    if (isNaN(level)) {
      throw new Error('not a valid ancestor_level');
    }
    let types = getTypes(getClass(instance));
    let componentCodeRef = types[level];
    if (!componentCodeRef) {
      throw new Error(`ancestor_level ${level} does not exist`);
    }

    let Component = instance.constructor.getComponent(instance, undefined, {
      componentCodeRef,
    });

    let useRealmIndexBoilerplate =
      format === 'isolated' &&
      level === 0 &&
      this.#isDefaultRealmCardsGridIndex(instance, types);

    return { format, instance, Component, useRealmIndexBoilerplate };
  }

  // True when the card under render is the realm's default index card
  // AND its type chain begins with the base CardsGrid AND the realm
  // has NOT opted in to keeping its prerendered isolated HTML via
  // `RealmInfo.includePrerenderedDefaultRealmIndex`. The orchestrator
  // substitutes a boilerplate placeholder for the captured HTML in
  // that case so the indexer doesn't pay for the (expensive) grid
  // fan-out render of every card in the realm. Published realms
  // receive the opt-in automatically from the publish handler.
  #isDefaultRealmCardsGridIndex(instance: CardDef, types: CodeRef[]): boolean {
    let cardRealmURL = instance[realmURL];
    if (
      !cardRealmURL ||
      !isRealmIndexCardId(
        instance.id,
        cardRealmURL,
        this.network.virtualNetwork,
      )
    ) {
      return false;
    }
    let topType = types[0];
    if (!topType) {
      return false;
    }
    let vn = this.network.virtualNetwork;
    let topKey = internalKeyFor(topType, undefined, vn);
    let cardsGridKey = internalKeyFor(CARDS_GRID_REF, undefined, vn);
    if (topKey !== cardsGridKey) {
      return false;
    }
    let info = this.realm.info(cardRealmURL.href);
    return info?.includePrerenderedDefaultRealmIndex !== true;
  }
}
