import { setOwner, getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { SupportedMimeType, type RealmInfo } from '@cardstack/runtime-common';

import type LoaderService from './loader-service';

interface ReadyState {
  type: 'ready';
  info: RealmInfo;
}

class RealmResource {
  @service declare loaderService: LoaderService;

  #state:
    | {
        type: 'initializing';
      }
    | ReadyState = { type: 'initializing' };

  constructor(readonly url: string) {}

  isReady(): this is ReadyRealmResource {
    return this.#state.type === 'ready';
  }

  get state() {
    return this.#state;
  }

  async initialize(): Promise<void> {
    let response = await this.loaderService.loader.fetch(`${this.url}_info`, {
      headers: { Accept: SupportedMimeType.RealmInfo },
    });
    this.#state = {
      type: 'ready',
      info: (await response.json()).data.attributes as RealmInfo,
    };
  }
}

type ReadyRealmResource = RealmResource & { state: ReadyState };

export default class RealmService extends Service {
  @service declare loaderService: LoaderService;

  async ensureRealmReady(url: string): Promise<void> {
    let realmURL = this.toRealmURL(url);
    if (!realmURL) {
      realmURL = await this.fetchRealmURL(url);
    }
    let resource = this.realms.get(realmURL);
    if (!resource) {
      resource = new RealmResource(realmURL);
      setOwner(resource, getOwner(this)!);
      this.realms.set(realmURL, resource);
    }
    await resource.initialize();
  }

  info = (url: string): RealmInfo => {
    return this.realm(url).state.info;
  };

  canRead(_url: string): boolean {
    throw new Error('unimplemented');
  }

  canWrite(_url: string): boolean {
    throw new Error('unimplemented');
  }

  token(_url: string): string | undefined {
    throw new Error('unimplemented');
  }

  private realm(url: string): ReadyRealmResource {
    let realmURL = this.toRealmURL(url);
    if (!realmURL) {
      throw new Error(`Failed to ensureRealmReady for ${url}`);
    }
    let r = this.realms.get(realmURL);
    if (!r?.isReady()) {
      throw new Error(`Failed to await ensureRealmReady for ${realmURL}`);
    }
    return r;
  }

  private toRealmURL(url: string): string | undefined {
    for (let key of this.realms.keys()) {
      if (url.startsWith(key)) {
        return key;
      }
    }
    return undefined;
  }

  private async fetchRealmURL(url: string): Promise<string> {
    let response = await this.loaderService.loader.fetch(url, {
      method: 'HEAD',
    });
    let realmURL = response.headers.get('x-boxel-realm-url');
    if (!realmURL) {
      throw new Error(
        `Could not find realm URL in response headers (x-boxel-realm-url) for ${url}`,
      );
    }
    return realmURL;
  }

  async refreshToken(_realmURL: string): Promise<void> {}

  private realms: Map<string, RealmResource> = new Map();
}
