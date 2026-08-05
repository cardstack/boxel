import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type { InitialFileContent } from '@cardstack/host/resources/file';
import type NetworkService from '@cardstack/host/services/network';
import type SessionService from '@cardstack/host/services/session';

const maxCachedEntries = 48;
const maxCachedBytes = 8 * 1024 * 1024;
const maxSingleEntryBytes = 1024 * 1024;

interface CacheEntry {
  bytes: number;
  snapshot: InitialFileContent;
}

// Monaco navigation is allowed to lead source validation. Keep a small,
// session-scoped cache of canonical source responses so returning to a file
// can update the persistent editor on the next render while a background GET
// validates it. This cache never crosses sign-in boundaries.
export default class CodeSourceCacheService extends Service {
  @service declare private network: NetworkService;
  @service declare private session: SessionService;

  private entries = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<InitialFileContent | undefined>>();
  private cachedBytes = 0;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  sourceFor(url: string): InitialFileContent | undefined {
    let entry = this.entries.get(url);
    if (!entry) {
      return undefined;
    }
    // Refresh LRU order without introducing tracked state into navigation.
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.snapshot;
  }

  remember(url: string, source: InitialFileContent): InitialFileContent {
    // Reuse snapshots when one URL aliases another (for example a redirect).
    // FileResource uses snapshot identity to distinguish a cache seed from a
    // newly-arrived response, so cloning here would make aliases look stale.
    let snapshot = Object.isFrozen(source)
      ? source
      : Object.freeze({ ...source });
    let bytes = source.content.length * 2;
    if (bytes > maxSingleEntryBytes) {
      return snapshot;
    }

    let previous = this.entries.get(url);
    if (previous) {
      this.cachedBytes -= previous.bytes;
      this.entries.delete(url);
    }
    this.entries.set(url, { bytes, snapshot });
    this.cachedBytes += bytes;
    this.trim();
    return snapshot;
  }

  prefetch(url: URL): Promise<InitialFileContent | undefined> {
    let cached = this.sourceFor(url.href);
    if (cached) {
      return Promise.resolve(cached);
    }
    let existing = this.pending.get(url.href);
    if (existing) {
      return existing;
    }
    let pending = this.fetchSource(url).finally(() => {
      this.pending.delete(url.href);
    });
    this.pending.set(url.href, pending);
    return pending;
  }

  resetState() {
    this.entries.clear();
    this.pending.clear();
    this.cachedBytes = 0;
  }

  willDestroy() {
    this.resetState();
    super.willDestroy();
  }

  private async fetchSource(
    requestedURL: URL,
  ): Promise<InitialFileContent | undefined> {
    try {
      let response = await this.network.authedFetch(requestedURL, {
        headers: { Accept: SupportedMimeType.CardSource },
      });
      if (!response.ok) {
        await response.body?.cancel();
        return undefined;
      }
      let realmURL = response.headers.get('x-boxel-realm-url');
      if (!realmURL) {
        await response.body?.cancel();
        return undefined;
      }
      let buffer = await response.arrayBuffer();
      let source = {
        content: new TextDecoder().decode(buffer),
        lastModified: response.headers.get('last-modified') ?? undefined,
        realmURL,
        size: buffer.byteLength,
      };
      let snapshot = this.remember(response.url, source);
      if (response.url !== requestedURL.href) {
        this.remember(requestedURL.href, snapshot);
      }
      return snapshot;
    } catch {
      // Prefetch is an optional latency optimization. The normal FileResource
      // request remains the authority and owns user-visible errors.
      return undefined;
    }
  }

  private trim() {
    while (
      this.entries.size > maxCachedEntries ||
      this.cachedBytes > maxCachedBytes
    ) {
      let oldest = this.entries.entries().next().value as
        | [string, CacheEntry]
        | undefined;
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest[0]);
      this.cachedBytes -= oldest[1].bytes;
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'code-source-cache': CodeSourceCacheService;
  }
}
