import { action } from '@ember/object';

import Component from '@glimmer/component';

import { not } from '@cardstack/boxel-ui/helpers';

import HostModeBreadcrumbItem from './breadcrumb-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardIds: string[];
    close?: (cardId: string) => void;
  };
}

export default class HostModeBreadcrumbs extends Component<Signature> {
  private get cardIds() {
    return this.args.cardIds ?? [];
  }

  private get hasCards() {
    return this.cardIds.length > 0;
  }

  private isLast = (index: number) => {
    return index === this.cardIds.length - 1;
  };

  private cardsAboveCard(cardId: string) {
    let cardIndex = this.cardIds.indexOf(cardId);

    if (cardIndex < 0) {
      return [] as string[];
    }

    return this.cardIds.slice(cardIndex + 1, this.cardIds.length);
  }

  private canNavigate = (cardId: string) => {
    if (!this.args.close) {
      return false;
    }

    return this.cardsAboveCard(cardId).length > 0;
  };

  @action
  private handleBreadcrumbClick(cardId: string) {
    if (!this.args.close) {
      return;
    }

    let cardsToClose = this.cardsAboveCard(cardId);

    if (cardsToClose.length === 0) {
      return;
    }

    for (let cardId of cardsToClose) {
      this.args.close(cardId);
    }
  }

  <template>
    <nav
      class='host-mode-breadcrumbs {{unless this.hasCards "empty"}}'
      aria-label='Card stack navigation'
      hidden={{not this.hasCards}}
      data-test-host-mode-breadcrumbs
      ...attributes
    >
      {{#if this.hasCards}}
        <ol class='list'>
          {{#each this.cardIds as |cardId index|}}
            <li class='item'>
              <HostModeBreadcrumbItem
                @cardId={{cardId}}
                @disabled={{not (this.canNavigate cardId)}}
                @onClick={{this.handleBreadcrumbClick}}
              />
              {{#unless (this.isLast index)}}
                <span class='separator' aria-hidden='true'>
                  ›
                </span>
              {{/unless}}
            </li>
          {{/each}}
        </ol>
      {{/if}}
    </nav>

    <style scoped>
      .host-mode-breadcrumbs {
        display: inline-flex;
        align-items: center;
        background-color: var(--boxel-700);
        box-shadow: var(--boxel-deep-box-shadow);
        border: solid 1px rgba(255, 255, 255, 0.35);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: 7px;
      }

      .empty {
        display: none;
      }

      .list {
        display: inline-flex;
        list-style: none;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding: 0;
        align-items: center;
      }

      .item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      .separator {
        color: rgba(255, 255, 255, 0.7);
        font-size: var(--boxel-font-size);
        line-height: 1;
      }
    </style>
  </template>
}
