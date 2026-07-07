import { logger } from '@cardstack/runtime-common';
import { sendWorkerRealmEvent } from '@cardstack/runtime-common/worker-realm-event';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

const log = logger('worker-manager');

// Resolve the reachable realm-server URL for a worker-originated event from the
// manager's realm→server (--fromUrl/--toUrl) mappings. A job carries its
// realm's canonical url (realm.url), which equals the mapping's `to`, so the
// match is normally against `to`; we also accept a `from` (URL-form alias) for
// robustness. Matching against the configured mappings is an allow-list: the
// manager only forwards for realms it manages, and only to the exact server URL
// it was configured with — never to an origin derived from worker input.
export function resolveWorkerRealmEventTarget(
  urlMappings: [URL | string, URL][],
  realmURL: string,
): URL | undefined {
  for (let [from, to] of urlMappings) {
    let fromHref = from instanceof URL ? from.href : from;
    if (realmURL === to.href || realmURL === fromHref) {
      return to;
    }
  }
  return undefined;
}

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 250;

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms).unref());

// Forward a worker-originated realm event to the realm server over the
// authenticated /_worker-event endpoint. Best-effort with a short retry on
// transport / 5xx errors: a dropped event degrades to the same staleness the
// periodic re-index / catch-up sweep already tolerates, so a final failure is
// logged, not fatal. A 4xx (bad request / auth) won't improve on retry, so we
// stop early. Returns true on delivery.
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
  // Normalize the event's realmURL to the canonical (to) realm url so the
  // endpoint's registry lookup resolves it regardless of which mapping side
  // matched.
  let normalizedEvent = {
    ...event,
    realmURL: target.href,
  } as RealmEventContent;

  let lastErr: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      let response = await sendWorkerRealmEvent({
        realmServerURL: target.origin,
        secret,
        event: normalizedEvent,
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
