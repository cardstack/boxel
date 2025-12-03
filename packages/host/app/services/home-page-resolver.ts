import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import { RealmPaths } from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { IndexConfig } from 'https://cardstack.com/base/index-config';
import type { SiteConfig } from 'https://cardstack.com/base/site-config';

import type RealmService from './realm';
import type StoreService from './store';

export type HomePageResolution = {
  realmURL: string;
  cardId: string;
};

type HomeMode = 'host' | 'interact';

export default class HomePageResolverService extends Service {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;

  private inflight = new Map<string, Promise<string | null>>();

  /**
   * Resolves the home page for a given URL.
   *
   * @param {string} url - The URL to resolve the home page for.
   * @param {'host' | 'interact'} mode - Determines which home config to use.
   * @returns {Promise<HomePageResolution | null>} A promise that resolves to a HomePageResolution object containing the realm URL and card ID,
   *   or `null` if the URL cannot be parsed, the realm cannot be identified, the local path is not a home page, or the home page card cannot be loaded.
   */
  async resolve(
    url: string,
    mode: HomeMode = 'host',
  ): Promise<HomePageResolution | null> {
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

    let inflightKey = `${realmURL}|${mode}`;
    let loadingHomePagePromise = this.inflight.get(inflightKey);
    if (!loadingHomePagePromise) {
      loadingHomePagePromise = this.loadHomePage(realmURL, mode).finally(() => {
        this.inflight.delete(inflightKey);
      });
      this.inflight.set(inflightKey, loadingHomePagePromise);
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

  private async loadHomePage(
    realmURL: string,
    mode: HomeMode,
  ): Promise<string | null> {
    let normalizedRealmURL = this.normalizeRealmURL(realmURL);
    if (!normalizedRealmURL) {
      return null;
    }

    if (mode === 'host') {
      let siteConfigId = await this.hostHomeFor(normalizedRealmURL);
      let siteConfigInstance =
        siteConfigId &&
        (await this.loadSiteConfig(siteConfigId, normalizedRealmURL));
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
    } else {
      let indexConfigId = await this.interactHomeFor(normalizedRealmURL);
      let indexConfigInstance =
        indexConfigId &&
        (await this.loadIndexConfig(indexConfigId, normalizedRealmURL));
      if (!indexConfigInstance) {
        return `${normalizedRealmURL}index`;
      }
      let homeCard = (await Promise.resolve(indexConfigInstance.home)) as
        | CardDef
        | undefined;
      if (!homeCard?.id) {
        return `${normalizedRealmURL}index`;
      }
      return homeCard.id.replace(/\.json$/, '');
    }
  }

  private async hostHomeFor(realmURL: string): Promise<string | null> {
    try {
      await this.realm.ensureRealmMeta(realmURL);
    } catch (_error) {
      return null;
    }

    let info = this.realm.info(realmURL);
    return info.hostHome ?? null;
  }

  private async interactHomeFor(realmURL: string): Promise<string | null> {
    try {
      await this.realm.ensureRealmMeta(realmURL);
    } catch (_error) {
      return null;
    }

    let info = this.realm.info(realmURL);
    return info.interactHome ?? null;
  }

  private async loadSiteConfig(
    siteConfigId: string,
    realmURL: string,
  ): Promise<SiteConfig | undefined> {
    let resolvedSiteConfigId = this.resolveCardURL(siteConfigId, realmURL);
    if (!resolvedSiteConfigId) {
      return undefined;
    }

    let siteConfig =
      (await this.tryLoadSiteConfig(resolvedSiteConfigId)) ??
      (await this.tryLoadSiteConfig(
        resolvedSiteConfigId.endsWith('.json')
          ? resolvedSiteConfigId
          : `${resolvedSiteConfigId}.json`,
      ));

    return siteConfig ?? undefined;
  }

  private async tryLoadSiteConfig(
    siteConfigURL: string,
  ): Promise<SiteConfig | undefined> {
    try {
      return (await this.store.get(siteConfigURL)) as SiteConfig | undefined;
    } catch (_error) {
      return undefined;
    }
  }

  private async loadIndexConfig(
    indexConfigId: string,
    realmURL: string,
  ): Promise<IndexConfig | undefined> {
    let resolvedIndexConfigId = this.resolveCardURL(indexConfigId, realmURL);
    if (!resolvedIndexConfigId) {
      return undefined;
    }

    let indexConfig =
      (await this.tryLoadIndexConfig(resolvedIndexConfigId)) ??
      (await this.tryLoadIndexConfig(
        resolvedIndexConfigId.endsWith('.json')
          ? resolvedIndexConfigId
          : `${resolvedIndexConfigId}.json`,
      ));

    return indexConfig ?? undefined;
  }

  private async tryLoadIndexConfig(
    indexConfigURL: string,
  ): Promise<IndexConfig | undefined> {
    try {
      return (await this.store.get(indexConfigURL)) as IndexConfig | undefined;
    } catch (_error) {
      return undefined;
    }
  }

  private resolveCardURL(cardId: string, realmURL: string): string | undefined {
    try {
      return new URL(cardId).href.replace(/\.json$/, '');
    } catch (_error) {
      try {
        return new URL(cardId, realmURL).href.replace(/\.json$/, '');
      } catch (_error) {
        return undefined;
      }
    }
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
