import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import { realmURL } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common';

import { Table } from '../components/table';
import { AppCard } from '../app-card';

class IsolatedTemplate extends Component<typeof ListingsTable> {
  get listingsQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('../catalog-app/listing/listing', import.meta.url)
            .href,
          name: 'Listing',
        },
      },
    };
  }

  get realms() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  <template>
    <Table
      @query={{this.listingsQuery}}
      @realms={{this.realms}}
      @context={{@context}}
      @showComputedFields={{@model.showComputedFields}}
    />
  </template>
}

export class ListingsTable extends AppCard {
  static displayName = 'Listings Table';
  @field showComputedFields = contains(BooleanField);

  static isolated = IsolatedTemplate;
}
