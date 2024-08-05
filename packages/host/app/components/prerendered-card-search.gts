import { service } from '@ember/service';

import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { WithBoundArgs } from '@glint/template';

import { restartableTask } from 'ember-concurrency';

import { flatMap } from 'lodash';

import { PrerenderedCard, Query } from '@cardstack/runtime-common';

import { Format } from 'https://cardstack.com/base/card-api';

import CardService from '../services/card-service';

import PrerenderedCardComponent from './prerendered';

interface Signature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
  };
  Blocks: {
    loading: [];
    card: [
      item: WithBoundArgs<typeof PrerenderedCardComponent, 'card'>,
      cardId: string,
      index: number,
    ];
  };
}

export default class PrerenderedCardSearch extends Component<Signature> {
  @service declare cardService: CardService;
  @tracked _instances: PrerenderedCard[] = [];

  private searchTask = restartableTask(async () => {
    let { query, format, realms } = this.args;
    this._instances = flatMap(
      await Promise.all(
        realms.map(
          async (realm) =>
            await this.cardService.searchPrerendered(query, format, realm),
        ),
      ),
    );
  });
  get isLoading() {
    return this.searchTask.isRunning;
  }
  get search() {
    this.searchTask.perform();
    let self = this;
    return {
      get isLoading() {
        return self.searchTask.isRunning;
      },
    };
  }
  <template>
    {{#if this.search.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{#each this._instances as |instance i|}}
        {{yield
          (component PrerenderedCardComponent card=instance)
          instance.url
          i
          to='card'
        }}
      {{/each}}
    {{/if}}
  </template>
}
