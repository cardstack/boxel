import { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import isEqual from 'lodash/isEqual';

import pluralize from 'pluralize';

import { Button } from '@cardstack/boxel-ui/components';

import { add, cn, eq, gt, lt, subtract } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import type {
  RealmInfo,
  CodeRef,
  PrerenderedCardLike,
} from '@cardstack/runtime-common';

import RestoreScrollPosition from '@cardstack/host/modifiers/restore-scroll-position';
import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';
import type RealmService from '@cardstack/host/services/realm';

import { removeFileExtension } from '../search-sheet/utils';

import CardCatalogResultsHeader from './results-header';

export interface NewCardArgs {
  ref: CodeRef;
  relativeTo: string | undefined;
  realmURL: string;
}

interface ButtonSignature {
  Args: {
    card?: PrerenderedCardLike;
    newCard?: NewCardArgs;
    isSelected: boolean;
    select: (
      card?: string | NewCardArgs,
      ev?: KeyboardEvent | MouseEvent,
    ) => void;
    handleEnterKey: (card: string | NewCardArgs, event: KeyboardEvent) => void;
    newCardKey: (realmURL: string) => string;
    cardRefName: string | undefined;
  };
}

const ItemButton: TemplateOnlyComponent<ButtonSignature> = <template>
  {{#if @card}}
    <Button
      class='catalog-item {{if @isSelected "selected"}}'
      {{on 'click' (fn @select @card.url)}}
      {{on 'dblclick' (fn @select @card.url)}}
      {{on 'keydown' (fn @handleEnterKey @card.url)}}
      data-test-select={{removeFileExtension @card.url}}
      aria-label='Select'
      data-test-card-catalog-item={{removeFileExtension @card.url}}
      data-test-card-catalog-item-selected={{@isSelected}}
      {{scrollIntoViewModifier
        @isSelected
        container='card-catalog'
        key=@card.url
      }}
    >
      <@card.component class='hide-boundaries' />
    </Button>
  {{else if @newCard}}
    <Button
      class='create-card catalog-item {{if @isSelected "selected"}}'
      {{on 'click' (fn @select @newCard)}}
      {{on 'dblclick' (fn @select @newCard)}}
      {{on 'keydown' (fn @handleEnterKey @newCard)}}
      data-test-select={{@newCardKey @newCard.realmURL}}
      aria-label='Select'
      data-test-card-catalog-create-new-button={{@newCard.realmURL}}
      data-test-card-catalog-item-selected={{@isSelected}}
      {{scrollIntoViewModifier
        @isSelected
        container='card-catalog'
        key=(@newCardKey @newCard.realmURL)
      }}
    >
      <IconPlus class='plus-icon' width='16' height='16' role='presentation' />
      Create New
      {{@cardRefName}}
    </Button>
  {{/if}}
  <style scoped>
    .catalog-item {
      --boxel-button-padding: 0;
      --boxel-button-border-radius: var(--boxel-border-radius-xl);
      --boxel-button-border: 1px solid var(--boxel-200);
      height: 67px;
      width: 100%;
      max-width: 100%;
      overflow: hidden;
      container-name: fitted-card;
      container-type: size;
      display: flex;
      text-align: left;
    }

    .catalog-item.selected {
      border-color: var(--boxel-highlight);
      box-shadow: 0 0 0 1px var(--boxel-highlight);
    }

    .catalog-item:hover {
      border-color: var(--boxel-darker-hover);
    }

    .catalog-item.selected:hover {
      border-color: var(--boxel-highlight);
    }

    .create-card.catalog-item {
      --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp);
      --boxel-button-letter-spacing: var(--boxel-lsp-xs);
      column-gap: var(--boxel-sp-xs);
      flex-wrap: nowrap;
      justify-content: flex-start;
    }
    .plus-icon > :deep(path) {
      stroke: none;
    }
  </style>
</template>;

interface Signature {
  Args: {
    cards: PrerenderedCardLike[];
    select: (
      card?: string | NewCardArgs,
      ev?: KeyboardEvent | MouseEvent,
    ) => void;
    selectedCard?: string | NewCardArgs;
    hasPreselectedCard?: boolean;
    offerToCreate?: {
      ref: CodeRef;
      relativeTo: URL | undefined;
    };
    realmInfos: Record<string, RealmInfo>;
  };
}

export default class CardCatalog extends Component<Signature> {
  <template>
    <div class='card-catalog' data-test-card-catalog>
      {{#each-in this.groupedCardsByRealm as |realmUrl realmData|}}
        <section
          class='card-catalog__realm'
          data-test-realm={{realmData.realmInfo.name}}
        >
          <CardCatalogResultsHeader
            @realm={{realmData.realmInfo}}
            @resultsCount={{realmData.cardsTotal}}
          />
          <ul
            class='card-catalog__group'
            {{RestoreScrollPosition
              key=this.selectedCardScrollKey
              container='card-catalog'
            }}
          >
            {{#if (this.showCreateCardForRealm realmUrl)}}
              {{#let
                (deepEq @selectedCard (this.newCardArgs realmUrl))
                as |isSelected|
              }}
                <ItemButton
                  @newCard={{this.newCardArgs realmUrl}}
                  @isSelected={{isSelected}}
                  @select={{@select}}
                  @handleEnterKey={{this.handleEnterKey}}
                  @newCardKey={{this.newCardKey}}
                  @cardRefName={{this.cardRefName}}
                />
              {{/let}}
            {{/if}}

            {{#each realmData.cards as |card index|}}
              {{#if (lt index realmData.displayedCardsCount)}}
                {{#let (eq @selectedCard card.url) as |isSelected|}}
                  <li class={{cn 'item' selected=isSelected}}>
                    <ItemButton
                      @card={{card}}
                      @isSelected={{isSelected}}
                      @select={{@select}}
                      @handleEnterKey={{this.handleEnterKey}}
                      @newCardKey={{this.newCardKey}}
                      @cardRefName={{this.cardRefName}}
                    />
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
              {{#let
                (subtract realmData.cardsTotal realmData.displayedCardsCount)
                as |remainingResults|
              }}
                {{#let (min this.pageSize remainingResults) as |nextPageSize|}}
                  Show
                  {{nextPageSize}}
                  more
                  {{pluralize 'card' nextPageSize}}
                  ({{remainingResults}}
                  not shown)
                {{/let}}
              {{/let}}
            </Button>
          {{/if}}
        </section>

      {{else}}
        <p>No cards available</p>
      {{/each-in}}
      {{#if @offerToCreate}}
        {{#each-in this.writableRealmsWithoutResults as |realmUrl realmInfo|}}
          <section
            class='card-catalog__realm'
            data-test-realm={{realmInfo.name}}
          >
            <CardCatalogResultsHeader
              @realm={{realmInfo}}
              @resultsCount={{0}}
            />
            <ul
              class='card-catalog__group'
              {{RestoreScrollPosition
                key=this.selectedCardScrollKey
                container='card-catalog'
              }}
            >
              {{#if (this.showCreateCardForRealm realmUrl)}}
                {{#let
                  (deepEq @selectedCard (this.newCardArgs realmUrl))
                  as |isSelected|
                }}
                  <ItemButton
                    @newCard={{this.newCardArgs realmUrl}}
                    @isSelected={{isSelected}}
                    @select={{@select}}
                    @handleEnterKey={{this.handleEnterKey}}
                    @newCardKey={{this.newCardKey}}
                    @cardRefName={{this.cardRefName}}
                  />
                {{/let}}
              {{/if}}
            </ul>
          </section>
        {{/each-in}}
      {{/if}}
    </div>

    <style scoped>
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
    </style>
  </template>

  @service private declare realm: RealmService;

  @cached
  private get selectedCardScrollKey() {
    return typeof this.args.selectedCard === 'string'
      ? this.args.selectedCard
      : typeof this.args.selectedCard === 'object'
      ? `new card for ${this.args.selectedCard.realmURL}`
      : undefined;
  }

  @cached
  private get groupedCardsByRealm(): Record<
    string,
    {
      cards: PrerenderedCardLike[];
      cardsTotal: number;
      displayedCardsCount: number;
      realmInfo: RealmInfo;
    }
  > {
    let cards = this.args.cards;
    let pageSize = this.pageSize;

    let groupedCards = cards.reduce(
      (acc, card) => {
        // don't show instances in an error state in the card chooser
        if (card.isError) {
          return acc;
        }
        let realmUrl = card.realmUrl;
        if (!acc[realmUrl]) {
          acc[realmUrl] = {
            cards: [],
            realmInfo: this.args.realmInfos[realmUrl],
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
          cards: PrerenderedCardLike[];
          realmInfo: RealmInfo;
          cardsTotal: number;
          displayedCardsCount: number;
        }
      >,
    );

    Object.keys(groupedCards).forEach((realmUrl) => {
      let totalCards = groupedCards[realmUrl].cards.length;
      groupedCards[realmUrl] = {
        ...groupedCards[realmUrl],
        cardsTotal: totalCards,
        displayedCardsCount: pageSize,
        realmInfo: groupedCards[realmUrl].realmInfo,
      };
    });

    return groupedCards;
  }

  @cached
  private get writableRealmsWithoutResults(): Record<string, RealmInfo> {
    let realms: Record<string, RealmInfo> = {};
    for (let realmURL of Object.keys(this.args.realmInfos)) {
      if (
        this.realm.canWrite(realmURL) &&
        !this.groupedCardsByRealm[realmURL]
      ) {
        realms[realmURL] = this.args.realmInfos[realmURL];
      }
    }
    return realms;
  }

  private get cardRefName() {
    if (!this.args.offerToCreate) {
      return undefined;
    }
    return (
      (
        this.args.offerToCreate?.ref as {
          module: string;
          name: string;
        }
      ).name ?? 'Card'
    );
  }

  // do not paginate if there's pre-selected card (because we scroll to it)
  private pageSize = this.args.hasPreselectedCard ? this.args.cards.length : 5;

  @action
  private handleEnterKey(card: string | NewCardArgs, event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.args.select(card, event);
    }
  }

  private showCreateCardForRealm = (realmURL: string) => {
    return !!this.args.offerToCreate && this.realm.canWrite(realmURL);
  };

  @action
  private newCardArgs(realmURL: string) {
    if (!this.args.offerToCreate) {
      throw new Error(
        `cannot create newCardArgs when there is not this.args.offerToCreate argument`,
      );
    }
    let { ref, relativeTo } = this.args.offerToCreate;
    return {
      ref,
      relativeTo: relativeTo ? relativeTo.href : undefined,
      realmURL,
    };
  }

  private newCardKey(realmURL: string) {
    return `new card for ${realmURL}`;
  }
}

function min(a: number, b: number) {
  return Math.min(a, b);
}

function deepEq(a: unknown, b: unknown) {
  return isEqual(a, b);
}
