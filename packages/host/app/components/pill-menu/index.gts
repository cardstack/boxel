import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { buildWaiter, type Token } from '@ember/test-waiters';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Button, Header } from '@cardstack/boxel-ui/components';

import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';

const waiter = buildWaiter('pill-menu:collapse-animation-waiter');

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
    content: [];
    contentActions: [];
  };
}

export default class PillMenu extends Component<Signature> {
  <template>
    {{#if this.isExpanded}}
      <div
        class='pill-menu
          {{if (has-block "contentActions") "has-content-actions"}}
          {{if this.isExpanding "is-expanding"}}
          {{if this.isCollapsing "is-collapsing"}}'
        {{on 'animationend' this.handleMenuAnimationEnd}}
        {{on 'animationcancel' this.handleMenuAnimationEnd}}
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
            {{yield to='content'}}

            {{#if (has-block 'contentActions')}}
              <div class='menu-content-actions'>
                {{yield to='contentActions'}}
              </div>
            {{/if}}
          </div>
        </div>
      </div>
    {{else}}
      <Button
        @kind='secondary'
        @size='extra-small'
        {{on 'click' this.expandMenu}}
        class='pill-menu-button'
        data-test-pill-menu-button
        ...attributes
      >
        {{yield to='headerIcon'}}
        {{yield to='headerDetail'}}
        <DropdownArrowFilled class='minimized-arrow' width='8px' height='8px' />
      </Button>
    {{/if}}
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
          /* The collapsed pill row's height, so the swap between button and
             menu lands exactly where the height animation starts/ends. */
          --pill-menu-collapsed-height: 2.5rem;

          /* Lets the height keyframe interpolate to its auto endpoint. */
          interpolate-size: allow-keywords;
          overflow: hidden;
          animation: pill-menu-expand var(--pill-menu-expand-duration, 0.2s)
            ease-out;
        }
        .pill-menu.is-collapsing {
          /* A separately named animation: only an animation-name change
             restarts the animation and re-arms its animationend event. */
          animation: pill-menu-collapse
            var(--pill-menu-collapse-duration, 0.15s) ease-in forwards;
        }

        /* While the menu height is animating, the squeezed content region
           would briefly become scrollable and flash a scrollbar; suppress it
           for the duration. hidden (not clip) keeps the region
           programmatically scrollable for the scroll-into-view modifier. */
        .pill-menu.is-expanding .menu-content-scroll,
        .pill-menu.is-collapsing .menu-content-scroll {
          overflow-y: hidden;
        }
      }
      .pill-menu-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-secondary-border: transparent;
        --boxel-button-border-radius: var(--boxel-border-radius-pill);
        --boxel-button-min-width: 0;
        --boxel-button-transition:
          var(--boxel-transition-properties), scale 0.15s ease-out;
        padding-inline: var(--boxel-sp-sm);
        gap: var(--boxel-sp-3xs);
        width: fit-content;
        white-space: nowrap;
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

      @keyframes pill-menu-collapse {
        from {
          height: auto;
          min-height: 0;
        }
        to {
          height: var(--pill-menu-collapsed-height);
          min-height: 0;
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
  @tracked private isExpanding = false;
  @tracked private isCollapsing = false;
  private collapseWaiterToken: Token | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    registerDestructor(this, () => this.releaseCollapseWaiter());
  }

  private get prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  @action expandMenu() {
    this.isCollapsing = false;
    this.releaseCollapseWaiter();
    this.isExpanded = true;
    // Mirrors the expand animation's lifetime; with reduced motion no
    // animation (and no animationend to clear this) runs.
    this.isExpanding = !this.prefersReducedMotion;
    this.args.onExpand?.();
  }

  @action collapseMenu() {
    if (this.isCollapsing) {
      return;
    }
    if (this.prefersReducedMotion) {
      // No exit animation will run, so there is no animationend to wait for.
      this.finishCollapse();
      return;
    }
    this.isCollapsing = true;
    this.collapseWaiterToken = waiter.beginAsync();
  }

  // The menu stays in the DOM while the collapse animation plays; removal
  // happens here, once that animation on the menu root itself completes.
  // Animation names are matched by prefix: scoped CSS appends a suffix to
  // keyframe names.
  @action private handleMenuAnimationEnd(event: Event) {
    if (
      !(event instanceof AnimationEvent) ||
      event.target !== event.currentTarget
    ) {
      return;
    }
    if (event.animationName.startsWith('pill-menu-expand')) {
      this.isExpanding = false;
      return;
    }
    if (
      this.isCollapsing &&
      event.animationName.startsWith('pill-menu-collapse')
    ) {
      this.finishCollapse();
    }
  }

  private finishCollapse() {
    this.isCollapsing = false;
    this.releaseCollapseWaiter();
    this.isExpanded = false;
    this.args.onCollapse?.();
  }

  private releaseCollapseWaiter() {
    if (this.collapseWaiterToken) {
      waiter.endAsync(this.collapseWaiterToken);
      this.collapseWaiterToken = undefined;
    }
  }
}
