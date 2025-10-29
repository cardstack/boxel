import {
  associateDestroyableChild,
  registerDestructor,
} from '@ember/destroyable';
import type Owner from '@ember/owner';
import { setOwner, getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { waitForPromise } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { cached } from '@glimmer/tracking';

import { dropTask, task, restartableTask, rawTimeout } from 'ember-concurrency';
import window from 'ember-window-mock';

import { TrackedSet, TrackedObject, TrackedArray } from 'tracked-built-ins';

import {
  Permissions,
  Deferred,
  logger,
  JWTPayload,
  SupportedMimeType,
  type RealmInfo,
  RealmPermissions,
  RealmPaths,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import { assertNever } from '@cardstack/host/utils/assert-never';

import type {
  IndexRealmEventContent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

import { SessionLocalStorageKey } from '../utils/local-storage-keys';

import type MatrixService from './matrix-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type RealmServerService from './realm-server';
import type ResetService from './reset';

const log = logger('service:realm');

export type EnhancedRealmInfo = RealmInfo & {
  isIndexing: boolean;
  isPublic: boolean;
};

type AuthStatus =
  | { type: 'logged-in'; token: string; claims: JWTPayload }
  | { type: 'anonymous' };

class RealmResource {
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private messageService: MessageService;
  @service declare private realmServer: RealmServerService;

  @tracked info: EnhancedRealmInfo | undefined;
  @tracked private realmPermissions: RealmPermissions | null | undefined;

  @tracked
  private auth: AuthStatus = { type: 'anonymous' };
  private subscription: { unsubscribe: () => void } | undefined;

  @tracked private _isPublishing = false;
  private _publishingRealms = new TrackedArray<string>();
  private _unPublishingRealms = new TrackedArray<string>();

  // Hassan: in general i'm questioning the usefulness of using Tasks in this
  // class. We seem to be following the pattern of await-ing all the tasks on
  // the outside of the Task.perform(). When we do this it actually casts the
  // Task.perform() into a normal non-cancellable promise. Probably we can get
  // rid of all these tasks and just use normal promises as I don't think the
  // tasks are buying us anything.

  constructor(
    private realmURL: string,
    token: string | undefined,
  ) {
    this.token = token;
    registerDestructor(this, () => {
      if (this.subscription) {
        this.subscription.unsubscribe();
      }
    });
  }

  get isLoggedIn() {
    return this.auth.type === 'logged-in';
  }

  get url(): string {
    return this.realmURL;
  }

  get token(): string | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.token;
    }
    return undefined;
  }

  set token(value: string | undefined) {
    if (value) {
      this.auth = {
        type: 'logged-in',
        token: value,
        claims: claimsFromRawToken(value),
      };
    } else {
      this.auth = { type: 'anonymous' };
    }
    SessionStorage.persist(this.realmURL, value);
    this.tokenRefresher.perform();
  }

  get isPublic() {
    return this.info?.isPublic;
  }

  get claims(): JWTPayload | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.claims;
    }
    return undefined;
  }

  get canRead() {
    return !!this.isPublic || !!this.claims?.permissions?.includes('read');
  }

  get canWrite() {
    return !!this.claims?.permissions?.includes('write');
  }

  private loggingIn: Promise<void> | undefined;

  async login(): Promise<void> {
    if (this.auth.type === 'logged-in') {
      await this.subscribe();
      return;
    }
    if (!this.loggingIn) {
      this.loggingIn = this.loginTask.perform();
    }
    await this.loggingIn;
    await this.subscribe();
  }

  private async subscribe() {
    if (this.subscription) {
      return;
    }

    // Avoid deadlocks during reauthentication triggered by a 401 when fetching realm info.
    // If the info is already being fetched, we don't need to call fetchInfo again,
    // since the purpose of await this.fetchInfo() here is only to ensure that the realm has the info loaded.
    if (!this.fetchingInfo) {
      await this.fetchInfo();
    }

    this.subscription = {
      unsubscribe: this.messageService.subscribe(
        this.realmURL,
        (event: RealmEventContent) => {
          if (!this.info) {
            console.warn(
              `No realm info exists for ${this.realmURL} when trying to set indexing status`,
            );
            return;
          }
          if (event.eventName !== 'index') {
            return;
          }
          let data = event as IndexRealmEventContent;
          if (data.indexType === 'full') {
            return;
          }
          switch (data.indexType) {
            case 'incremental-index-initiation':
              this.info.isIndexing = true;
              break;
            case 'copy':
            case 'incremental':
              this.info.isIndexing = false;
              break;
            default:
              throw assertNever(data);
          }
        },
      ),
    };
  }

  private loginTask = task(async () => {
    try {
      let token = await this.matrixService.createRealmSession(
        new URL(this.realmURL),
      );
      this.token = token;
    } catch (e: any) {
      console.error(`RealmService - Failed to login to realm: ${e.message}`, e);
      this.token = undefined;
    } finally {
      this.loggingIn = undefined;
    }
  });

  logout(): void {
    this.token = undefined;
    this.loginTask.cancelAll();
    this.tokenRefresher.cancelAll();
    this.loggingIn = undefined;
    this.fetchInfoTask.cancelAll();
    this.fetchingInfo = undefined;
    this.fetchRealmPermissionsTask.cancelAll();
    window.localStorage.removeItem(SessionLocalStorageKey);
  }

  private fetchingInfo: Promise<void> | undefined;

  async fetchInfo(): Promise<void> {
    if (!this.fetchingInfo) {
      // share the work if there are multiple requests to get the info for a realm
      this.fetchingInfo = this.fetchInfoTask.perform();
    }
    await this.fetchingInfo;
  }

  private fetchInfoTask = dropTask(async () => {
    try {
      if (this.info) {
        return;
      }
      let headers: Record<string, string> = {
        Accept: SupportedMimeType.RealmInfo,
        ...(this.auth.type === 'logged-in'
          ? { Authorization: `Bearer ${this.token}` }
          : {}),
      };
      let response = await this.network.authedFetch(`${this.realmURL}_info`, {
        headers,
      });
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch realm info for ${this.realmURL}: ${response.status}`,
        );
      }
      let json = await waitForPromise(response.json());
      let info: RealmInfo = {
        url: json.data.id,
        ...json.data.attributes,
      };
      let isPublic = Boolean(
        response.headers.get('x-boxel-realm-public-readable'),
      );
      this.info = new TrackedObject({ ...info, isIndexing: false, isPublic });
    } finally {
      this.fetchingInfo = undefined;
    }
  });

  async fetchRealmPermissions() {
    return await this.fetchRealmPermissionsTask.perform();
  }

  private fetchRealmPermissionsTask = dropTask(async () => {
    if (this.realmPermissions !== undefined) {
      return this.realmPermissions;
    }
    await this.loginTask.perform();
    let headers: Record<string, string> = {
      Accept: SupportedMimeType.Permissions,
      Authorization: `Bearer ${this.token}`,
    };
    let response = await this.network.authedFetch(
      `${this.realmURL}_permissions`,
      {
        headers,
      },
    );

    if (response.status === 403) {
      // the user is not an owner of this realm which is a legit scenario
      this.realmPermissions = null;
      return;
    } else if (response.status !== 200) {
      throw new Error(
        `Failed to fetch realm permissions for ${this.realmURL}: ${response.status}`,
      );
    }
    let json = await waitForPromise(response.json());
    this.realmPermissions = json.data.attributes.permissions;
    return this.realmPermissions;
  });

  async setRealmPermission(
    userId: string,
    permissions: ('read' | 'write')[] | null,
  ): Promise<void> {
    return await this.setRealmPermissionTask.perform(userId, permissions);
  }

  private setRealmPermissionTask = restartableTask(
    async (userId: string, permissions: ('read' | 'write')[] | null) => {
      await this.loginTask.perform();
      let headers: Record<string, string> = {
        Accept: SupportedMimeType.Permissions,
        Authorization: `Bearer ${this.token}`,
      };
      let response = await this.network.authedFetch(
        `${this.realmURL}_permissions`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            data: {
              type: 'permissions',
              id: this.url,
              attributes: {
                permissions: {
                  [userId]: permissions,
                } as RealmPermissions,
              },
            },
          }),
        },
      );

      if (response.status !== 200) {
        throw new Error(
          `Failed to set realm permissions for '${userId}:${
            permissions ? permissions.join() : 'null'
          }' in realm ${this.url}: ${response.status}`,
        );
      }
      let json = await waitForPromise(response.json());
      this.realmPermissions = json.data.attributes.permissions;
    },
  );

  private tokenRefresher = restartableTask(async () => {
    if ((globalThis as any).__boxelRenderContext || !this.claims) {
      return;
    }

    let refreshMs = 0;

    if (!this.claims.sessionRoom) {
      // Force JWT renewal to ensure presence of sessionRoom property
      console.log(`JWT for realm ${this.url} has no session room, renewing`);
    } else {
      // token expiration is unix time (seconds)
      let expirationMs = this.claims.exp * 1000;

      refreshMs = Math.max(
        expirationMs - Date.now() - tokenRefreshPeriodSec * 1000,
        0,
      );
    }

    await rawTimeout(refreshMs);

    if (!this.loggingIn) {
      this.loggingIn = this.loginTask.perform();
      await this.loggingIn;
    }
  });

  async publish(urls: string[]) {
    if (this._isPublishing) {
      return;
    }

    try {
      this._isPublishing = true;
      const publishPromises = urls.map(async (url) => {
        if (this._publishingRealms.includes(url)) {
          return;
        }
        // Set publishing state
        this._publishingRealms.push(url);

        try {
          const result = await this.realmServer.publishRealm(this.url, url);
          return result;
        } catch (error) {
          console.error(`Error publishing to URL ${url}:`, error);
          throw error; // Re-throw so Promise.allSettled can capture it as rejected
        } finally {
          this._publishingRealms.splice(this._publishingRealms.indexOf(url), 1);
        }
      });

      const results = await Promise.allSettled(publishPromises);
      if (this.info) {
        let lastPublishedAt = results.reduce(
          (acc, result) => {
            if (result.status === 'fulfilled' && result.value) {
              acc[result.value.data.attributes.publishedRealmURL] =
                result.value.data.attributes.lastPublishedAt;
            }
            return acc;
          },
          {} as Record<string, any>,
        );
        this.info = {
          ...this.info,
          lastPublishedAt: {
            ...(this.info.lastPublishedAt &&
            typeof this.info.lastPublishedAt === 'object'
              ? this.info.lastPublishedAt
              : {}),
            ...lastPublishedAt,
          },
        };
      }

      return results;
    } catch (error) {
      console.error(`Error publishing to URLs ${urls}:`, error);
      return;
    } finally {
      this._isPublishing = false;
    }
  }

  get isPublishing() {
    return this._isPublishing;
  }

  get isPublishingToAnyRealms(): boolean {
    return this._publishingRealms.length > 0;
  }

  get publishingRealms(): string[] {
    return this._publishingRealms;
  }

  async unpublish(url: string) {
    if (this._unPublishingRealms.includes(url)) {
      return;
    }

    try {
      this._unPublishingRealms.push(url);
      await this.realmServer.unpublishRealm(url);
      if (
        this.info &&
        this.info.lastPublishedAt &&
        typeof this.info.lastPublishedAt === 'object'
      ) {
        delete this.info.lastPublishedAt[url];
        this.info = {
          ...this.info,
        };
      }
    } catch (error) {
      console.error(`Error unpublishing from URL ${url}:`, error);
      return;
    } finally {
      this._unPublishingRealms.splice(this._unPublishingRealms.indexOf(url), 1);
    }
  }

  isUnpublishingAnyRealms = (): boolean => {
    return this._unPublishingRealms.length > 0;
  };

  isUnpublishingRealm = (publishedRealmURL: string): boolean => {
    return this._unPublishingRealms.includes(publishedRealmURL);
  };
}

