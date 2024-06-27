import { getCard } from '@cardstack/runtime-common';
import {
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import { cached, tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import {
  IconMinusCircle,
  IconPlus,
  IconSearch,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';
import { Button, Header, IconButton } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};

class SearchCommandResultEmbeddedView extends Component<typeof CommandResult> {
  @tracked showAllResults = false;

  @cached
  get attachedResources(): AttachedCardResource[] | undefined {
    if (!this.args.model.cardIds?.length) {
      return undefined;
    }
    let cards = this.args.model.cardIds.map((id) => {
      let card = getCard(new URL(id));
      if (!card) {
        return {
          card: undefined,
          cardError: {
            id,
            error: new Error(`cannot find card for id "${id}"`),
          },
        };
      }
      return card;
    });
    return cards;
  }

  get cardsToDisplay() {
    if (this.showAllResults) {
      return this.attachedResources;
    }
    return this.attachedResources?.slice(0, this.paginateSize);
  }

  get numberOfCards() {
    if (!this.args.model.cardIds) {
      return 0;
    }
    return this.args.model.cardIds?.length;
  }

  get leftoverCardsToShow() {
    return this.numberOfCards - this.paginateSize;
  }

  get numberOfCardsGreaterThanPaginateSize() {
    return this.numberOfCards > this.paginateSize;
  }

  get paginateSize() {
    return 3;
  }

  get toggleShowText() {
    return !this.showAllResults
      ? `Show ${this.leftoverCardsToShow} more results`
      : 'See Less';
  }

  @action toggleShow() {
    this.showAllResults = !this.showAllResults;
  }

  <template>
    <div class='result'>
      <Header
        @title='Search Results'
        @subtitle='{{this.numberOfCards}} results'
        @hasBottomBorder={{true}}
        class='header'
        data-test-comand-result-header
      >
        <:icon>
          <div class='search-icon-container'>
            <IconSearch class='search-icon' width='14.6px' height='14.6px' />
          </div>
        </:icon>
        <:actions>
          <IconButton
            @icon={{ThreeDotsHorizontal}}
            @width='20px'
            @height='20px'
            class='icon-button'
            aria-label='Options'
            data-test-more-options-button
          />
        </:actions>
      </Header>
      <div class='body'>
        {{#each this.cardsToDisplay as |cardResource i|}}
          {{#if cardResource.cardError}}
            <div
              data-test-card-error={{cardResource.cardError.id}}
              class='error'
            >
              Error: cannot render card
              {{cardResource.cardError.id}}:
              {{cardResource.cardError.error.message}}
            </div>
          {{else if cardResource.card}}
            <div data-test-result-card={{cardResource.card.id}}>
              {{i}}.
              {{cardResource.card.title}}
            </div>
          {{/if}}
        {{/each}}
        <div class='footer'>
          {{#if this.numberOfCardsGreaterThanPaginateSize}}
            <Button
              @size='small'
              class='toggle-show'
              {{on 'click' this.toggleShow}}
              data-test-toggle-show-button
            >
              {{#if this.showAllResults}}
                <IconMinusCircle
                  width='11px'
                  height='11px'
                  role='presentation'
                />
              {{else}}
                <IconPlus width='11px' height='11px' role='presentation' />
              {{/if}}

              {{this.toggleShowText}}
            </Button>
          {{/if}}

        </div>
      </div>
    </div>
    <style>
      .result {
        color: black;
        width: 100%;
        --left-padding: var(--boxel-sp-xs);
      }
      .search-icon {
        --icon-stroke-width: 3.5;
      }
      .search-icon-container {
        background-color: var(--boxel-border-color);
        display: flex;
        padding: var(--boxel-sp-xxxs);
        border-radius: var(--boxel-border-radius-sm);
      }
      .header {
        --boxel-label-color: var(--boxel-400);
        --boxel-label-font-weight: 500;
        --boxel-label-font: 500 var(--boxel-font-xs);
        --boxel-header-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs) 0
          var(--left-padding);
      }
      .body {
        display: flex;
        flex-direction: column;
        font-weight: bold;
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs) var(--boxel-sp-xxs)
          var(--boxel-sp);
        gap: var(--boxel-sp-xxxs);
      }

      .footer {
        color: var(--boxel-header-text-color);
        text-overflow: ellipsis;
      }
      .toggle-show {
        --icon-color: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
        --boxel-button-padding: 0px;
        --boxel-button-font: var(--boxel-font-xs);
        --icon-stroke-width: 2.5;
        font-weight: bold;
        color: var(--boxel-highlight);
        display: flex;
        gap: var(--boxel-sp-xxxs);
        border: none;
      }
    </style>
  </template>
}

export class CommandResult extends CardDef {
  @field intent = contains(StringField);
  @field cardIds = containsMany(StringField);
}

export class SearchCommandResult extends CommandResult {
  static embedded = SearchCommandResultEmbeddedView;
}
