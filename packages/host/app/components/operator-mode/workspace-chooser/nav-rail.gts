import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { cancel, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Bot from '@cardstack/boxel-icons/bot';
import ChevronRight from '@cardstack/boxel-icons/chevron-right';
import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import MessageCircle from '@cardstack/boxel-icons/message-circle';
import Plus from '@cardstack/boxel-icons/plus';
import Store from '@cardstack/boxel-icons/store';
import { restartableTask, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

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

import { CATALOG_LEADS_BELOW, leadWith } from './index';

const RECENT_SESSION_COUNT = 5;
const FAVORITES_SHOWN = 6;

// How long a flyout waits before following the pointer to another entry
// while the pointer is still travelling into the open flyout, and before
// closing once the pointer has left its entry.
const FLYOUT_AIM_DELAY_MS = 260;
const FLYOUT_CLOSE_DELAY_MS = 320;

interface Point {
  x: number;
  y: number;
}

// Whether the pointer, moving from `previous` to `current`, is heading into
// `target`, a flyout to the right of the rail: the move narrows the angle to
// both of the flyout's near corners. This is the triangle a pointer may cross
// on its way to the flyout without the flyout switching to the entries it
// passes over.
function isAimingAt(previous: Point, current: Point, target: DOMRect) {
  if (current.x >= target.left) {
    return false;
  }
  let slope = (from: Point, to: Point) =>
    (to.y - from.y) / Math.max(to.x - from.x, 1);
  let top = { x: target.left, y: target.top };
  let bottom = { x: target.left, y: target.bottom };
  return (
    slope(current, top) < slope(previous, top) &&
    slope(current, bottom) > slope(previous, bottom)
  );
}

// The rail's entries are the dashboard's sections, in page order.
type Section = 'workspaces' | 'catalogs' | 'agents';

// A section counts as the one being read once its top passes this far down
// the scroller.
const READING_LINE = 0.35;

function dashboardScroller() {
  return document.querySelector<HTMLElement>(
    '[data-workspace-chooser-scroller]',
  );
}

// Reports which section the dashboard is scrolled to, so the rail can mark
// it. Reads run after render, outside the render that installs this.
const trackSection = modifier(
  (_element: HTMLElement, [onChange]: [(section: Section) => void]) => {
    let scroller = dashboardScroller();
    if (!scroller) {
      return;
    }
    let update = () => {
      let sections = [
        ...scroller.querySelectorAll<HTMLElement>('[data-dashboard-section]'),
      ];
      let readingLine =
        scroller.getBoundingClientRect().top +
        scroller.clientHeight * READING_LINE;
      let current = sections[0];
      for (let section of sections) {
        if (section.getBoundingClientRect().top <= readingLine) {
          current = section;
        }
      }
      // The last section may be too short to reach the line; at the bottom
      // of a page that scrolls, it is the one in view.
      let scrolls = scroller.scrollHeight > scroller.clientHeight + 1;
      let atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if (scrolls && atBottom) {
        current = sections[sections.length - 1];
      }
      if (current) {
        onChange(current.dataset.dashboardSection as Section);
      }
    };
    let timer: ReturnType<typeof scheduleOnce> | undefined;
    let schedule = () => {
      timer = scheduleOnce('afterRender', update);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      scroller.removeEventListener('scroll', schedule);
      if (timer) {
        cancel(timer);
      }
    };
  },
);

interface RailSection {
  id: Section;
  label: string;
  icon: typeof LayoutGrid;
  count: number | undefined;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    // Below the wide breakpoint the rail shows only while summoned from the
    // wordmark; at and above it, it stays as a labeled sidebar.
    isSummoned: boolean;
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
// Each entry jumps to its section of the dashboard and marks the one being
// read; hovering one opens a flyout of the places it leads to.
export default class NavRail extends Component<Signature> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private openFlyout: Section | null = null;
  @tracked private currentSection: Section = 'workspaces';

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

  // The rail lists the page's sections in page order, which puts the
  // catalog first for someone with few workspaces of their own.
  private get sections(): RailSection[] {
    let workspaces: RailSection = {
      id: 'workspaces',
      label: 'Workspaces',
      icon: LayoutGrid,
      count: this.realmServer.userRealmIdentifiers.length || undefined,
    };
    let catalogs: RailSection = {
      id: 'catalogs',
      label: 'Catalogs',
      icon: Store,
      count:
        (this.realmServer.displayedCatalogRealmIdentifiers ?? []).length ||
        undefined,
    };
    let agents: RailSection = {
      id: 'agents',
      label: 'Agents',
      icon: Bot,
      count: undefined,
    };
    return this.realmServer.userRealmIdentifiers.length < CATALOG_LEADS_BELOW
      ? [catalogs, workspaces, agents]
      : [workspaces, catalogs, agents];
  }

  private get recentSessions() {
    return this.aiAssistantPanelService.aiSessionRooms.slice(
      0,
      RECENT_SESSION_COUNT,
    );
  }

  @action private showFlyout(flyout: Section | null) {
    this.flyoutIntentTask.cancelAll();
    this.openFlyout = flyout;
  }

  // The pointer's last two positions over the rail, for the aim test.
  private previousPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private railElement: HTMLElement | null = null;

  @action private trackPointer(event: Event) {
    let { clientX, clientY, currentTarget } = event as MouseEvent;
    this.railElement = currentTarget as HTMLElement;
    this.previousPoint = this.currentPoint;
    this.currentPoint = { x: clientX, y: clientY };
  }

  private get isAimingAtOpenFlyout() {
    let flyout = this.railElement?.querySelector('[data-nav-rail-flyout]');
    if (!flyout || !this.previousPoint || !this.currentPoint) {
      return false;
    }
    return isAimingAt(
      this.previousPoint,
      this.currentPoint,
      flyout.getBoundingClientRect(),
    );
  }

  // Hovering an entry opens its flyout at once, unless another flyout is
  // open and the pointer is on its way into it; then the switch waits, and
  // happens only if the pointer stops short.
  @action private hoverEntry(section: Section) {
    if (this.openFlyout === section) {
      this.flyoutIntentTask.cancelAll();
      return;
    }
    if (this.openFlyout && this.isAimingAtOpenFlyout) {
      this.flyoutIntentTask.perform(section, FLYOUT_AIM_DELAY_MS);
      return;
    }
    this.showFlyout(section);
  }

  // Leaving an entry closes its flyout after a grace period; entering the
  // flyout (part of the entry) or another entry cancels it.
  @action private leaveEntry() {
    if (this.openFlyout) {
      this.flyoutIntentTask.perform(null, FLYOUT_CLOSE_DELAY_MS);
    }
  }

  private flyoutIntentTask = restartableTask(
    async (section: Section | null, delay: number) => {
      await timeout(delay);
      if (section && this.isAimingAtOpenFlyout) {
        // Still travelling into the open flyout: look again shortly.
        this.flyoutIntentTask.perform(section, delay);
        return;
      }
      this.openFlyout = section;
    },
  );

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

  @action private setCurrentSection(section: Section) {
    if (section !== this.currentSection) {
      this.currentSection = section;
    }
  }

  @action private scrollToSection(section: Section) {
    this.openFlyout = null;
    this.currentSection = section;
    let behavior: ScrollBehavior = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
      ? 'auto'
      : 'smooth';
    // The first section opens the page, greeting and all, so it goes to
    // the top.
    if (section === this.sections[0]?.id) {
      dashboardScroller()?.scrollTo({ top: 0, behavior });
      return;
    }
    document
      .querySelector(`[data-dashboard-section='${section}']`)
      ?.scrollIntoView({ behavior, block: 'start' });
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

  private formatWhen = (timestamp: number) => formatRelativeTime(timestamp);

  private wallpaper = (entry: RealmEntry) =>
    entry.backgroundURL ? `url("${entry.backgroundURL}")` : undefined;

  <template>
    {{! Escape closes the flyout, then the rail, from any control inside it. }}
    {{! template-lint-disable no-invalid-interactive }}
    <nav
      class={{cn 'nav-rail' is-summoned=@isSummoned}}
      aria-label='Dashboard'
      data-theme='dark'
      data-nav-rail
      data-test-nav-rail
      {{on 'mouseenter' @onPointerEnter}}
      {{on 'mouseleave' @onPointerLeave}}
      {{on 'focusin' @onPointerEnter}}
      {{on 'keydown' this.onKeydown}}
      {{on 'mousemove' this.trackPointer}}
      {{trackSection this.setCurrentSection}}
      ...attributes
    >
      {{#each this.sections key='id' as |section|}}
        <div
          class='rail-item'
          {{on 'mouseenter' (fn this.hoverEntry section.id)}}
          {{on 'mouseleave' this.leaveEntry}}
        >
          <button
            type='button'
            class={{cn
              'rail-button'
              is-current=(eq this.currentSection section.id)
              is-open=(eq this.openFlyout section.id)
            }}
            aria-current={{if (eq this.currentSection section.id) 'location'}}
            aria-label={{section.label}}
            aria-haspopup='true'
            aria-expanded={{if (eq this.openFlyout section.id) 'true' 'false'}}
            {{on 'focus' (fn this.showFlyout section.id)}}
            {{on 'click' (fn this.scrollToSection section.id)}}
            data-test-nav-rail-item={{section.id}}
          >
            <section.icon class='rail-icon' width='20' height='20' />
            <span class='rail-label' aria-hidden='true'>{{section.label}}</span>
            {{#if section.count}}
              <span
                class='rail-count'
                aria-hidden='true'
              >{{section.count}}</span>
            {{/if}}
          </button>
          {{#if (eq this.openFlyout section.id)}}
            {{#if (eq section.id 'workspaces')}}
              <div
                class='flyout'
                role='group'
                aria-label='Favorite workspaces'
                data-nav-rail-flyout
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

            {{else if (eq section.id 'catalogs')}}
              <div
                class='flyout'
                role='group'
                aria-label='Catalogs'
                data-nav-rail-flyout
                data-test-nav-rail-flyout='catalogs'
              >
                <header class='flyout-header'>
                  <span class='flyout-title'>Catalogs</span>
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
                        <RealmIcon
                          class='catalog-icon'
                          @realmInfo={{entry.info}}
                        />
                        <span class='row-title'>{{entry.name}}</span>
                      </span>
                    </button>
                  {{/each}}
                </div>
              </div>

            {{else}}
              <div
                class='flyout'
                role='group'
                aria-label='Agents'
                data-nav-rail-flyout
                data-test-nav-rail-flyout='agents'
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
                <button
                  type='button'
                  class='session-row is-link'
                  {{on 'click' (fn this.scrollToSection 'agents')}}
                  data-test-nav-rail-connect-agent
                >
                  <span class='row-title'>Connect Claude Code or Codex</span>
                  <ChevronRight width='14' height='14' />
                </button>
              </div>

            {{/if}}
          {{/if}}
        </div>
      {{/each}}
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
      .rail-icon {
        flex: none;
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
      /* The section being read. The filled wordmark above already says
         which screen this is; the rail is that screen's outline, so the
         current section is marked with a ring, never a second fill. */
      .rail-button.is-current {
        color: var(--boxel-highlight);
        box-shadow: inset 0 0 0 1.5px
          color-mix(in oklch, var(--boxel-highlight) 70%, transparent);
      }
      .rail-button:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }

      /* An icon column. Below the wide breakpoint (80rem, matched in the
         chooser's own padding) it shows only while summoned; at and above it,
         it stays. Either way, hovering it or focusing into it slides its
         labels out over the page, the icons holding still. */
      .nav-rail {
        width: calc(var(--container-button-size) + 2 * var(--rail-pad) + 2px);
        box-sizing: border-box;
        transition: width 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .nav-rail:not(.is-summoned) {
        display: none;
      }
      @media (min-width: 80rem) {
        .nav-rail:not(.is-summoned) {
          display: flex;
        }
        .nav-rail {
          animation: none;
        }
      }
      .nav-rail:is(:hover, :focus-within) {
        width: var(--host-dashboard-sidebar-width);
      }
      .rail-button {
        overflow: hidden;
        white-space: nowrap;
      }
      .nav-rail:is(:hover, :focus-within) .rail-button {
        width: 100%;
        justify-content: flex-start;
        gap: var(--boxel-sp-sm);
        /* The icon's own inset, so it stays put as the rail widens. */
        padding: 0 calc((var(--container-button-size) - 20px) / 2);
      }
      .rail-label,
      .rail-count {
        display: none;
      }
      .nav-rail:is(:hover, :focus-within) .rail-label {
        display: inline;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .nav-rail:is(:hover, :focus-within) .rail-count {
        display: inline;
        margin-left: auto;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      @media (prefers-reduced-motion: reduce) {
        .nav-rail {
          transition: none;
        }
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
      .session-row.is-link {
        margin-top: var(--boxel-sp-4xs);
        border-top: 1px solid var(--rail-line);
        border-radius: 0 0 0.625rem 0.625rem;
        color: var(--muted-foreground);
      }
      .session-row.is-link:hover {
        color: var(--foreground);
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
