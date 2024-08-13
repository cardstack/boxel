import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { didCancel, restartableTask } from 'ember-concurrency';
import { trackedFunction } from 'ember-resources/util/function';
import { flatMap } from 'lodash';
import { stringify } from 'qs';

import { TrackedSet } from 'tracked-built-ins';

import {
  PrerenderedCard as PrerenderedCardData,
  Query,
} from '@cardstack/runtime-common';
import { isPrerenderedCardCollectionDocument } from '@cardstack/runtime-common/card-document';

import { type Format } from 'https://cardstack.com/base/card-api';

import SubscribeToRealms from '../helpers/subscribe-to-realms';
import { type HTMLComponent, htmlComponent } from '../lib/html-component';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

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
  _lastSearchResults: PrerenderedCard[] = [];
  realmsNeedingRefresh = new TrackedSet<string>();

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    for (const realm of this.args.realms) {
      this.realmsNeedingRefresh.add(realm);
    }
  }

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
    let { query, format } = this.args;

    if (query && format && this.realmsNeedingRefresh.size > 0) {
      await this.runSearchTask.perform();
    }
    return (
      this.runSearchTask.lastSuccessful?.value ?? {
        instances: [],
        isLoading: true,
      }
    );
  });

  runSearchTask = restartableTask(async () => {
    let { query, format } = this.args;
    let results = [...this._lastSearchResults];
    let realmsNeedingRefresh = Array.from(this.realmsNeedingRefresh);
    let token = waiter.beginAsync();
    try {
      for (let realmNeedingRefresh of realmsNeedingRefresh) {
        results = results.filter((r) => !r.url.startsWith(realmNeedingRefresh));
      }
      results.push(
        ...flatMap(
          await Promise.all(
            Array.from(realmsNeedingRefresh).map(
              async (realm) =>
                await this.searchPrerendered(query, format, realm),
            ),
          ),
        ),
      );
      this._lastSearchResults = results;
      return { instances: results, isLoading: false };
    } catch (e) {
      if (!didCancel(e)) {
        // re-throw the non-cancelation error
        throw e;
      }
      return {
        instances: [],
        isLoading: false,
      };
    } finally {
      waiter.endAsync(token);
    }
  });

  private get searchResults() {
    return this.runSearch.value || { instances: [], isLoading: true };
  }

  private markRealmNeedsRefreshing = (ev: MessageEvent, realm: string) => {
    if (ev.type === 'index') {
      this.realmsNeedingRefresh.add(realm);
    }
  };

  <template>
    {{SubscribeToRealms @realms this.markRealmNeedsRefreshing}}
    {{#if this.searchResults.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield this.searchResults.instances to='response'}}
    {{/if}}
  </template>
}
