import { Query, baseRealm } from '@cardstack/runtime-common';
import { Filter, SortExpression } from '@cardstack/runtime-common';
import { tracked } from 'tracked-built-ins';

const DEFAULT_QUERY = {
  filter: {
    not: {
      eq: {
        _cardType: 'Cards Grid',
      },
    },
  },
  // sorting by title so that we can maintain stability in
  // the ordering of the search results (server sorts results
  // by order indexed by default)
  sort: [
    {
      on: {
        module: `${baseRealm.url}card-api`,
        name: 'CardDef',
      },
      by: '_cardType',
    },
    {
      on: {
        module: `${baseRealm.url}card-api`,
        name: 'CardDef',
      },
      by: 'title',
    },
  ],
};

export class QueryWidget {
  @tracked _query: Query = DEFAULT_QUERY;
  get query() {
    return this._query;
  }
  addFilter(filter: Filter) {
    let currentFilter = this._query.filter;
    this._query.filter = { ...currentFilter, ...filter };
  }
  addSort(sort: SortExpression) {
    this._query.sort?.push(sort);
  }
  addContains() {}
  clearFilters() {}
}
