import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Home from '@cardstack/boxel-icons/home';
import Shapes from '@cardstack/boxel-icons/shapes';

import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { IconGlobe, Lock, StarFilled } from '@cardstack/boxel-ui/icons';
import type { Icon } from '@cardstack/boxel-ui/icons';

import config from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import AddWorkspace from './add-workspace';
import Workspace from './workspace';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';

interface SortOption {
  label: string;
  icon: Icon;
  value: 'default' | 'hosted-only';
}

interface Signature {
  Element: HTMLDivElement;
  Args: {};
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare matrixService: MatrixService;
  @service declare realmServer: RealmServerService;
  @service declare realm: RealmService;

  private sortOptions: SortOption[] = [
    { label: 'View All', icon: Shapes, value: 'default' },
    { label: 'Hosted Only', icon: Home, value: 'hosted-only' },
  ];

  @tracked private selectedSortOption: SortOption = this.sortOptions[0]!;

  @action private onSortChange(option: SortOption) {
    this.selectedSortOption = option;
  }

  private get sortOrder(): 'default' | 'hosted-only' {
    return this.selectedSortOption.value;
  }

  private get displayCatalogWorkspaces() {
    return (
      this.realmServer.catalogRealmURLs &&
      this.realmServer.catalogRealmURLs.length > 0
    );
  }

  private get communityRealmURLs() {
    let realmURLs = this.realmServer.catalogRealmURLs ?? [];
    if (config.environment !== 'production') {
      return realmURLs;
    }
    return realmURLs.filter(
      (realmURL) => !realmURL.includes('/boxel-homepage/'),
    );
  }

  private isHosted = (url: string): boolean => {
    let info = this.realm.info(url);
    return !!(
      info.lastPublishedAt &&
      typeof info.lastPublishedAt === 'object' &&
      Object.keys(info.lastPublishedAt).length > 0
    );
  };

  private filterByHosted(urls: string[]): string[] {
    if (this.sortOrder === 'hosted-only') {
      return urls.filter(this.isHosted);
    }
    return urls;
  }

  private get filteredUserRealmURLs() {
    return this.filterByHosted(this.realmServer.userRealmURLs);
  }

  private get filteredCatalogRealmURLs() {
    return this.filterByHosted(this.communityRealmURLs);
  }

  private get favoriteRealmURLs() {
    let favorites = this.matrixService.workspaceFavorites;
    let allURLs = [
      ...this.realmServer.userRealmURLs,
      ...(this.realmServer.catalogRealmURLs ?? []),
    ];
    let filtered = favorites.filter((url) => allURLs.includes(url));
    return this.filterByHosted(filtered);
  }

  private get userWorkspacesEmptyMessage(): string | null {
    if (
      this.sortOrder === 'hosted-only' &&
      this.filteredUserRealmURLs.length === 0
    ) {
      return 'No matching results';
    }
    return null;
  }

  private get catalogEmptyMessage(): string | null {
    if (
      this.sortOrder === 'hosted-only' &&
      this.filteredCatalogRealmURLs.length === 0
    ) {
      return 'No matching results';
    }
    return null;
  }

  private get favoritesEmptyMessage(): string | null {
    if (this.matrixService.workspaceFavorites.length === 0) {
      return 'You have no favorites yet';
    }
    if (this.favoriteRealmURLs.length === 0) {
      return 'No matching results';
    }
    return null;
  }

