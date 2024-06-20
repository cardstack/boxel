import { setOwner, getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import { tracked } from '@glimmer/tracking';

import {
  Permissions,
  SupportedMimeType,
  type RealmInfo,
  JWTPayload,
} from '@cardstack/runtime-common';

import {
  RealmSessionResource,
  getRealmSession,
} from '../resources/realm-session';

import type LoaderService from './loader-service';
import type MatrixService from './matrix-service';
import { task } from 'ember-concurrency';

const waiter = buildWaiter('realm-service');

interface Meta {
  info: RealmInfo;
  isPublic: boolean;
}

class RealmResource {
  @service private declare matrixService: MatrixService;

  constructor(
    private realmURL: string,
    auth: { token: string; claims: JWTPayload } | undefined,
  ) {
    this.auth = auth;
  }

  @tracked meta: Meta | undefined;

  @tracked
  private auth: { token: string; claims: JWTPayload } | undefined;

  get token(): string | undefined {
    return this.auth?.token;
  }

  get claims(): JWTPayload | undefined {
    return this.auth?.claims;
  }

  private loggingIn: Promise<void> | undefined;

  async login(): Promise<void> {
    if (!this.loggingIn) {
      this.loggingIn = this.loginTask.perform();
    }
    await this.loggingIn;
  }

  private loginTask = task(async () => {
    let token = await this.matrixService.createRealmSession(
      new URL(this.realmURL),
    );
    let claims = claimsFromRawToken(token);
    this.auth = { claims, token };
    this.loggingIn = undefined;
  });

  logout(): void {
    this.auth = undefined;
  }
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

  constructor(
    readonly url: string,
    readonly isPublic: boolean,
  ) {}

  get state() {
    return this.#state;
  }

  async initialize(): Promise<void> {
    await this.#state.session.loaded;
    let headers: Record<string, string> = {
      Accept: SupportedMimeType.RealmInfo,
    };
    let token = this.#state.session.rawRealmToken;
    if (token) {
      headers['Authorization'] = token;
    }
    let response = await this.loaderService.loader.fetch(`${this.url}_info`, {
      headers,
    });
    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch realm info for ${this.url}: ${response.status}`,
      );
    }
    let json = await response.json();
    let info: RealmInfo = {
      url: json.data.id,
      ...json.data.attributes,
    };
    let resource = new RealmResource(info, this.#state.session, this.isPublic);
    setOwner(resource, getOwner(this));
    this.#state = resource;
  }
}

class RealmNotReadyError extends Error {
  code = 'RealmNotReady';
}
export default class RealmService extends Service {
  @service declare loaderService: LoaderService;

  async ensureRealmReady(url: string): Promise<void> {
    let token = waiter.beginAsync();
    try {
      let isPublic: boolean | undefined;
      let realmURL = this.toRealmURL(url);
      if (!realmURL) {
        ({ realmURL, isPublic } = await this.fetchRealmURL(url));
      }
      let resource = this.realms.get(realmURL);
      if (!resource) {
        resource = new InitialRealmResource(realmURL, !!isPublic);
        setOwner(resource, getOwner(this)!);
        this.realms.set(realmURL, resource);
      }
      await resource.initialize();
    } finally {
      waiter.endAsync(token);
    }
  }

  info = (url: string): RealmInfo => {
    let info = this.requireRealmMeta(url).meta.info;
    if (!info) {
      throw new RealmNotReadyError(
        `Haven't fetched from realm at ${url} yet, so realm info is not available`,
      );
    }
    return info;
  };

  canRead = (url: string): boolean => {
    let resource = this.requireRealmMeta(url);
    return (
      resource.meta.isPublic ||
      Boolean(resource.claims?.permissions?.includes('read'))
    );
  };

  canWrite = (url: string): boolean => {
    let resource = this.requireRealmMeta(url);
    return Boolean(resource.claims?.permissions?.includes('write'));
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
    return this.knownRealm(url)?.token;
  };

  private requireRealmMeta(url: string): RealmResource & { meta: Meta } {
    let resource = this.knownRealm(url);
    if (!resource) {
      throw new RealmNotReadyError(
        `Haven't fetched from realm at ${url} yet, so realm info is not available`,
      );
    }
    if (!resource.meta) {
      throw new RealmNotReadyError(
        `Haven't fetched from realm at ${url} yet, so realm info is not available`,
      );
    }
    return resource as RealmResource & { meta: Meta };
  }

  private knownRealm(url: string): RealmResource | undefined {
    for (let [key, value] of this.realms) {
      if (url.startsWith(key)) {
        return value;
      }
    }
    return undefined;
  }

  private async fetchRealmURL(
    url: string,
  ): Promise<{ realmURL: string; isPublic: boolean }> {
    let response = await this.loaderService.loader.fetch(url, {
      method: 'HEAD',
    });
    let realmURL = response.headers.get('x-boxel-realm-url');
    if (!realmURL) {
      throw new Error(
        `Could not find realm URL in response headers (x-boxel-realm-url) for ${url} ${response.status}`,
      );
    }
    let isPublic = Boolean(
      response.headers.get('x-boxel-realm-public-readable'),
    );
    return { realmURL, isPublic };
  }

  async refreshToken(url: string): Promise<void> {
    await this.requireRealmMeta(url).session.refreshToken();
  }

  private realms: Map<string, RealmResource> = restoreSessions();
}

const tokenRefreshPeriodSec = 5 * 60; // 5 minutes
const sessionLocalStorageKey = 'boxel-session';

function claimsFromRawToken(rawToken: string): JWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as JWTPayload;
}

function restoreSessions(): Map<string, RealmResource> {
  let sessions: Map<string, RealmResource> = new Map();
  let tokens = extractSessionsFromStorage();
  if (tokens) {
    for (let [realmURL, token] of Object.entries(tokens)) {
      let claims = claimsFromRawToken(token);
      let expiration = claims.exp;
      if (expiration - tokenRefreshPeriodSec > Date.now() / 1000) {
        sessions.set(realmURL, new RealmResource(realmURL, { claims, token }));
      }
    }
  }
  return sessions;
}

function extractSessionsFromStorage(): Record<string, string> | undefined {
  let sessionsString = window.localStorage.getItem(sessionLocalStorageKey);
  if (sessionsString) {
    return JSON.parse(sessionsString);
  }
  return undefined;
}
