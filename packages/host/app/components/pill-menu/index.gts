import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ChevronLeft from '@cardstack/boxel-icons/chevron-left';

import { Button, Header } from '@cardstack/boxel-ui/components';

import { DropdownArrowFilled } from '@cardstack/boxel-ui/icons';

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
          {{if (has-block "contentActions") "has-content-actions"}}'
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
              <ChevronLeft class='collapse-icon' width='16' height='16' />
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
      .pill-menu-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-secondary-border: transparent;
        --boxel-button-secondary-active-border: var(--boxel-400);
        --boxel-button-border-radius: var(--boxel-border-radius-pill);
        padding-inline: var(--boxel-sp-sm);
        gap: var(--boxel-sp-2xs);
        width: fit-content;
        white-space: nowrap;
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
        margin-left: var(--boxel-sp-xs);
        flex-shrink: 0;
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

  @action expandMenu() {
    this.isExpanded = true;
    this.args.onExpand?.();
  }

  @action collapseMenu() {
    this.isExpanded = false;
    this.args.onCollapse?.();
  }
}
