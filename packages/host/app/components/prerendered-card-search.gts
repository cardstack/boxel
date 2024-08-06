import { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { WithBoundArgs } from '@glint/template';

import { restartableTask } from 'ember-concurrency';

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
  @tracked _instances: PrerenderedCard[] = [];
  _lastSearchQuery: Query | null = null;

  get isLoading() {
    return this.searchTask.isRunning;
  }
  get search() {
    if (this._lastSearchQuery !== this.args.query) {
      // eslint-disable-next-line ember/no-side-effects
      this._lastSearchQuery = this.args.query;
      this.searchTask.perform();
    }
    let self = this;
    return {
      get isLoading() {
        return self.searchTask.isRunning;
      },
    };
  }

  private searchTask = restartableTask(async () => {
    let { query, format, realms } = this.args;
    let token = waiter.beginAsync();
    try {
      this._instances = flatMap(
        await Promise.all(
          realms.map(
            async (realm) =>
              await this.cardService.searchPrerendered(query, format, realm),
          ),
        ),
      );
    } finally {
      waiter.endAsync(token);
    }
  });

  get count() {
    return this._instances.length;
  }

  <template>
    {{#if this.search.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield
        (hash
          count=this.count
          Results=(component ResultsComponent instances=this._instances)
        )
        to='response'
      }}
    {{/if}}
  </template>
}
