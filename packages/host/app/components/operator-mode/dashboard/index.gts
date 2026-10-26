import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import Bot from '@cardstack/boxel-icons/bot';
import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import Lock from '@cardstack/boxel-icons/lock';
import Store from '@cardstack/boxel-icons/store';
import { Button } from '@cardstack/pretui/components/button';
import { Collapsible } from '@cardstack/pretui/components/collapsible';
import { SegmentedControl } from '@cardstack/pretui/components/segmented-control';
import { Spinner } from '@cardstack/pretui/components/spinner';
import { didCancel, dropTask } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import { add, eq } from '@cardstack/boxel-ui/helpers';
import {
  FailureBordered as FailureIcon,
  StarFilled,
  WarningTriangleFilled as WarningIcon,
} from '@cardstack/boxel-ui/icons';
import type { Icon } from '@cardstack/boxel-ui/icons';

import { logger, ri } from '@cardstack/runtime-common';

import { catalogRealmURL, leadWith } from '@cardstack/host/lib/utils';
import {
  favoritesTileWidth,
  isHostedRealm,
  listedCatalogRealmURLs,
  nearestNavIndexInRow,
  sortByCreatedAtDesc,
  unreachableRealmServersMessage,
} from '@cardstack/host/lib/workspace-list';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import AddWorkspace from '../workspace-chooser/add-workspace';
import ArchivedWorkspace from '../workspace-chooser/archived-workspace';
import ManageCatalogs from '../workspace-chooser/manage-catalogs';
import Workspace, {
  WORKSPACE_TILE_TARGET,
} from '../workspace-chooser/workspace';
import WorkspaceLoadingIndicator from '../workspace-chooser/workspace-loading-indicator';

import { greetingFor } from './greeting';

type Scope = 'all' | 'hosted';

interface Signature {
  Element: HTMLElement;
}

const log = logger('component:dashboard');

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hosted', label: 'Hosted' },
];

