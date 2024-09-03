import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { didCancel, restartableTask } from 'ember-concurrency';
import { trackedFunction } from 'ember-resources/util/function';
import { flatMap, isEqual } from 'lodash';
import { stringify } from 'qs';

import { TrackedSet } from 'tracked-built-ins';

import { Query, RealmInfo } from '@cardstack/runtime-common';
import {
  PrerenderedCardCollectionDocument,
  isPrerenderedCardCollectionDocument,
} from '@cardstack/runtime-common/card-document';

import { type Format } from 'https://cardstack.com/base/card-api';

import SubscribeToRealms from '../helpers/subscribe-to-realms';
import { type HTMLComponent, htmlComponent } from '../lib/html-component';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

const waiter = buildWaiter('prerendered-card-search:waiter');

export interface PrerenderedCardData {
  url: string;
  realmUrl: string;
  realmInfo: RealmInfo;
  html: string;
}

class PrerenderedCard {
  component: HTMLComponent;
  constructor(private data: PrerenderedCardData) {
    this.component = htmlComponent(data.html);
  }
  get url() {
    return this.data.url;
  }
  get realmUrl(): string {
    return this.data.realmUrl;
  }
  get realmInfo(): RealmInfo {
    return this.data.realmInfo;
  }
}

interface Signature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    cardUrls?: string[];
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
  _lastSearchResults: PrerenderedCard[] | undefined;
  _lastRealms: string[] | undefined;
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
    cardUrls: string[],
    realmURL: string,
  ): Promise<PrerenderedCard[]> {
    let json = (await this.cardService.fetchJSON(
      `${realmURL}_search-prerendered?${stringify({
        ...query,
        prerenderedHtmlFormat: format,
        cardUrls,
      })}`,
    )) as unknown as PrerenderedCardCollectionDocument;
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
        realmUrl: realmURL,
        realmInfo: json.meta.realmInfo!,
        html: r.attributes?.html,
      });
    });
  }

  private runSearch = trackedFunction(this, async () => {
    let { query, format, cardUrls, realms } = this.args;

    let realmsChanged = !isEqual(realms, this._lastRealms);
    if (realmsChanged) {
      this._lastSearchResults = this._lastSearchResults?.filter((r) =>
        realms.includes(r.realmUrl),
      );
      this.realmsNeedingRefresh = new TrackedSet(realms);
    }
    this._lastRealms = realms;

    if (
      query &&
      format &&
      (realmsChanged || this.realmsNeedingRefresh.size > 0)
    ) {
      try {
        await this.runSearchTask.perform(query, format, cardUrls);
      } catch (e) {
        if (!didCancel(e)) {
          // re-throw the non-cancelation error
          throw e;
        }
      }
    }

    return (
      this.runSearchTask.lastSuccessful?.value ?? {
        instances: [],
        isLoading: true,
      }
    );
  });

  runSearchTask = restartableTask(async (query, format, cardUrls) => {
    if (!isEqual(query, this._lastSearchQuery)) {
      this._lastSearchResults = undefined;
      this._lastSearchQuery = query;
    }
    let results = [...(this._lastSearchResults || [])];
    let realmsNeedingRefresh = Array.from(this.realmsNeedingRefresh);
    let token = waiter.beginAsync();
    try {
      for (let realmNeedingRefresh of realmsNeedingRefresh) {
        results = results.filter((r) => !r.url.startsWith(realmNeedingRefresh));
      }

      let searchPromises = Array.from(realmsNeedingRefresh).map(
        async (realm) => {
          try {
            return await this.searchPrerendered(
              query,
              format,
              cardUrls ?? [],
              realm,
            );
          } catch (error) {
            console.error(
              `Failed to search prerendered for realm ${realm}:`,
              error,
            );
            return [];
          }
        },
      );

      const searchResults = await Promise.all(searchPromises);
      results.push(...flatMap(searchResults));

      this._lastSearchResults = results;
      return { instances: results, isLoading: false };
    } finally {
      waiter.endAsync(token);
    }
  });

  private get searchResults() {
    if (this.runSearch.value) {
      return this.runSearch.value;
    } else if (this._lastSearchResults) {
      return { instances: this._lastSearchResults, isLoading: false };
    } else {
      return { instances: [], isLoading: true };
    }
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
