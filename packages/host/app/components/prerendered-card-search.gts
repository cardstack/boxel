import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { WithBoundArgs } from '@glint/template';

import { restartableTask } from 'ember-concurrency';

import { flatMap } from 'lodash';

import { PrerenderedCard, Query } from '@cardstack/runtime-common';

import { Format } from 'https://cardstack.com/base/card-api';

import CardService from '../services/card-service';
import LoaderService from '../services/loader-service';

interface Signature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
  };
  Blocks: {
    loading: [];
    item: [
      item: WithBoundArgs<typeof PrerenderedCardComponent, 'item'>,
      cardId: string,
      index: number,
    ];
  };
}

interface PrerenderedCardComponentSignature {
  Element: undefined;
  Args: {
    item: PrerenderedCard;
  };
}

class PrerenderedCardComponent extends Component<PrerenderedCardComponentSignature> {
  @service declare loaderService: LoaderService;
  constructor(
    owner: unknown,
    props: PrerenderedCardComponentSignature['Args'],
  ) {
    super(owner, props);
    this.ensureCssLoaded();
    for (let cssModuleId of this.args.item.cssModuleIds) {
      this.loaderService.loader.import(cssModuleId);
    }
  }
  @tracked isCssLoaded = false;
  async ensureCssLoaded() {
    for (let cssModuleId of this.args.item.cssModuleIds) {
      await this.loaderService.loader.import(cssModuleId);
    }
    this.isCssLoaded = true;
  }
  <template>
    {{#if this.isCssLoaded}}
      {{htmlSafe @item.html}}
    {{/if}}
  </template>
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
          (component PrerenderedCardComponent item=instance)
          instance.url
          i
          to='item'
        }}
      {{/each}}
    {{/if}}
  </template>
}
