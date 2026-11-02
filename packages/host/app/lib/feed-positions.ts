import { FEED_POSITION_HEADER } from '@cardstack/runtime-common';

// The feed positions the page's reads carried (ADR event-feed §1.1), so a realm's
// feed opens from the earliest of what the page holds: a change made between
// a read and the feed opening is then replayed rather than missed.
//
// Kept per URL, first position only, since the earliest copy of a resource is
// the one a missed change would leave stale. Bounded: past the cap, new URLs
// are not recorded, which keeps the earliest positions.
const MAX_URLS = 2000;
const positions = new Map<string, { epoch: string; seq: number }>();

export function noteFeedPosition(url: string, header: string | null) {
  if (!header || positions.has(url) || positions.size >= MAX_URLS) {
    return;
  }
  // A write's range names its own changes; what the page holds after it is
  // the state at the end of the range.
  let [epoch, range] = header.split(':');
  let seq = Number(range?.split('-').pop());
  if (epoch && Number.isInteger(seq)) {
    positions.set(url, { epoch, seq });
  }
}

// The earliest position among what the page read from the realm at `base`,
// as an event id, or undefined when it read nothing that carried one.
export function earliestFeedPosition(base: string): string | undefined {
  let earliest: { epoch: string; seq: number } | undefined;
  let epochs = new Set<string>();
  for (let [url, position] of positions) {
    if (!url.startsWith(base)) {
      continue;
    }
    epochs.add(position.epoch);
    if (!earliest || position.seq < earliest.seq) {
      earliest = position;
    }
  }
  if (!earliest) {
    return undefined;
  }
  // Reads from two epochs: the realm restarted between them, so whatever the
  // page holds from before needs revalidating. An id from no epoch the realm
  // serves gets a reset.
  return epochs.size > 1 ? 'restarted:0' : `${earliest.epoch}:${earliest.seq}`;
}

// Records the position each response carries.
export function notingFeedPositions(
  fetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    let response = await fetch(input, init);
    let header = response.headers.get(FEED_POSITION_HEADER);
    if (header) {
      noteFeedPosition(response.url || new Request(input, init).url, header);
    }
    return response;
  };
}

export function resetFeedPositionsForTests() {
  positions.clear();
}
