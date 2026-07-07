import { logger } from '@cardstack/runtime-common';
import {
  BROADCAST_REALM_EVENT,
  postWorkerRequest,
  type WorkerRequestBody,
} from '@cardstack/runtime-common/worker-request';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import { normalizeRealmURL } from '../utils/realm-url.ts';

const log = logger('worker-manager');

export interface WorkerRealmEventTarget {
  // The realm-server origin to POST to (reachable — the `--toUrl` origin).
  origin: string;
  // The canonical realm url the realm server is keyed by. This is `Realm.url`
  // (`main.ts` backfills it from `hrefs[i][0]`): the `--fromUrl` for URL-form
  // mappings, the `--toUrl` for realm-prefix mappings (where `main.ts` pushes
  // `[to, to]`). The realm registry and the endpoint's
  // `reconciler.lookupOrMount` are keyed by this, and hosts subscribe to it, so
  // the forwarded event must carry it — never the `--toUrl` when they differ
  // (e.g. base maps `cardstack.com/base/` → `app.boxel.ai/base/`).
  realmURL: string;
}

// Resolve the reachable realm-server origin and the canonical realm url for a
// worker-originated event from the manager's realm→server (`--fromUrl/--toUrl`)
// mappings. Matching against the configured mappings is an allow-list: the
// manager only forwards for realms it manages, and only to the exact server
// origin it was configured with — never to an origin derived from worker input.
export function resolveWorkerRealmEventTarget(
  urlMappings: [URL | string, URL][],
  realmURL: string,
): WorkerRealmEventTarget | undefined {
  // Registry keys are canonicalized (one trailing slash, no search/hash), so
  // canonicalize the incoming url before comparing to avoid a silent drop on a
  // trivially-different spelling.
  let normalized = normalizeRealmURL(realmURL)?.href ?? realmURL;
  for (let [from, to] of urlMappings) {
    let canonicalHref = from instanceof URL ? from.href : to.href;
    if (normalized === canonicalHref || normalized === to.href) {
      return { origin: to.origin, realmURL: canonicalHref };
    }
  }
  return undefined;
}

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 250;

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms).unref());

// Forward a worker-originated realm event to the realm server over the
// authenticated /_worker-request endpoint. Best-effort with a short retry on
// transport / 5xx errors: a dropped event degrades to the same staleness the
// periodic re-index / catch-up sweep already tolerates, so a final failure is
// logged, not fatal. A 4xx (bad request / auth) won't improve on retry, so we
// stop early. Delivery is at-least-once — a lost HTTP response after a
// successful broadcast triggers a re-send, which consumers tolerate because
// realm events drive idempotent re-invalidation. Returns true on delivery.
export async function forwardWorkerRealmEvent({
  event,
  urlMappings,
  secret,
  fetch = globalThis.fetch,
  now = () => Date.now(),
  sleep = defaultSleep,
}: {
  event: RealmEventContent;
  urlMappings: [URL | string, URL][];
  secret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  let target = resolveWorkerRealmEventTarget(urlMappings, event.realmURL);
  if (!target) {
    log.warn(
      `dropping worker realm event for unmanaged realm ${event.realmURL} (eventName=${event.eventName})`,
    );
    return false;
  }
  // Carry the canonical realm url the endpoint resolves by (Realm.url),
  // regardless of which alias the caller used. The realm-server adapter stamps
  // the resolved realm's url on the broadcast anyway, but the endpoint's
  // registry lookup needs the canonical form to resolve at all.
  let outgoing: RealmEventContent =
    event.realmURL === target.realmURL
      ? event
      : { ...event, realmURL: target.realmURL };

  let lastErr: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      let response = await postWorkerRequest({
        realmServerURL: target.origin,
        secret,
        type: BROADCAST_REALM_EVENT,
        payload: outgoing,
        fetch,
        now: now(),
      });
      if (response.ok) {
        return true;
      }
      let detail = await response.text().catch(() => '');
      lastErr = `${response.status} ${response.statusText}${
        detail ? `: ${detail}` : ''
      }`;
      // 4xx won't succeed on retry (malformed body / rejected signature).
      if (response.status >= 400 && response.status < 500) {
        break;
      }
    } catch (e) {
      lastErr = e;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  log.error(
    `failed to forward worker realm event for ${event.realmURL} after ${attempts} attempt(s): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
  return false;
}

// Dispatch a worker request received over the IPC channel to its handler,
// keyed on the request `type`. This is the generic manager-side seam: a new
// worker-originated request adds a `case` here (and a matching handler on the
// realm server's /_worker-request endpoint) without changing the transport.
export function dispatchWorkerRequest(
  request: WorkerRequestBody,
  ctx: {
    urlMappings: [URL | string, URL][];
    secret: string;
    workerName?: string;
    fetch?: typeof globalThis.fetch;
  },
): Promise<boolean> {
  switch (request.type) {
    case BROADCAST_REALM_EVENT:
      return forwardWorkerRealmEvent({
        event: request.payload as RealmEventContent,
        urlMappings: ctx.urlMappings,
        secret: ctx.secret,
        fetch: ctx.fetch,
      });
    default:
      log.warn(
        `ignoring unknown worker request type '${request.type}'${
          ctx.workerName ? ` from worker ${ctx.workerName}` : ''
        }`,
      );
      return Promise.resolve(false);
  }
}
