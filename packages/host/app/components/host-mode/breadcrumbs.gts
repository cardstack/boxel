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
      class='host-mode-breadcrumbs'
      aria-label='Card stack navigation'
      hidden={{not this.hasCards}}
      data-host-mode-breadcrumbs
      data-test-host-mode-breadcrumbs
      ...attributes
    >
      {{#if this.hasCards}}
        <ol class='list'>
          {{#each this.cardIds key='@identity' as |cardId index|}}
            <li class='item'>
              <HostModeBreadcrumbItem
                @cardId={{cardId}}
                @disabled={{not (this.canNavigate cardId)}}
                @isCurrent={{this.isLast index}}
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
        max-width: 100%;
        box-sizing: border-box;
        background-color: var(--boxel-700);
        box-shadow: var(--boxel-deep-box-shadow);
        border: 1px solid var(--boxel-light-35);
        min-height: 2.25rem;
        padding-block: 0;
        padding-inline: var(--boxel-sp-xs);
        border-radius: 7px;
      }

      .list {
        display: inline-flex;
        list-style: none;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding: 0;
        align-items: center;
        max-width: 100%;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .list::-webkit-scrollbar {
        display: none;
      }

      .item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        flex-shrink: 1;
        min-width: 2.5rem;
      }

      .item:first-child,
      .item:last-child {
        flex-shrink: 0;
        min-width: 4rem;
      }

      .item:first-child :deep(.breadcrumb-item),
      .item:last-child :deep(.breadcrumb-item) {
        min-width: 4rem;
      }

      .separator {
        color: var(--boxel-light-70);
        font-size: var(--boxel-font-size);
        line-height: 1;
      }

      @media (max-width: 30rem) {
        .host-mode-breadcrumbs {
          padding-inline: var(--boxel-sp-3xs);
        }
      }
    </style>
  </template>
}
