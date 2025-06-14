import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { Header } from '@cardstack/boxel-ui/components';

import {
  DropdownArrowFilled,
  DropdownArrowUp,
} from '@cardstack/boxel-ui/icons';

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
        class='pill-menu'
        {{onClickOutside
          this.collapseMenu
          exceptSelector='.card-catalog-modal'
        }}
        ...attributes
      >
        <Header class='menu-header' data-test-pill-menu-header>
          <:icon>
            {{yield to='headerIcon'}}
          </:icon>
          <:detail>
            {{yield to='headerDetail'}}
          </:detail>
          <:actions>
            <button
              {{on 'click' this.collapseMenu}}
              class='header-button'
              data-test-pill-menu-button
            >
              <DropdownArrowUp class='rotate-left' width='8px' height='8px' />
            </button>
          </:actions>
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
        --boxel-header-gap: var(--boxel-sp-xxs);
        --boxel-header-detail-margin-left: 0;
        --pill-menu-spacing: var(--boxel-pill-menu-spacing, var(--boxel-sp-xs));
        --boxel-header-padding: 0 0 0 var(--pill-menu-spacing);
        --boxel-header-detail-max-width: 100%;
        --boxel-header-letter-spacing: var(--boxel-lsp);
        --button-outline: 2px;
        --boxel-header-min-height: fit-content;

        display: grid;
        grid-template-rows: auto 1fr auto;
        max-height: 100%;
        min-height: max-content;
        width: var(--boxel-pill-menu-width, 100%);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        box-shadow: var(--boxel-box-shadow);
        transition: width 0.2s ease-in;
      }
      .pill-menu-button {
        display: flex;
        align-items: center;
        font: 600 var(--boxel-font-xs);
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
        padding: var(
          --boxel-pill-menu-header-padding,
          var(--pill-menu-spacing)
        );
      }
      .menu-header :deep(.title) {
        font: 600 var(--boxel-font);
      }
      .header-button {
        margin: var(--button-outline);
        padding: 0;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .header-button:focus:focus-visible {
        outline-color: var(--boxel-highlight);
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
        padding: var(
          --boxel-pill-menu-content-padding,
          var(--pill-menu-spacing)
        );
        display: grid;
        gap: var(--pill-menu-spacing);
        overflow-y: auto;
        min-height: 0;
      }
      .menu-footer {
        padding: var(
          --boxel-pill-menu-footer-padding,
          var(--pill-menu-spacing)
        );
      }
      .pill-menu :deep(.menu-header .detail) {
        font: 600 var(--boxel-font-xs);
      }
      .pill-menu :deep(.menu-header .header-icon) {
        order: 2;
      }
      .pill-menu :deep(.menu-header .detail) {
        order: 3;
      }
      .pill-menu :deep(.menu-header .content) {
        order: 1;
        margin-left: 0;
      }
      .rotate-left {
        transform: rotate(-90deg);
        transform-origin: center;
      }
      .minimized-arrow {
        transform: rotate(180deg);
        transform-origin: center;
        margin-left: var(--boxel-sp-xs);
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
