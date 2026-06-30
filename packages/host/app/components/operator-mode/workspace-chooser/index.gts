import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import Home from '@cardstack/boxel-icons/home';
import Shapes from '@cardstack/boxel-icons/shapes';

import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { add, eq } from '@cardstack/boxel-ui/helpers';
import { IconGlobe, Lock, StarFilled } from '@cardstack/boxel-ui/icons';
import type { Icon } from '@cardstack/boxel-ui/icons';

import { ri } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import AddWorkspace from './add-workspace';
import ArchivedWorkspace from './archived-workspace';
import Workspace from './workspace';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';

interface SortOption {
  label: string;
  icon: Icon;
  value: 'default' | 'hosted-only';
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    topBarCenterElement: Element | null;
  };
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare matrixService: MatrixService;
  @service declare realmServer: RealmServerService;
  @service declare realm: RealmService;

  constructor(...args: [any, any]) {
    super(...args);
    // Populate the Archived section. The endpoint is owner-scoped, so
    // non-owners get an empty list and the section stays hidden.
    this.realmServer
      .fetchArchivedRealms()
      .catch((e) => console.error('Failed to fetch archived realms', e));
  }

  private get archivedRealms() {
    return this.realmServer.archivedRealms;
  }

  private get hasArchivedRealms() {
    return this.archivedRealms.length > 0;
  }

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
      this.realmServer.displayedCatalogRealmIdentifiers &&
      this.realmServer.displayedCatalogRealmIdentifiers.length > 0
    );
  }

  private get communityRealmIdentifiers() {
    let realmURLs = this.realmServer.displayedCatalogRealmIdentifiers ?? [];
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

  private filterByHosted<T extends string>(urls: T[]): T[] {
    if (this.sortOrder === 'hosted-only') {
      return urls.filter(this.isHosted);
    }
    return urls;
  }

  private get filteredUserRealmIdentifiers() {
    return this.filterByHosted(this.realmServer.userRealmIdentifiers);
  }

  private get filteredCatalogRealmIdentifiers() {
    return this.filterByHosted(this.communityRealmIdentifiers);
  }

  private get favoriteRealmIdentifiers() {
    let favorites = this.matrixService.workspaceFavorites;
    let allURLs = new Set<string>([
      ...this.realmServer.userRealmIdentifiers,
      ...(this.realmServer.displayedCatalogRealmIdentifiers ?? []),
    ]);
    let filtered = favorites.filter((url) => allURLs.has(url)).map(ri);
    return this.filterByHosted(filtered);
  }

  private get userWorkspacesEmptyMessage(): string | null {
    if (
      this.sortOrder === 'hosted-only' &&
      this.filteredUserRealmIdentifiers.length === 0
    ) {
      return 'No matching results';
    }
    return null;
  }

  private get catalogEmptyMessage(): string | null {
    if (
      this.sortOrder === 'hosted-only' &&
      this.filteredCatalogRealmIdentifiers.length === 0
    ) {
      return 'No matching results';
    }
    return null;
  }

  private get favoritesEmptyMessage(): string | null {
    if (this.matrixService.workspaceFavorites.length === 0) {
      return 'You have no favorites yet';
    }
    if (this.favoriteRealmIdentifiers.length === 0) {
      return 'No matching results';
    }
    return null;
  }

  // The keyboard-selected tile, identified by its position in the flat,
  // DOM-ordered sequence of selectable tiles. The sequence spans, in render
  // order: Favorites, Your Workspaces, the "New Workspace" tile, then Catalogs.
  @tracked private selectedIndex = 0;

  private get favoritesCount() {
    return this.favoriteRealmIdentifiers.length;
  }

  private get userWorkspacesCount() {
    return this.filteredUserRealmIdentifiers.length;
  }

  // The "New Workspace" tile is hidden only when the hosted-only filter empties
  // the Your Workspaces section.
  private get isAddWorkspaceShown() {
    return !this.userWorkspacesEmptyMessage;
  }

  private get renderedCatalogCount() {
    if (!this.displayCatalogWorkspaces || this.catalogEmptyMessage) {
      return 0;
    }
    return this.filteredCatalogRealmIdentifiers.length;
  }

  // navIndex of the first tile in each section. The "New Workspace" tile sits
  // between Your Workspaces and Catalogs.
  private get userWorkspacesNavBase() {
    return this.favoritesCount;
  }

  private get addWorkspaceNavIndex() {
    return this.favoritesCount + this.userWorkspacesCount;
  }

  private get catalogNavBase() {
    return this.addWorkspaceNavIndex + (this.isAddWorkspaceShown ? 1 : 0);
  }

  private get selectableCount() {
    return this.catalogNavBase + this.renderedCatalogCount;
  }

  // `selectedIndex` can fall out of range when the selectable set shrinks
  // without a keypress (e.g. switching to the Hosted Only filter hides the
  // user section and "New Workspace" tile). Clamping on read keeps a tile
  // selected so focus/Enter/arrow navigation keep working. Used everywhere the
  // selection is consumed — rendering, lookups, and as the base for movement.
  private get currentIndex() {
    let count = this.selectableCount;
    if (count === 0) {
      return 0;
    }
    return Math.min(Math.max(this.selectedIndex, 0), count - 1);
  }

  // Keep the selection in sync with focus, so tabbing onto a tile selects it.
  @action private onFocusIn(event: Event) {
    let tile = (event.target as HTMLElement).closest('[data-nav-index]');
    if (!tile) {
      return;
    }
    let index = Number((tile as HTMLElement).dataset.navIndex);
    if (!Number.isNaN(index) && index !== this.selectedIndex) {
      this.selectedIndex = index;
    }
  }

  @action private onKeydown(event: Event) {
    let kbEvent = event as KeyboardEvent;
    let container = kbEvent.currentTarget as HTMLElement;
    let count = this.selectableCount;
    if (count === 0) {
      return;
    }
    // Only handle keys that originate from a selectable tile. Other controls
    // inside the chooser (a card's favorite/options/host buttons) handle their
    // own keys, so we must not intercept (and preventDefault) their events.
    if (!(kbEvent.target as HTMLElement).closest('[data-nav-index]')) {
      return;
    }
    switch (kbEvent.key) {
      // Left/Right step linearly through the sequence.
      case 'ArrowRight':
        event.preventDefault();
        this.selectedIndex = Math.min(this.currentIndex + 1, count - 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.selectedIndex = Math.max(this.currentIndex - 1, 0);
        break;
      // Up/Down move by visual row in the wrapped flex layout.
      case 'ArrowDown':
        event.preventDefault();
        this.moveVertically(container, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveVertically(container, -1);
        break;
      case 'Enter': {
        event.preventDefault();
        // Stop this keystroke from reaching ember-keyboard's document-level
        // listener. Activating the "New Workspace" tile mounts a modal whose
        // Create button has a global `{{on-key 'Enter'}}`; without this, the
        // same Enter would bubble on to that listener and submit the form the
        // instant it opens.
        event.stopPropagation();
        let selected = container.querySelector(
          `[data-nav-index='${this.currentIndex}']`,
        );
        if (selected instanceof HTMLElement) {
          // Activates the focused tile — opening the workspace, or the
          // "New Workspace" modal. preventDefault above suppresses the focused
          // button's native Enter-to-click so it fires only once.
          selected.click();
        }
        break;
      }
    }
  }

  // From the selected tile, find the nearest row in the given direction and
  // pick the tile whose horizontal center is closest to the current one.
  private moveVertically(container: HTMLElement, direction: 1 | -1) {
    let tiles = [...container.querySelectorAll('[data-nav-index]')].map(
      (element) => ({
        index: Number((element as HTMLElement).dataset.navIndex),
        rect: element.getBoundingClientRect(),
      }),
    );
    let current = tiles.find((tile) => tile.index === this.currentIndex);
    if (!current) {
      return;
    }
    let currentCenterX = current.rect.left + current.rect.width / 2;
    let candidates = tiles.filter((tile) =>
      direction === 1
        ? tile.rect.top > current.rect.top + 1
        : tile.rect.top < current.rect.top - 1,
    );
    if (candidates.length === 0) {
      return;
    }
    // The nearest row is the one whose top is closest to the current tile in
    // the travel direction; tiles in that row share (near-)identical tops.
    let targetRowTop =
      direction === 1
        ? Math.min(...candidates.map((tile) => tile.rect.top))
        : Math.max(...candidates.map((tile) => tile.rect.top));
    let rowTiles = candidates.filter(
      (tile) => Math.abs(tile.rect.top - targetRowTop) <= 1,
    );
    let nearest = rowTiles.reduce((closest, tile) => {
      let closestDx = Math.abs(
        closest.rect.left + closest.rect.width / 2 - currentCenterX,
      );
      let tileDx = Math.abs(
        tile.rect.left + tile.rect.width / 2 - currentCenterX,
      );
      return tileDx < closestDx ? tile : closest;
    });
    this.selectedIndex = nearest.index;
  }

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <div
      class='workspace-chooser'
      data-test-workspace-chooser
      {{on 'keydown' this.onKeydown}}
      {{on 'focusin' this.onFocusIn}}
    >
      {{#if @topBarCenterElement}}
        {{#in-element @topBarCenterElement}}
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
        {{/in-element}}
      {{/if}}
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
                {{#each this.favoriteRealmIdentifiers as |realmIdentifier i|}}
                  <Workspace
                    @realmIdentifier={{realmIdentifier}}
                    @navIndex={{i}}
                    @isSelected={{eq this.currentIndex i}}
                  />
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
                {{#each
                  this.filteredUserRealmIdentifiers
                  as |realmIdentifier i|
                }}
                  {{#let (add this.userWorkspacesNavBase i) as |navIndex|}}
                    <Workspace
                      @realmIdentifier={{realmIdentifier}}
                      @showMenu={{true}}
                      @navIndex={{navIndex}}
                      @isSelected={{eq this.currentIndex navIndex}}
                    />
                  {{/let}}
                {{/each}}
                {{#if this.matrixService.isInitializingNewUser}}
                  <WorkspaceLoadingIndicator />
                {{/if}}
                <AddWorkspace
                  @navIndex={{this.addWorkspaceNavIndex}}
                  @isSelected={{eq this.currentIndex this.addWorkspaceNavIndex}}
                />
              </div>
            {{/if}}
          </div>
          {{#if this.hasArchivedRealms}}
            <div class='workspace-section' data-test-archived-section>
              <div class='section-header'>
                <ArchiveIcon
                  width='20'
                  height='20'
                  class='section-header-icon'
                />
                <span class='workspace-chooser__title'>Archived</span>
              </div>
              <div class='workspace-list' data-test-archived-list>
                {{#each this.archivedRealms as |archivedRealm|}}
                  <ArchivedWorkspace @archivedRealm={{archivedRealm}} />
                {{/each}}
              </div>
            </div>
          {{/if}}
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
                  {{#each
                    this.filteredCatalogRealmIdentifiers
                    as |realmIdentifier i|
                  }}
                    {{#let (add this.catalogNavBase i) as |navIndex|}}
                      <Workspace
                        @realmIdentifier={{realmIdentifier}}
                        @navIndex={{navIndex}}
                        @isSelected={{eq this.currentIndex navIndex}}
                      />
                    {{/let}}
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
        display: flex;
        align-items: center;
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
