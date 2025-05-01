import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask } from 'ember-concurrency';

import { AddButton, Header } from '@cardstack/boxel-ui/components';
import { cn, gt, not, or } from '@cardstack/boxel-ui/helpers';

import {
  chooseCard,
  baseCardRef,
  type CardCatalogQuery,
} from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';

export type PillMenuItem = {
  cardId: string;
  realmURL: string | undefined;
  isActive: boolean;
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    title?: string;
    items: PillMenuItem[];
    itemDisplayName?: string;
    isExpandableHeader?: boolean;
    headerAction?: () => void;
    canAttachCard?: boolean;
    query?: CardCatalogQuery;
    onChooseCard?: (cardId: string) => void;
    onChangeItemIsActive: (item: PillMenuItem, isActive: boolean) => void;
  };
  Blocks: {
    headerIcon: [];
    headerDetail: [];
    headerButton: [];
    content: [];
  };
}

export default class PillMenu extends Component<Signature> {
  <template>
    <div
      class={{cn 'pill-menu' pill-menu--minimized=(not this.isExpanded)}}
      {{onClickOutside this.closeMenu exceptSelector='.card-catalog-modal'}}
      ...attributes
    >
      <Header class='menu-header' @title={{@title}} data-test-pill-menu-header>
        <:icon>
          {{yield to='headerIcon'}}
        </:icon>
        <:detail>
          {{yield to='headerDetail'}}
        </:detail>
        <:actions>
          <button
            {{on 'click' this.headerAction}}
            class={{cn
              'header-button'
              expandable-header-button=@isExpandableHeader
            }}
            data-test-pill-menu-header-button
          >
            {{#if @isExpandableHeader}}
              {{if this.isExpanded 'Hide' 'Show'}}
            {{else}}
              {{yield to='headerButton'}}
            {{/if}}
          </button>
        </:actions>
      </Header>
      {{#if this.isExpanded}}
        {{#if (or (has-block 'content') (gt @items.length 0))}}
          <div class='menu-content'>
            {{yield to='content'}}

            {{#if @items.length}}
              <ul class='pill-list'>
                {{#each @items as |item|}}
                  <li>
                    <CardPill
                      @cardId={{item.cardId}}
                      @onToggle={{fn this.toggleActive item}}
                      @isEnabled={{item.isActive}}
                      @urlForRealmLookup={{urlForRealmLookup item}}
                      data-test-pill-menu-item={{item.cardId}}
                    />
                  </li>
                {{/each}}
              </ul>
            {{/if}}
          </div>
        {{/if}}

        {{#if @canAttachCard}}
          <footer class='menu-footer'>
            <AddButton
              class='attach-button'
              @variant='pill'
              @iconWidth='14'
              @iconHeight='14'
              {{on 'click' this.attachCard}}
              @disabled={{this.doAttachCard.isRunning}}
              data-test-pill-menu-add-button
            >
              Add
              {{if @itemDisplayName @itemDisplayName 'Item'}}
            </AddButton>
          </footer>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      .pill-menu {
        --pill-menu-spacing: var(--boxel-pill-menu-spacing, var(--boxel-sp-xs));
        --boxel-header-padding: 0 0 0 var(--pill-menu-spacing);
        --boxel-header-detail-max-width: 100%;
        --boxel-header-letter-spacing: var(--boxel-lsp);
        --button-outline: 2px;

        display: grid;
        max-height: 100%;
        min-height: max-content;
        width: var(--boxel-pill-menu-width, 100%);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        box-shadow: var(--boxel-box-shadow);
      }
      .menu-header {
        overflow: hidden;
      }
      .menu-header :deep(.title) {
        font: 600 var(--boxel-font);
      }
      .header-button {
        margin: var(--button-outline);
        padding: var(--pill-menu-spacing);
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
        width: var(--boxel-pill-menu-expandable-header-button-width, 3.75rem);
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
        overflow: hidden;
      }
      .pill-list {
        display: grid;
        gap: var(--boxel-sp-xs);
        list-style-type: none;
        padding: 0;
        margin: 0;
        overflow-y: auto;
      }
      .pill-list:deep(.card-pill) {
        --pill-gap: var(--boxel-sp-xxxs);
        display: inline-grid;
        grid-template-columns: auto 1fr auto;
        width: 100%;
      }
      .pill-list:deep(.card-content) {
        max-width: initial;
      }
      .menu-footer {
        padding: var(--boxel-sp-xxs);
      }
      .attach-button {
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xxxs);
        gap: var(--boxel-sp-xs);
        background: none;
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-600);
        color: var(--boxel-600);
        background: none;
        box-shadow: none;
      }
      .attach-button > :deep(svg > path) {
        stroke: none;
      }
    </style>
  </template>

  @tracked isExpanded = !this.args.isExpandableHeader;

  @action headerAction() {
    if (this.args.isExpandableHeader) {
      this.toggleMenu();
    }
    this.args.headerAction?.();
  }

  @action toggleMenu() {
    this.isExpanded = !this.isExpanded;
  }

  @action closeMenu() {
    if (!this.args.isExpandableHeader) {
      return;
    }
    this.isExpanded = false;
  }

  @action private toggleActive(item: PillMenuItem) {
    this.args.onChangeItemIsActive(item, !item.isActive);
  }

  @action private attachCard() {
    if (!this.args.canAttachCard) {
      return;
    }
    this.doAttachCard.perform();
  }

  private doAttachCard = restartableTask(async () => {
    let query = this.args.query ?? { filter: { type: baseCardRef } };
    let cardId = await chooseCard(query);
    if (cardId) {
      this.args.onChooseCard?.(cardId);
    }
  });
}

function urlForRealmLookup(item: PillMenuItem) {
  return item.cardId ?? item.realmURL;
}
