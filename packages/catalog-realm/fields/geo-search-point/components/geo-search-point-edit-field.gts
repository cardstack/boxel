import GlimmerComponent from '@glimmer/component';
import type Owner from '@ember/owner';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import { debounce } from 'lodash';
import { tracked } from '@glimmer/tracking';
import GeoSearchAddressInput from './geo-search-address-input';
import GeoSearchTopResultsAddon from './geo-search-top-results-addon';
import GeoSearchRecentSearchesAddon from './geo-search-recent-searches-addon';
import { searchAddress, type GeoSearchModel } from '../util/index';
import type {
  GeoSearchPointConfiguration,
  GeoSearchPointOptions,
} from '../../geo-search-point';

// Module-level storage for recent searches keyed by configuration
// Persists across component recreation within the same page session
const recentSearchesStorage = new WeakMap<
  GeoSearchPointConfiguration | object,
  string[]
>();

interface GeoSearchPointEditFieldSignature {
  Args: {
    model: GeoSearchModel;
    canEdit?: boolean;
    configuration?: GeoSearchPointConfiguration;
  };
}

export default class GeoSearchPointEditField extends GlimmerComponent<GeoSearchPointEditFieldSignature> {
  @tracked searchResults: any[] = [];
  @tracked recentSearches: string[] = [];
  @tracked private resultSelected = false;

  constructor(owner: Owner, args: GeoSearchPointEditFieldSignature['Args']) {
    super(owner, args);
    const stored = recentSearchesStorage.get(this.config);
    if (stored) {
      this.recentSearches = [...stored];
    }
  }

  get config(): GeoSearchPointConfiguration {
    return (this.args.configuration as GeoSearchPointConfiguration) ?? {};
  }

  private get options(): GeoSearchPointOptions {
    return this.config.options ?? {};
  }

  get canEdit(): boolean {
    return this.args.canEdit ?? true;
  }

  get inputOptions() {
    return {
      placeholder: this.options.placeholder,
    };
  }

  get showTopSearchResults(): boolean {
    return this.options.showTopSearchResults === true;
  }

  get topSearchResultsLimit(): number {
    if (this.options.showTopSearchResults === true) {
      return this.options.topSearchResultsLimit ?? 5;
    }
    return 5;
  }

  get showRecentSearches(): boolean {
    if (this.options.showTopSearchResults === true) {
      return this.options.showRecentSearches ?? true;
    }
    return false;
  }

  get recentSearchesLimit(): number {
    if (this.options.showTopSearchResults === true) {
      return this.options.recentSearchesLimit ?? 5;
    }
    return 5;
  }

  get limitedSearchResults() {
    return this.searchResults.slice(0, this.topSearchResultsLimit);
  }

  get limitedRecentSearches() {
    return this.recentSearches.slice(0, this.recentSearchesLimit);
  }

  get showTopResultsSection() {
    return (
      this.canEdit &&
      this.showTopSearchResults &&
      !this.resultSelected &&
      !!this.args.model?.searchKey?.trim() &&
      !!this.performSearchTask.last
    );
  }

  get showRecentSearchesSection() {
    return (
      this.canEdit &&
      this.showRecentSearches &&
      this.limitedRecentSearches.length > 0
    );
  }

  private performSearchTask = task(async (query: string | undefined) => {
    if (!query || query.trim() === '') {
      if (this.args.model) {
        this.args.model.lat = undefined;
        this.args.model.lon = undefined;
      }
      this.searchResults = [];
      return;
    }

    try {
      const results = await searchAddress(query, this.topSearchResultsLimit);
      this.searchResults = results.map((r) => r.raw);

      if (results.length > 0 && this.args.model) {
        const first = results[0];
        this.args.model.lat = first.lat;
        this.args.model.lon = first.lon;
      }
    } catch (error) {
      console.error('Error geocoding address:', error);
      if (this.args.model) {
        this.args.model.lat = undefined;
        this.args.model.lon = undefined;
      }
      this.searchResults = [];
    }
  });

  private debouncedSearch = debounce((query: string) => {
    this.performSearchTask.perform(query);
  }, 1000);

  @action
  handleSearchInput(value: string) {
    this.resultSelected = false;
    if (this.args.model) {
      this.args.model.searchKey = value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      if (this.args.model) {
        this.args.model.lat = undefined;
        this.args.model.lon = undefined;
      }
      this.searchResults = [];
      return;
    }

    this.debouncedSearch(trimmed);
  }

  private recordRecentSearch(query: string) {
    if (!query || this.recentSearches.includes(query)) return;
    const updated = [query, ...this.recentSearches].slice(
      0,
      this.recentSearchesLimit,
    );
    this.recentSearches = updated;
    recentSearchesStorage.set(this.config, updated);
  }

  @action
  selectResult(displayName: string) {
    this.recordRecentSearch(displayName);
    this.resultSelected = true;
    this.searchResults = [];
    if (this.args.model) {
      this.args.model.searchKey = displayName;
    }
    this.performSearchTask.perform(displayName);
  }

  @action
  selectRecentSearch(query: string) {
    this.resultSelected = true;
    if (this.args.model) {
      this.args.model.searchKey = query;
    }
    this.performSearchTask.perform(query);
  }

  <template>
    <div class='geo-search-point-edit-field'>
      <GeoSearchAddressInput
        @model={{@model}}
        @canEdit={{this.canEdit}}
        @options={{this.inputOptions}}
        @isSearching={{this.performSearchTask.isRunning}}
        @onSearch={{this.handleSearchInput}}
      />

      {{#if this.showTopResultsSection}}
        <GeoSearchTopResultsAddon
          @results={{this.limitedSearchResults}}
          @canEdit={{this.canEdit}}
          @isSearching={{this.performSearchTask.isRunning}}
          @onSelectResult={{this.selectResult}}
        />
      {{/if}}

      {{#if this.showRecentSearchesSection}}
        <GeoSearchRecentSearchesAddon
          @searches={{this.limitedRecentSearches}}
          @canEdit={{this.canEdit}}
          @onSelectSearch={{this.selectRecentSearch}}
        />
      {{/if}}
    </div>

    <style scoped>
      .geo-search-point-edit-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}
