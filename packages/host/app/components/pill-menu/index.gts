import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { motion, Presence, to, tween } from 'glimmer-motion';

import { Button, Header } from '@cardstack/boxel-ui/components';

import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';

import {
  DURATION,
  EASE_IN,
  motionEnabled,
} from '../ai-assistant/motion/tokens';

export type PillMenuItem = {
  cardId: string;
  realmURL: string | undefined;
  isActive: boolean;
};

interface Signature {
  Element: HTMLDivElement | HTMLButtonElement;
  Args: {
    title?: string;
    onExpand?: () => void;
    onCollapse?: () => void;
  };
  Blocks: {
    headerIcon: [];
    headerDetail: [];
    content: [collapseMenu: () => void];
    contentActions: [];
  };
}

// The expanded menu is the one item of a <Presence>, so it can play its exit
// after `isExpanded` has already flipped. One stable array per state: the
// presence diffs its items by identity.
type MenuFace = { id: 'menu' };
const MENU_PRESENT: MenuFace[] = [{ id: 'menu' }];
const MENU_ABSENT: MenuFace[] = [];
const faceKey = (face: MenuFace) => face.id;

// Leaving eases in (ADR 007 §1.5). Opacity only: a fade cannot deform the
// menu's text, and under reduced motion it is the short fade §1.5 asks for.
const MENU_EXIT = to({ opacity: 0 });
const MENU_EXIT_TRANSITION = tween({
  duration: DURATION.exit,
  ease: [...EASE_IN],
});

/**
 * A pill that expands into a menu and collapses back to the pill.
 *
 * Collapsing is a state change (ADR 007 §1.1): `isExpanded` flips and
 * `@onCollapse` fires in the click handler, and the collapsed pill renders in
 * the same pass. The menu's exit is the motion layer's: `<Presence>` keeps
 * the leaving menu rendered, lifted out of flow over the pill (`popLayout`),
 * while it fades; with motion off it leaves at once. The expand animation is
 * CSS on the menu root, so no state tracks whether it is playing.
 */
