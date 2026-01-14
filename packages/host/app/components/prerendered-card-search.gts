import { setComponentTemplate } from '@ember/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { isDestroyed, isDestroying } from '@ember/destroyable';
import { service } from '@ember/service';
import { precompileTemplate } from '@ember/template-compilation';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import TriangleAlert from '@cardstack/boxel-icons/triangle-alert';

import { didCancel, restartableTask } from 'ember-concurrency';
import { consume } from 'ember-provide-consume-context';
import { isEqual } from 'lodash';
import { trackedFunction } from 'reactiveweb/function';

import { TrackedSet } from 'tracked-built-ins';

import { CardContainer } from '@cardstack/boxel-ui/components';

import type { QueryResultsMeta } from '@cardstack/runtime-common';
import {
  type Query,
  RealmPaths,
  type PrerenderedCardLike,
  type PrerenderedCardData,
  type PrerenderedCardComponentSignature,
  CardContextName,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { PrerenderedCardCollectionDocument } from '@cardstack/runtime-common/document-types';
import { isPrerenderedCardCollectionDocument } from '@cardstack/runtime-common/document-types';

import type { CardContext, Format } from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import SubscribeToRealms from '../helpers/subscribe-to-realms';
import { type HTMLComponent, htmlComponent } from '../lib/html-component';

import type LoaderService from '../services/loader-service';
import type RealmServerService from '../services/realm-server';

const waiter = buildWaiter('prerendered-card-search:waiter');
const OWNER_DESTROYED_ERROR =
  "Cannot call `.lookup('renderer:-dom')` after the owner has been destroyed";

export class PrerenderedCard implements PrerenderedCardLike {
  component: HTMLComponent;
  constructor(
    public data: PrerenderedCardData,
    cardComponentModifier?: CardContext['cardComponentModifier'],
  ) {
    if (data.isError && !data.html) {
      this.component = wrapWithModifier(
        getErrorComponent(data.realmUrl, data.url),
        cardComponentModifier,
        data.url,
      );
    } else {
      let extraAttributes: Record<string, string> = {};
      if (data.isError) {
        extraAttributes['data-is-error'] = 'true';
      }
      this.component = wrapWithModifier(
        htmlComponent(data.html, extraAttributes),
        cardComponentModifier,
        data.url,
      );
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
  const DefaultErrorResultComponent: TemplateOnlyComponent<{
    Element: HTMLDivElement;
  }> = <template>
    <CardContainer
      class='card instance-error'
      @displayBoundaries={{true}}
      data-test-instance-error={{true}}
      data-test-card={{url}}
      ...attributes
    >
      <div class='error'>
        <div class='thumbnail'>
          <TriangleAlert />
        </div>
        <div class='name' data-test-instance-error-name>{{name}}</div>
      </div>
    </CardContainer>
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
  return DefaultErrorResultComponent as unknown as HTMLComponent;
}

const normalizeRealms = (realms: string[]) => {
  return realms.map((r) => {
    return new RealmPaths(new URL(r)).url;
  });
};

function resolveCardRealmUrl(cardId: string, realms: string[]): string {
  let cardUrl = new URL(cardId);
  for (let realm of realms) {
    let realmUrl = new URL(realm);
    let realmPaths = new RealmPaths(realmUrl);
    if (realmPaths.inRealm(cardUrl)) {
      return realmPaths.url;
    }
  }
  return new RealmPaths(cardUrl).url;
}

interface SearchResult {
  instances: PrerenderedCard[];
  meta: QueryResultsMeta;
}

function wrapWithModifier(
  innerComponent: HTMLComponent,
  modifier: CardContext['cardComponentModifier'] | undefined,
  cardId: string,
): HTMLComponent {
  if (!modifier) {
    return innerComponent;
  }

  let cardIdForModifier = cardId;

  class DecoratedPrerenderedCard extends Component {
    component = innerComponent;
    cardModifier = modifier!;
    cardId = cardIdForModifier;
  }

  setComponentTemplate(
    precompileTemplate(
      `<this.component
        {{this.cardModifier
          cardId=this.cardId
          format='data'
          fieldType=undefined
          fieldName=undefined
        }}
        ...attributes
      />`,
      { strictMode: true, scope: () => ({}) },
    ),
    DecoratedPrerenderedCard,
  );

  return DecoratedPrerenderedCard as unknown as HTMLComponent;
}

export default class PrerenderedCardSearch extends Component<PrerenderedCardComponentSignature> {
  @consume(CardContextName) declare private cardContext?: CardContext;
  @service declare loaderService: LoaderService;
  @service declare realmServer: RealmServerService;
  _lastSearchQuery: Query | null = null;
  _lastCardUrls: string[] | undefined;
  _lastSearchResults: SearchResult | undefined;
  _lastRealms: string[] | undefined;
  realmsNeedingRefresh = new TrackedSet<string>(
    normalizeRealms(this.args.realms),
  );

  private get cardComponentModifier() {
    if (isDestroying(this) || isDestroyed(this)) {
      return undefined;
    }
    try {
      return this.cardContext?.cardComponentModifier;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(OWNER_DESTROYED_ERROR)
      ) {
        // Realm refreshes can finish after the component tree has torn down.
        return undefined;
      }
      throw error;
    }
  }

  async searchPrerendered(
    query: Query,
    format: Format,
    cardUrls: string[],
    realms: string[],
  ): Promise<SearchResult> {
    if (realms.length === 0) {
      return { instances: [], meta: { page: { total: 0 } } };
    }

    let realmServerURLs = this.realmServer.getRealmServersForRealms(realms);
    // TODO remove this assertion after multi-realm server/federated identity is supported
    this.realmServer.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;
    let searchURL = new URL('_search-prerendered', realmServerURL);
    for (let realm of realms) {
      searchURL.searchParams.append('realms', realm);
    }

    let response = await this.realmServer.maybeAuthedFetch(searchURL.href, {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...query,
        prerenderedHtmlFormat: format,
        cardUrls,
      }),
    });

    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} - ${response.statusText}. ${responseText}`,
      ) as any;
      err.status = response.status;
      err.responseText = responseText;
      err.responseHeaders = response.headers;
      throw err;
    }

    let json =
      (await response.json()) as unknown as PrerenderedCardCollectionDocument;

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

    if (isDestroying(this) || isDestroyed(this)) {
      return { instances: [], meta: json.meta };
    }

    let modifier = this.cardComponentModifier;

    let resolvedRealms = normalizeRealms(realms);
    return {
      instances: json.data.filter(Boolean).map((r) => {
        let realmUrl = resolveCardRealmUrl(r.id, resolvedRealms);
        return new PrerenderedCard(
          {
            url: r.id,
            realmUrl,
            html: r.attributes?.html,
            isError: !!r.attributes?.isError,
          },
          modifier,
        );
      }),
      meta: json.meta,
    };
  }

  private runSearch = trackedFunction(this, async () => {
    let { query, format, cardUrls, realms } = this.args;
    realms = normalizeRealms(realms);

    let realmsChanged = !isEqual(realms, this._lastRealms);
    let queryChanged = !isEqual(query, this._lastSearchQuery);
    let cardUrlsChanged = !isEqual(cardUrls, this._lastSearchQuery);
    if (realmsChanged) {
      if (this._lastSearchResults) {
        this._lastSearchResults = {
          instances: this._lastSearchResults.instances.filter((r) =>
            realms.some((realm) => r.url.startsWith(realm)),
          ),
          meta: this._lastSearchResults.meta,
        };
      }
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
          meta: {
            page: { total: 0 },
          },
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
        meta: {
          page: { total: 0 },
        },
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

    let results = this._lastSearchResults?.instances || [];
    let realmsNeedingRefresh = Array.from(this.realmsNeedingRefresh);
    let token = waiter.beginAsync();
    try {
      for (let realmNeedingRefresh of realmsNeedingRefresh) {
        results = results.filter((r) => !r.url.startsWith(realmNeedingRefresh));
      }

      let searchResult: SearchResult;
      try {
        searchResult = await this.searchPrerendered(
          query,
          format,
          cardUrls ?? [],
          realmsNeedingRefresh,
        );
      } catch (error) {
        console.error(
          `Failed to search prerendered for realms ${realmsNeedingRefresh.join(
            ', ',
          )}:`,
          error,
        );
        searchResult = { instances: [], meta: { page: { total: 0 } } };
      }

      results.push(...(searchResult.instances || []));
      let combinedMeta: QueryResultsMeta = searchResult.meta ?? {
        page: { total: 0 },
      };

      this._lastSearchResults = { instances: results, meta: combinedMeta };
      return { instances: results, isLoading: false, meta: combinedMeta };
    } finally {
      waiter.endAsync(token);
    }
  });

  private get searchResults() {
    if (this.runSearch.value) {
      return this.runSearch.value;
    } else if (this._lastSearchResults) {
      return {
        instances: this._lastSearchResults.instances,
        isLoading: false,
        meta: this._lastSearchResults.meta,
      };
    } else {
      return { instances: [], isLoading: true, meta: { page: { total: 0 } } };
    }
  }

  private markRealmNeedsRefreshing = (ev: RealmEventContent, realm: string) => {
    if (ev.eventName === 'index' && ev.indexType === 'incremental') {
      this.realmsNeedingRefresh.add(realm);
    }
  };

  <template>
    {{#if @isLive}}
      {{SubscribeToRealms
        (normalizeRealms @realms)
        this.markRealmNeedsRefreshing
      }}
    {{/if}}
    {{#if this.searchResults.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield this.searchResults.instances to='response'}}
      {{#if this.searchResults.meta}}
        {{yield this.searchResults.meta to='meta'}}
      {{/if}}
    {{/if}}
  </template>
}