export default class RealmService extends Service {
  @service declare private realmServer: RealmServerService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private reset: ResetService;

  // This is not a TrackedMap, it's a regular Map. Conceptually, we want it to
  // be tracked, but we're using it as a read-through cache and glimmer/tracking
  // treats that case as a read-then-write assertion failure. So instead we do
  // untracked reads from `realms` and pair them, at the right times, with
  // tracked reads from `currentKnownRealms` to establish dependencies.
  private _realms: Map<string, RealmResource> = this.restoreSessions();
  private currentKnownRealms = new TrackedSet<string>();
  private reauthentications = new Map<string, Promise<string | undefined>>();

  @tracked private identifyRealmTracker = 0;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  get realms(): ReadonlyMap<string, RealmResource> {
    return this._realms;
  }

  resetState() {
    this.logout();
  }

  async ensureRealmMeta(realmURL: string): Promise<void> {
    let resource = this.getOrCreateRealmResource(realmURL);
    await resource.fetchInfo();
  }

  async login(realmURL: string): Promise<void> {
    let resource = this.getOrCreateRealmResource(realmURL);
    await resource.login();
  }

  info = (url: string): EnhancedRealmInfo => {
    let resource = this.knownRealm(url, false);
    if (!resource) {
      this.identifyRealm.perform(url);

      this.identifyRealmTracker;

      return {
        name: 'Unknown Workspace',
        backgroundURL: null,
        iconURL: null,
        showAsCatalog: null,
        visibility: 'private',
        publishable: null,
        isIndexing: false,
        isPublic: false,
        lastPublishedAt: null,
      };
    }

    if (!resource.info) {
      resource.fetchInfo();
      return {
        name: 'Unknown Workspace',
        backgroundURL: null,
        iconURL: null,
        showAsCatalog: null,
        visibility: 'private',
        publishable: null,
        isIndexing: false,
        isPublic: false,
        lastPublishedAt: null,
      };
    } else {
      return resource.info;
    }
  };

