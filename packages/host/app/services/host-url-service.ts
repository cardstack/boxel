import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';
import type {
  HostURL,
  HostURLList,
} from '@cardstack/host/services/realm-server';
import type SessionService from '@cardstack/host/services/session';

// What the app knows about a realm's host URLs (ADR 033). `loadError` is set
// when the last read failed; the host URLs from an earlier read stay.
export interface HostURLState {
  hostURLs: HostURL[];
  // The Boxel Space URL the realm can be mounted at, in its owner's Space.
  boxelSpaceURL: string | undefined;
  loadError: string | undefined;
}

interface ChangeOptions {
  refresh?: boolean;
}

// Holds each realm's host URLs, so everything that shows them (the host URL
// manager, the Open Site button) reads one list, and a change made in one
// place shows in the others. Each change goes through here and reads the
// list again.
export default class HostURLService extends Service {
  @service declare private realmServer: RealmServerService;
  @service declare private session: SessionService;

  // By realm URL, with a trailing slash. A realm has an entry only after its
  // first read finishes.
  private states = new TrackedMap<string, HostURLState>();
  // The realms `load` has read, by realm URL. Not tracked, so a render that
  // calls `load` doesn't depend on it.
  private loaded = new Set<string>();
  // The last read started, by realm URL. A read that finishes after a newer
  // one started, or after the session was reset, writes nothing.
  private requestIds = new Map<string, number>();
  private lastRequestId = 0;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.states.clear();
    this.loaded.clear();
    this.requestIds.clear();
  }

  stateFor(realmURL: string): HostURLState | undefined {
    return this.states.get(ensureTrailingSlash(realmURL));
  }

  hostURLsFor(realmURL: string): HostURL[] {
    return this.stateFor(realmURL)?.hostURLs ?? [];
  }

  canonicalFor(realmURL: string): HostURL | undefined {
    return this.hostURLsFor(realmURL).find((hostURL) => hostURL.isCanonical);
  }

  // Reads the realm's host URLs the first time it is called for the realm. A
  // later call does nothing, also after a failed read: a failure is kept in
  // the state, not thrown, and `refresh` reads again. It is safe to call
  // while rendering: it reads no tracked state, and writes none before its
  // first await.
  load(realmURL: string): void {
    let key = ensureTrailingSlash(realmURL);
    if (this.loaded.has(key)) {
      return;
    }
    this.loaded.add(key);
    this.refresh(realmURL).catch(() => {
      // `refresh` keeps the failure in the state.
    });
  }

  // Reads the realm's host URLs again. Throws when the read fails.
  async refresh(realmURL: string): Promise<HostURLState> {
    let key = ensureTrailingSlash(realmURL);
    let requestId = ++this.lastRequestId;
    this.requestIds.set(key, requestId);
    let list: HostURLList;
    try {
      list = await this.realmServer.listHostURLs(realmURL);
    } catch (error) {
      if (this.requestIds.get(key) === requestId) {
        let previous = this.states.get(key);
        this.states.set(key, {
          hostURLs: previous?.hostURLs ?? [],
          boxelSpaceURL: previous?.boxelSpaceURL,
          loadError: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
    let state: HostURLState = {
      hostURLs: list.hostURLs,
      boxelSpaceURL: list.boxelSpaceURL,
      loadError: undefined,
    };
    if (this.requestIds.get(key) === requestId) {
      this.states.set(key, state);
    }
    return this.states.get(key) ?? state;
  }

  async mount(realmURL: string, url: string): Promise<void> {
    await this.realmServer.mountHostURL(realmURL, url);
    await this.refresh(realmURL);
  }

  // A change reads the list again, unless `refresh` is false. A caller that
  // must know that the change was made, also when the read after it fails,
  // gives false and calls `refresh` itself.
  async setCanonical(
    realmURL: string,
    id: string,
    { refresh = true }: ChangeOptions = {},
  ): Promise<void> {
    await this.realmServer.setCanonicalHostURL(id);
    if (refresh) {
      await this.refresh(realmURL);
    }
  }

  async unmount(
    realmURL: string,
    id: string,
    { refresh = true }: ChangeOptions = {},
  ): Promise<void> {
    await this.realmServer.unmountHostURL(id);
    if (refresh) {
      await this.refresh(realmURL);
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-url-service': HostURLService;
  }
}
