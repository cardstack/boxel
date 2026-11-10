import Service, { service } from '@ember/service';
import { waitForPromise } from '@ember/test-waiters';

import { TrackedMap } from 'tracked-built-ins';

import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import {
  getMenuItems,
  logger,
  ri,
  rri,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type LoaderService from './loader-service';
import type NetworkService from './network';
import type RealmService from './realm';
import type { CardDef, GetMenuItemParams } from '@cardstack/base/card-api';
import type { RealmExtension } from '@cardstack/base/realm-extension';

const log = logger('realm-extensions');

type LoadedExtension =
  | { state: 'loaded'; extension: RealmExtension }
  | { state: 'failed' };

// Loads the extensions a realm lists in its `realm.json` and asks them for
// what they add to the realm's cards (ADR 032).
export default class RealmExtensionsService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  // Keyed by loader: a code change replaces the loader, and an extension
  // loaded by the old one must not answer for the new one.
  private loaded = new WeakMap<Loader, TrackedMap<string, LoadedExtension>>();
  private loading = new WeakMap<Loader, Set<string>>();

  // The menu for `card`: its own items, then the items its realm's extensions
  // provide, placed before the first dangerous item so Delete stays last.
  cardMenuItems(card: CardDef, params: GetMenuItemParams): MenuItemOptions[] {
    let own = card[getMenuItems]?.(params) ?? [];
    let extensionItems = this.extensionMenuItems(card, params);
    if (extensionItems.length === 0) {
      return own;
    }
    let firstDangerous = own.findIndex((item) => item.dangerous);
    if (firstDangerous === -1) {
      return [...own, ...extensionItems];
    }
    return [
      ...own.slice(0, firstDangerous),
      ...extensionItems,
      ...own.slice(firstDangerous),
    ];
  }

  private extensionMenuItems(
    card: CardDef,
    params: GetMenuItemParams,
  ): MenuItemOptions[] {
    let lookup = urlForRealmLookup(card);
    let refs = this.realm.info(lookup).realmExtensionModules;
    if (!refs?.length) {
      return [];
    }
    let realmKey = this.realm.realmOf(rri(lookup));
    if (!realmKey) {
      return [];
    }
    let realm = ri(this.network.virtualNetwork.unresolveURL(realmKey));
    let items: MenuItemOptions[] = [];
    for (let ref of refs) {
      let extension = this.extensionFor(ref);
      if (!extension?.provideMenuItems) {
        continue;
      }
      try {
        items.push(...extension.provideMenuItems(card, { ...params, realm }));
      } catch (error) {
        // One broken extension costs only its own items.
        log.warn(
          `realm extension ${ref.module}#${ref.name} failed to provide menu items: ${error}`,
        );
      }
    }
    return items;
  }

  // The extension `ref` names, once its module has loaded. Until then this
  // starts the load and answers undefined; the tracked map re-runs the caller
  // when the load settles.
  private extensionFor(ref: ResolvedCodeRef): RealmExtension | undefined {
    let loader = this.loaderService.loader;
    let loaded = this.loaded.get(loader);
    if (!loaded) {
      loaded = new TrackedMap();
      this.loaded.set(loader, loaded);
    }
    let key = `${ref.module}#${ref.name}`;
    let entry = loaded.get(key);
    if (entry) {
      return entry.state === 'loaded' ? entry.extension : undefined;
    }
    let loading = this.loading.get(loader);
    if (!loading) {
      loading = new Set();
      this.loading.set(loader, loading);
    }
    if (!loading.has(key)) {
      loading.add(key);
      waitForPromise(this.load(loader, ref, loaded, key));
    }
    return undefined;
  }

  private async load(
    loader: Loader,
    ref: ResolvedCodeRef,
    loaded: TrackedMap<string, LoadedExtension>,
    key: string,
  ): Promise<void> {
    try {
      let module = await loader.import<Record<string, unknown>>(ref.module);
      let extension = module[ref.name];
      if (isRealmExtension(extension)) {
        loaded.set(key, { state: 'loaded', extension });
      } else {
        log.warn(
          `${ref.module}#${ref.name} is listed as a realm extension but provides no extension hooks`,
        );
        loaded.set(key, { state: 'failed' });
      }
    } catch (error) {
      log.warn(
        `failed to load realm extension ${ref.module}#${ref.name}: ${error}`,
      );
      loaded.set(key, { state: 'failed' });
    }
  }
}

function isRealmExtension(value: unknown): value is RealmExtension {
  return (
    (typeof value === 'function' ||
      (typeof value === 'object' && value !== null)) &&
    typeof (value as RealmExtension).provideMenuItems === 'function'
  );
}

declare module '@ember/service' {
  interface Registry {
    'realm-extensions': RealmExtensionsService;
  }
}
