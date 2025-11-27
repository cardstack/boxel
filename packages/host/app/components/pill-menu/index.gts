import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Header } from '@cardstack/boxel-ui/components';

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
    footer: [];
  };
}

export default class PillMenu extends Component<Signature> {
  <template>
    {{#if this.isExpanded}}
      <div
        class='pill-menu {{if (has-block "footer") "has-footer"}}'
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
              <DropdownArrowFilled width='8px' height='8px' />
            </button>
          </:detail>
        </Header>
        {{#if (has-block 'content')}}
          <div class='menu-content'>
            {{yield to='content'}}
          </div>
        {{/if}}

        {{#if (has-block 'footer')}}
          <footer class='menu-footer'>
            {{yield to='footer'}}
          </footer>
        {{/if}}
      </div>
    {{else}}
      <button
        {{on 'click' this.expandMenu}}
        class='pill-menu-button'
        data-test-pill-menu-button
        ...attributes
      >
        {{yield to='headerIcon'}}
        {{yield to='headerDetail'}}
        <DropdownArrowFilled class='minimized-arrow' width='8px' height='8px' />
      </button>
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

        display: grid;
        grid-template-rows: auto 1fr auto;
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

        timeline-scope: --pill-menu-content-scroll-timeline;
      }
      .pill-menu-button {
        display: flex;
        align-items: center;
        font: 700 var(--boxel-font-xs);
        gap: var(--boxel-sp-xxs);
        padding: var(
          --boxel-pill-menu-button-padding,
          var(--pill-menu-spacing)
        );
        border: none;
        white-space: nowrap;
        background-color: transparent;
        border: 1px solid transparent;
        border-radius: var(--boxel-border-radius-xl);
        width: fit-content;
      }
      .pill-menu-button:hover {
        border: 1px solid var(--boxel-400);
      }
      .menu-header {
        overflow: hidden;
        padding: var(--chat-input-area-bottom-padding);
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
        padding: 0 var(--chat-input-area-bottom-padding);
        display: grid;
        gap: var(--pill-menu-spacing);
        overflow-y: auto;
        min-height: 0;
      }

      .pill-menu:not(:has(.menu-footer)) .menu-content {
        padding-bottom: var(--chat-input-area-bottom-padding);
      }

      .menu-content::before,
      .menu-content::after,
      .menu-footer::before {
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
        background: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.25) 0%,
          transparent 100%
        );

        animation: scroll-pill-menu-content linear forwards;
        animation-timeline: --pill-menu-content-scroll-timeline;
      }

      .pill-menu.has-footer .menu-content::after {
        display: none;
      }

      .menu-content::after {
        background: linear-gradient(
          to top,
          rgba(0, 0, 0, 0.25) 0%,
          transparent 100%
        );

        animation: scroll-pill-menu-content reverse linear backwards;
        animation-timeline: --pill-menu-content-scroll-timeline;

        bottom: var(--chat-input-area-bottom-padding);
      }

      .menu-footer {
        padding: var(--chat-input-area-bottom-padding);
      }

      .menu-footer::before {
        background: linear-gradient(
          to top,
          rgba(0, 0, 0, 0.25) 0%,
          transparent 100%
        );

        animation: scroll-pill-menu-content reverse linear backwards;
        animation-timeline: --pill-menu-content-scroll-timeline;

        transform: translateY(
          calc(
            -1 *
              (
                var(--pill-menu-gradient-height) +
                  var(--chat-input-area-bottom-padding)
              )
          )
        );
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
