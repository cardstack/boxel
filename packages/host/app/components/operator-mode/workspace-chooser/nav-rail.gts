import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import MessageCircle from '@cardstack/boxel-icons/message-circle';
import Plus from '@cardstack/boxel-icons/plus';
import Sparkles from '@cardstack/boxel-icons/sparkles';
import Store from '@cardstack/boxel-icons/store';

import { RealmIcon } from '@cardstack/boxel-ui/components';
import { cn, cssVar, eq } from '@cardstack/boxel-ui/helpers';

import {
  catalogRealmURL,
  publishedRealmURLsFromInfo,
} from '@cardstack/host/lib/utils';
import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { leadWith } from './index';

const RECENT_SESSION_COUNT = 5;
const FAVORITES_SHOWN = 6;

type Flyout = 'workspaces' | 'ai' | 'catalog';

interface Signature {
  Element: HTMLElement;
  Args: {
    // Pointer and focus inside the rail keep it open; leaving starts the
    // owner's dismiss grace period, so the pointer can travel between the
    // wordmark and the rail without the rail flickering shut.
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onDismiss: () => void;
  };
}

interface RealmEntry {
  url: string;
  name: string;
  backgroundURL: string | undefined;
  info: ReturnType<RealmService['info']>;
  isLive: boolean;
}

