import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Owner from '@ember/owner';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { Button } from '@cardstack/boxel-ui/components';

import { cn, eq, gt } from '@cardstack/boxel-ui/helpers';

import type { RealmInfo } from '@cardstack/runtime-common';

import { HTMLComponent } from '@cardstack/host/lib/html-component';

import { removeFileExtension } from '../search-sheet/utils';

import CardCatalogResultsHeader from './results-header';

interface PrerenderedCard {
  component: HTMLComponent;
  url: string;
  realmUrl: string;
}

interface Signature {
  Args: {
    cards: PrerenderedCard[];
    select: (cardUrl?: string, ev?: KeyboardEvent | MouseEvent) => void;
    selectedCardUrl?: string;
    realmInfos: Record<string, RealmInfo>;
  };
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <div class='card-catalog' data-test-card-catalog>
      {{#if @realmInfos}}
        {{#each this.cardsGroupedByRealm as |realmData|}}
          <section
            class='card-catalog__realm'
            data-test-realm={{realmData.realmInfo.name}}
          >
            <CardCatalogResultsHeader
              @realm={{realmData.realmInfo}}
              @resultsCount={{realmData.cardsTotal}}
            />

            <ul class='card-catalog__group'>
              {{#each realmData.cardsShown as |card|}}
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
              {{/each}}
            </ul>

            {{#if (gt realmData.cardsTotal realmData.cardsShown.length)}}
              <Button
                {{on 'click' (fn this.revealMoreCards realmData)}}
                @kind='secondary-light'
                @size='small'
                data-test-show-more-cards
              >
                Show
                {{this.pageSize}}
                more cards ({{this.remainingCardsCount realmData.realmUrl}}
                not shown)
              </Button>
            {{/if}}
          </section>
        {{else}}
          <p>No cards available</p>
        {{/each}}
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

  @tracked private cardsGroupedByRealm: {
    realmUrl: string;
    realmInfo: RealmInfo;
    cardsShown: PrerenderedCard[];
    cardsHidden: PrerenderedCard[];
    cardsTotal: number;
  }[] = [];

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    let { cards, realmInfos } = args;

    let groupedCards = cards.reduce(
      (acc, card) => {
        let realmUrl = card.realmUrl;
        if (!acc[realmUrl]) {
          acc[realmUrl] = {
            cardsShown: [],
            cardsHidden: [],
            cardsTotal: 0,
            realmInfo: realmInfos[realmUrl],
          };
        }
        if (acc[realmUrl].cardsShown.length < this.pageSize) {
          acc[realmUrl].cardsShown.push(card);
        } else {
          acc[realmUrl].cardsHidden.push(card);
        }
        acc[realmUrl].cardsTotal++;
        return acc;
      },
      {} as Record<
        string,
        {
          cardsShown: PrerenderedCard[];
          cardsHidden: PrerenderedCard[];
          realmInfo: RealmInfo;
          cardsTotal: number;
        }
      >,
    );

    let cardsGroupedByRealm = Object.keys(groupedCards).map((realmUrl) => {
      return {
        realmUrl,
        realmInfo: groupedCards[realmUrl].realmInfo,
        cardsShown: groupedCards[realmUrl].cardsShown,
        cardsHidden: groupedCards[realmUrl].cardsHidden,
        cardsTotal: groupedCards[realmUrl].cardsTotal,
      };
    });

    this.cardsGroupedByRealm = cardsGroupedByRealm;
  }

  pageSize = 5;

  @action remainingCardsCount(realmUrl: string) {
    let realmData = this.cardsGroupedByRealm.find(
      (realmData: any) => realmData.realmUrl === realmUrl,
    );
    return realmData!.cardsTotal - realmData!.cardsShown.length;
  }

  @action revealMoreCards(realmData: any) {
    let realmDataIndex = this.cardsGroupedByRealm.findIndex(
      (realmData: any) => realmData.realmUrl === realmData.realmUrl,
    );

    let newRealmData = { ...realmData };
    let cardsToReveal = newRealmData.cardsHidden.slice(0, this.pageSize);
    newRealmData.cardsShown = [...newRealmData.cardsShown, ...cardsToReveal];
    newRealmData.cardsHidden = newRealmData.cardsHidden.slice(this.pageSize);

    this.cardsGroupedByRealm[realmDataIndex] = newRealmData;
    this.cardsGroupedByRealm = [...this.cardsGroupedByRealm]; // Reassigning the array to itself is necessary to trigger a re-render
  }

  @action
  handleEnterKey(cardUrl: string, event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.args.select(cardUrl, event);
    }
  }
}
