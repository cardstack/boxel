import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { TrackedArray } from 'tracked-built-ins';

import {
  isScopedCSSRequest,
  type QueryResultsMeta,
  type Format,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import { PrerenderedCard } from '../components/prerendered-card-search';
import { normalizeRealms, resolveCardRealmUrl } from '../lib/realm-utils';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RenderService from '../services/render-service';
import type RenderStoreService from '../services/render-store';

const waiter = buildWaiter('live-prerendered-search-resource:render-waiter');

type SearchInstance = CardDef | FileDef;

export interface Args {
  named: {
    instances: SearchInstance[];
    isLoading: boolean;
    meta: QueryResultsMeta;
    format: Format | undefined;
    realms: string[] | undefined;
    cardComponentModifier?: any;
    owner: Owner;
  };
}

function captureModeForFormat(format: Format): 'innerHTML' | 'outerHTML' {
  switch (format) {
    case 'isolated':
    case 'atom':
    case 'head':
      return 'innerHTML';
    default:
      return 'outerHTML';
  }
}

export class LivePrerenderedSearchResource extends Resource<Args> {
  @service declare private network: NetworkService;
  @service declare private renderService: RenderService;
  // This resource is only used for card prerendering in render context.
  @service('render-store') declare private renderStore: RenderStoreService;
  @service('loader-service') declare private loaderService: LoaderService;

  @tracked private _isLoading = false;
  private _instances = new TrackedArray<PrerenderedCard>();
  @tracked private _meta: QueryResultsMeta = { page: { total: 0 } };
  #loadedScopedCssModules = new Set<string>();
  #scopedCssModulesByLoader = new WeakMap<
    Loader,
    Map<string, Promise<string[]>>
  >();
  #previousSignature: string | undefined;

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      this.buildPrerenderedCards.cancelAll();
      this._instances = new TrackedArray();
      this._meta = { page: { total: 0 } };
      this.#loadedScopedCssModules.clear();
      this.#previousSignature = undefined;
    });
  }

  modify(_positional: never[], named: Args['named']) {
    let {
      owner,
      instances,
      isLoading,
      meta,
      format,
      realms,
      cardComponentModifier,
    } = named;

    setOwner(this, owner);
    this._isLoading = isLoading;
    this._meta = meta;

    if (format === undefined) {
      this.#previousSignature = undefined;
      this._instances = new TrackedArray();
      this.buildPrerenderedCards.cancelAll();
      return;
    }

    let signature = JSON.stringify({
      format,
      ids: instances.map((instance) => instance.id),
      realms: realms ?? [],
    });

    if (signature === this.#previousSignature) {
      return;
    }
    this.#previousSignature = signature;

    let load = this.buildPrerenderedCards.perform(
      [...instances],
      format,
      realms ? normalizeRealms(realms) : [],
      cardComponentModifier,
    );
    this.renderStore.trackLoad(load as unknown as Promise<void>);
  }

  get instances() {
    return this._instances;
  }

  get isLoading() {
    return this._isLoading || this.buildPrerenderedCards.isRunning;
  }

  get meta() {
    return this._meta;
  }

  private async waitForPendingDocumentLoads(): Promise<void> {
    // Do not call `renderStore.loaded()` here. This task is tracked by
    // render-store, so waiting on `loaded()` would include ourselves.
    const maxPasses = 10;
    const requiredStablePasses = 2;
    let stablePasses = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      let docsInFlight =
        this.renderStore.cardDocsInFlight.length +
        this.renderStore.fileMetaDocsInFlight.length;
      if (docsInFlight === 0) {
        stablePasses++;
      } else {
        stablePasses = 0;
      }
      if (stablePasses >= requiredStablePasses) {
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        await new Promise<void>((resolve) =>
          // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- prerender stability-check timing
          requestAnimationFrame(() => resolve()),
        );
      } else {
        await Promise.resolve();
      }
    }
  }

  private isScopedCssModule(url: string): boolean {
    // Suffix check on the path portion only — scoped-css URLs carry the
    // encoded CSS in the filename, never in a query string or hash, so
    // trimming those is enough. String ops instead of `new URL()`: this runs
    // per dependency per type and the URL constructor dominates otherwise.
    let end = url.length;
    let queryIdx = url.indexOf('?');
    if (queryIdx !== -1) {
      end = queryIdx;
    }
    let hashIdx = url.indexOf('#');
    if (hashIdx !== -1 && hashIdx < end) {
      end = hashIdx;
    }
    return isScopedCSSRequest(end === url.length ? url : url.slice(0, end));
  }

  private async loadScopedCssForInstance(instance: SearchInstance) {
    let identity = Loader.identify(instance.constructor);
    if (!identity?.module) {
      return;
    }
    let loader = this.loaderService.loader;
    // A result set holds many instances of few types, but the dependency
    // walk costs the same for each instance of a type — so compute the
    // scoped-css module list once per (loader, type module). Keyed by loader
    // because a loader reset re-transpiles modules and the content-addressed
    // scoped-css URLs change with the CSS.
    let byModule = this.#scopedCssModulesByLoader.get(loader);
    if (!byModule) {
      byModule = new Map();
      this.#scopedCssModulesByLoader.set(loader, byModule);
    }
    let scopedCssModules = byModule.get(identity.module);
    if (!scopedCssModules) {
      scopedCssModules = loader
        .getConsumedModules(identity.module)
        .then((deps) => deps.filter((dep) => this.isScopedCssModule(dep)));
      byModule.set(identity.module, scopedCssModules);
    }
    let modulesToLoad = (await scopedCssModules).filter(
      (moduleURL) => !this.#loadedScopedCssModules.has(moduleURL),
    );
    if (modulesToLoad.length === 0) {
      return;
    }
    await Promise.all(
      modulesToLoad.map(async (moduleURL) => {
        await loader.import(moduleURL);
        this.#loadedScopedCssModules.add(moduleURL);
      }),
    );
  }

  private buildPrerenderedCards = restartableTask(
    async (
      instances: SearchInstance[],
      format: Format,
      normalizedRealms: string[],
      cardComponentModifier?: any,
    ) => {
      let token = waiter.beginAsync();
      try {
        if (instances.length === 0) {
          this._instances = new TrackedArray();
          return;
        }
        let capture = captureModeForFormat(format);
        let cards = await Promise.all(
          instances.map(async (instance) => {
            let url = instance.id;
            let realmUrl = resolveCardRealmUrl(
              url,
              normalizedRealms,
              this.network.virtualNetwork,
            );
            try {
              await this.loadScopedCssForInstance(instance);
              let component = (
                instance.constructor as typeof CardDef
              ).getComponent(instance as CardDef);
              let html = await this.renderService.renderCardComponent(
                component,
                capture,
                format,
                () => this.waitForPendingDocumentLoads(),
              );
              return new PrerenderedCard(
                {
                  url,
                  realmUrl,
                  html,
                  isError: false,
                },
                cardComponentModifier,
              );
            } catch (error) {
              console.error(
                `Failed to render live search result ${url}:`,
                error,
              );
              return new PrerenderedCard(
                {
                  url,
                  realmUrl,
                  html: '',
                  isError: true,
                },
                cardComponentModifier,
              );
            }
          }),
        );
        this._instances = new TrackedArray(cards);
      } finally {
        waiter.endAsync(token);
      }
    },
  );
}

export function getLivePrerenderedSearch(
  parent: object,
  owner: Owner,
  args: () => {
    instances: SearchInstance[];
    isLoading: boolean;
    meta: QueryResultsMeta;
    format: Format | undefined;
    realms?: string[];
    cardComponentModifier?: any;
  },
) {
  return LivePrerenderedSearchResource.from(parent, () => ({
    named: {
      instances: args().instances,
      isLoading: args().isLoading,
      meta: args().meta,
      format: args().format,
      realms: args().realms,
      cardComponentModifier: args().cardComponentModifier,
      owner,
    },
  }));
}
