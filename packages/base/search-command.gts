import { codeRefWithAbsoluteURL, getCards } from '@cardstack/runtime-common';
import { CardTypeFilter, Query } from '@cardstack/runtime-common/query';
import { CommandField } from './command';
import { tracked } from 'tracked-built-ins';
import { type CardDef } from 'https://cardstack.com/base/card-api';

export type SearchObject = {
  search: {
    card_id: string; //we search relative to the card that is shared
    filter: CardTypeFilter; //TODO: can be enhanced by other filter types
  };
};

export interface SearchCardPayload {
  type: 'searchCard';
  payload: SearchObject;
  eventId: string;
}

export class SearchCommandField extends CommandField {
  protected hostCommand = getCards;

  @tracked
  private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };

  get hostCommandArgs() {
    let query = (this.payload as SearchObject).search;
    let adoptsFrom = {
      name: query.filter.type.name,
      module: query.filter.type.module,
    };
    //If ai returns a relative module path, we make it absolute
    let maybeCodeRef = codeRefWithAbsoluteURL(
      adoptsFrom,
      new URL(query.card_id), //relative to the attached card id shared
    );
    if ('name' in maybeCodeRef && 'module' in maybeCodeRef) {
      query.filter.type = maybeCodeRef;
    }
    return {
      filter: { type: query.filter.type },
    } as Query;
  }
}
