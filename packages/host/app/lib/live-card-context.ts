import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import type EventFeedService from '../services/event-feed';
import type RealmService from '../services/realm';
import type { CardContext, CardDef } from '@cardstack/base/card-api';

// The card-context functions that keep a page live (ADR 023 §1.6, §1.8),
// built in one place for every context the host provides, so no context
// offers one of them and not the other.
export function liveCardContext(
  eventFeed: EventFeedService,
  realm: RealmService,
): Required<Pick<CardContext, 'followChannel' | 'takeRefreshRequests'>> {
  return {
    followChannel: (card, onMessage) => {
      let cardURL = typeof card === 'string' ? card : card.id;
      if (!cardURL) {
        return () => {};
      }
      // A card knows the realm it was read from, under the site's alias on a
      // site, which the realm service may never have been told of.
      let realmURL =
        (typeof card === 'string'
          ? undefined
          : (card as CardDef & { [realmURLSymbol]?: URL })[realmURLSymbol]
              ?.href) ?? realm.realmURLOf(cardURL);
      return eventFeed.followChannel(cardURL, realmURL, onMessage);
    },
    takeRefreshRequests: (taker) => eventFeed.takeRefreshRequests(taker),
  };
}
