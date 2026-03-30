import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import isEqual from 'lodash/isEqual';
import { TrackedArray } from 'tracked-built-ins';

import {
  subscribeToRealm,
  normalizeQueryForSignature,
  buildQueryParamValue,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { QueryResultsMeta } from '@cardstack/runtime-common';
import type { Query, Format } from '@cardstack/runtime-common';
import type { PrerenderedCardCollectionDocument } from '@cardstack/runtime-common/document-types';
import { isPrerenderedCardCollectionDocument } from '@cardstack/runtime-common/document-types';

import { PrerenderedCard } from '../components/prerendered-card-search';
import { normalizeRealms, resolveCardRealmUrl } from '../lib/realm-utils';

import type LoaderService from '../services/loader-service';
import type RealmServerService from '../services/realm-server';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

const waiter = buildWaiter('prerendered-search-resource:search-waiter');

export interface Args {
  named: {
    query: Query | undefined;
    format: Format | undefined;
    realms: string[] | undefined;
    cardUrls?: string[];
    isLive: boolean;
    cardComponentModifier?: any;
    owner: Owner;
  };
}

export class PrerenderedSearchResource extends Resource<Args> {
  @service declare private loaderService: LoaderService;
  @service declare private realmServer: RealmServerService;

  private realmsToSearch: string[] = [];
  private subscriptions: { url: string; unsubscribe: () => void }[] = [];
  private _instances = new TrackedArray<PrerenderedCard>();
  @tracked private _meta: QueryResultsMeta = { page: { total: 0 } };
  @tracked private _hasSearchRun = false;

  // Plain Set for storage + a tracked signal counter for reactivity.
  // Using TrackedSet would cause a Glimmer backtracking assertion because
  // modify() both reads (.size) and writes (.clear()) to the same tracked
  // storage in successive render cycles.  Adding to the set increments the
  // signal (triggering reactivity); clearing only empties the plain Set so
  // no tracked write occurs and no backtracking is possible.
  private realmsNeedingRefreshSet = new Set<string>();
  @tracked private realmsNeedingRefreshSignal = 0;

  // Reads the signal to establish a Glimmer tracking dependency, then
  // returns the actual size of the plain Set.
  private get realmsNeedingRefreshHasItems(): boolean {
    this.realmsNeedingRefreshSignal;
    return this.realmsNeedingRefreshSet.size > 0;
  }

  #isLive = false;
  #previousQuery: Query | undefined;
  #previousQueryString: string | undefined;
  #previousRealms: string[] | undefined;
  #previousFormat: Format | undefined;
  #previousCardUrls: string[] | undefined;
  #cardComponentModifier: any;

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      this.search.cancelAll();
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = [];
      this.realmsNeedingRefreshSet.clear();
      this._instances = new TrackedArray();
      this._meta = { page: { total: 0 } };
      this._hasSearchRun = false;
    });
  }

  modify(_positional: never[], named: Args['named']) {
    let {
      query,
      format,
      realms,
      cardUrls,
      isLive,
      cardComponentModifier,
      owner,
    } = named;

    setOwner(this, owner);

    if (query === undefined || format === undefined) {
      // Clear stale state so live subscriptions don't re-fire the old query
      this.#previousQuery = undefined;
      this.#previousQueryString = undefined;
      this.#previousFormat = undefined;
      this.#previousCardUrls = undefined;
      this.#previousRealms = undefined;
      this.realmsNeedingRefreshSet.clear();
      this.search.cancelAll();
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = [];
      this._instances = new TrackedArray();
      this._meta = { page: { total: 0 } };
      return;
    }

    this.#isLive = isLive;
    this.#cardComponentModifier = cardComponentModifier;

    // Normalize realms
    let normalizedRealms = realms
      ? normalizeRealms(realms)
      : normalizeRealms(this.realmServer.availableRealmURLs);

    this.realmsToSearch = normalizedRealms;

    // Set up live subscriptions if needed
    if (
      isLive &&
      (this.subscriptions.length === 0 ||
        !isEqual(normalizedRealms, this.#previousRealms))
    ) {
      // Unsubscribe from old realms
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }

      // Subscribe to new realms
      this.subscriptions = this.realmsToSearch.map((realm) => {
        return {
          url: `${realm}_message`,
          unsubscribe: subscribeToRealm(realm, (event: RealmEventContent) => {
            if (this.#previousQuery === undefined) {
              return;
            }
            // Only interested in incremental index events
            if (
              event.eventName !== 'index' ||
              ('indexType' in event && event.indexType !== 'incremental')
            ) {
              return;
            }
            // Mark this realm as needing refresh
            this.realmsNeedingRefreshSet.add(realm);
            this.realmsNeedingRefreshSignal++;
            // Trigger re-search
            this.search.perform(this.#previousQuery, this.#previousFormat!);
          }),
        };
      });
    }

    // Detect changes
    let realmsChanged = !isEqual(normalizedRealms, this.#previousRealms);
    let queryString = buildQueryParamValue(normalizeQueryForSignature(query));
    let queryChanged = queryString !== this.#previousQueryString;
    let formatChanged = format !== this.#previousFormat;
    let cardUrlsChanged = !isEqual(cardUrls, this.#previousCardUrls);

    // Handle realm changes - filter out results from removed realms
    if (realmsChanged) {
      this._instances = new TrackedArray(
        this._instances.filter((card) =>
          normalizedRealms.some((realm) => card.url.startsWith(realm)),
        ),
      );
      // Don't mark realms as needing refresh on realm changes
      // Only realm events should trigger incremental refreshes
    }

    // Check if we need to refresh
    let needsRefresh =
      realmsChanged ||
      queryChanged ||
      formatChanged ||
      cardUrlsChanged ||
      (isLive && this.realmsNeedingRefreshHasItems);

    if (!needsRefresh) {
      return;
    }

    // Update tracking
    this.#previousRealms = normalizedRealms;
    this.#previousQuery = query;
    this.#previousQueryString = queryString;
    this.#previousFormat = format;
    this.#previousCardUrls = cardUrls;

    // Perform search
    this.search.perform(query, format, cardUrls);
  }

  get isLoading() {
    return this.search.isRunning;
  }

  // Whether the search task has completed at least once for the current
  // query. Unlike `isLoading` (which reads `search.isRunning`), this
  // property is safe to consume during render alongside `instances`.
  // Reading `isRunning` in a render pass where the task also toggles it
  // would trigger Glimmer's backtracking assertion. This flag avoids
  // that because it is only written inside the async task body (reset
  // before the await, set in finally after the await), so its mutations
  // occur across async boundaries — never in the same synchronous
  // render cycle that reads it.
  get hasSearchRun() {
    return this._hasSearchRun;
  }

  get isLive() {
    return this.#isLive;
  }

  get instances() {
    return this._instances;
  }

  get meta() {
    return this._meta;
  }

  private async fetchPrerenderedCards(
    query: Query,
    format: Format,
    realms: string[],
    cardUrls?: string[],
  ): Promise<{ instances: PrerenderedCard[]; meta: QueryResultsMeta }> {
    if (realms.length === 0) {
      return { instances: [], meta: { page: { total: 0 } } };
    }

    let realmServerURLs = this.realmServer.getRealmServersForRealms(realms);
    this.realmServer.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;
    let searchURL = new URL('_federated-search-prerendered', realmServerURL);

    let response = await this.realmServer.maybeAuthedFetch(searchURL.href, {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...query,
        realms,
        prerenderedHtmlFormat: format,
        ...(cardUrls ? { cardUrls } : {}),
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

    // Load CSS modules
    await Promise.all(
      (json.meta.scopedCssUrls ?? []).map((cssModuleUrl) =>
        this.loaderService.loader.import(cssModuleUrl),
      ),
    );

    let resolvedRealms = normalizeRealms(realms);
    let isFileMeta = !!json.meta.isFileMeta;
    return {
      instances: json.data.filter(Boolean).map((r) => {
        let realmUrl = resolveCardRealmUrl(r.id, resolvedRealms);
        return new PrerenderedCard(
          {
            url: r.id,
            realmUrl,
            html: r.attributes?.html,
            isError: !!r.attributes?.isError,
            cardType: r.attributes?.cardType,
            iconHtml: r.attributes?.iconHtml,
            // adoptsFrom in prerendered results is always a ResolvedCodeRef
            usedRenderType: r.meta?.adoptsFrom as
              | { module: string; name: string }
              | undefined,
            ...(isFileMeta ? { isFileMeta } : {}),
          },
          this.#cardComponentModifier,
        );
      }),
      meta: json.meta,
    };
  }

  private search = restartableTask(
    async (query: Query, format: Format, cardUrls?: string[]) => {
      let token = waiter.beginAsync();
      try {
        // Determine which realms to fetch
        let realmsToFetch: string[];
        let isIncrementalRefresh = this.realmsNeedingRefreshSet.size > 0;

        if (isIncrementalRefresh) {
          // Only fetch realms that need refreshing
          realmsToFetch = Array.from(this.realmsNeedingRefreshSet);

          // Remove old results from these realms
          this._instances = new TrackedArray(
            this._instances.filter(
              (card) =>
                !realmsToFetch.some((realm) => card.url.startsWith(realm)),
            ),
          );
        } else {
          // Fetch all realms (query or format changed)
          realmsToFetch = this.realmsToSearch;
          this._instances = new TrackedArray();
          this._hasSearchRun = false;
        }

        // Fetch fresh results
        let result = await this.fetchPrerenderedCards(
          query,
          format,
          realmsToFetch,
          cardUrls,
        );

        // Merge with existing results
        this._instances.push(...result.instances);

        // Update metadata
        if (isIncrementalRefresh) {
          // For incremental refresh, update total based on actual instances count
          this._meta = {
            page: {
              total: this._instances.length,
            },
          };
        } else {
          // For full refresh, use the metadata from the response
          this._meta = result.meta;
        }

        // Clear refresh flags
        this.realmsNeedingRefreshSet.clear();
      } catch (e) {
        console.error(
          `Failed to search prerendered for realms ${Array.from(
            this.realmsNeedingRefreshSet.values(),
          ).join(', ')}:`,
          e,
        );
        this._instances.splice(0, this._instances.length);
        this._meta = { page: { total: 0 } };
      } finally {
        this._hasSearchRun = true;
        waiter.endAsync(token);
      }
    },
  );
}

/**
 * Creates a PrerenderedSearchResource that fetches prerendered card HTML
 * from the realm server and manages live updates.
 *
 * @param parent - The component or object that owns this resource
 * @param owner - The Ember owner for dependency injection
 * @param args - Function returning the search parameters
 * @returns PrerenderedSearchResource instance
 *
 * @example
 * ```typescript
 * private searchResource = getPrerenderedSearch(
 *   this,
 *   getOwner(this)!,
 *   () => ({
 *     query: this.query,
 *     format: 'fitted',
 *     realms: this.selectedRealms,
 *     isLive: true
 *   })
 * );
 * ```
 */
export function getPrerenderedSearch(
  parent: object,
  owner: Owner,
  args: () => {
    query: Query | undefined;
    format: Format | undefined;
    realms?: string[];
    cardUrls?: string[];
    isLive?: boolean;
    cardComponentModifier?: any;
  },
) {
  let resource = PrerenderedSearchResource.from(parent, () => ({
    named: {
      query: args().query,
      format: args().format,
      realms: args().realms,
      cardUrls: args().cardUrls,
      isLive: args().isLive ?? false,
      cardComponentModifier: args().cardComponentModifier,
      owner,
    },
  }));
  return resource;
}
