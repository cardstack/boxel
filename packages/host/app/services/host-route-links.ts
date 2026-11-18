import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import {
  hostRouteLink,
  isCardInstance,
  logger,
  registerHostRouteLinks,
  runtimeNonQueryDependencyContext,
  type CardAPIForMatching,
  type HostRouteAddressTarget,
  type HostRouteLinkRoutes,
  type HostRouteLinks,
  type UnresolvedHostRouteLink,
} from '@cardstack/runtime-common';

import type HostModeService from './host-mode-service';
import type NetworkService from './network';
import type SessionService from './session';
import type StoreService from './store';
import type { BaseDef, CardDef } from '@cardstack/base/card-api';

const log = logger('host-route-links');

// Gives the links in card templates their URLs: what the `hrefTo` helper of
// the base realm calls. The helper is card code with no service to inject,
// so this service registers itself on the global the runtime declares
// (`getHostRouteLinks`).
//
// The routes are those of the realm the render is for. On a page served on a
// host URL they are the ones the realm server put in the page's config.
export default class HostRouteLinksService
  extends Service
  implements HostRouteLinks
{
  @service declare private hostModeService: HostModeService;
  @service declare private network: NetworkService;
  @service declare private session: SessionService;
  @service declare private store: StoreService;

  // The cards a link asked the store for, by the id the link gave. `null`
  // for a card that could not be loaded, which is not asked for again. The
  // map is written only when a load settles, never during a render.
  private askedCards = new TrackedMap<string, CardDef | null>();
  private cardLoads = new Map<string, Promise<void>>();

  // The page config's routes as the lookup takes them, kept so that the
  // realm URL is parsed once.
  private pageRoutes:
    | { config: unknown; routes: HostRouteLinkRoutes | undefined }
    | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    registerDestructor(this, registerHostRouteLinks(this));
  }

  resetState() {
    this.askedCards.clear();
    this.cardLoads.clear();
    this.pageRoutes = undefined;
  }

  link(
    target: HostRouteAddressTarget,
    api: Omit<CardAPIForMatching, 'virtualNetwork'>,
  ): string | undefined {
    return hostRouteLink(target, {
      routes: this.routes(),
      api: { ...api, virtualNetwork: this.network.virtualNetwork },
      loadedCard: this.loadedCard,
      unresolved: this.reportUnresolved,
    });
  }

  // The routes of the realm this render is for, or `undefined` when there
  // are none to read.
  routes(): HostRouteLinkRoutes | undefined {
    return this.routesFromPageConfig();
  }

  private routesFromPageConfig(): HostRouteLinkRoutes | undefined {
    let config = this.hostModeService.hostDynamicRoutes;
    let pageRoutes = this.pageRoutes;
    if (!pageRoutes || pageRoutes.config !== config) {
      pageRoutes = this.pageRoutes = {
        config,
        routes: config
          ? { realmURL: new URL(config.realmURL), routes: config.routes }
          : undefined,
      };
    }
    return pageRoutes.routes;
  }

  // The loaded card for an id a link gave. A card the store doesn't hold is
  // asked for through the store, which makes the HTML visit wait for it and
  // records it as a dependency of the render. The link reads this again when
  // the card arrives.
  private loadedCard = (id: string): BaseDef | undefined => {
    let held = this.store.peek(id);
    if (isCardInstance(held)) {
      return held;
    }
    let asked = this.askedCards.get(id);
    if (asked !== undefined) {
      return asked ?? undefined;
    }
    if (!this.cardLoads.has(id)) {
      let load = this.loadCard(id);
      this.cardLoads.set(id, load);
      this.store.trackLoad(load);
    }
    return undefined;
  };

  private async loadCard(id: string): Promise<void> {
    // A link asks from inside a render, and the store's load writes tracked
    // state, so the load starts in a later microtask.
    await Promise.resolve();
    let card: CardDef | null = null;
    try {
      let result = await this.store.get(id, {
        dependencyTrackingContext: runtimeNonQueryDependencyContext({
          source: 'host-route-links:loadCard',
        }),
      });
      card = isCardInstance(result) ? result : null;
    } catch (e) {
      log.debug(`could not load ${id} for a link: ${String(e)}`);
    }
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    this.cardLoads.delete(id);
    this.askedCards.set(id, card);
  }

  // The one place a link that got no routed address is reported. Nothing is
  // stored: a link reports again each time it renders.
  private reportUnresolved = (link: UnresolvedHostRouteLink): void => {
    log.debug(
      `a link to ${link.target} (${link.form}) has no routed address in ${
        link.realmURL
      }: ${link.reason}${link.routePath ? ` at ${link.routePath}` : ''}`,
    );
  };
}

declare module '@ember/service' {
  interface Registry {
    'host-route-links': HostRouteLinksService;
  }
}
