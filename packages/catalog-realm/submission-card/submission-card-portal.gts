import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { debounce } from 'lodash';

import {
  CardDef,
  Component,
  contains,
  field,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from 'https://cardstack.com/base/command';
import { type Query, type getCards } from '@cardstack/runtime-common';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';

import { gt } from '@cardstack/boxel-ui/helpers';
import {
  BoxelInput,
  ViewSelector,
  type ViewItem,
} from '@cardstack/boxel-ui/components';
import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import BotIcon from '@cardstack/boxel-icons/bot';

import { CardsGrid } from '../catalog-app/components/grid';
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

  get realmHrefs(): string[] {
    if (!this.allRealmsInfoResource?.isSuccess) return this.currentRealmHrefs;
    if (this.selectedRealm) return [this.selectedRealm];

    const availableUrls = this.availableRealms.map((r) => r.url);
    return availableUrls.length > 0 ? availableUrls : this.currentRealmHrefs;
  }

  get query(): Query {
    const baseFilter = this.baseTypeFilter.filter!;

    if (!this.searchText) {
      return { filter: baseFilter };
    }

    return {
      filter: {
        every: [
          baseFilter,
          {
            any: [{ contains: { cardTitle: this.searchText } }],
          },
        ],
      },
    };
  }

  <template>
    <div class='submission-portal'>
      <header class='portal-header'>
        <h1 class='portal-title'>{{@model.title}}</h1>
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
        <CardsGrid
          @query={{this.query}}
          @realms={{this.realmHrefs}}
          @selectedView={{this.selectedView}}
          @context={{@context}}
        />
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

      .portal-title {
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

      .portal-content :deep(.cards) {
        --grid-view-min-width: 300px;
        --grid-view-height: 420px;
        --strip-view-min-width: 100%;
        --strip-view-height: 120px;
      }
    </style>
  </template>
}

export class SubmissionCardPortal extends CardDef {
  static displayName = 'Submission Card Portal';
  static prefersWideFormat = true;
  static headerColor = '#00ffba';
  static icon = BotIcon;

  @field title = contains(StringField);
  @field description = contains(StringField);

  static isolated = Isolated;
}
