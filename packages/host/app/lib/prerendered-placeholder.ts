import { rri } from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

interface Services {
  network: NetworkService;
  realm: RealmService;
  realmServer: RealmServerService;
}

// The index's server-rendered isolated HTML for one card, used as a static
// stand-in while the live card body is deferred behind a crossing. It is a
// placeholder, so every failure (unknown realm, no rendering yet, a slow or
// refused request) resolves to undefined and the crossing proceeds as before.
export async function fetchIsolatedPlaceholder(
  { network, realm, realmServer }: Services,
  cardId: string,
  { timeoutMs = 1500, maxResponseLength = 100_000 } = {},
): Promise<string | undefined> {
  let controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let realmId = realm.realmOf(rri(cardId));
    if (!realmId) return undefined;
    let virtualNetwork = network.virtualNetwork;
    let realmHref = virtualNetwork.toURL(realmId).href;
    let [realmServerURL] = realmServer.getRealmServersForRealms([realmHref]);
    if (!realmServerURL) return undefined;
    let cardHref = virtualNetwork.toURL(cardId).href;
    let response = await realmServer.maybeAuthedFetchForRealms(
      new URL('_federated-search', realmServerURL).href,
      [realmHref],
      {
        method: 'QUERY',
        headers: {
          Accept: 'application/vnd.card+json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          realms: [realmHref],
          cardUrls: [
            cardHref.endsWith('.json') ? cardHref : `${cardHref}.json`,
          ],
          // Pins the instance row rather than the card file's dual-indexed row.
          scope: 'cards',
          filter: { eq: { htmlQuery: { eq: { format: 'isolated' } } } },
          fields: { entry: ['html'] },
        }),
      },
    );
    if (!response.ok) return undefined;
    // Parsing and inserting a very large rendering lands in the first frames
    // of the flight (the 426 KB, 2,754-node PretUI catalog stuttered for
    // ~140 ms). Past this size the hollow crossing is smoother; the live body
    // follows the landing either way.
    let text = await response.text();
    if (text.length > maxResponseLength) return undefined;
    let json = JSON.parse(text);
    let htmlRef = json?.data?.[0]?.relationships?.html?.data?.[0];
    let html = (json?.included ?? []).find(
      (resource: { type?: string; id?: string }) =>
        resource?.type === 'html' && resource?.id === htmlRef?.id,
    )?.attributes?.html;
    return typeof html === 'string' && html.trim() ? html : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