// The dashboard's left rail: a floating glass capsule summoned from the
// BOXEL wordmark. It sits on the column the wordmark and the search button
// already share, so it adds navigation without moving any existing control.
// Each entry opens a flyout of the places it leads to.
export default class NavRail extends Component<Signature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private openFlyout: Flyout | null = null;

  private entryFor = (url: string): RealmEntry => {
    let info = this.realm.info(url);
    return {
      url,
      name: info.name,
      backgroundURL: info.backgroundURL ?? undefined,
      info,
      isLive: publishedRealmURLsFromInfo(info).length > 0,
    };
  };

  private get favorites(): RealmEntry[] {
    let known = new Set<string>([
      ...this.realmServer.userRealmIdentifiers,
      ...(this.realmServer.displayedCatalogRealmIdentifiers ?? []),
    ]);
    return this.matrixService.workspaceFavorites
      .filter((url) => known.has(url))
      .slice(0, FAVORITES_SHOWN)
      .map(this.entryFor);
  }

  private get catalogs(): RealmEntry[] {
    return leadWith(
      this.realmServer.displayedCatalogRealmIdentifiers ?? [],
      catalogRealmURL,
    ).map(this.entryFor);
  }

  private get recentSessions() {
    return this.aiAssistantPanelService.aiSessionRooms.slice(
      0,
      RECENT_SESSION_COUNT,
    );
  }

  @action private showFlyout(flyout: Flyout | null) {
    this.openFlyout = flyout;
  }

  @action private onKeydown(event: Event) {
    if ((event as KeyboardEvent).key !== 'Escape') {
      return;
    }
    event.stopPropagation();
    if (this.openFlyout) {
      this.openFlyout = null;
      return;
    }
    this.args.onDismiss();
  }

  @action private closeRail() {
    this.openFlyout = null;
    this.args.onDismiss();
  }

  @action private async openRealm(url: string) {
    this.closeRail();
    await this.operatorModeStateService.openWorkspace(url);
  }

  @action private async openAssistant() {
    this.closeRail();
    await this.aiAssistantPanelService.openPanel();
  }

  @action private async openSession(roomId: string) {
    this.closeRail();
    // `openPanel` reselects the persisted room, so enter it first.
    this.aiAssistantPanelService.enterRoom(roomId);
    await this.aiAssistantPanelService.openPanel();
  }

  @action private async startSession() {
    this.closeRail();
    await this.aiAssistantPanelService.openPanel();
    await this.aiAssistantPanelService.createNewSession();
  }

  // The Catalog entry opens the Boxel catalog; the flyout lists the rest.
  @action private openCatalogHome() {
    let url = catalogRealmURL ?? this.catalogs[0]?.url;
    if (url) {
      this.openRealm(url);
    }
  }

  private formatWhen = (timestamp: number) => formatRelativeTime(timestamp);

  private wallpaper = (entry: RealmEntry) =>
    entry.backgroundURL ? `url("${entry.backgroundURL}")` : undefined;

  <template>
    <nav
      class='nav-rail'
      aria-label='Dashboard'
      data-theme='dark'
      data-nav-rail
      data-test-nav-rail
      {{on 'mouseenter' @onPointerEnter}}
      {{on 'mouseleave' @onPointerLeave}}
      {{on 'focusin' @onPointerEnter}}
      {{on 'keydown' this.onKeydown}}
      ...attributes
    >
      <div
        class='rail-item'
        {{on 'mouseenter' (fn this.showFlyout 'workspaces')}}
        {{on 'mouseleave' (fn this.showFlyout null)}}
      >
        <button
          type='button'
          class={{cn
            'rail-button is-current'
            is-open=(eq this.openFlyout 'workspaces')
          }}
          aria-current='page'
          aria-label='Workspaces'
          aria-haspopup='true'
          aria-expanded={{if (eq this.openFlyout 'workspaces') 'true' 'false'}}
          {{on 'focus' (fn this.showFlyout 'workspaces')}}
          {{on 'click' this.closeRail}}
          data-test-nav-rail-item='workspaces'
        >
          <LayoutGrid width='20' height='20' />
        </button>
        {{#if (eq this.openFlyout 'workspaces')}}
          <div
            class='flyout'
            role='group'
            aria-label='Favorite workspaces'
            data-test-nav-rail-flyout='workspaces'
          >
            <header class='flyout-header'>
              <span class='flyout-title'>Workspaces</span>
              <span class='flyout-hint'>Favorites</span>
            </header>
            {{#each this.favorites key='url' as |entry|}}
              <button
                type='button'
                class='realm-row'
                {{on 'click' (fn this.openRealm entry.url)}}
                data-test-nav-rail-favorite={{entry.url}}
              >
                <span
                  class='realm-thumb'
                  style={{cssVar rail-wallpaper=(this.wallpaper entry)}}
                >
                  <RealmIcon
                    class='realm-thumb-icon'
                    @realmInfo={{entry.info}}
                  />
                </span>
                <span class='row-title'>{{entry.name}}</span>
                {{#if entry.isLive}}
                  <span class='live-chip'>Live</span>
                {{/if}}
              </button>
            {{else}}
              <p class='flyout-empty'>
                Star a workspace to keep it here and at the top of the
                dashboard.
              </p>
            {{/each}}
          </div>
        {{/if}}
      </div>

      <div
        class='rail-item'
        {{on 'mouseenter' (fn this.showFlyout 'ai')}}
        {{on 'mouseleave' (fn this.showFlyout null)}}
      >
        <button
          type='button'
          class={{cn 'rail-button' is-open=(eq this.openFlyout 'ai')}}
          aria-label='Boxel AI'
          aria-haspopup='true'
          aria-expanded={{if (eq this.openFlyout 'ai') 'true' 'false'}}
          {{on 'focus' (fn this.showFlyout 'ai')}}
          {{on 'click' this.openAssistant}}
          data-test-nav-rail-item='ai'
        >
          <Sparkles width='20' height='20' />
        </button>
        {{#if (eq this.openFlyout 'ai')}}
          <div
            class='flyout'
            role='group'
            aria-label='Boxel AI sessions'
            data-test-nav-rail-flyout='ai'
          >
            <header class='flyout-header'>
              <span class='flyout-title'>Boxel AI</span>
              <button
                type='button'
                class='header-action'
                {{on 'click' this.startSession}}
                data-test-nav-rail-new-session
              >
                <Plus width='14' height='14' />
                New session
              </button>
            </header>
            {{#each this.recentSessions as |session|}}
              <button
                type='button'
                class='session-row'
                {{on 'click' (fn this.openSession session.roomId)}}
                data-test-nav-rail-session={{session.roomId}}
              >
                <span class='session-icon'>
                  <MessageCircle width='14' height='14' />
                </span>
                <span class='row-title'>{{session.name}}</span>
                <span class='row-meta'>{{this.formatWhen
                    session.lastActiveTimestamp
                  }}</span>
              </button>
            {{else}}
              <p class='flyout-empty' data-test-nav-rail-sessions-empty>
                No sessions yet. Ask Boxel AI to build or change something.
              </p>
            {{/each}}
          </div>
        {{/if}}
      </div>

      <div
        class='rail-item'
        {{on 'mouseenter' (fn this.showFlyout 'catalog')}}
        {{on 'mouseleave' (fn this.showFlyout null)}}
      >
        <button
          type='button'
          class={{cn 'rail-button' is-open=(eq this.openFlyout 'catalog')}}
          aria-label='Catalog'
          aria-haspopup='true'
          aria-expanded={{if (eq this.openFlyout 'catalog') 'true' 'false'}}
          {{on 'focus' (fn this.showFlyout 'catalog')}}
          {{on 'click' this.openCatalogHome}}
          data-test-nav-rail-item='catalog'
        >
          <Store width='20' height='20' />
        </button>
        {{#if (eq this.openFlyout 'catalog')}}
          <div
            class='flyout'
            role='group'
            aria-label='Catalogs'
            data-test-nav-rail-flyout='catalog'
          >
            <header class='flyout-header'>
              <span class='flyout-title'>Catalog</span>
              <span class='flyout-hint'>Apps, fields and themes to use</span>
            </header>
            <div class='catalog-grid'>
              {{#each this.catalogs key='url' as |entry|}}
                <button
                  type='button'
                  class='catalog-tile'
                  style={{cssVar rail-wallpaper=(this.wallpaper entry)}}
                  {{on 'click' (fn this.openRealm entry.url)}}
                  data-test-nav-rail-catalog={{entry.url}}
                >
                  <span class='catalog-name'>
                    <RealmIcon class='catalog-icon' @realmInfo={{entry.info}} />
                    <span class='row-title'>{{entry.name}}</span>
                  </span>
                </button>
              {{/each}}
            </div>
          </div>
        {{/if}}
      </div>
    </nav>

    <style scoped>
      .nav-rail {
        --rail-glass: color-mix(in oklch, var(--boxel-800) 72%, transparent);
        --rail-line: color-mix(in oklch, var(--boxel-light) 12%, transparent);
        --rail-hover: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --rail-pad: var(--boxel-sp-4xs);
        /* Centered on the column the wordmark and search button share. */
        position: absolute;
        left: calc(var(--operator-mode-spacing) - var(--rail-pad));
        top: calc(
          var(--operator-mode-top-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );
        bottom: calc(
          var(--operator-mode-bottom-bar-item-height) + 2 *
            var(--operator-mode-spacing)
        );
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        padding: var(--rail-pad);
        border-radius: calc(0.75rem + var(--rail-pad));
        border: 1px solid var(--rail-line);
        background-color: var(--rail-glass);
        backdrop-filter: blur(18px) saturate(140%);
        box-shadow:
          0 1.5rem 3rem color-mix(in oklch, var(--boxel-dark) 45%, transparent),
          inset 0 1px 0 color-mix(in oklch, var(--boxel-light) 8%, transparent);
        color: var(--foreground);
        z-index: var(--host-nav-rail-z-index);
        transform-origin: top left;
        animation: rail-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      @keyframes rail-in {
        from {
          opacity: 0;
          transform: translateX(-0.75rem) scale(0.96);
        }
      }
      .rail-item {
        position: relative;
      }
      .rail-button {
        position: relative;
        width: var(--container-button-size);
        height: var(--container-button-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 0.75rem;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
        transition:
          background-color var(--boxel-transition),
          color var(--boxel-transition),
          box-shadow var(--boxel-transition);
      }
      .rail-button:hover,
      .rail-button.is-open {
        background-color: var(--rail-hover);
        color: var(--foreground);
      }
      .rail-button.is-current {
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        box-shadow: 0 0 1.25rem
          color-mix(in oklch, var(--boxel-highlight) 35%, transparent);
      }
      .rail-button:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }

      .flyout {
        position: absolute;
        top: calc(-1 * var(--rail-pad));
        left: calc(100% + var(--boxel-sp-sm));
        width: 20rem;
        max-height: 26rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
        padding: var(--boxel-sp-xs);
        border-radius: 1rem;
        border: 1px solid var(--rail-line);
        background-color: color-mix(
          in oklch,
          var(--boxel-700) 99%,
          transparent
        );
        backdrop-filter: blur(18px) saturate(140%);
        box-shadow: 0 1.5rem 3.5rem
          color-mix(in oklch, var(--boxel-dark) 55%, transparent);
        animation: flyout-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      /* Bridges the gap to the rail, so the pointer can cross it without
         leaving the item and closing the flyout. */
      .flyout::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        right: 100%;
        width: var(--boxel-sp-sm);
      }
      @keyframes flyout-in {
        from {
          opacity: 0;
          transform: translateX(-0.375rem);
        }
      }
      .flyout-header {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs) var(--boxel-sp-xs);
      }
      .flyout-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .flyout-hint {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .header-action {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        height: 1.75rem;
        padding: 0 var(--boxel-sp-xs);
        border: 0;
        border-radius: 0.875rem;
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        cursor: pointer;
        align-self: center;
      }
      .header-action:hover {
        background-color: var(--boxel-highlight-hover);
      }
      .realm-row,
      .session-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        min-height: 2.75rem;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border: 0;
        border-radius: 0.625rem;
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .realm-row:hover,
      .realm-row:focus-visible,
      .session-row:hover,
      .session-row:focus-visible {
        background-color: var(--rail-hover);
        outline: none;
      }
      .realm-thumb {
        position: relative;
        flex: none;
        width: 3rem;
        height: 2rem;
        border-radius: 0.5rem;
        background-color: var(--muted);
        background-image: var(--rail-wallpaper);
        background-size: cover;
        background-position: center;
        box-shadow: inset 0 0 0 1px var(--rail-line);
      }
      .realm-thumb-icon {
        --boxel-realm-icon-size: 1.125rem;
        --boxel-realm-icon-border-radius: 0.3125rem;
        --boxel-realm-icon-background-color: var(--boxel-light);
        position: absolute;
        left: 0.25rem;
        bottom: 0.25rem;
      }
      .row-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .row-meta {
        flex: none;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .live-chip {
        flex: none;
        padding: 0.0625rem var(--boxel-sp-4xs);
        border-radius: 0.5rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-lime) 14%,
          transparent
        );
        color: var(--boxel-lime);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .session-icon {
        flex: none;
        width: 1.75rem;
        height: 1.75rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background-color: var(--rail-hover);
        color: var(--muted-foreground);
      }
      .catalog-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--boxel-sp-xs);
        padding: 0 var(--boxel-sp-4xs) var(--boxel-sp-4xs);
      }
      .catalog-tile {
        position: relative;
        height: 5rem;
        padding: var(--boxel-sp-4xs);
        display: flex;
        align-items: flex-end;
        border: 0;
        border-radius: 0.75rem;
        background-color: var(--muted);
        background-image: var(--rail-wallpaper);
        background-size: cover;
        background-position: center;
        box-shadow: inset 0 0 0 1px var(--rail-line);
        color: var(--boxel-light);
        cursor: pointer;
        transition: transform var(--boxel-transition);
      }
      .catalog-tile:hover {
        transform: translateY(-1px);
      }
      .catalog-tile:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .catalog-name {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        max-width: 100%;
        padding: var(--boxel-sp-6xs) var(--boxel-sp-4xs) var(--boxel-sp-6xs)
          var(--boxel-sp-6xs);
        border-radius: 0.5rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-800) 60%,
          transparent
        );
        backdrop-filter: blur(8px);
      }
      .catalog-icon {
        --boxel-realm-icon-size: 1.125rem;
        --boxel-realm-icon-border-radius: 0.3125rem;
        --boxel-realm-icon-background-color: var(--boxel-light);
        flex: none;
      }
      .catalog-name .row-title {
        font-size: var(--boxel-font-size-xs);
      }
      .flyout-empty {
        margin: 0;
        padding: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      @media (prefers-reduced-motion: reduce) {
        .nav-rail,
        .flyout {
          animation: none;
        }
        .catalog-tile:hover {
          transform: none;
        }
      }
    </style>
  </template>
}

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
  style: 'narrow',
});

// "2h ago", "yesterday", "3d ago" — coarse on purpose: the list is for
// recognizing a session, not timing it.
export function formatRelativeTime(timestamp: number, now = Date.now()) {
  let minutes = Math.round((timestamp - now) / 60000);
  if (Math.abs(minutes) < 60) {
    return relativeTimeFormat.format(minutes, 'minute');
  }
  let hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeTimeFormat.format(hours, 'hour');
  }
  return relativeTimeFormat.format(Math.round(hours / 24), 'day');
}