// Dashboard v2, shown in place of the workspace chooser when the
// DASHBOARD_V2 feature flag is on. The sections hold the chooser's tiles
// until the dashboard's own desks and rows replace them.
export default class Dashboard extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private realmServer: RealmServerService;
  @service declare private realm: RealmService;

  @tracked private hour = new Date().getHours();

  private get greeting() {
    return greetingFor(this.hour, this.matrixService.profile.displayName);
  }

  // Re-reads the hour at the top of every hour, so a dashboard left open
  // moves from morning to afternoon to evening. Timers don't run while the
  // machine sleeps, so the hour is also re-read when the page is shown again.
  private trackHour = modifier(() => {
    let timer: ReturnType<typeof setTimeout>;
    let schedule = () => {
      let now = new Date();
      let nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      timer = setTimeout(update, nextHour.getTime() - now.getTime());
    };
    let update = () => {
      clearTimeout(timer);
      this.hour = new Date().getHours();
      schedule();
    };
    let onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        update();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  // Each section is named by the title span in its heading, so a count shown
  // in a heading, as Catalogs has, stays out of the name.
  private headingId = (section: string) => `${guidFor(this)}-${section}`;

  // All, or only workspaces published to the web, in Favorites, Your
  // Workspaces and Catalogs.
  @tracked private scope: Scope = 'all';

  private scopeOptions = SCOPE_OPTIONS;

  @action private setScope(value: string) {
    let option = SCOPE_OPTIONS.find((option) => option.value === value);
    if (option) {
      this.scope = option.value;
    }
  }

  @tracked private isArchivedExpanded = false;

  private get archivedRealms() {
    return this.realmServer.archivedRealms;
  }

  private get unreachableRealmServers() {
    return this.realmServer.unreachableRealmServers;
  }

  private get unreachableRealmServersMessage() {
    return unreachableRealmServersMessage(
      this.unreachableRealmServers,
      this.isRetryingUnreachableRealmServers,
    );
  }

  private get isRetryingUnreachableRealmServers() {
    return this.matrixService.isRetryingUnreachableRealmServers;
  }

  private get unreachableNoticeIcon(): Icon {
    return this.isRetryingUnreachableRealmServers ? WarningIcon : FailureIcon;
  }

  // Before the first load the count is unknown, so the row shows just
  // "Archived".
  private get showArchivedCount() {
    return (
      Boolean(this.loadArchivedRealmsTask.lastSuccessful) ||
      this.archivedRealms.length > 0
    );
  }

  private loadArchivedRealmsTask = dropTask(async () => {
    await this.realmServer.fetchArchivedRealms();
  });

  private get archivedLoadFailed() {
    return Boolean(this.loadArchivedRealmsTask.last?.isError);
  }

  @action private setArchivedExpanded(isExpanded: boolean) {
    this.isArchivedExpanded = isExpanded;
    // Fetched on first expand, and again after a failed fetch.
    if (this.isArchivedExpanded) {
      this.loadArchivedRealms();
    }
  }

  @action private loadArchivedRealms() {
    if (
      !this.loadArchivedRealmsTask.lastSuccessful &&
      !this.loadArchivedRealmsTask.isRunning
    ) {
      // Nothing awaits the perform, and an unconsumed task error is reported
      // globally, failing whichever test happens to be running.
      this.loadArchivedRealmsTask.perform().catch((error: unknown) => {
        if (didCancel(error)) {
          return;
        }
        log.warn(`loading archived realms failed: ${error}`);
      });
    }
  }

  @cached
  private get catalogRealmIdentifiers() {
    return listedCatalogRealmURLs(
      this.realmServer.displayedCatalogRealmIdentifiers,
    );
  }

  private isHosted = (url: string): boolean =>
    isHostedRealm(this.realm.info(url));

  private filterByScope<T extends string>(urls: T[]): T[] {
    return this.scope === 'hosted' ? urls.filter(this.isHosted) : urls;
  }

  // In list order: `_realm-auth` lists realms newest-created first.
  @cached
  private get userRealmIdentifiers() {
    return this.filterByScope(this.realmServer.userRealmIdentifiers);
  }

  // Newest first, except the Boxel catalog, which always leads.
  @cached
  private get filteredCatalogRealmIdentifiers() {
    return this.filterByScope(
      leadWith(
        sortByCreatedAtDesc(this.catalogRealmIdentifiers, this.realm.info),
        catalogRealmURL,
      ),
    );
  }

  // Favorites outside the listed workspaces and catalogs (archived or removed
  // realms) aren't shown.
  @cached
  private get listedFavoriteRealmIdentifiers() {
    let listedURLs = new Set<string>([
      ...this.realmServer.userRealmIdentifiers,
      ...this.catalogRealmIdentifiers,
    ]);
    return this.matrixService.workspaceFavorites
      .filter((url) => listedURLs.has(url))
      .map(ri);
  }

  @cached
  private get favoriteRealmIdentifiers() {
    return this.filterByScope(this.listedFavoriteRealmIdentifiers);
  }

  // Only favorite tiles show Cards / Files / Definitions counts, so they are
  // loaded for that set alone. `revision` is unread, but passing it re-runs
  // the modifier when a re-index marks the counts stale.
  private trackFavoriteCounts = modifier(
    (_el: HTMLElement, [urls, _revision]: [string[], number]) => {
      this.realm.loadIndexCounts(urls);
    },
  );

  private get favoritesEmptyMessage(): string | null {
    if (this.favoriteRealmIdentifiers.length > 0) {
      return null;
    }
    return this.listedFavoriteRealmIdentifiers.length === 0
      ? 'You have no favorites yet'
      : 'No matching results';
  }

  private get userWorkspacesEmptyMessage(): string | null {
    if (this.scope === 'hosted' && this.userRealmIdentifiers.length === 0) {
      return 'No matching results';
    }
    return null;
  }

  private get catalogEmptyMessage(): string | null {
    if (this.filteredCatalogRealmIdentifiers.length > 0) {
      return null;
    }
    return this.scope === 'hosted'
      ? 'No matching results'
      : 'No catalogs yet. Add public realms with the gear.';
  }

  // Favorite tiles span the Your Workspaces grid, measured live from it.
  @tracked private workspaceGridWidth = 0;
  @tracked private workspaceTileWidth = 0;
  @tracked private workspaceTileGap = 0;

  // Undefined while there's no measured grid, so the tile keeps its static
  // width. With no workspaces (none yet, or Hosted hid them all) there is no
  // row to match, whatever was measured last.
  private get favoritesTileWidthPx(): string | undefined {
    if (this.userWorkspacesCount === 0) {
      return undefined;
    }
    let width = favoritesTileWidth(
      this.workspaceGridWidth,
      this.workspaceTileWidth,
      this.workspaceTileGap,
    );
    return width === null ? undefined : `${width}px`;
  }

  // Observer callbacks land after render, so these tracked writes stay out of
  // the render that read `favoritesTileWidthPx`. Tiles are observed as they
  // appear, since each starts as a loading indicator that a loaded tile
  // replaces in the grid, and the grid's own size may not change when it does.
  private measureWorkspaceGrid = modifier((el: HTMLElement) => {
    if (
      typeof ResizeObserver === 'undefined' ||
      typeof MutationObserver === 'undefined'
    ) {
      return;
    }
    // Tracked writes re-render every favorite tile, so only changes are written.
    let ro = new ResizeObserver(() => {
      if (this.workspaceGridWidth !== el.clientWidth) {
        this.workspaceGridWidth = el.clientWidth;
      }
      let tile = el.querySelector(WORKSPACE_TILE_TARGET);
      let tileWidth = tile?.getBoundingClientRect().width;
      if (tileWidth !== undefined && this.workspaceTileWidth !== tileWidth) {
        this.workspaceTileWidth = tileWidth;
      }
      let gap = parseFloat(getComputedStyle(el).columnGap);
      if (!Number.isNaN(gap) && this.workspaceTileGap !== gap) {
        this.workspaceTileGap = gap;
      }
    });
    let observedTile: Element | null = null;
    let observeTile = () => {
      let tile = el.querySelector(WORKSPACE_TILE_TARGET);
      if (tile === observedTile) {
        return;
      }
      if (observedTile) {
        ro.unobserve(observedTile);
      }
      observedTile = tile;
      if (tile) {
        ro.observe(tile);
      }
    };
    let mo = new MutationObserver(observeTile);
    ro.observe(el);
    observeTile();
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  });

  // The keyboard-selected tile, by its position among the selectable tiles in
  // render order: Favorites, New Workspace, Your Workspaces, then Catalogs.
  // `null` until the user moves the selection.
  @tracked private selectedIndex: number | null = null;

  private get favoritesCount() {
    return this.favoriteRealmIdentifiers.length;
  }

  private get userWorkspacesCount() {
    return this.userRealmIdentifiers.length;
  }

  private get isAddWorkspaceShown() {
    return !this.userWorkspacesEmptyMessage;
  }

  private get renderedCatalogCount() {
    return this.catalogEmptyMessage
      ? 0
      : this.filteredCatalogRealmIdentifiers.length;
  }

  private get addWorkspaceNavIndex() {
    return this.favoritesCount;
  }

  private get userWorkspacesNavBase() {
    return this.favoritesCount + (this.isAddWorkspaceShown ? 1 : 0);
  }

  private get catalogNavBase() {
    return this.userWorkspacesNavBase + this.userWorkspacesCount;
  }

  private get selectableCount() {
    return this.catalogNavBase + this.renderedCatalogCount;
  }

  // The selected tile takes focus on open, so it is never New Workspace while
  // anything else is shown: the first Enter would create a workspace.
  private get defaultSelectedIndex() {
    if (this.favoritesCount > 0) {
      return 0;
    }
    if (this.userWorkspacesCount > 0) {
      return this.userWorkspacesNavBase;
    }
    if (this.renderedCatalogCount > 0) {
      return this.catalogNavBase;
    }
    return 0;
  }

  // Clamped, because the selectable set can shrink without a keypress, as
  // when Hosted hides tiles.
  private get currentIndex() {
    let count = this.selectableCount;
    if (count === 0) {
      return 0;
    }
    let index = this.selectedIndex ?? this.defaultSelectedIndex;
    return Math.min(Math.max(index, 0), count - 1);
  }

  // The default tile is focused on open but shows no ring until the user
  // moves the selection.
  private get isSelectionActive() {
    return this.selectedIndex !== null;
  }

  @action private onFocusIn(event: Event) {
    let tile = (event.target as HTMLElement).closest('[data-nav-index]');
    if (!tile) {
      return;
    }
    let index = Number((tile as HTMLElement).dataset.navIndex);
    // Compared with the effective selection: the selected tile's focus
    // modifier re-enters here in the render that read `currentIndex`, and a
    // write then would trip the backtracking-rerender assertion.
    if (!Number.isNaN(index) && index !== this.currentIndex) {
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
    // A tile's own controls (star, menu, host link) handle their own keys.
    if (!(kbEvent.target as HTMLElement).closest('[data-nav-index]')) {
      return;
    }
    switch (kbEvent.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.selectedIndex = Math.min(this.currentIndex + 1, count - 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.selectedIndex = Math.max(this.currentIndex - 1, 0);
        break;
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
        // New Workspace opens a modal whose Create button listens for Enter
        // on the document; this keystroke must not reach it.
        event.stopPropagation();
        let selected = container.querySelector(
          `[data-nav-index='${this.currentIndex}']`,
        );
        if (selected instanceof HTMLElement) {
          selected.click();
        }
        break;
      }
    }
  }

  private moveVertically(container: HTMLElement, direction: 1 | -1) {
    let index = nearestNavIndexInRow(container, this.currentIndex, direction);
    if (index !== undefined) {
      this.selectedIndex = index;
    }
  }

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <section
      class='dashboard'
      aria-label='Dashboard'
      data-theme='dark'
      {{on 'keydown' this.onKeydown}}
      {{on 'focusin' this.onFocusIn}}
      data-test-dashboard
      ...attributes
    >
      <div class='dashboard-scroller boxel-dark-scrollbar'>
        <div class='frosted-band' aria-hidden='true'></div>
        <div class='dashboard-page'>
          {{! Rendered empty up front: a live region inserted already
            filled is often not announced. }}
          <div class='unreachable-status' role='status'>
            {{#if this.unreachableRealmServers.length}}
              <div
                class='unreachable-notice'
                data-test-unreachable-realm-servers-notice
              >
                <this.unreachableNoticeIcon
                  width='20'
                  height='20'
                  class='unreachable-notice-icon'
                  aria-hidden='true'
                />
                <span>{{this.unreachableRealmServersMessage}}</span>
                {{#if this.isRetryingUnreachableRealmServers}}
                  <Spinner
                    class='unreachable-notice-icon'
                    @size={{20}}
                    aria-hidden='true'
                  />
                {{/if}}
              </div>
            {{/if}}
          </div>

          <header class='page-head'>
            <h1
              class='greeting'
              {{this.trackHour}}
              data-test-dashboard-greeting
            >{{this.greeting}}</h1>
            <SegmentedControl
              class='scope-filter'
              @options={{this.scopeOptions}}
              @value={{this.scope}}
              @onValueChange={{this.setScope}}
              @label='Filter workspaces'
              data-test-dashboard-filter
            />
          </header>

          <section
            class='dashboard-section'
            aria-labelledby={{this.headingId 'workspaces'}}
            data-test-dashboard-section='workspaces'
          >
            <div class='section-head'>
              <h2 class='section-title'>
                <LayoutGrid
                  class='section-icon'
                  width='20'
                  height='20'
                  aria-hidden='true'
                />
                <span id={{this.headingId 'workspaces'}}>Workspaces</span>
              </h2>
              <p class='section-hint'>Where your cards live.</p>
            </div>

            <div class='group' data-test-favorites-section>
              <h3 class='group-head'>
                <StarFilled
                  class='group-icon'
                  width='14'
                  height='14'
                  aria-hidden='true'
                />
                <span class='group-title'>Favorites</span>
                {{#if this.favoritesCount}}
                  <span class='group-count'>{{this.favoritesCount}}</span>
                {{/if}}
              </h3>
              {{#if this.favoritesEmptyMessage}}
                <p
                  class='group-empty'
                  data-test-favorites-empty
                >{{this.favoritesEmptyMessage}}</p>
              {{else}}
                <div
                  class='tile-list'
                  {{this.trackFavoriteCounts
                    this.favoriteRealmIdentifiers
                    this.realm.indexCountsRevision
                  }}
                  data-test-favorites-list
                >
                  {{#each this.favoriteRealmIdentifiers as |realmIdentifier i|}}
                    <Workspace
                      @realmIdentifier={{realmIdentifier}}
                      @navIndex={{i}}
                      @isSelected={{eq this.currentIndex i}}
                      @selectionActive={{this.isSelectionActive}}
                      @isFavoritesSection={{true}}
                      @enlargedWidth={{this.favoritesTileWidthPx}}
                    />
                  {{/each}}
                </div>
              {{/if}}
            </div>

            <div class='group' data-test-your-workspaces-section>
              <h3 class='group-head'>
                <Lock
                  class='group-icon'
                  width='14'
                  height='14'
                  aria-hidden='true'
                />
                <span class='group-title'>Your Workspaces</span>
                {{#if this.userWorkspacesCount}}
                  <span class='group-count'>{{this.userWorkspacesCount}}</span>
                {{/if}}
              </h3>
              {{#if this.userWorkspacesEmptyMessage}}
                <p
                  class='group-empty'
                  data-test-workspaces-empty
                >{{this.userWorkspacesEmptyMessage}}</p>
              {{else}}
                <div
                  class='tile-list'
                  {{this.measureWorkspaceGrid}}
                  data-test-workspace-list
                >
                  <AddWorkspace
                    @navIndex={{this.addWorkspaceNavIndex}}
                    @isSelected={{eq
                      this.currentIndex
                      this.addWorkspaceNavIndex
                    }}
                    @selectionActive={{this.isSelectionActive}}
                  />
                  {{#if this.matrixService.isInitializingNewUser}}
                    <WorkspaceLoadingIndicator />
                  {{/if}}
                  {{#each this.userRealmIdentifiers as |realmIdentifier i|}}
                    {{#let (add this.userWorkspacesNavBase i) as |navIndex|}}
                      <Workspace
                        @realmIdentifier={{realmIdentifier}}
                        @showMenu={{true}}
                        @navIndex={{navIndex}}
                        @isSelected={{eq this.currentIndex navIndex}}
                        @selectionActive={{this.isSelectionActive}}
                      />
                    {{/let}}
                  {{/each}}
                </div>
              {{/if}}
            </div>

            <div class='group' data-test-archived-section>
              <Collapsible
                @open={{this.isArchivedExpanded}}
                @onOpenChange={{this.setArchivedExpanded}}
              >
                <:trigger>
                  <span class='group-head'>
                    <ArchiveIcon
                      class='group-icon'
                      width='14'
                      height='14'
                      aria-hidden='true'
                    />
                    <span class='group-title'>Archived</span>
                    {{#if this.showArchivedCount}}
                      <span
                        class='group-count'
                      >{{this.archivedRealms.length}}</span>
                    {{/if}}
                  </span>
                </:trigger>
                <:default>
                  <div class='archived-content'>
                    {{#if this.loadArchivedRealmsTask.isRunning}}
                      <WorkspaceLoadingIndicator />
                    {{else if this.archivedRealms.length}}
                      <div class='tile-list' data-test-archived-list>
                        {{#each this.archivedRealms as |archivedRealm|}}
                          <ArchivedWorkspace @archivedRealm={{archivedRealm}} />
                        {{/each}}
                      </div>
                    {{else if this.archivedLoadFailed}}
                      <p
                        class='group-empty'
                        role='alert'
                        data-test-archived-error
                      >
                        Couldn’t load archived workspaces.
                        <Button
                          @tone='primary'
                          @appearance='link'
                          {{on 'click' this.loadArchivedRealms}}
                          data-test-archived-retry
                        >Try again</Button>
                      </p>
                    {{else}}
                      <p class='group-empty' data-test-archived-empty>No
                        archived workspaces</p>
                    {{/if}}
                  </div>
                </:default>
              </Collapsible>
            </div>
          </section>

          <section
            class='dashboard-section'
            aria-labelledby={{this.headingId 'catalogs'}}
            data-test-dashboard-section='catalogs'
          >
            <div class='section-head'>
              <h2 class='section-title'>
                <Store
                  class='section-icon'
                  width='20'
                  height='20'
                  aria-hidden='true'
                />
                <span id={{this.headingId 'catalogs'}}>Catalogs</span>
                {{#if this.renderedCatalogCount}}
                  <span class='group-count'>{{this.renderedCatalogCount}}</span>
                {{/if}}
              </h2>
              <ManageCatalogs />
              <p class='section-hint'>Apps, fields and themes to use in your
                workspaces.</p>
            </div>
            {{#if this.catalogEmptyMessage}}
              <p
                class='group-empty'
                data-test-catalog-empty
              >{{this.catalogEmptyMessage}}</p>
            {{else}}
              <div class='tile-list' data-test-catalog-list>
                {{#each
                  this.filteredCatalogRealmIdentifiers
                  as |realmIdentifier i|
                }}
                  {{#let (add this.catalogNavBase i) as |navIndex|}}
                    <Workspace
                      @realmIdentifier={{realmIdentifier}}
                      @navIndex={{navIndex}}
                      @isSelected={{eq this.currentIndex navIndex}}
                      @selectionActive={{this.isSelectionActive}}
                    />
                  {{/let}}
                {{/each}}
              </div>
            {{/if}}
          </section>

          <section
            class='dashboard-section'
            aria-labelledby={{this.headingId 'agents'}}
            data-test-dashboard-section='agents'
          >
            <div class='section-head'>
              <h2 class='section-title'>
                <Bot
                  class='section-icon'
                  width='20'
                  height='20'
                  aria-hidden='true'
                />
                <span id={{this.headingId 'agents'}}>Agents</span>
              </h2>
              <p class='section-hint'>Boxel AI works here; your own agent works
                through the Boxel plugin.</p>
            </div>
          </section>
        </div>
      </div>
    </section>

    <style scoped>
      @keyframes dashboard-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .dashboard {
        /* Pret UI selection reads this undefined token and falls back to a
           light gray; remove once it reads --selected (CS-14334). */
        --pretui-selected: var(--selected);
        --dashboard-top-bar-clearance: calc(
          var(--operator-mode-top-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );
        --dashboard-page-padding-top: calc(
          var(--dashboard-top-bar-clearance) + var(--boxel-sp-xl)
        );
        --dashboard-band-height: calc(
          var(--dashboard-top-bar-clearance) + var(--boxel-sp-sm)
        );
        --dashboard-page-max-width: 90rem;
        --dashboard-notice-max-width: 40rem;
        --dashboard-grid-dot-size: 0.075rem;
        --dashboard-grid-size: 2rem;
        --dashboard-tile-gap: calc(var(--boxel-sp-lg) * 2);
        --dashboard-greeting-font-size: var(--boxel-font-size-xl);
        --dashboard-section-title-font-size: var(--boxel-font-size-lg);
        --dashboard-section-hint-font-size: var(--boxel-font-size-sm);

        /* Breakpoints follow the dashboard's own width, which is less than
           the viewport's when the AI assistant panel is open. */
        container: dashboard / inline-size;
        color: var(--foreground);
        /* A faint dot grid gives the page a surface to sit on. */
        background-image: radial-gradient(
          var(--boxel-light-10) var(--dashboard-grid-dot-size),
          transparent var(--dashboard-grid-dot-size)
        );
        background-size: var(--dashboard-grid-size) var(--dashboard-grid-size);
      }
      /* Frosted band under the top bar: the page blurs out as it scrolls up
         toward the wordmark. Sticky inside the scroller, so it spans the
         scrollport and never covers the scrollbar. Negative margins pull it
         over the gutters without taking up space. The scroller has no top
         padding, since Chrome sticks below it, over the greeting. */
      .frosted-band {
        position: sticky;
        top: 0;
        height: var(--dashboard-band-height);
        margin: 0 calc(-1 * var(--dashboard-gutter))
          calc(-1 * var(--dashboard-band-height));
        background-color: color-mix(
          in oklch,
          var(--boxel-800) 55%,
          transparent
        );
        backdrop-filter: blur(1.125rem) saturate(140%);
        mask-image: linear-gradient(to bottom, black 65%, transparent);
        pointer-events: none;
        z-index: 1;
      }
      /* The gutter and tile widths live here, not on .dashboard, so the
         container queries below can change them. */
      .dashboard-scroller {
        --dashboard-gutter: 5rem;
        /* Read by the chooser tiles the sections hold. */
        --workspace-chooser-card-width: fit-content;
        --workspace-chooser-tile-width: var(--boxel-xxs-container);
        --workspace-chooser-enlarged-tile-width: min(
          var(--boxel-xxs-container) * 1.5,
          100cqi - 2 * var(--dashboard-gutter)
        );

        height: 100%;
        overflow: auto;
        /* Tiles scrolled into view by the keyboard land below the frosted band. */
        scroll-padding-top: var(--dashboard-band-height);
        /* The bottom clears the floating AI assistant button. */
        padding: 0 var(--dashboard-gutter)
          max(
            var(--dashboard-gutter),
            calc(
              var(--container-button-size) + var(--operator-mode-spacing) +
                var(--boxel-sp)
            )
          );
        /* Only the contents fade in; the dark background paints at once, so
           the operator-mode canvas never flashes after sign-in. */
        opacity: 0;
        animation: dashboard-fade-in 0.5s ease-in forwards;
      }
      .dashboard-page {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xl);
        max-width: var(--dashboard-page-max-width);
        margin-inline: auto;
        padding-top: var(--dashboard-page-padding-top);
        /* One layer, so the frosted band sits over every tile. */
        isolation: isolate;
      }

      /* Type scale: greeting, then section title, then everything inside a
         section. Nothing inside a section outranks its heading. */
      .page-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .greeting {
        min-width: 0;
        margin: 0;
        overflow-wrap: break-word;
        font-size: var(--dashboard-greeting-font-size);
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      /* The rail matches the page, and the selected pill is white on black.
         SegmentedControl has no tone arg, so this sets the tokens it reads. */
      .scope-filter {
        --inset: var(--boxel-800);
        --border: var(--boxel-light-10);
        --border-strong: var(--boxel-light-25);
        --card: var(--boxel-dark);
        --card-foreground: var(--boxel-light);
        margin-left: auto;
      }

      .dashboard-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
      }
      .section-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--boxel-sp-xs);
        row-gap: var(--boxel-sp-2xs);
        padding-bottom: var(--boxel-sp-sm);
        border-bottom: 1px solid var(--boxel-light-10);
      }
      .section-title {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin: 0;
        font-size: var(--dashboard-section-title-font-size);
        font-weight: 700;
        letter-spacing: -0.015em;
      }
      .section-icon,
      .group-icon {
        --icon-color: var(--muted-foreground);
        color: var(--muted-foreground);
        flex-shrink: 0;
      }
      .section-hint {
        flex-basis: 100%;
        margin: 0;
        font-size: var(--dashboard-section-hint-font-size);
        color: var(--muted-foreground);
      }

      /* Groups inside a section are quiet labels; the tiles are the
         headline. */
      .group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin: 0;
        font: inherit;
      }
      .group-title,
      .group-count {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .group-count {
        color: var(--subtle-foreground);
      }
      .group-count::before {
        content: '· ' / '';
      }
      /* Inside the fold, so the space collapses with it. */
      .archived-content {
        padding-top: var(--boxel-sp-lg);
      }
      .group-empty {
        margin: 0;
        color: var(--muted-foreground);
        font: 400 var(--boxel-font-sm);
      }
      .tile-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--dashboard-tile-gap);
        padding: var(--boxel-sp-xs) 0;
      }

      /* Empty, it stays out of the page's flex gap. */
      .unreachable-status:not(:has(.unreachable-notice)) {
        position: absolute;
      }
      .unreachable-notice {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        max-width: var(--dashboard-notice-max-width);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        color: var(--foreground);
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .unreachable-notice-icon {
        flex-shrink: 0;
      }

      /* The gutter narrows with the dashboard, so a tablet or phone spends
         its width on the tiles. */
      @container dashboard (max-width: 64rem) {
        .dashboard-scroller {
          --dashboard-gutter: 2.5rem;
        }
      }
      @container dashboard (max-width: 48rem) {
        .dashboard-scroller {
          --dashboard-gutter: 1.5rem;
        }
      }
      @container dashboard (max-width: 40rem) {
        .dashboard-scroller {
          --dashboard-gutter: 1rem;
        }
      }
      /* One tile per row, filling the dashboard's width. */
      @container dashboard (max-width: 30rem) {
        .dashboard-scroller {
          --workspace-chooser-card-width: 100%;
          --workspace-chooser-tile-width: 100%;
          --workspace-chooser-enlarged-tile-width: 100%;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .dashboard-scroller {
          animation-duration: 0.01ms;
        }
      }
    </style>
  </template>
}
