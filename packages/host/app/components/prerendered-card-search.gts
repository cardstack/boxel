import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';

import { didCancel, restartableTask } from 'ember-concurrency';
import { flatMap, isEqual } from 'lodash';
import { trackedFunction } from 'reactiveweb/function';

import { TrackedSet } from 'tracked-built-ins';

import {
  type Query,
  RealmPaths,
  type PrerenderedCardLike,
  type PrerenderedCardData,
  type PrerenderedCardComponentSignature,
} from '@cardstack/runtime-common';
import {
  PrerenderedCardCollectionDocument,
  isPrerenderedCardCollectionDocument,
} from '@cardstack/runtime-common/document-types';

import { type Format } from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import SubscribeToRealms from '../helpers/subscribe-to-realms';
import { type HTMLComponent, htmlComponent } from '../lib/html-component';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

const waiter = buildWaiter('prerendered-card-search:waiter');

export class PrerenderedCard implements PrerenderedCardLike {
  component: HTMLComponent;
  constructor(public data: PrerenderedCardData) {
    if (data.isError && !data.html) {
      this.component = getErrorComponent(data.realmUrl, data.url);
    } else {
      this.component = htmlComponent(data.html);
    }
  }
  get url() {
    return this.data.url;
  }
  get isError() {
    return this.data.isError;
  }
  get realmUrl(): string {
    return this.data.realmUrl;
  }
}
function getErrorComponent(realmURL: string, url: string) {
  let name = new RealmPaths(new URL(realmURL)).local(new URL(url));
  const DefaultErrorResultComponent: TemplateOnlyComponent = <template>
    <div class='error'>
      <div class='thumbnail'>
        <TriangleAlert />
      </div>
      <div class='name' data-test-instance-error-name>{{name}}</div>
    </div>
    <style scoped>
      .error {
        display: flex;
        align-content: flex-start;
        justify-content: center;
        padding: var(--boxel-sp-xs);
        flex-wrap: wrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .thumbnail {
        display: flex;
        justify-content: center;
        align-items: center;
        height: calc(100% - 64.35px);
      }
      .name {
        width: 100%;
        text-align: center;
        font: 500 var(--boxel-font-sm);
        line-height: 1.23;
        letter-spacing: 0.13px;
        text-overflow: ellipsis;
      }
      svg {
        width: 50px;
        height: 50px;
      }
    </style>
  </template>;
  return DefaultErrorResultComponent;
}

export default class PrerenderedCardSearch extends Component<PrerenderedCardComponentSignature> {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  _lastSearchQuery: Query | null = null;
  _lastCardUrls: string[] | undefined;
  _lastSearchResults: PrerenderedCard[] | undefined;
  _lastRealms: string[] | undefined;
  realmsNeedingRefresh = new TrackedSet<string>(this.args.realms);

  async searchPrerendered(
    query: Query,
    format: Format,
    cardUrls: string[],
    realmURL: string,
  ): Promise<PrerenderedCard[]> {
    let json = (await this.cardService.fetchJSON(
      `${realmURL}_search-prerendered`,
      {
        method: 'QUERY',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...query,
          prerenderedHtmlFormat: format,
          cardUrls,
        }),
      },
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
        html: r.attributes?.html,
        isError: !!r.attributes?.isError,
      });
    });
  }

  private runSearch = trackedFunction(this, async () => {
    let { query, format, cardUrls, realms } = this.args;

    let realmsChanged = !isEqual(realms, this._lastRealms);
    let queryChanged = !isEqual(query, this._lastSearchQuery);
    let cardUrlsChanged = !isEqual(cardUrls, this._lastSearchQuery);
    if (realmsChanged) {
      this._lastSearchResults = this._lastSearchResults?.filter((r) =>
        realms.includes(r.realmUrl),
      );
      this.realmsNeedingRefresh = new TrackedSet(realms);
    }
    this._lastRealms = realms;

    if (
      // we want to only run the search when there is a deep equality
      // difference, not a strict equality difference
      !realmsChanged &&
      !queryChanged &&
      !cardUrlsChanged &&
      (!this.args.isLive ||
        (this.args.isLive && this.realmsNeedingRefresh.size === 0))
    ) {
      return (
        this.runSearchTask.lastSuccessful?.value ?? {
          instances: [],
          isLoading: true,
        }
      );
    }

    if (query && format) {
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
    if (!isEqual(cardUrls, this._lastCardUrls)) {
      this._lastCardUrls = cardUrls;
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

  private markRealmNeedsRefreshing = (ev: RealmEventContent, realm: string) => {
    if (ev.eventName === 'index' && ev.indexType === 'incremental') {
      this.realmsNeedingRefresh.add(realm);
    }
  };

  <template>
    {{#if @isLive}}
      {{SubscribeToRealms @realms this.markRealmNeedsRefreshing}}
    {{/if}}
    {{#if this.searchResults.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield this.searchResults.instances to='response'}}
    {{/if}}
  </template>
}
