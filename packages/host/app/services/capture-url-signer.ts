import Service, { service } from '@ember/service';

import {
  CAPTURE_SERVING_PREFIX,
  CAPTURE_URL_TOKEN_TTL_MS,
  MAX_CAPTURE_URLS_PER_SIGNING_REQUEST,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import type NetworkService from './network';

// How much remaining token life is too little to hand out. A signed URL is
// consumed at load time (viewers save from buffered bytes, so expiry after
// load is harmless), but a URL handed to an <object> or a new tab needs
// enough life to survive the fetch it triggers.
const REMINT_SLACK_MS = 2 * 60 * 1000;

interface SignedEntry {
  url: string;
  signedUrl: string;
  expiresAt: string | null;
}

interface MemoEntry {
  signedUrl: string;
  // When to stop handing this out and re-mint. An unsigned echo (public
  // realm) still gets a horizon so a realm turning private is noticed.
  staleAtMs: number;
}

interface PendingBatch {
  urls: Set<string>;
  waiters: Map<
    string,
    { resolve: (signedUrl: string) => void; reject: (e: unknown) => void }[]
  >;
}

// Mints and caches signed capture URLs — the `?token=` variants that
// authorize a `_capture/` GET without an Authorization header, for the
// fetches the auth service worker cannot reach (`<object>`/`<embed>` loads,
// new-tab navigations). One memo per durable URL, re-minted when its token
// nears expiry; concurrent requests against the same realm coalesce into a
// single `_sign-capture-urls` call per microtask turn. Signed URLs are
// ephemeral view-layer values: render them or navigate to them, never
// persist them — the durable URL is the only storable reference.
export default class CaptureUrlSignerService extends Service {
  @service declare private network: NetworkService;

  private memo = new Map<string, MemoEntry>();
  private pendingByRealm = new Map<string, PendingBatch>();

  // Resolves to the URL to actually load: the durable URL with a fresh
  // token appended, or the durable URL itself when the realm serves it
  // anonymously (the endpoint echoes unsigned for public realms).
  async getSignedUrl(durableUrl: string): Promise<string> {
    let hit = this.memo.get(durableUrl);
    if (hit && hit.staleAtMs > Date.now()) {
      return hit.signedUrl;
    }
    let realm = realmRootOfCaptureURL(durableUrl);
    return new Promise<string>((resolve, reject) => {
      let batch = this.pendingByRealm.get(realm);
      if (!batch) {
        batch = { urls: new Set(), waiters: new Map() };
        this.pendingByRealm.set(realm, batch);
        // Flush on a microtask so every getSignedUrl call issued during one
        // render pass lands in a single request.
        Promise.resolve().then(() => this.flush(realm));
      }
      batch.urls.add(durableUrl);
      let waiters = batch.waiters.get(durableUrl);
      if (!waiters) {
        waiters = [];
        batch.waiters.set(durableUrl, waiters);
      }
      waiters.push({ resolve, reject });
    });
  }

  private async flush(realm: string) {
    let batch = this.pendingByRealm.get(realm);
    this.pendingByRealm.delete(realm);
    if (!batch) {
      return;
    }
    let urls = [...batch.urls];
    try {
      let entries: SignedEntry[] = [];
      for (
        let i = 0;
        i < urls.length;
        i += MAX_CAPTURE_URLS_PER_SIGNING_REQUEST
      ) {
        let chunk = urls.slice(i, i + MAX_CAPTURE_URLS_PER_SIGNING_REQUEST);
        let response = await this.network.authedFetch(
          `${realm}_sign-capture-urls`,
          {
            method: 'POST',
            headers: {
              Accept: SupportedMimeType.JSON,
              'Content-Type': SupportedMimeType.JSON,
              'X-HTTP-Method-Override': 'QUERY',
            },
            body: JSON.stringify({ urls: chunk }),
          },
        );
        if (!response.ok) {
          throw new Error(
            `Signing capture URLs failed: ${response.status} ${await response.text()}`,
          );
        }
        entries.push(
          ...((await response.json()) as { signed: SignedEntry[] }).signed,
        );
      }
      let now = Date.now();
      for (let entry of entries) {
        let staleAtMs = entry.expiresAt
          ? new Date(entry.expiresAt).getTime() - REMINT_SLACK_MS
          : now + CAPTURE_URL_TOKEN_TTL_MS - REMINT_SLACK_MS;
        this.memo.set(entry.url, { signedUrl: entry.signedUrl, staleAtMs });
        for (let waiter of batch.waiters.get(entry.url) ?? []) {
          waiter.resolve(entry.signedUrl);
        }
        batch.waiters.delete(entry.url);
      }
      // A URL the response didn't cover (shouldn't happen) must not hang.
      for (let [url, waiters] of batch.waiters) {
        for (let waiter of waiters) {
          waiter.reject(new Error(`No signed entry returned for ${url}`));
        }
      }
    } catch (e) {
      for (let waiters of batch.waiters.values()) {
        for (let waiter of waiters) {
          waiter.reject(e);
        }
      }
    }
  }
}

// The realm root a capture URL serves from: everything up to its
// `_capture/` segment. Throws on anything else, so a mistyped URL fails
// at the call site rather than as a realm-server 400.
export function realmRootOfCaptureURL(durableUrl: string): string {
  let marker = durableUrl.indexOf(CAPTURE_SERVING_PREFIX);
  if (marker < 1) {
    throw new Error(
      `${durableUrl} is not a capture URL (expected a ${CAPTURE_SERVING_PREFIX} segment)`,
    );
  }
  return durableUrl.slice(0, marker);
}

declare module '@ember/service' {
  interface Registry {
    'capture-url-signer': CaptureUrlSignerService;
  }
}
