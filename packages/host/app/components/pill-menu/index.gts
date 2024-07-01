import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { AddButton, Header } from '@cardstack/boxel-ui/components';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';

import type { CardDef } from 'https://cardstack.com/base/card-api';

export type PillMenuItem = {
  card: CardDef;
  isActive: boolean;
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    title?: string;
    isExpandableHeader?: boolean;
    headerAction?: () => void;
    items: PillMenuItem[];
    canAttachCard?: boolean;
    onChooseCard?: (card: CardDef) => void;
  };
  Blocks: {
    'header-icon': [];
    'header-detail': [];
    'header-button': [];
    content: [];
  };
}

export default class PillMenu extends Component<Signature> {
  <template>
    <div class='pill-menu' ...attributes>
      <Header class='menu-header' @title={{@title}}>
        <:icon>
          {{yield to='header-icon'}}
        </:icon>
        <:detail>
          {{yield to='header-detail'}}
        </:detail>
        <:actions>
          <button {{on 'click' this.headerAction}} class='header-button'>
            {{#if @isExpandableHeader}}
              {{if this.isExpanded 'Hide' 'Show'}}
            {{else}}
              {{yield to='header-button'}}
            {{/if}}
          </button>
        </:actions>
      </Header>
      {{#if this.isExpanded}}
        <div class='menu-content'>
          {{yield to='content'}}

          {{#if @items.length}}
            <ul class='pill-list'>
              {{#each @items as |item|}}
                <li>
                  <CardPill
                    @card={{item.card}}
                    @onToggle={{fn this.toggleActive item}}
                    @isEnabled={{item.isActive}}
                  />
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </div>

        {{#if @canAttachCard}}
          <footer class='menu-footer'>
            <AddButton
              class='add-button'
              @variant='pill'
              @iconWidth='15px'
              @iconHeight='15px'
              {{on 'click' this.attachCard}}
              @disabled={{this.doAttachCard.isRunning}}
            >
              Add Item
            </AddButton>
          </footer>
        {{/if}}
      {{/if}}
    </div>
    <style>
      .pill-menu {
        --pill-menu-spacing: var(--boxel-pill-menu-spacing, var(--boxel-sp-xs));
        --boxel-header-padding: 0 0 0 var(--pill-menu-spacing);
        --boxel-header-detail-max-width: 100%;
        --boxel-header-letter-spacing: var(--boxel-lsp);

        display: grid;
        max-height: 100%;
        width: 100%;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        box-shadow: var(--boxel-box-shadow);
      }
      .header-button {
        padding: var(--pill-menu-spacing);
        background: none;
        border: none;
        color: var(--boxel-450);
        font: 700 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        text-transform: uppercase;
      }
      .menu-content {
        padding: var(
          --boxel-pill-menu-content-padding,
          var(--pill-menu-spacing)
        );
        display: grid;
        gap: var(--pill-menu-spacing);
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
        width: 100%;
      }
      .pill-list:deep(.card-content) {
        max-width: initial;
      }
      .add-button {
        --icon-color: var(--boxel-highlight);
        width: max-content;
        padding: var(--pill-menu-spacing);
        background: none;
        box-shadow: none;
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-highlight);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        transition: color var(--boxel-transition);
      }
      .add-button:hover:not(:disabled),
      .add-button:focus:not(:disabled) {
        --icon-color: var(--boxel-highlight-hover);
        color: var(--boxel-highlight-hover);
        background: none;
        box-shadow: none;
      }
    </style>
  </template>

  @tracked isExpanded = !Boolean(this.args.isExpandableHeader);

  @action headerAction() {
    if (this.args.isExpandableHeader) {
      this.toggleMenu();
    }
    this.args.headerAction?.();
  }

  @action toggleMenu() {
    this.isExpanded = !this.isExpanded;
  }

  @action private toggleActive(item: PillMenuItem) {
    item.isActive = !item.isActive;
  }

  @action private attachCard() {
    if (!this.args.canAttachCard) {
      return;
    }
    this.doAttachCard.perform();
  }

  private doAttachCard = restartableTask(async () => {
    let card: CardDef | undefined = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (card) {
      this.args.onChooseCard?.(card);
    }
  });
}
