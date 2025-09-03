import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import { realmURL } from '@cardstack/runtime-common';

import { Table } from '../components/table';
import { AppCard } from './app';
import { QueryField, queryBuilderResource } from '../fields/query';
import { LoadingIndicator } from '@cardstack/boxel-ui/components';

class IsolatedTemplate extends Component<typeof TableApp> {
  queryBuilder = queryBuilderResource(
    this,
    () => this.args.model.query?.type?.codeRef,
  );

  get realms() {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  <template>
    {{#if this.queryBuilder.isError}}
      <div class='error-message'>{{this.queryBuilder.error.message}}</div>
    {{else if this.queryBuilder.isLoading}}
      <div class='loading-container'>
        <LoadingIndicator />
      </div>
    {{else if this.queryBuilder.value}}
      <Table
        @query={{this.queryBuilder.value}}
        @realms={{this.realms}}
        @context={{@context}}
        @showComputedFields={{@model.showComputedFields}}
      />
    {{else}}
      <div>No query configured</div>
    {{/if}}

    <style scoped>
      .error-message {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: red;
      }

      .loading-container {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    </style>
  </template>
}

export class TableApp extends AppCard {
  static displayName = 'Table App';
  @field showComputedFields = contains(BooleanField);
  @field query = contains(QueryField);

  static isolated = IsolatedTemplate;
}