export default class PillMenu extends Component<Signature> {
  <template>
    {{#unless this.isExpanded}}
      <Button
        @kind='secondary'
        @size='extra-small'
        @pill={{true}}
        {{on 'click' this.expandMenu}}
        class='pill-menu-button'
        data-test-pill-menu-button
        data-test-pill-menu-collapsed
        ...attributes
      >
        {{yield to='headerIcon'}}
        {{yield to='headerDetail'}}
        <DropdownArrowFilled class='minimized-arrow' width='8px' height='8px' />
      </Button>
    {{/unless}}
    <Presence
      @items={{this.menuFaces}}
      @key={{faceKey}}
      @mode='popLayout'
      as |_face h|
    >
      <div
        class='pill-menu
          {{if (has-block "contentActions") "has-content-actions"}}'
        inert={{unless h.isPresent true}}
        {{motion presence=h exit=this.menuExit transition=MENU_EXIT_TRANSITION}}
        ...attributes
      >
        <Header class='menu-header' data-test-pill-menu-header>
          <:icon>
            {{yield to='headerIcon'}}
          </:icon>
          <:default>
            <button
              {{on 'click' this.collapseMenu}}
              class='detail-close-button'
              data-test-pill-menu-detail-close
            >
              {{yield to='headerDetail'}}
            </button>
          </:default>
          <:detail>
            <button
              {{on 'click' this.collapseMenu}}
              class='header-button'
              data-test-pill-menu-button
            >
              <DropdownArrowFilled
                class='collapse-icon'
                width='8px'
                height='8px'
              />
            </button>
          </:detail>
        </Header>
        <div class='menu-content'>
          <div class='menu-content-scroll'>
            {{yield this.collapseMenu to='content'}}

            {{#if (has-block 'contentActions')}}
              <div class='menu-content-actions'>
                {{yield to='contentActions'}}
              </div>
            {{/if}}
          </div>
        </div>
      </div>
    </Presence>
    <style scoped>
      .pill-menu {
        --boxel-header-gap: var(--boxel-sp-4xs);
        --boxel-header-detail-margin-left: 0;
        --pill-menu-spacing: var(--boxel-pill-menu-spacing, var(--boxel-sp-xs));
        --boxel-header-padding: 0 0 0 var(--pill-menu-spacing);
        --button-outline: 2px;
        --boxel-header-min-height: fit-content;
        --pill-menu-gradient-height: 5px;
        --pill-menu-content-max-height: 18.75rem;

        display: grid;
        grid-template-rows: auto 1fr;
        max-height: 100%;
        min-height: max-content;
        width: var(--boxel-pill-menu-width, 100%);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        box-shadow: var(--boxel-box-shadow);
        transition: width 0.2s ease-in;
      }
      @media (prefers-reduced-motion: no-preference) {
        .pill-menu {
          /* The collapsed pill row's height, so the menu grows out of the
             place the pill occupied. */
          --pill-menu-collapsed-height: 2.5rem;
          --pill-menu-expand-duration: 0.2s;

          /* Lets the height keyframe interpolate to its auto endpoint. */
          interpolate-size: allow-keywords;
          overflow: hidden;
          animation: pill-menu-expand var(--pill-menu-expand-duration) ease-out;
        }

        /* While the menu height is animating, the squeezed content region
           would briefly become scrollable and flash a scrollbar. An animation
           of the same length holds overflow hidden for exactly that time, so
           no state has to know when the expand ends. hidden (not clip) keeps
           the region programmatically scrollable for the scroll-into-view
           modifier. */
        .pill-menu .menu-content-scroll {
          animation: pill-menu-settle-scroll var(--pill-menu-expand-duration);
        }
      }
      .pill-menu-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-secondary-border: transparent;
        --boxel-button-min-width: 0;
        --boxel-button-transition:
          var(--boxel-transition-properties), scale 0.15s ease-out;
        padding-inline: var(--boxel-sp-2xs);
        gap: var(--boxel-sp-3xs);
        width: fit-content;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .pill-menu-button:not(:disabled):active {
        scale: 0.96;
      }
      .menu-header {
        overflow: hidden;
        padding: var(--boxel-sp-sm);
        font: 700 var(--boxel-font-xs);
      }
      .menu-header :deep(.title) {
        font: 700 var(--boxel-font);
      }
      .header-button {
        margin: var(--button-outline);
        padding: 0;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        font: 700 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .header-button:focus:focus-visible {
        outline-color: var(--boxel-highlight);
      }
      .collapse-icon {
        color: var(--icon-color, var(--boxel-dark));
      }

      .detail-close-button {
        border: none;
        padding: 0;
        background: none;
      }

      .expandable-header-button {
        width: var(
          --boxel-pill-menu-expandable-header-button-width,
          fit-content
        );
        color: var(--boxel-450);
        text-transform: uppercase;
      }
      .menu-content {
        /* Non-scrolling wrapper: the edge shadows are its pseudo-elements and
           it is their containing block, so they stay pinned to the visible
           edges while .menu-content-scroll scrolls underneath them. */
        position: relative;
        display: grid;
        min-height: 0;

        timeline-scope: --pill-menu-content-scroll-timeline;
      }

      .menu-content-scroll {
        padding: 0 var(--boxel-sp-sm);
        display: grid;
        gap: var(--pill-menu-spacing);
        overflow-y: auto;
        min-height: 0;
        max-height: var(--pill-menu-content-max-height);

        /* The scroll region and the timeline the edge shadows animate on are
           the same element, so a consumer capping the height here gets the
           shadows for free — no inner list should scroll on its own. */
        scroll-timeline: --pill-menu-content-scroll-timeline;
      }

      .pill-menu:not(:has(.menu-content-actions > *)) .menu-content-scroll {
        padding-bottom: var(--boxel-sp-sm);
      }

      .menu-content::before,
      .menu-content::after {
        content: '';
        display: block;
        width: 100%;
        height: var(--pill-menu-gradient-height);
        position: absolute;
        left: 0;
        opacity: 0;
        pointer-events: none;
      }

      .menu-content::before {
        top: 0;
        background: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.25) 0%,
          transparent 100%
        );

        animation: scroll-pill-menu-content linear forwards;
        animation-timeline: --pill-menu-content-scroll-timeline;
      }

      .menu-content::after {
        background: linear-gradient(
          to top,
          rgba(0, 0, 0, 0.25) 0%,
          transparent 100%
        );

        animation: scroll-pill-menu-content reverse linear backwards;
        animation-timeline: --pill-menu-content-scroll-timeline;

        bottom: 0;
      }

      .menu-content-actions {
        border-top: 1px solid var(--boxel-200);
        padding-block: var(--boxel-sp-xs);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-3xs);
      }

      .menu-content-actions:not(:has(*)) {
        display: none;
      }

      .pill-menu :deep(.menu-header .detail) {
        order: -1;
        margin-left: 0;
      }
      .minimized-arrow {
        transform: rotate(180deg);
        transform-origin: center;
        flex-shrink: 0;
      }

      @keyframes pill-menu-expand {
        /* min-height is pinned in both keyframes so the base
           min-height: max-content doesn't hold the menu open mid-animation. */
        from {
          height: var(--pill-menu-collapsed-height);
          min-height: 0;
        }
        to {
          height: auto;
          min-height: 0;
        }
      }

      @keyframes pill-menu-settle-scroll {
        from,
        to {
          overflow-y: hidden;
        }
      }

      @keyframes scroll-pill-menu-content {
        0% {
          opacity: 0;
        }
        1% {
          opacity: 1;
        }
        100% {
          opacity: 1;
        }
      }
    </style>
  </template>

  @tracked isExpanded = false;
  private motion = motionEnabled();

  private get menuFaces(): MenuFace[] {
    return this.isExpanded ? MENU_PRESENT : MENU_ABSENT;
  }

  /** With motion off the leaving menu has no exit to play and is removed at once. */
  private get menuExit() {
    return this.motion ? MENU_EXIT : undefined;
  }

  @action expandMenu() {
    if (this.isExpanded) {
      return;
    }
    this.isExpanded = true;
    this.args.onExpand?.();
  }

  @action collapseMenu() {
    if (!this.isExpanded) {
      return;
    }
    this.isExpanded = false;
    this.args.onCollapse?.();
  }
}
