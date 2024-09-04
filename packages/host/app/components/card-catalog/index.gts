import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';

import { add, cn, eq, gt, lt, subtract } from '@cardstack/boxel-ui/helpers';

import type { RealmInfo } from '@cardstack/runtime-common';

import { HTMLComponent } from '@cardstack/host/lib/html-component';

import { removeFileExtension } from '../search-sheet/utils';

import CardCatalogResultsHeader from './results-header';

interface PrerenderedCard {
  component: HTMLComponent;
  url: string;
  realmUrl: string;
  realmInfo?: RealmInfo;
}

interface Signature {
  Args: {
    cards: PrerenderedCard[];
    select: (cardUrl?: string, ev?: KeyboardEvent | MouseEvent) => void;
    selectedCardUrl?: string;
    realmInfos?: Record<string, RealmInfo>;
  };
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <div class='card-catalog' data-test-card-catalog>
      {{#if @realmInfos}}
        {{#let
          (this.groupByRealmUrl @cards this.pageSize)
          as |groupedCardsByRealm|
        }}
          {{#each-in groupedCardsByRealm as |_realmUrl realmData|}}
            <section
              class='card-catalog__realm'
              data-test-realm={{realmData.realmInfo.name}}
            >
              <CardCatalogResultsHeader
                @realm={{realmData.realmInfo}}
                @resultsCount={{realmData.cardsTotal}}
              />

              <ul class='card-catalog__group'>
                {{#each realmData.cards as |card index|}}
                  {{#if (lt index realmData.displayedCardsCount)}}
                    {{#let (eq @selectedCardUrl card.url) as |isSelected|}}
                      <li class={{cn 'item' selected=isSelected}}>
                        <button
                          class='catalog-item {{if isSelected "selected"}}'
                          {{on 'click' (fn @select card.url)}}
                          {{on 'dblclick' (fn @select card.url)}}
                          {{on 'keydown' (fn this.handleEnterKey card.url)}}
                          data-test-select={{removeFileExtension card.url}}
                          aria-label='Select'
                          data-test-card-catalog-item={{removeFileExtension
                            card.url
                          }}
                          data-test-card-catalog-item-selected={{isSelected}}
                        >
                          {{card.component}}
                        </button>
                      </li>
                    {{/let}}
                  {{/if}}
                {{/each}}
              </ul>

              {{#if (gt realmData.cardsTotal realmData.displayedCardsCount)}}
                <Button
                  {{on
                    'click'
                    (fn
                      (mut realmData.displayedCardsCount)
                      (add realmData.displayedCardsCount this.pageSize)
                    )
                  }}
                  @kind='secondary-light'
                  @size='small'
                  data-test-show-more-cards
                >
                  Show
                  {{this.pageSize}}
                  more cards ({{subtract
                    realmData.cardsTotal
                    realmData.displayedCardsCount
                  }}
                  not shown)
                </Button>
              {{/if}}
            </section>

          {{else}}
            <p>No cards available</p>
          {{/each-in}}
        {{/let}}
      {{/if}}
    </div>

    <style>
      .catalog-item.selected {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }

      .card-catalog {
        display: grid;
        gap: var(--boxel-sp-xl);
      }

      .card-catalog__realm > * + * {
        margin-top: var(--boxel-sp);
      }
      .card-catalog__realm > *:not(:first-child) {
        margin-left: var(--boxel-sp-lg);
      }
      .card-catalog__group {
        list-style-type: none;
        padding: 0;
        margin-bottom: 0;
        display: grid;
        gap: var(--boxel-sp);
      }

      .item:hover > .select:not(:disabled) {
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
        cursor: pointer;
      }

      .item {
        position: relative;
      }

      .item > .hover-button {
        display: none;
        width: 30px;
        height: 100%;
      }
      .hover-button:not(:disabled):hover {
        --icon-color: var(--boxel-highlight);
      }
      .item:hover > .hover-button:not(:disabled) {
        position: absolute;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .catalog-item {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
        width: 100%;
        height: 63px;
        overflow: hidden;
        cursor: pointer;
        container-name: fitted-card;
        container-type: size;
        display: flex;
        text-align: left;
        margin: auto;
      }
    </style>
  </template>

  @action
  stringify(realmInfos: Record<string, RealmInfo>) {
    return JSON.stringify(realmInfos);
  }

  @action
  groupByRealmUrl(
    cards: PrerenderedCard[],
    displayLimit: number,
  ): Record<
    string,
    {
      cards: PrerenderedCard[];
      cardsTotal: number;
      displayedCardsCount: number;
      realmInfo: RealmInfo;
    }
  > {
    const groupedCards = cards.reduce(
      (acc, card) => {
        let realmUrl = card.realmUrl;
        if (!acc[realmUrl]) {
          acc[realmUrl] = {
            cards: [],
            realmInfo: this.args.realmInfos![realmUrl],
            cardsTotal: 0,
            displayedCardsCount: 0,
          };
        }
        acc[realmUrl].cards.push(card);
        return acc;
      },
      {} as Record<
        string,
        {
          cards: PrerenderedCard[];
          realmInfo: RealmInfo;
          cardsTotal: number;
          displayedCardsCount: number;
        }
      >,
    );

    Object.keys(groupedCards).forEach((realmUrl) => {
      const totalCards = groupedCards[realmUrl].cards.length;
      groupedCards[realmUrl] = {
        ...groupedCards[realmUrl],
        cardsTotal: totalCards,
        displayedCardsCount: displayLimit,
        realmInfo: groupedCards[realmUrl].realmInfo,
      };
    });

    return groupedCards;
  }

  pageSize = 5;

  @action
  handleEnterKey(cardUrl: string, event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.args.select(cardUrl, event);
    }
  }
}
