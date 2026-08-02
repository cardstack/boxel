import {
  realmURL,
  type Query,
  type getCard as GetCard,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/search/search-results';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import type StoreService from '@cardstack/host/services/store';

import type { BaseDef, CardContext } from '@cardstack/base/card-api';

export function buildCardIslandContext(store: StoreService, card: BaseDef) {
  let currentRealm = card[realmURL]?.href;
  let cardFacingStore = store.cardFacingStore(() => currentRealm);
  let getCardForContext = getCard as unknown as GetCard;
  let getCards = (
    parent: object,
    getQuery: () => Query | undefined,
    getRealms?: () => string[] | undefined,
    opts?: { isLive?: boolean; doWhileRefreshing?: () => void },
  ) =>
    store.getSearchResource(parent, getQuery, getRealms, {
      ...opts,
      cardInitiated: true,
      getDefaultRealm: () => currentRealm,
    });
  let context: CardContext = {
    getCard: getCardForContext,
    getCards,
    getCardCollection,
    store: cardFacingStore,
    searchResultsComponent: SearchResults,
    mode: 'host',
    submode: 'host',
  };

  return {
    getCard: getCardForContext,
    getCards,
    getCardCollection,
    context,
  };
}