  <template>
    <div class='workspace-chooser' data-test-workspace-chooser>
      <div class='sort-controls'>
        <BoxelSelect
          class='sort-select'
          @options={{this.sortOptions}}
          @selected={{this.selectedSortOption}}
          @onChange={{this.onSortChange}}
          @matchTriggerWidth={{false}}
          aria-label='Filter workspaces'
          data-test-sort-dropdown-trigger
          as |option|
        >
          <option.icon width='16' height='16' />
          {{option.label}}
        </BoxelSelect>
      </div>
      <div class='workspace-chooser__content boxel-dark-scrollbar'>
        <div class='sections-wrapper'>
          <div class='workspace-section' data-test-favorites-section>
            <div class='section-header'>
              <StarFilled width='20' height='20' class='section-header-icon' />
              <span class='workspace-chooser__title'>Favorites</span>
            </div>
            {{#if this.favoritesEmptyMessage}}
              <span
                class='section-empty'
                data-test-favorites-empty
              >{{this.favoritesEmptyMessage}}</span>
            {{else}}
              <div class='workspace-list' data-test-favorites-list>
                {{#each this.favoriteRealmURLs as |realmURL|}}
                  <Workspace @realmURL={{realmURL}} />
                {{/each}}
              </div>
            {{/if}}
          </div>
          <div class='workspace-section'>
            <div class='section-header'>
              <Lock width='20' height='20' class='section-header-icon' />
              <span class='workspace-chooser__title'>Your Workspaces</span>
            </div>
            {{#if this.userWorkspacesEmptyMessage}}
              <span
                class='section-empty'
                data-test-workspaces-empty
              >{{this.userWorkspacesEmptyMessage}}</span>
            {{else}}
              <div class='workspace-list' data-test-workspace-list>
                {{#each this.filteredUserRealmURLs as |realmURL|}}
                  <Workspace @realmURL={{realmURL}} @showMenu={{true}} />
                {{/each}}
                {{#if this.matrixService.isInitializingNewUser}}
                  <WorkspaceLoadingIndicator />
                {{/if}}
                <AddWorkspace />
              </div>
            {{/if}}
          </div>
          {{#if this.displayCatalogWorkspaces}}
            <div class='workspace-section'>
              <div class='section-header'>
                <IconGlobe width='20' height='20' class='section-header-icon' />
                <span class='workspace-chooser__title'>Catalogs</span>
              </div>
              {{#if this.catalogEmptyMessage}}
                <span
                  class='section-empty'
                  data-test-catalog-empty
                >{{this.catalogEmptyMessage}}</span>
              {{else}}
                <div class='workspace-list' data-test-catalog-list>
                  {{#each this.filteredCatalogRealmURLs as |realmURL|}}
                    <Workspace @realmURL={{realmURL}} />
                  {{/each}}
                </div>
              {{/if}}
            </div>
          {{/if}}
        </div>
      </div>
    </div>
    <style scoped>
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .workspace-chooser {
        opacity: 0;
        position: absolute;
        background-color: var(--boxel-800);
        height: 100%;
        width: 100%;
        animation: fadeIn 0.5s ease-in forwards;
        z-index: var(--host-workspace-chooser-z-index);
      }
      .sort-controls {
        position: absolute;
        left: 50%;
        top: var(--operator-mode-spacing);
        height: var(--operator-mode-top-bar-item-height);
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        z-index: 1;
      }
      .sort-select {
        --boxel-select-background-color: rgb(42 32 64 / 90%);
        --boxel-select-border-color: rgba(255 255 255 / 25%);
        --boxel-select-text-color: var(--boxel-light);
        --boxel-select-focus-border-color: rgba(255 255 255 / 50%);
        --icon-color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }
      .workspace-chooser__content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-lg);
        height: 100%;
        padding: calc(5rem + 3.75rem) 5rem 5rem;
        overflow: auto;
      }
      .sections-wrapper {
        display: flex;
        flex-direction: column;
        gap: calc(var(--boxel-sp-lg) * 2);
      }
      .workspace-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .section-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .section-header-icon {
        --icon-color: var(--boxel-teal);
        color: var(--boxel-teal);
        flex-shrink: 0;
      }
      .workspace-chooser__title {
        color: var(--boxel-light);
        font: 400 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp);
      }
      .workspace-list {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--boxel-sp-lg) + var(--boxel-sp-lg));
        padding: var(--boxel-sp-xs) 0;
      }
      .section-empty {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-sm);
      }
    </style>
  </template>
}
