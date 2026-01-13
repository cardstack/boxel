import { service } from '@ember/service';

import type { Filter } from '@cardstack/runtime-common';
import { assertQuery } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

export class SearchCardsByTypeAndTitleCommand extends HostBaseCommand<
  typeof BaseCommandModule.SearchCardsByTypeAndTitleInput,
  typeof BaseCommandModule.SearchCardsResult
> {
  description = 'Search for card instances by type and/or title';

  static actionVerb = 'Search';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SearchCardsByTypeAndTitleInput } = commandModule;
    return SearchCardsByTypeAndTitleInput;
  }

  protected async run(
    input: BaseCommandModule.SearchCardsByTypeAndTitleInput,
  ): Promise<BaseCommandModule.SearchCardsResult> {
    if (!input.title && !input.cardType && !input.type) {
      throw new Error(
        'At least one of title, cardType, or type must be provided',
      );
    }
    let filter = {} as any;
    if (input.title) {
      filter.contains = { title: input.title };
    }
    if (input.cardType) {
      filter.eq = { _cardType: input.cardType };
    }
    if (input.type) {
      filter.type = input.type;
    }
    return new SearchCardsByQueryCommand(this.commandContext).execute({
      query: {
        filter: filter as Filter,
      },
    });
  }
}

export class SearchCardsByQueryCommand extends HostBaseCommand<
  typeof BaseCommandModule.SearchCardsByQueryInput,
  typeof BaseCommandModule.SearchCardsResult
> {
  @service declare private store: StoreService;
  @service declare private realmServer: RealmServerService;

  description =
    'Propose a query to search for a card instance filtered by type. \
  If a card was shared with you, always prioritize search based upon the card that was last shared. \
  If you do not have information on card module and name, do the search using the `_cardType` attribute.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SearchCardsByQueryInput } = commandModule;
    return SearchCardsByQueryInput;
  }

  requireInputFields = ['query'];

  protected async run(
    input: BaseCommandModule.SearchCardsByQueryInput,
  ): Promise<BaseCommandModule.SearchCardsResult> {
    assertQuery(input.query);
    let realmUrls = this.realmServer.availableRealmURLs;
    let instances: CardDef[] = [];
    try {
      instances = await this.store.search(input.query, realmUrls);
    } catch (e) {
      console.error(`Error searching in realms:`, e, input.query);
    }

    let commandModule = await this.loadCommandModule();
    const { SearchCardsResult, SearchCardSummaryField } = commandModule;
    let resultCard = new SearchCardsResult({
      cardIds: instances.map((c) => c.id),
      instances,
      summaries: instances.map(
        (c) =>
          new SearchCardSummaryField({
            id: c.id,
            title: c.title,
          }),
      ),
      description: `Query: ${JSON.stringify(input.query.filter, null, 2)}`,
    });
    return resultCard;
  }
}
