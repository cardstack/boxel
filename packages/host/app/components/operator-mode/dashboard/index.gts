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

import { add, cn, eq, gt, not } from '@cardstack/boxel-ui/helpers';
import {
  FailureBordered as FailureIcon,
  StarFilled,
  WarningTriangleFilled as WarningIcon,
} from '@cardstack/boxel-ui/icons';
import type { Icon } from '@cardstack/boxel-ui/icons';

import { logger } from '@cardstack/runtime-common';

import { catalogRealmURL, leadWith } from '@cardstack/host/lib/utils';
import {
  isHostedRealm,
  listedCatalogRealmURLs,
  listedFavoriteRealmIdentifiers,
  sortByCreatedAtDesc,
  unreachableRealmServersMessage,
} from '@cardstack/host/lib/workspace-list';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import ManageCatalogs from '../workspace-chooser/manage-catalogs';

import AddWorkspace from './add-workspace';
import ArchivedWorkspace from './archived-workspace';
import FavoritesFlyout from './favorites-flyout';
import { greetingFor } from './greeting';
import KeyboardCursor from './keyboard-cursor';
import Workspace from './workspace';
import {
  COLLAPSED_WORKSPACE_ROWS,
  gridColumnCount,
  recentWorkspaceCount,
  sortByUpdatedAtDesc,
} from './workspace-layout';

import type DashboardSections from './sections';
import type { DashboardSection } from './sections';

type Scope = 'all' | 'hosted';

interface Signature {
  Element: HTMLElement;
  Args: {
    // Each section registers its entry in the section rail here.
    sections: DashboardSections;
  };
}

const log = logger('component:dashboard');

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hosted', label: 'Hosted' },
];

