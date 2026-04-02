import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { debounce } from 'lodash';

import {
  CardDef,
  Component,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import CardList from '@cardstack/base/components/card-list';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from '@cardstack/base/command';
import { commandData } from '@cardstack/base/resources/command-data';
import StringField from '@cardstack/base/string';

import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';
import BotIcon from '@cardstack/boxel-icons/bot';

import { gt } from '@cardstack/boxel-ui/helpers';
import {
  BoxelInput,
  LoadingIndicator,
  ViewSelector,
  type ViewItem,
} from '@cardstack/boxel-ui/components';
import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import { type Query, type getCards } from '@cardstack/runtime-common';

import { RealmTabs } from './components/portal/realm-tabs';

type ViewOption = 'strip' | 'grid';

const SUBMISSION_VIEW_OPTIONS: ViewItem[] = [
  { id: 'strip', icon: StripIcon },
  { id: 'grid', icon: GridIcon },
];

class Isolated extends Component<typeof SubmissionCardPortal> {
  @tracked searchText: string = '';
  @tracked selectedView: string = 'grid';
  @tracked selectedRealm: string | null = null;

  private debouncedSetSearch = debounce((value: string) => {
    this.searchText = value;
  }, 300);

  willDestroy() {
    super.willDestroy();
    this.debouncedSetSearch.cancel();
  }

  @action
  onSearchInput(value: string) {
    this.debouncedSetSearch(value);
  }

  @action
  setView(id: ViewOption) {
    this.selectedView = id;
  }

  @action
  selectRealm(realm: string | null) {
    this.selectedRealm = realm;
  }

  allRealmsInfoResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  // All realm URLs known to the host — used as the search scope
  get allRealmUrls(): string[] {
    const resource = this.allRealmsInfoResource;
    if (resource?.isSuccess && resource.cardResult) {
      return (
        (resource.cardResult as GetAllRealmMetasResult).results?.map(
          (r) => r.url,
        ) ?? []
      );
    }
    return [];
  }

  // Query SubmissionCards across all known realms so we can see which ones
  // The filter uses adoptsFrom type matching — it looks for cards whose module/name matches SubmissionCard
  submissionDiscovery: ReturnType<getCards> | undefined =
    this.args.context?.getCards(
      this,
      () => this.baseTypeFilter,
      () => this.allRealmUrls,
      { isLive: true },
    );

  get baseTypeFilter(): Query {
    return {
      filter: {
        type: {
          module: new URL('./submission-card', import.meta.url).href,
          name: 'SubmissionCard',
        },
      },
      sort: [{ by: 'createdAt', direction: 'desc' }],
    };
  }

  private get currentRealmHrefs(): string[] {
    const url = this.args.model[realmURL];
    return url ? [url.href] : [];
  }

  private get allRealmMetas(): RealmMetaField[] {
    if (!this.allRealmsInfoResource?.isSuccess) return [];
    return (
      (this.allRealmsInfoResource.cardResult as GetAllRealmMetasResult)
        ?.results ?? []
    );
  }

  // Only realms that actually have SubmissionCard instances, with full meta
  get availableRealms(): RealmMetaField[] {
    const realmUrlsWithCards = new Set(
      (this.submissionDiscovery?.instancesByRealm ?? []).map((r) => r.realm),
    );
    return this.allRealmMetas.filter((r) => realmUrlsWithCards.has(r.url));
  }

  get isRealmsReady(): boolean {
    return (
      this.allRealmsInfoResource?.isSuccess === true &&
      this.submissionDiscovery?.isLoading === false
    );
  }

  get realmHrefs(): string[] {
    const fallback = this.currentRealmHrefs;
    if (!this.allRealmsInfoResource?.isSuccess) return fallback;
    if (this.selectedRealm) return [this.selectedRealm];

    const availableUrls = this.availableRealms.map((r) => r.url);
    return availableUrls.length > 0 ? availableUrls : fallback;
  }

  get query(): Query {
    const { filter: baseFilter, sort } = this.baseTypeFilter;

    if (!this.searchText) {
      return { filter: baseFilter, sort };
    }

    return {
      filter: {
        every: [
          baseFilter!,
          {
            any: [{ contains: { cardTitle: this.searchText } }],
          },
        ],
      },
      sort,
    };
  }

  <template>
    <div class='submission-portal'>
      <header class='portal-header'>
        <h1 class='portal-cardTitle'>{{@model.cardTitle}}</h1>
        <div class='portal-controls'>
          <BoxelInput
            class='search-input'
            @type='search'
            @value={{this.searchText}}
            @onInput={{this.onSearchInput}}
            placeholder='Search by card title...'
          />
          <ViewSelector
            class='portal-view-selector'
            @selectedId={{this.selectedView}}
            @onChange={{this.setView}}
            @items={{SUBMISSION_VIEW_OPTIONS}}
          />
        </div>
        {{#if (gt this.availableRealms.length 0)}}
          <RealmTabs
            @realms={{this.availableRealms}}
            @selectedRealm={{this.selectedRealm}}
            @onChange={{this.selectRealm}}
          />
        {{/if}}
      </header>

      <div class='portal-content'>
        {{#if this.isRealmsReady}}
          <CardList
            @query={{this.query}}
            @realms={{this.realmHrefs}}
            @format='fitted'
            @viewOption={{this.selectedView}}
            @context={{@context}}
            @isLive={{true}}
          />
        {{else}}
          <div class='loading-screen'>
            <LoadingIndicator />
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .submission-portal {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--muted, #f6f8fa);
      }

      .portal-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        background: color-mix(
          in srgb,
          var(--primary, #e5f0ff) 12%,
          var(--card, #ffffff)
        );
        border-bottom: 1px solid var(--border, #d0d7de);
      }

      .portal-cardTitle {
        margin: 0;
        font: 700 var(--boxel-font-xl);
        color: var(--foreground, #1f2328);
      }

      .portal-controls {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }

      .search-input {
        flex: 1;
        --boxel-input-search-background-color: var(--foreground, #1f2328);
        --boxel-input-search-color: var(--card, #ffffff);
        --boxel-input-search-icon-color: var(--primary-foreground, #ffffff);
        --border: var(--foreground, #1f2328);
        --muted-foreground: color-mix(
          in srgb,
          var(--card, #ffffff) 72%,
          transparent
        );
      }

      .portal-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--boxel-sp);
        background: var(--card, #ffffff);
      }

      .portal-view-selector {
        margin-left: auto;
        flex-shrink: 0;
        --boxel-view-option-group-column-gap: var(--boxel-sp-2xs);
        color: var(--muted-foreground, #656d76);
      }

      .portal-content :deep(.boxel-card-list) {
        --boxel-card-list-padding: 0;
        --boxel-card-list-gap: var(--boxel-sp);
      }

      .portal-content :deep(.boxel-card-list.grid-view) {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }

      .portal-content :deep(.boxel-card-list.strip-view) {
        grid-template-columns: repeat(auto-fill, minmax(100%, 1fr));
      }

      .portal-content :deep(.boxel-card-list.grid-view .boxel-card-list-item) {
        width: 100%;
        height: 420px;
      }

      .portal-content :deep(.boxel-card-list.strip-view .boxel-card-list-item) {
        width: 100%;
        height: 120px;
      }

      .portal-content .loading-screen {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        min-height: 300px;
      }
    </style>
  </template>
}

export class SubmissionCardPortal extends CardDef {
  static displayName = 'Submission Card Portal';
  static prefersWideFormat = true;
  static headerColor = '#00ffba';
  static icon = BotIcon;

  @field cardTitle = contains(StringField, {
    computeVia: function (this: SubmissionCardPortal) {
      return 'Submission Card Portal';
    },
  });

  static isolated = Isolated;
}
