import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import { RealmPaths } from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { SiteConfig } from 'https://cardstack.com/base/site-config';

import type RealmService from './realm';
import type StoreService from './store';

export type HomePageResolution = {
  realmURL: string;
  cardId: string;
};

export default class HomePageResolverService extends Service {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;

  private inflight = new Map<string, Promise<string | null>>();

  async resolve(url: string): Promise<HomePageResolution | null> {
    let parsedURL = this.safeParseURL(url);
    if (!parsedURL) {
      return null;
    }

    let realmURL = await this.identifyRealmURL(parsedURL);
    if (!realmURL) {
      return null;
    }

    let localPath = this.localPathFor(parsedURL, realmURL);
    if (
      localPath &&
      localPath !== '' &&
      localPath !== 'index' &&
      localPath !== 'index.json'
    ) {
      return null;
    }

    let loadingHomePagePromise = this.inflight.get(realmURL);
    if (!loadingHomePagePromise) {
      loadingHomePagePromise = this.loadHomePage(realmURL).finally(() => {
        this.inflight.delete(realmURL);
      });
      this.inflight.set(realmURL, loadingHomePagePromise);
    }

    let cardId = await loadingHomePagePromise;
    if (!cardId) {
      return null;
    }

    return {
      realmURL,
      cardId,
    };
  }

  private async loadHomePage(realmURL: string): Promise<string | null> {
    let normalizedRealmURL = this.normalizeRealmURL(realmURL);
    if (!normalizedRealmURL) {
      return null;
    }

    let realmPaths = new RealmPaths(new URL(normalizedRealmURL));
    let siteConfigURL = realmPaths.fileURL('site.json').href;

    let siteConfigInstance: SiteConfig | undefined;
    try {
      siteConfigInstance = (await this.store.get(siteConfigURL)) as
        | SiteConfig
        | undefined;
    } catch (_error) {
      return null;
    }

    if (!siteConfigInstance) {
      return null;
    }

    let homeCard = (await Promise.resolve(siteConfigInstance.home)) as
      | CardDef
      | undefined;
    if (!homeCard?.id) {
      return null;
    }

    return homeCard.id.replace(/\.json$/, '');
  }

  private async identifyRealmURL(url: URL): Promise<string | undefined> {
    let knownRealm = this.realm.realmOfURL(url);
    if (knownRealm) {
      return this.normalizeRealmURL(knownRealm.href);
    }

    try {
      let response = await this.network.authedFetch(url.href, {
        method: 'HEAD',
        headers: { Accept: '*/*' },
      });
      if (response.ok) {
        let headerRealmURL = response.headers.get('x-boxel-realm-url');
        if (headerRealmURL) {
          let normalized = this.normalizeRealmURL(headerRealmURL);
          if (normalized) {
            return normalized;
          }
        }
      }
    } catch (_error) {
      // ignore network errors and fall through
    }

    return undefined;
  }

  private localPathFor(url: URL, realmURL: string): string | undefined {
    try {
      let realmPaths = new RealmPaths(new URL(realmURL));
      return realmPaths.local(url);
    } catch (_error) {
      return undefined;
    }
  }

  private normalizeRealmURL(realmURL?: string): string | undefined {
    if (!realmURL) {
      return;
    }

    try {
      let parsed = new URL(realmURL);
      parsed.pathname = parsed.pathname.endsWith('/')
        ? parsed.pathname
        : `${parsed.pathname}/`;
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (_error) {
      return;
    }
  }

  private safeParseURL(value: string): URL | undefined {
    try {
      return new URL(value, window.location.href);
    } catch (_error) {
      return undefined;
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'home-page-resolver': HomePageResolverService;
  }
}
