import {
  Component,
  field,
  contains,
  type CreateCardFn,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import { AbsoluteCodeRefField } from 'https://cardstack.com/base/code-ref';
import { realmURL, type CodeRef } from '@cardstack/runtime-common';

import { Table } from '../components/table';
import { AppCard } from './app';
import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { CardCrudFunctionsConsumer } from 'https://cardstack.com/base/field-component';

import type { Query } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { resource } from 'ember-resources';

// This is meant to be the generic placeholder for managing state
export class QueryState {
  @tracked query?: Query = undefined;
  @tracked isLoading = false;
  @tracked error?: Error = undefined;

  get value(): Query | undefined {
    return this.query;
  }

  get isError(): boolean {
    return Boolean(this.error);
  }

  updateQuery(query: Query) {
    this.query = query;
    this.error = undefined;
  }

  setError(error: Error) {
    this.error = error;
    this.query = undefined;
  }
}

class IsolatedTemplate extends Component<typeof DataExplorer> {
  queryBuilder = resource(this, () => {
    const state = new QueryState();

    const typeRef = this.args.model.codeRef;
    if (!typeRef?.module && !typeRef?.name) {
      state.setError(new Error('Query not setup. Please assign a type.'));
      return state;
    }
    if (typeRef?.module && typeRef?.name) {
      state.updateQuery({
        filter: {
          type: {
            module: typeRef.module,
            name: typeRef.name,
          },
        },
      });
    }

    return state;
  });

  get realm() {
    return this.args.model[realmURL]
      ? this.args.model[realmURL].href
      : undefined;
  }

  createCard = (cardCrudFunctions: { createCard: CreateCardFn }) => {
    return cardCrudFunctions.createCard;
  };

  get cardTypeRef(): CodeRef | undefined {
    const typeRef = this.args.model.codeRef;
    if (typeRef?.module && typeRef?.name) {
      return {
        module: typeRef.module,
        name: typeRef.name,
      };
    }
    return undefined;
  }

  <template>
    {{#if this.queryBuilder.isError}}
      <div class='error-message'>{{this.queryBuilder.error.message}}</div>
    {{else if this.queryBuilder.isLoading}}
      <div class='loading-container'>
        <LoadingIndicator />
      </div>
    {{else if this.queryBuilder.value}}
      <CardCrudFunctionsConsumer as |cardCrudFunctions|>
        <Table
          @query={{this.queryBuilder.value}}
          @realm={{this.realm}}
          @cardTypeRef={{this.cardTypeRef}}
          @showClean={{@model.showClean}}
          @showComputedFields={{@model.showComputedFields}}
          @showPrimitivesOnly={{@model.showPrimitivesOnly}}
          @context={{@context}}
          @createCard={{this.createCard cardCrudFunctions}}
        />
      </CardCrudFunctionsConsumer>
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

export class DataExplorer extends AppCard {
  static displayName = 'Data Explorer';
  @field showComputedFields = contains(BooleanField);
  @field showPrimitivesOnly = contains(BooleanField);
  @field showClean = contains(BooleanField);
  @field codeRef = contains(AbsoluteCodeRefField);

  static isolated = IsolatedTemplate;
}
