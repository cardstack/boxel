import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { IconGlobe, Lock, StarFilled } from '@cardstack/boxel-ui/icons';

import config from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import AddWorkspace from './add-workspace';
import Workspace from './workspace';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    sortOrder: 'default' | 'hosted-only';
  };
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare matrixService: MatrixService;
  @service declare realmServer: RealmServerService;
  @service declare realm: RealmService;

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
    if (this.args.sortOrder === 'hosted-only') {
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
      this.args.sortOrder === 'hosted-only' &&
      this.filteredUserRealmURLs.length === 0
    ) {
      return 'No matching results';
    }
    return null;
  }

  private get catalogEmptyMessage(): string | null {
    if (
      this.args.sortOrder === 'hosted-only' &&
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
      <div class='workspace-chooser__content'>
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
        background-color: #1a1628;
        height: 100%;
        width: 100%;
        animation: fadeIn 0.5s ease-in forwards;
        z-index: var(--host-workspace-chooser-z-index);
      }
      .workspace-chooser__content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-lg);
        height: 100%;
        padding: calc(5rem + 60px) 5rem 5rem;
        overflow: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255 255 255 / 20%) transparent;
      }
      .workspace-chooser__content::-webkit-scrollbar {
        width: 8px;
      }
      .workspace-chooser__content::-webkit-scrollbar-track {
        background: transparent;
      }
      .workspace-chooser__content::-webkit-scrollbar-thumb {
        background: rgba(255 255 255 / 20%);
        border-radius: 4px;
      }
      .workspace-chooser__content::-webkit-scrollbar-thumb:hover {
        background: rgba(255 255 255 / 35%);
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
        --icon-color: #00ffba;
        color: #00ffba;
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
        gap: calc(var(--boxel-sp-lg) + 20px);
        padding: var(--boxel-sp-xs) 0;
      }
      .section-empty {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-sm);
      }
    </style>
  </template>
}
