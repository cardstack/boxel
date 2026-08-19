import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  GetCardCollectionContextName,
  type getCardCollection,
  type SearchResultsYield,
} from '@cardstack/runtime-common';

import type { CardDef } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    // The recent card ids to resolve live, when the fallback is needed.
    cardIds: string[];
    // The recents `<SearchResults>` results — the fallback engages only when its
    // prerendered search threw (e.g. a multi-realm setup where federated search
    // can't be authorized). An empty result is legitimate (filter/realm excluded
    // all recents) and must NOT engage the fallback, or it would resurrect cards
    // the user filtered out.
    recentsResults: SearchResultsYield;
  };
  Blocks: {
    default: [CardDef[]];
  };
}

// Resolves the recent cards as live instances, but only when the prerendered
// recents search failed — the lazy live fallback for the recents row. The
// `getCardCollection` resource is created once (a `@cached` getter, so the
// consumed context is injected before it runs) and varied through its reactive
// thunk: while the fallback is off the thunk yields an empty id list, so no card
// modules load on the happy path; when the recents search errors it resolves the
// ids.
export default class LiveRecentsProvider extends Component<Signature> {
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;

  private get enabled(): boolean {
    return (
      this.args.cardIds.length > 0 &&
      (this.args.recentsResults.errors?.length ?? 0) > 0
    );
  }

  @cached
  private get collection(): ReturnType<getCardCollection> {
    return this.getCardCollection(this, () =>
      this.enabled ? this.args.cardIds : [],
    );
  }

  private get liveCards(): CardDef[] {
    return (this.collection.cards?.filter(Boolean) as CardDef[]) ?? [];
  }

  <template>{{yield this.liveCards}}</template>
}
