import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { trackedFunction } from 'ember-resources/util/function';
import { flatMap } from 'lodash';
import { stringify } from 'qs';

import {
  PrerenderedCard as PrerenderedCardData,
  Query,
} from '@cardstack/runtime-common';
import { isPrerenderedCardCollectionDocument } from '@cardstack/runtime-common/card-document';

import { type Format } from 'https://cardstack.com/base/card-api';

import { type HTMLComponent, htmlComponent } from '../lib/html-component';
import CardService from '../services/card-service';
import LoaderService from '../services/loader-service';

const waiter = buildWaiter('prerendered-card-search:waiter');

class PrerenderedCard {
  component: HTMLComponent;
  constructor(private data: PrerenderedCardData) {
    this.component = htmlComponent(data.html);
  }
  get url() {
    return this.data.url;
  }
}

interface Signature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
  };
  Blocks: {
    loading: [];
    response: [cards: PrerenderedCard[]];
  };
}

export default class PrerenderedCardSearch extends Component<Signature> {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  _lastSearchQuery: Query | null = null;

  async searchPrerendered(
    query: Query,
    format: Format,
    realmURL: string,
  ): Promise<PrerenderedCard[]> {
    let json = await this.cardService.fetchJSON(
      `${realmURL}_search-prerendered?${stringify({
        ...query,
        prerenderedHtmlFormat: format,
      })}`,
    );
    if (!isPrerenderedCardCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a prerendered-card collection document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }

    await Promise.all(
      (json.meta.scopedCssUrls ?? []).map((cssModuleUrl) =>
        this.loaderService.loader.import(cssModuleUrl),
      ),
    );
    return json.data.filter(Boolean).map((r) => {
      return new PrerenderedCard({
        url: r.id,
        html: r.attributes?.html,
      });
    });
  }

  private runSearch = trackedFunction(this, async () => {
    let { query, format, realms } = this.args;
    let token = waiter.beginAsync();
    try {
      let instances = flatMap(
        await Promise.all(
          realms.map(
            async (realm) => await this.searchPrerendered(query, format, realm),
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
      {{yield this.searchResults.instances to='response'}}
    {{/if}}
  </template>
}
