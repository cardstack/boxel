import { setOwner, getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import {
  Permissions,
  SupportedMimeType,
  type RealmInfo,
} from '@cardstack/runtime-common';

import {
  RealmSessionResource,
  getRealmSession,
} from '../resources/realm-session';

import type LoaderService from './loader-service';
import { buildWaiter } from '@ember/test-waiters';

const waiter = buildWaiter('realm-service');

class RealmResource {
  type = 'ready' as const;
  constructor(
    readonly info: RealmInfo,
    readonly session: RealmSessionResource,
  ) {}
}

class InitialRealmResource {
  @service declare loaderService: LoaderService;

  #state:
    | {
        type: 'initializing';
        session: RealmSessionResource;
      }
    | RealmResource = {
    type: 'initializing',
    session: getRealmSession(this, { realmURL: () => new URL(this.url) }),
  };

  constructor(readonly url: string) {}

  get state() {
    return this.#state;
  }

  async initialize(): Promise<void> {
    let response = await this.loaderService.loader.fetch(`${this.url}_info`, {
      headers: { Accept: SupportedMimeType.RealmInfo },
    });
    await this.#state.session.loaded;
    this.#state = new RealmResource(
      (await response.json()).data.attributes as RealmInfo,
      this.#state.session,
    );
  }
}

export default class RealmService extends Service {
  @service declare loaderService: LoaderService;

  async ensureRealmReady(url: string): Promise<void> {
    let token = waiter.beginAsync();
    try {
      let realmURL = this.toRealmURL(url);
      if (!realmURL) {
        realmURL = await this.fetchRealmURL(url);
      }
      let resource = this.realms.get(realmURL);
      if (!resource) {
        resource = new InitialRealmResource(realmURL);
        setOwner(resource, getOwner(this)!);
        this.realms.set(realmURL, resource);
      }
      await resource.initialize();
    } finally {
      waiter.endAsync(token);
    }
  }

  info = (url: string): RealmInfo => {
    return this.realm(url).info;
  };

  canRead = (url: string): boolean => {
    return this.realm(url).session.canRead;
  };

  canWrite = (url: string): boolean => {
    return this.realm(url).session.canWrite;
  };

  permissions = (url: string): Permissions => {
    let self = this;
    return {
      get canRead() {
        return self.canRead(url);
      },
      get canWrite() {
        return self.canWrite(url);
      },
    };
  };

  token = (url: string): string | undefined => {
    return this.realm(url).session.rawRealmToken;
  };

  private realm(url: string): RealmResource {
    let realmURL = this.toRealmURL(url);
    if (!realmURL) {
      throw new Error(`Failed to ensureRealmReady for ${url}`);
    }
    let r = this.realms.get(realmURL);
    let s = r?.state;
    if (s?.type !== 'ready') {
      throw new Error(`Failed to await ensureRealmReady for ${realmURL}`);
    }
    return s;
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
        `Could not find realm URL in response headers (x-boxel-realm-url) for ${url} ${response.status}`,
      );
    }
    return realmURL;
  }

  async refreshToken(url: string): Promise<void> {
    await this.realm(url).session.refreshToken();
  }

  private realms: Map<string, InitialRealmResource> = new Map();
}