// Dashboard v2, shown in place of the workspace chooser when the
// DASHBOARD_V2 feature flag is on.
export default class Dashboard extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realmServer: RealmServerService;
  @service declare private realm: RealmService;

  // The workspace the dashboard opened over, read once: the cursor starts on
  // it, so Enter goes straight back to where the user was.
  private returnRealmURL = this.readReturnRealmURL();

  private readReturnRealmURL(): string | undefined {
    try {
      return this.operatorModeStateService.realmURL || undefined;
    } catch {
      return undefined;
    }
  }

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

  // What Show more and Show fewer control.
  private rowListId = `${guidFor(this)}-workspace-rows`;

  // All, or only workspaces published to the web, in Favorites, Your
  // Workspaces and Catalogs.
  @tracked private scope: Scope = 'all';

  private scopeOptions = SCOPE_OPTIONS;

  @action private setScope(value: string) {
    let option = SCOPE_OPTIONS.find((option) => option.value === value);
    if (option) {
      this.scope = option.value;
      // A different list starts collapsed.
      this.showAllWorkspaces = false;
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

  @cached
  private get listedFavorites() {
    return listedFavoriteRealmIdentifiers(
      this.matrixService.workspaceFavorites,
      this.realmServer.userRealmIdentifiers,
      this.realmServer.displayedCatalogRealmIdentifiers,
    );
  }

  @cached
  private get favoriteRealmIdentifiers() {
    return this.filterByScope(this.listedFavorites);
  }

  // Only desks show Cards / Files / Definitions counts, so they are
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
    return this.listedFavorites.length === 0
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

  // Columns in the recent tiles' grid and the rows' grid, as CSS laid them
  // out. Kept when a grid unmounts, as when Hosted empties the list.
  @tracked private recentColumns = 0;
  @tracked private rowColumns = 0;

  // Observer callbacks land after render, so these tracked writes stay out of
  // the render that read the counts. Only changes are written.
  private measureColumns = modifier(
    (grid: HTMLElement, [which]: ['recent' | 'rows']) => {
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      let observer = new ResizeObserver(() => {
        let columns = gridColumnCount(grid);
        if (which === 'recent' && columns !== this.recentColumns) {
          this.recentColumns = columns;
        } else if (which === 'rows' && columns !== this.rowColumns) {
          this.rowColumns = columns;
        }
      });
      observer.observe(grid);
      return () => observer.disconnect();
    },
  );

  // Three until the rows' grid has been measured.
  private get rowsPerGridRow() {
    return this.rowColumns || 3;
  }

  // The most recently updated workspaces, as tiles.
  @cached
  private get recentRealmIdentifiers() {
    return sortByUpdatedAtDesc(
      this.userRealmIdentifiers,
      this.realm.info,
    ).slice(
      0,
      recentWorkspaceCount(
        this.recentColumns,
        this.matrixService.isInitializingNewUser ? 2 : 1,
      ),
    );
  }

  // Everything else, in list order, as rows.
  @cached
  private get rowRealmIdentifiers() {
    let recent = new Set<string>(this.recentRealmIdentifiers);
    return this.userRealmIdentifiers.filter((url) => !recent.has(url));
  }

  // A long list shows its first rows, faded under a scrim with a way to show
  // the rest. Only the rows shown are rendered.
  // Unset until the user chooses, so the list opens expanded when the
  // workspace the dashboard opened over would otherwise be hidden.
  @tracked private showAllWorkspaces: boolean | undefined;

  private get isShowingAllWorkspaces() {
    return this.showAllWorkspaces ?? this.isReturnRowCollapsed;
  }

  @action private toggleAllWorkspaces() {
    this.showAllWorkspaces = !this.isShowingAllWorkspaces;
  }

  private get isReturnRowCollapsed() {
    let target = this.returnRealmURL;
    if (!target) {
      return false;
    }
    let index = this.rowRealmIdentifiers.findIndex(
      (url) => this.toURL(url) === target,
    );
    return index >= this.collapsedRowCount;
  }

  private get collapsedRowCount() {
    return this.rowsPerGridRow * COLLAPSED_WORKSPACE_ROWS;
  }

  private get isRowListCollapsible() {
    return this.rowRealmIdentifiers.length > this.collapsedRowCount;
  }

  @cached
  private get visibleRowRealmIdentifiers() {
    return this.isShowingAllWorkspaces
      ? this.rowRealmIdentifiers
      : this.rowRealmIdentifiers.slice(0, this.collapsedRowCount);
  }

  private get hiddenRowCount() {
    return (
      this.rowRealmIdentifiers.length - this.visibleRowRealmIdentifiers.length
    );
  }

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

  // Where each part of the keyboard cursor's walk starts: Favorites, New
  // Workspace, the recent tiles, the rows shown, then Catalogs.
  private get addWorkspaceNavIndex() {
    return this.favoritesCount;
  }

  private get recentNavBase() {
    return this.favoritesCount + (this.isAddWorkspaceShown ? 1 : 0);
  }

  private get rowsNavBase() {
    return this.recentNavBase + this.recentRealmIdentifiers.length;
  }

  private get catalogNavBase() {
    return this.rowsNavBase + this.visibleRowRealmIdentifiers.length;
  }

  // What each `[data-nav-index]` shows, in page order. A workspace that is
  // also a favorite is in the walk twice, as a desk and as a tile or row.
  @cached
  private get walkKeys(): string[] {
    return [
      ...this.favoriteRealmIdentifiers.map((url) => `desk:${url}`),
      ...(this.isAddWorkspaceShown ? ['new-workspace'] : []),
      ...this.recentRealmIdentifiers.map((url) => `workspace:${url}`),
      ...this.visibleRowRealmIdentifiers.map((url) => `workspace:${url}`),
      ...(this.catalogEmptyMessage
        ? []
        : this.filteredCatalogRealmIdentifiers.map((url) => `catalog:${url}`)),
    ];
  }

  // Where the workspace the dashboard opened over sits in the walk, when it
  // is shown.
  @cached
  private get returnNavIndex(): number | undefined {
    let target = this.returnRealmURL;
    if (!target) {
      return undefined;
    }
    let index = this.walkKeys.findIndex((key) => {
      let separator = key.indexOf(':');
      return separator >= 0 && this.toURL(key.slice(separator + 1)) === target;
    });
    return index >= 0 ? index : undefined;
  }

  private toURL(id: string) {
    try {
      return this.network.virtualNetwork.toURL(id).href;
    } catch {
      return id;
    }
  }

  // The cursor takes focus on open, so it never starts on New Workspace while
  // anything else is shown: the first Enter would create a workspace.
  private get defaultSelectedIndex() {
    let returnIndex = this.returnNavIndex;
    if (returnIndex !== undefined) {
      return returnIndex;
    }
    if (this.favoritesCount > 0) {
      return 0;
    }
    if (this.userWorkspacesCount > 0) {
      return this.recentNavBase;
    }
    if (this.renderedCatalogCount > 0) {
      return this.catalogNavBase;
    }
    return 0;
  }

  // No count: the rail counts a section only as its heading does, and this
  // one's counts belong to its Favorites and Your Workspaces groups.
  private workspacesSection: DashboardSection = {
    id: 'workspaces',
    label: 'Workspaces',
    icon: LayoutGrid,
    flyout: FavoritesFlyout,
  };

  private cursor = new KeyboardCursor({
    keys: () => this.walkKeys,
    defaultIndex: () => this.defaultSelectedIndex,
  });

  <template>
    {{! template-lint-disable no-invalid-interactive }}
    <section
      class={{cn 'dashboard' is-compact=@sections.isCompact}}
      aria-label='Dashboard'
      data-theme='dark'
      {{on 'keydown' this.cursor.onKeydown}}
      {{on 'focusin' this.cursor.onFocusIn}}
      {{on 'pointerup' this.cursor.onPointerUp}}
      data-test-dashboard
      ...attributes
    >
      <div
        class='dashboard-scroller boxel-dark-scrollbar'
        {{@sections.trackScroller}}
        data-test-dashboard-scroller
      >
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
            {{@sections.register this.workspacesSection}}
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
                  class='desk-list'
                  {{this.trackFavoriteCounts
                    this.favoriteRealmIdentifiers
                    this.realm.indexCountsRevision
                  }}
                  data-test-favorites-list
                >
                  {{#each this.favoriteRealmIdentifiers as |realmIdentifier i|}}
                    <Workspace
                      @realmIdentifier={{realmIdentifier}}
                      @variant='desk'
                      @navIndex={{i}}
                      @isSelected={{eq this.cursor.currentIndex i}}
                      @selectionActive={{this.cursor.isRingShown}}
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
                {{! One list: the rows carry straight on from the tiles. }}
                <div class='your-workspaces' data-test-workspace-list>
                  <div
                    class='recent-list'
                    {{this.measureColumns 'recent'}}
                    data-test-workspace-recent-list
                  >
                    <AddWorkspace
                      @navIndex={{this.addWorkspaceNavIndex}}
                      @isSelected={{eq
                        this.cursor.currentIndex
                        this.addWorkspaceNavIndex
                      }}
                      @selectionActive={{this.cursor.isRingShown}}
                    />
                    {{#if this.matrixService.isInitializingNewUser}}
                      <div
                        class='new-workspace-pending'
                        data-test-workspace-loading-indicator
                      >
                        <Spinner @size={{20}} aria-label='Creating workspace' />
                      </div>
                    {{/if}}
                    {{#each this.recentRealmIdentifiers as |realmIdentifier i|}}
                      {{#let (add this.recentNavBase i) as |navIndex|}}
                        <Workspace
                          @realmIdentifier={{realmIdentifier}}
                          @variant='tile'
                          @navIndex={{navIndex}}
                          @isSelected={{eq this.cursor.currentIndex navIndex}}
                          @selectionActive={{this.cursor.isRingShown}}
                        />
                      {{/let}}
                    {{/each}}
                  </div>
                  {{#if this.rowRealmIdentifiers.length}}
                    <div
                      id={{this.rowListId}}
                      class={{cn
                        'row-list'
                        is-clipped=(gt this.hiddenRowCount 0)
                      }}
                      {{this.measureColumns 'rows'}}
                      data-test-workspace-rows
                    >
                      {{#each
                        this.visibleRowRealmIdentifiers
                        as |realmIdentifier i|
                      }}
                        {{#let (add this.rowsNavBase i) as |navIndex|}}
                          <Workspace
                            @realmIdentifier={{realmIdentifier}}
                            @variant='row'
                            @navIndex={{navIndex}}
                            @isSelected={{eq this.cursor.currentIndex navIndex}}
                            @selectionActive={{this.cursor.isRingShown}}
                          />
                        {{/let}}
                      {{/each}}
                      {{#if this.hiddenRowCount}}
                        <div class='list-scrim' aria-hidden='true'></div>
                      {{/if}}
                    </div>
                    {{! One button for both, so focus stays on it as the
                        list grows and shrinks. }}
                    {{#if this.isRowListCollapsible}}
                      <Button
                        class={{cn
                          'list-toggle'
                          is-collapsed=(not this.isShowingAllWorkspaces)
                        }}
                        @appearance='accent'
                        @shape='pill'
                        aria-controls={{this.rowListId}}
                        aria-expanded={{if
                          this.isShowingAllWorkspaces
                          'true'
                          'false'
                        }}
                        {{on 'click' this.toggleAllWorkspaces}}
                        data-test-workspace-list-toggle
                      >
                        {{#if this.isShowingAllWorkspaces}}
                          Show fewer
                        {{else}}
                          Show
                          {{this.hiddenRowCount}}
                          more
                        {{/if}}
                      </Button>
                    {{/if}}
                  {{/if}}
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
                      <Spinner
                        @size={{20}}
                        aria-label='Loading archived workspaces'
                        data-test-archived-loading
                      />
                    {{else if this.archivedRealms.length}}
                      <div class='row-list' data-test-archived-list>
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
              <div class='catalog-list' data-test-catalog-list>
                {{#each
                  this.filteredCatalogRealmIdentifiers
                  as |realmIdentifier i|
                }}
                  {{#let (add this.catalogNavBase i) as |navIndex|}}
                    <Workspace
                      @realmIdentifier={{realmIdentifier}}
                      @variant='tile'
                      @navIndex={{navIndex}}
                      @isSelected={{eq this.cursor.currentIndex navIndex}}
                      @selectionActive={{this.cursor.isRingShown}}
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
           light gray; remove once it reads --selected. */
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
        --dashboard-desk-min-width: 27.5rem;
        --dashboard-desk-gap: var(--boxel-sp-3xl);
        --dashboard-tile-min-width: 12rem;
        --dashboard-tile-height: 8rem;
        --dashboard-tile-radius: var(--boxel-border-radius-xl);
        --dashboard-row-min-width: 15.5rem;
        --dashboard-row-height: 3.75rem;
        /* A row's and its thumbnail's tints, shared by workspace and
           archived rows. */
        --dashboard-row-tint: color-mix(
          in oklch,
          var(--boxel-light) 4%,
          transparent
        );
        --dashboard-thumb-tint: color-mix(
          in oklch,
          var(--boxel-light) 6%,
          transparent
        );
        /* The keyboard cursor's ring, on New Workspace and the desks. */
        --dashboard-ring: 0 0 0 2px var(--boxel-highlight);
        --dashboard-scrim-height: 7rem;
        --dashboard-toggle-height: 2.75rem;
        --dashboard-greeting-font-size: var(--boxel-font-size-xl);
        --dashboard-greeting-font-weight: 700;
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
          calc(-1 * var(--dashboard-band-height))
          calc(-1 * var(--dashboard-gutter-start));
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
        /* The section rail stands as an icon column in the wordmark's
           column, so the page starts past it. Its labels slide out over the
           page, so they need no room of their own. */
        --dashboard-gutter-start: max(
          var(--dashboard-gutter),
          calc(
            var(--container-button-size) + 2 * var(--operator-mode-spacing) +
              var(--boxel-sp-xl)
          )
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
          )
          var(--dashboard-gutter-start);
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
      /* The greeting grows to fill its line, which pushes the filter to the
         right beside it, and leaves the filter at the start once it wraps. */
      .greeting {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        overflow-wrap: break-word;
        font-size: var(--dashboard-greeting-font-size);
        font-weight: var(--dashboard-greeting-font-weight);
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
      .catalog-list {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(var(--dashboard-tile-min-width), 100%), 1fr)
        );
        gap: var(--boxel-sp-lg) var(--boxel-sp);
        padding: var(--boxel-sp-xs) 0;
      }
      /* As many desks per row as fit at their minimum width, spanning the
         section like the lists below them. */
      .desk-list {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(var(--dashboard-desk-min-width), 100%), 1fr)
        );
        gap: var(--dashboard-desk-gap);
        padding: var(--boxel-sp-xs) 0;
      }
      .your-workspaces {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .recent-list {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(var(--dashboard-tile-min-width), 100%), 1fr)
        );
        gap: var(--boxel-sp-lg) var(--boxel-sp);
        padding: var(--boxel-sp-xs) 0;
      }
      .new-workspace-pending {
        display: flex;
        align-items: center;
        justify-content: center;
        height: var(--dashboard-tile-height);
        border-radius: var(--dashboard-tile-radius);
        background-color: var(--boxel-dark-50);
      }
      .row-list {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(var(--dashboard-row-min-width), 100%), 1fr)
        );
        gap: var(--boxel-sp-sm);
      }
      /* A clipped list fades out over its last row, where the button to show
         the rest sits. */
      .row-list.is-clipped {
        position: relative;
      }
      .list-scrim {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 2;
        height: var(--dashboard-scrim-height);
        background-image: linear-gradient(
          to bottom,
          transparent,
          var(--boxel-800) 72%
        );
        pointer-events: none;
      }
      .list-toggle {
        --pretui-button-h: var(--dashboard-toggle-height);
        --pretui-button-px: var(--boxel-sp-lg);
        --pretui-button-bg: var(--boxel-700);
        --pretui-button-fg: var(--boxel-light);
        --pretui-size-m: var(--boxel-font-size-sm);
        /* Pret UI's neutral accent hover mixes in --background, which is this
           same shade on the dark dashboard, so the hover is set here. */
        --pretui-btn-accent-hover: var(--boxel-650);
        position: relative;
        z-index: 3;
        align-self: center;
        border-color: var(--boxel-light-25);
        font-weight: 600;
      }
      /* Collapsed, it sits on the scrim over the last row shown. */
      .list-toggle.is-collapsed {
        margin-top: calc(
          -1 * (var(--dashboard-toggle-height) + var(--boxel-sp-sm))
        );
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
      /* Compact, where the section rail stays as icons, the page tightens
         too: less room above and between its parts, and a smaller, lighter
         greeting. */
      .is-compact .dashboard-page {
        --dashboard-page-padding-top: calc(
          var(--dashboard-top-bar-clearance) + var(--boxel-sp-xs)
        );
        gap: var(--boxel-sp-2xl);
      }
      .is-compact .page-head {
        gap: var(--boxel-sp-xs);
      }
      .is-compact .greeting {
        --dashboard-greeting-font-size: var(--boxel-font-size-lg);
        --dashboard-greeting-font-weight: 400;
      }
      /* One tile per row, filling the dashboard's width. */
      @media (prefers-reduced-motion: reduce) {
        .dashboard-scroller {
          animation-duration: 0.01ms;
        }
      }
    </style>
  </template>
}