  async allUsersPermissions(url: string) {
    let resource = this.knownRealm(url);
    if (!resource) {
      await this.identifyRealm.perform(url);
    }
    return await resource?.fetchRealmPermissions();
  }

  async setPermissions(
    url: string,
    userId: string,
    permissions: ('read' | 'write')[],
  ) {
    await this.knownRealm(url)?.setRealmPermission(userId, permissions);
  }

  isPublic = (url: string): boolean => {
    return this.knownRealm(url)?.isPublic ?? false;
  };

  canRead = (url: string): boolean => {
    return this.knownRealm(url)?.canRead ?? false;
  };

  canWrite = (url: string): boolean => {
    return this.knownRealm(url)?.canWrite ?? false;
  };

  url = (url: string): string | undefined => {
    return this.knownRealm(url)?.url;
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

  meta = (url: string) => {
    let self = this;
    return {
      get info() {
        return self.info(url);
      },
      get canWrite() {
        return self.canWrite(url);
      },
    };
  };

  get allRealmsInfo() {
    const realmsMeta: Record<
      string,
      { info: EnhancedRealmInfo; canWrite: boolean }
    > = Object.create(null);
    for (const [url, _resource] of this.realms.entries()) {
      realmsMeta[url] = this.meta(url);
    }
    return realmsMeta;
  }

  realmOfURL(url: URL) {
    for (const realm of this.realms.keys()) {
      let realmURL = new URL(realm);
      if (new RealmPaths(realmURL).inRealm(url)) {
        return new URL(realmURL);
      }
    }
    return undefined;
  }

  realmForSessionRoomId(sessionRoomId: string) {
    return Array.from(this.realms.values()).find(
      (r) => r.claims?.sessionRoom === sessionRoomId,
    );
  }

  @cached
  get defaultWritableRealm(): { path: string; info: RealmInfo } | null {
    let maybePersonalRealm = `${this.realmServer.url.href}${this.matrixService.userName}/personal/`;
    if (Object.keys(this.allRealmsInfo).find((r) => r === maybePersonalRealm)) {
      return {
        path: maybePersonalRealm,
        info: this.allRealmsInfo[maybePersonalRealm].info,
      };
    }
    let writeableRealms = Object.entries(this.allRealmsInfo)
      .filter(([, i]) => i.canWrite)
      .sort(([, i], [, j]) => i.info.name.localeCompare(j.info.name));

    let first = writeableRealms[0];

    if (!first) {
      log.debug(
        `No writable realms found, known realms and writability: ${Object.keys(
          this.allRealmsInfo,
        )
          .map(
            (realmUrl) =>
              `${realmUrl}: ${this.allRealmsInfo[realmUrl].canWrite}`,
          )
          .join(', ')}`,
      );

      return null;
    }

    return { path: first[0], info: first[1].info };
  }

  @cached
  get defaultReadableRealm(): { path: string; info: RealmInfo } {
    if (this.defaultWritableRealm) {
      return this.defaultWritableRealm;
    }

    let allRealmsInfoEntries = Object.entries(this.allRealmsInfo);

    if (allRealmsInfoEntries.length > 0) {
      let firstMeta = allRealmsInfoEntries[0];
      return { path: firstMeta[0], info: firstMeta[1].info };
    }

    return {
      path: ENV.resolvedBaseRealmURL,
      info: this.info(ENV.resolvedBaseRealmURL),
    };
  }

  token = (url: string): string | undefined => {
    return this.knownRealm(url, false)?.token;
  };

  logout() {
    for (let realm of this.realms.values()) {
      realm.logout();
    }
  }

  async publish(realmURL: string, publishedRealmURLs: string[]) {
    let resource = this.getOrCreateRealmResource(realmURL);
    return await resource.publish(publishedRealmURLs);
  }

  async unpublish(realmURL: string, publishedRealmURL: string) {
    let resource = this.getOrCreateRealmResource(realmURL);
    return await resource.unpublish(publishedRealmURL);
  }

  isUnpublishingAnyRealms = (realmURL: string): boolean => {
    let resource = this.getOrCreateRealmResource(realmURL);
    return resource.isUnpublishingAnyRealms();
  };

  isUnpublishingRealm = (
    realmURL: string,
    publishedRealmURL: string,
  ): boolean => {
    let resource = this.getOrCreateRealmResource(realmURL);
    return resource.isUnpublishingRealm(publishedRealmURL);
  };

  isPublishing = (realmURL: string): boolean => {
    let resource = this.getOrCreateRealmResource(realmURL);
    return resource.isPublishing;
  };

  publishingRealms = (realmURL: string): string[] => {
    let resource = this.getOrCreateRealmResource(realmURL);
    return resource.publishingRealms;
  };

  // By default, this does a tracked read from currentKnownRealms so that your
  // answer can be invalidated if a new realm is discovered. Internally, we also
  // use it untracked to implement the read-through cache.
  private knownRealm(url: string, tracked = true): RealmResource | undefined {
    for (let [key, value] of this.realms) {
      if (url.startsWith(key)) {
        return value;
      }
    }
    if (tracked) {
      this.currentKnownRealms.has(url);
    }
    return undefined;
  }

  async reauthenticate(realmURL: string): Promise<string | undefined> {
    let inProgressAuthentication = this.reauthentications.get(realmURL);
    if (inProgressAuthentication) {
      return inProgressAuthentication;
    }
    let deferred = new Deferred<string | undefined>();
    this.reauthentications.set(realmURL, deferred.promise);

    let resource = this.getOrCreateRealmResource(realmURL);
    resource.logout();
    await resource.login();
    let result = resource.token;
    deferred.fulfill(result);
    try {
      return result;
    } finally {
      this.reauthentications.delete(realmURL);
    }
  }

  private createRealmResource(
    realmURL: string,
    token: string | undefined,
  ): RealmResource {
    let resource = new RealmResource(realmURL, token);
    setOwner(resource, getOwner(this)!);
    associateDestroyableChild(this, resource);
    return resource;
  }

  getOrCreateRealmResource(
    realmURL: string,
    token: string | undefined = undefined,
  ): RealmResource {
    // this should be the only place we do the untracked read. It needs to be
    // untracked so our `this._realms.set` below will not be an assertion.
    let resource = this.knownRealm(realmURL, false);

    if (resource && !resource?.token && token) {
      resource.token = token;
    }

    if (!resource) {
      resource = this.createRealmResource(realmURL, token);
      this._realms.set(realmURL, resource);
      // only after the set has happened can we safely do the tracked read to
      // establish our depenency.
      this.currentKnownRealms.add(realmURL);
    }
    return resource;
  }

  private identifyRealm = task(
    { maxConcurrency: 1, enqueue: true },
    async (url: string): Promise<void> => {
      if (this.knownRealm(url, false)) {
        // could have already been discovered while we were queued
        return;
      }
      let response = await this.network.authedFetch(url, {
        method: 'HEAD',
      });
      let realmURL = response.headers.get('x-boxel-realm-url');
      if (realmURL) {
        this.getOrCreateRealmResource(realmURL);
        this.identifyRealmTracker = 0;
      }
    },
  );

  private restoreSessions(): Map<string, RealmResource> {
    let sessions: Map<string, RealmResource> = new Map();
    let tokens = SessionStorage.getAll();
    if (tokens) {
      for (let [realmURL, token] of Object.entries(tokens)) {
        let resource = this.createRealmResource(realmURL, token);
        sessions.set(realmURL, resource);
      }
    }
    return sessions;
  }
}

export const tokenRefreshPeriodSec = 5 * 60; // 5 minutes

export function claimsFromRawToken(rawToken: string): JWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as JWTPayload;
}

let SessionStorage = {
  getAll(): Record<string, string> | undefined {
    let sessionsString = window.localStorage.getItem(SessionLocalStorageKey);
    if (sessionsString) {
      return JSON.parse(sessionsString);
    }
    return undefined;
  },
  persist(realmURL: string, token: string | undefined) {
    let sessionStr =
      window.localStorage.getItem(SessionLocalStorageKey) ?? '{}';
    let session = JSON.parse(sessionStr);
    if (session[realmURL] !== token) {
      session[realmURL] = token;
      window.localStorage.setItem(
        SessionLocalStorageKey,
        JSON.stringify(session),
      );
    }
  },
};

declare module '@ember/service' {
  interface Registry {
    realm: RealmService;
  }
}
