import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import Home from '@cardstack/boxel-icons/home';
import Shapes from '@cardstack/boxel-icons/shapes';
import { didCancel, dropTask } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import { BoxelSelect, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { add, eq } from '@cardstack/boxel-ui/helpers';
import {
  FailureBordered as FailureIcon,
  IconGlobe,
  Lock,
  StarFilled,
  TriangleRight,
  WarningTriangleFilled as WarningIcon,
} from '@cardstack/boxel-ui/icons';
import type { Icon } from '@cardstack/boxel-ui/icons';

import { logger, ri } from '@cardstack/runtime-common';

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

const log = logger('component:workspace-chooser');

export default class WorkspaceChooser extends Component<Signature> {
  @service declare matrixService: MatrixService;
  @service declare realmServer: RealmServerService;
  @service declare realm: RealmService;

  // Archived realms are tucked away below the fold and collapsed by default —
  // they're rarely needed, so the section stays out of the way and the list
  // isn't fetched until the owner opens the disclosure.
  @tracked private isArchivedExpanded = false;

  private get archivedRealms() {
    return this.realmServer.archivedRealms;
  }

  // Trusted realm servers that couldn't be reached during boot. When present,
  // an unobtrusive notice names them so the user understands some workspaces
  // may be missing; the notice clears if the background retry recovers them,
  // and changes its wording if that retry gives up first.
  private get unreachableRealmServers() {
    return this.realmServer.unreachableRealmServers;
  }

  private get unreachableRealmServersMessage() {
    let hosts = this.unreachableRealmServers.map((serverURL) => {
      try {
        return new URL(serverURL).host;
      } catch {
        return serverURL;
      }
    });
    // Name every unreachable server, per the notice's contract. Trusted
    // servers are few in practice, so a comma-joined list stays readable.
    let servers = hosts.join(', ');
    let reason = `Couldn’t reach ${servers}. Some workspaces may be missing`;
    return this.isRetryingUnreachableRealmServers
      ? `${reason} — retrying…`
      : `${reason} — reload to try again.`;
  }

  private get isRetryingUnreachableRealmServers() {
    return this.matrixService.isRetryingUnreachableRealmServers;
  }

  private get unreachableNoticeIcon(): Icon {
    return this.isRetryingUnreachableRealmServers ? WarningIcon : FailureIcon;
  }

  // Show the archived count once we've loaded the list (or already have entries
  // from an archive action this session). Before the first load we don't know
  // the count, so the row shows just "Archived".
  private get showArchivedCount() {
    return (
      Boolean(this.loadArchivedRealmsTask.lastSuccessful) ||
      this.archivedRealms.length > 0
    );
  }

  private loadArchivedRealmsTask = dropTask(async () => {
    await this.realmServer.fetchArchivedRealms();
  });

  @action private toggleArchived() {
    this.isArchivedExpanded = !this.isArchivedExpanded;
    // Lazy-load on first expand. Retry if a prior attempt failed (no
    // lastSuccessful); the service caches a successful fetch so re-expanding
    // after success is a no-op.
    if (
      this.isArchivedExpanded &&
      !this.loadArchivedRealmsTask.lastSuccessful &&
      !this.loadArchivedRealmsTask.isRunning
    ) {
      // Nothing awaits the perform, and an unconsumed ember-concurrency task
      // instance rethrows its error globally — under a test run that fails
      // whichever test is executing rather than this one. The disclosure
      // already handles a failed load by leaving `lastSuccessful` unset so the
      // next expand retries, so a failure is logged here rather than escaping.
      this.loadArchivedRealmsTask.perform().catch((error: unknown) => {
        if (didCancel(error)) {
          return;
        }
        log.warn(`loading archived realms failed: ${error}`);
      });
    }
  }

  private sortOptions: SortOption[] = [
    { label: 'View All', icon: Shapes, value: 'default' },
    { label: 'Hosted Only', icon: Home, value: 'hosted-only' },
  ];

  @tracked private selectedSortOption: SortOption = this.sortOptions[0]!;

  @action private onSortChange(option: SortOption | null) {
    if (!option) {
      return;
    }
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

  // Newest first. Realms without a createdAt (e.g. a broken/orphaned realm
  // reference) sort to the end rather than clumping at the front.
  private sortByCreatedAtDesc = <T extends string>(urls: T[]): T[] => {
    return [...urls].sort((a, b) => {
      let aCreatedAt = this.realm.info(a).createdAt;
      let bCreatedAt = this.realm.info(b).createdAt;
      if (!aCreatedAt && !bCreatedAt) {
        return 0;
      }
      if (!aCreatedAt) {
        return 1;
      }
      if (!bCreatedAt) {
        return -1;
      }
      return new Date(bCreatedAt).getTime() - new Date(aCreatedAt).getTime();
    });
  };

  private get filteredUserRealmIdentifiers() {
    // Render in list order: `_realm-auth` enumerates realms
    // newest-created-first and realms created mid-session are prepended, so
    // the workspace list is stable across sessions with new workspaces at
    // the front.
    return this.filterByHosted(this.realmServer.userRealmIdentifiers);
  }

  private get filteredCatalogRealmIdentifiers() {
    return this.filterByHosted(
      this.sortByCreatedAtDesc(this.communityRealmIdentifiers),
    );
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

  // Only favorited tiles render a Cards / Files / Definitions row, and the
  // counts behind it are an aggregate over each realm's whole index — so they
  // are requested here, for that set alone, rather than arriving with the realm
  // info the chooser loads for every workspace. Installed as a modifier on the
  // Favorites list so it runs after render and re-runs when the set of
  // favorites changes; `loadIndexCounts` is fire-and-forget and skips realms
  // already loaded or in flight, so the dashboard never waits on it.
  // `revision` is passed but unread: ember-modifier re-runs a modifier when any
  // argument changes, so taking it makes a re-index that marked counts stale
  // re-trigger the load. Without it this would only re-run when *which* realms
  // are favorited changes — never when the answer for those realms does.
  private trackFavoriteCounts = modifier(
    (_el: HTMLElement, [urls, _revision]: [string, number]) => {
      if (urls) {
        this.realm.loadIndexCounts(urls.split(' '));
      }
    },
  );

  private get favoriteCountsKey() {
    return this.favoriteRealmIdentifiers.join(' ');
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

  // Measured live from the Your Workspaces tile grid so favorited tiles can
  // mirror however many tiles actually fit per row at the current viewport
  // width (see measureWorkspaceGrid below).
  @tracked private workspaceGridWidth = 0;
  @tracked private workspaceTileWidth = 0;
  @tracked private workspaceTileGap = 0;

  private get tilesPerRow(): number {
    if (!this.workspaceTileWidth) {
      return 3;
    }
    let perRow = Math.floor(
      (this.workspaceGridWidth + this.workspaceTileGap) /
        (this.workspaceTileWidth + this.workspaceTileGap),
    );
    return Math.max(1, perRow);
  }

  // Two tiles' worth of Favorites-section width for every 3-across, rounded
  // up — a row of 3 or 4 gives favorited tiles pairs, a row of 5 gives
  // groups of 3, etc.
  private get favoritesSlotCount(): number {
    return Math.ceil(this.tilesPerRow / 2);
  }

  // The width a single favorited tile should be so that `favoritesSlotCount`
  // of them, plus the gaps between them, exactly span the measured Your
  // Workspaces row width. Null before the grid has been measured.
  private get favoritesSlotWidth(): number | null {
    if (!this.workspaceTileWidth) {
      return null;
    }
    let n = this.favoritesSlotCount;
    let rowWidth =
      this.tilesPerRow * this.workspaceTileWidth +
      (this.tilesPerRow - 1) * this.workspaceTileGap;
    return (rowWidth - (n - 1) * this.workspaceTileGap) / n;
  }

  // Applied to real favorited tiles (via cssVar, see workspace.gts) so they
  // take up this responsive width. Undefined before the grid has been
  // measured, so the tile falls back to its static CSS width.
  private get favoritesTileWidthPx(): string | undefined {
    let width = this.favoritesSlotWidth;
    return width === null ? undefined : `${width}px`;
  }

  // Watches the Your Workspaces tile grid so we always know how many tiles
  // currently fit per row (and their exact width/gap), regardless of how
  // many workspaces the user actually has.
  private measureWorkspaceGrid = modifier((el: HTMLElement) => {
    let measure = () => {
      this.workspaceGridWidth = el.clientWidth;
      let tile = el.querySelector('.workspace-card button.workspace');
      if (tile) {
        this.workspaceTileWidth = tile.getBoundingClientRect().width;
      }
      let gap = parseFloat(getComputedStyle(el).columnGap);
      if (!Number.isNaN(gap)) {
        this.workspaceTileGap = gap;
      }
    };
    // `observe()` delivers an initial callback with the element's current
    // size, so this covers the first measurement too — and it lands after the
    // render transaction commits, keeping these tracked writes out of a
    // transaction the Favorites block's `@enlargedWidth={{favoritesTileWidthPx}}`
    // already read this frame. A synchronous `measure()` here would write
    // `workspaceTileWidth` after that read and trip Ember's backtracking-
    // rerender assertion for any user who opens the chooser with a favorite.
    // The observer also supersedes a window 'resize' listener: anything that
    // changes the viewport width also changes `el.clientWidth`, and it
    // additionally catches a scrollbar appearing or a surrounding panel
    // resizing, which a 'resize' event misses.
    if (typeof ResizeObserver === 'undefined') {
      // Never measured: `tilesPerRow` falls back to 3 and `favoritesSlotWidth`
      // to null, so the favorite tile keeps its static CSS width.
      return;
    }
    let ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  // The keyboard-selected tile, identified by its position in the flat,
  // DOM-ordered sequence of selectable tiles. The sequence spans, in render
  // order: Favorites, the "New Workspace" tile, Your Workspaces, then Catalogs.
  // `null` until the user moves the selection, at which point
  // `defaultSelectedIndex` no longer applies.
  @tracked private selectedIndex: number | null = null;

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
  // first in Your Workspaces, ahead of the actual workspace tiles.
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

  // Where the selection sits before the user has moved it. The "New Workspace"
  // tile renders first within Your Workspaces, but it must not be what opening
  // the chooser lands on: the selected tile takes focus, so starting there
  // would make the first Enter create a workspace instead of opening one. Skip
  // past it to the first real workspace whenever there is one.
  private get defaultSelectedIndex() {
    if (this.favoritesCount > 0) {
      return 0;
    }
    if (this.userWorkspacesCount > 0) {
      return this.userWorkspacesNavBase;
    }
    // No favorites and no user workspaces (new user, or everything
    // archived/filtered). "New Workspace" is at index 0, and landing the
    // selection there would make the first Enter create a workspace — the
    // hazard above. Prefer the first catalog when one is shown; only fall
    // back to 0 when there is genuinely nothing else to land on.
    if (this.renderedCatalogCount > 0) {
      return this.catalogNavBase;
    }
    return 0;
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
    let index = this.selectedIndex ?? this.defaultSelectedIndex;
    return Math.min(Math.max(index, 0), count - 1);
  }

  // True once the user has moved the selection off its open-time default.
  // Drives whether a tile shows its selection ring: the default tile is
  // focused on open (so keyboard nav works) but stays unringed until the user
  // engages, so opening the chooser doesn't look like a tile is pre-selected.
  private get isSelectionActive() {
    return this.selectedIndex !== null;
  }

  // Keep the selection in sync with focus, so tabbing onto a tile selects it.
  @action private onFocusIn(event: Event) {
    let tile = (event.target as HTMLElement).closest('[data-nav-index]');
    if (!tile) {
      return;
    }
    let index = Number((tile as HTMLElement).dataset.navIndex);
    // Compare against the *effective* selection, not the raw backing field.
    // The selected tile is focused by a modifier (`focusWhenSelected`), whose
    // synchronous `focus()` re-enters here during the same render pass that
    // just read `currentIndex`. Writing `selectedIndex` there trips Ember's
    // backtracking-rerender assertion, so the already-selected case has to be
    // a genuine no-op — which it isn't if we compare to a still-unset field.
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
              @dropdownClass='workspace-chooser-sort-dropdown'
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
        {{#if this.unreachableRealmServers.length}}
          <div
            class='unreachable-notice'
            role='status'
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
              <LoadingIndicator
                class='unreachable-notice-spinner'
                @color='currentColor'
                @size='1.125rem'
                aria-hidden='true'
              />
            {{/if}}
          </div>
        {{/if}}
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
              <div
                class='workspace-list'
                data-test-favorites-list
                {{this.trackFavoriteCounts
                  this.favoriteCountsKey
                  this.realm.indexCountsRevision
                }}
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
              <div
                class='workspace-list'
                data-test-workspace-list
                {{this.measureWorkspaceGrid}}
              >
                <AddWorkspace
                  @navIndex={{this.addWorkspaceNavIndex}}
                  @isSelected={{eq this.currentIndex this.addWorkspaceNavIndex}}
                />
                {{#if this.matrixService.isInitializingNewUser}}
                  <WorkspaceLoadingIndicator />
                {{/if}}
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
                      @selectionActive={{this.isSelectionActive}}
                    />
                  {{/let}}
                {{/each}}
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
            </div>
          {{/if}}
          <div class='workspace-section' data-test-archived-section>
            <button
              type='button'
              class='section-header section-header--toggle
                {{if this.isArchivedExpanded "is-expanded"}}'
              aria-expanded='{{if this.isArchivedExpanded "true" "false"}}'
              data-test-archived-toggle
              {{on 'click' this.toggleArchived}}
            >
              <TriangleRight
                width='12'
                height='12'
                class='section-disclosure-icon'
              />
              <ArchiveIcon width='20' height='20' class='section-header-icon' />
              <span class='workspace-chooser__title'>Archived</span>
              {{#if this.showArchivedCount}}
                <span
                  class='section-count'
                >{{this.archivedRealms.length}}</span>
              {{/if}}
            </button>
            {{#if this.isArchivedExpanded}}
              {{#if this.loadArchivedRealmsTask.isRunning}}
                <WorkspaceLoadingIndicator />
              {{else if this.archivedRealms.length}}
                <div class='workspace-list' data-test-archived-list>
                  {{#each this.archivedRealms as |archivedRealm|}}
                    <ArchivedWorkspace @archivedRealm={{archivedRealm}} />
                  {{/each}}
                </div>
              {{else}}
                <span class='section-empty' data-test-archived-empty>
                  No archived workspaces
                </span>
              {{/if}}
            {{/if}}
          </div>
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
        position: absolute;
        background-color: var(--boxel-800);
        height: 100%;
        width: 100%;
        z-index: var(--host-workspace-chooser-z-index);
      }
      .sort-controls {
        display: flex;
        align-items: center;
        /* Keep the trigger on a single line at narrow top-bar widths rather
           than letting its label wrap under the icon. */
        white-space: nowrap;
      }
      .sort-select {
        flex-shrink: 0;
        --boxel-select-background-color: var(--boxel-800);
        --boxel-select-text-color: var(--boxel-light);
        --boxel-select-border-color: var(--boxel-light-25);
        --boxel-select-focus-border-color: var(--boxel-light-50);
        --icon-color: var(--boxel-light);
      }
      :global(.boxel-select__dropdown.workspace-chooser-sort-dropdown) {
        --boxel-dropdown-background-color: var(--boxel-650);
        --boxel-dropdown-border-color: var(--boxel-light-25);
        --boxel-dropdown-text-color: var(--boxel-light);
        --boxel-dropdown-selected-text-color: var(--boxel-light);
        --boxel-dropdown-hover-color: var(--boxel-700);
        --boxel-dropdown-highlight-color: var(--boxel-650);
        --boxel-dropdown-highlight-hover-color: var(--boxel-700);
        --boxel-dropdown-selected-highlighted-color: var(--boxel-700);
        --boxel-dropdown-selected-hover-color: var(--boxel-700);
      }
      :global(.workspace-chooser-sort-dropdown .boxel-select-option-checkmark) {
        --icon-color: var(--boxel-highlight);
        color: var(--boxel-highlight);
      }
      .workspace-chooser__content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-lg);
        height: 100%;
        padding: calc(5rem + 3.75rem) 5rem 5rem;
        overflow: auto;
        /* Fade in only the contents; the dark chooser background above
           paints immediately so the grey operator-mode canvas never flashes
           between the (dark) sign-in screen and the (dark) chooser. */
        opacity: 0;
        animation: fadeIn 0.5s ease-in forwards;
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
      .section-header--toggle {
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        width: fit-content;
        text-align: left;
      }
      .section-disclosure-icon {
        --icon-color: var(--boxel-light);
        color: var(--boxel-light);
        flex-shrink: 0;
        transition: transform 0.15s ease;
      }
      .section-header--toggle.is-expanded .section-disclosure-icon {
        transform: rotate(90deg);
      }
      .section-count {
        color: var(--boxel-400);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
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
      .unreachable-notice {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        max-width: 40rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light-10);
        color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .unreachable-notice-icon {
        flex-shrink: 0;
      }
      .unreachable-notice-spinner {
        flex-shrink: 0;
      }
    </style>
  </template>
}
