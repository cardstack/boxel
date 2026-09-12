import { service } from '@ember/service';

import type { Filter } from '@cardstack/runtime-common';
import { assertQuery } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export class SearchCardsByTypeAndTitleTool extends HostBaseTool<
  typeof BaseToolModule.SearchCardsByTypeAndTitleInput,
  typeof BaseToolModule.SearchCardsResult
> {
  description =
    'Search for live card instances by type and/or title when you need the ' +
    'instances themselves — to attach, open, copy, or patch. For discovery ' +
    '(finding what exists — card types, specs, listings, files), use the ' +
    'search-entries tool instead.';

  static actionVerb = 'Search';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SearchCardsByTypeAndTitleInput } = commandModule;
    return SearchCardsByTypeAndTitleInput;
  }

  protected async run(
    input: BaseToolModule.SearchCardsByTypeAndTitleInput,
  ): Promise<BaseToolModule.SearchCardsResult> {
    if (!input.cardTitle && !input.cardType && !input.type) {
      throw new Error(
        'At least one of cardTitle, cardType, or type must be provided',
      );
    }
    let filter = {} as any;
    if (input.cardTitle) {
      filter.contains = { cardTitle: input.cardTitle };
    }
    if (input.cardType) {
      filter.eq = { _cardType: input.cardType };
    }
    if (input.type) {
      filter.type = input.type;
    }
    return new SearchCardsByQueryTool(this.toolContext).execute({
      query: {
        filter: filter as Filter,
      },
    });
  }
}

export class SearchCardsByQueryTool extends HostBaseTool<
  typeof BaseToolModule.SearchCardsByQueryInput,
  typeof BaseToolModule.SearchCardsResult
> {
  @service declare private store: StoreService;
  @service declare private realmServer: RealmServerService;

  description =
    'Search for live card instances by query when you need the instances ' +
    'themselves — to attach, open, copy, or patch. If a card was shared with ' +
    'you, always prioritize search based upon the card that was last shared. ' +
    'For discovery (finding what exists — card types, specs, listings, ' +
    'files, or anything reusable), use the search-entries tool instead.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SearchCardsByQueryInput } = commandModule;
    return SearchCardsByQueryInput;
  }

  requireInputFields = ['query'];

  protected async run(
    input: BaseToolModule.SearchCardsByQueryInput,
  ): Promise<BaseToolModule.SearchCardsResult> {
    assertQuery(input.query);
    let realmUrls = this.realmServer.availableRealmIdentifiers;
    let instances: CardDef[] = [];
    try {
      // store.search pins `scope: 'cards'`, so the raw query already resolves
      // to card instances only.
      instances = await this.store.search(input.query, realmUrls);
    } catch (e) {
      console.error(`Error searching in realms:`, e, input.query);
    }

    let commandModule = await this.loadToolModule();
    const { SearchCardsResult, SearchCardSummaryField } = commandModule;
    let resultCard = new SearchCardsResult({
      cardIds: instances.map((c) => c.id),
      instances,
      summaries: instances.map(
        (c) =>
          new SearchCardSummaryField({
            id: c.id,
            cardTitle: c.cardTitle,
          }),
      ),
      cardDescription: `Query: ${JSON.stringify(input.query.filter, null, 2)}`,
    });
    return resultCard;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SearchCardsByTypeAndTitleTool as SearchCardsByTypeAndTitleCommand };
export { SearchCardsByQueryTool as SearchCardsByQueryCommand };
