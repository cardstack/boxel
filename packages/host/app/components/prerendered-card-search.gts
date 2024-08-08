import { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { WithBoundArgs } from '@glint/template';

import { trackedFunction } from 'ember-resources/util/function';
import { flatMap } from 'lodash';

import { PrerenderedCard, Query } from '@cardstack/runtime-common';

import { Format } from 'https://cardstack.com/base/card-api';

import CardService from '../services/card-service';

import PrerenderedCardComponent from './prerendered';

const waiter = buildWaiter('prerendered-card-search:waiter');

interface ResultsSignature {
  Element: undefined;
  Args: {
    instances: PrerenderedCard[];
  };
  Blocks: {
    default: [
      item: WithBoundArgs<typeof PrerenderedCardComponent, 'card'>,
      cardId: string,
      index: number,
    ];
  };
}

const ResultsComponent: TemplateOnlyComponent<ResultsSignature> = <template>
  {{#each @instances as |instance i|}}
    {{yield (component PrerenderedCardComponent card=instance) instance.url i}}
  {{/each}}
</template>;

interface Signature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
  };
  Blocks: {
    loading: [];
    response: [
      {
        count: number;
        Results: WithBoundArgs<typeof ResultsComponent, 'instances'>;
      },
    ];
  };
}

export default class PrerenderedCardSearch extends Component<Signature> {
  @service declare cardService: CardService;
  _lastSearchQuery: Query | null = null;

  private runSearch = trackedFunction(this, async () => {
    let { query, format, realms } = this.args;
    let token = waiter.beginAsync();
    try {
      let instances = flatMap(
        await Promise.all(
          realms.map(
            async (realm) =>
              await this.cardService.searchPrerendered(query, format, realm),
          ),
        ),
      );
      return { instances, isLoading: false };
    } finally {
      waiter.endAsync(token);
    }
  });

  private get searchResults() {
    return this.runSearch.value || { instances: null, isLoading: true };
  }

  <template>
    {{#if this.searchResults.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield
        (hash
          count=this.searchResults.instances.length
          Results=(component
            ResultsComponent instances=this.searchResults.instances
          )
        )
        to='response'
      }}
    {{/if}}
  </template>
}
