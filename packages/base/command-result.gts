import { Query, getCard } from '@cardstack/runtime-common';
import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksToMany,
  primitive,
} from './card-api';
import { CommandField } from './command';
import { cached, tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import {
  IconLink,
  IconMinusCircle,
  IconPlus,
  IconSearch,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';
import {
  BoxelDropdown,
  Button,
  Header,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};

class EmbeddedView extends Component<typeof CommandResult> {
  @tracked showAllResults = false;
  get what() {
    debugger;
    console.log(this.args.model);
    return 'hi';
  }

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
    console.log('model', this.args.model);
    if (this.args.model.cardIds === null) {
      debugger;
    }
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

  get showAllText() {
    return !this.showAllResults
      ? `Show ${this.leftoverCardsToShow} more results`
      : 'See Less';
  }

  @action showAll() {
    this.showAllResults = !this.showAllResults;
  }

  get actions() {
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => 'hi',
        icon: IconLink,
      }),
    ];
    return menuItems;
  }

  <template>
    <div class='result'>
      <Header
        @title='Search Results'
        @subtitle='{{this.numberOfCards}} results'
        @size='small'
        @hasBottomBorder={{true}}
        class='header'
        data-test-definition-header
      >
        <:icon>
          <div class='search-icon-container'>
            <IconSearch class='search-icon' width='14.6px' height='14.6px' />
          </div>
        </:icon>
        <:actions>
          <BoxelDropdown>
            <:trigger as |bindings|>
              <Tooltip @placement='top'>
                <:trigger>
                  <IconButton
                    @icon={{ThreeDotsHorizontal}}
                    @width='20px'
                    @height='20px'
                    class='icon-button'
                    aria-label='Options'
                    data-test-more-options-button
                    {{bindings}}
                  />
                </:trigger>
                <:content>
                  More Options
                </:content>
              </Tooltip>
            </:trigger>
            <:content as |dd|>
              <Menu @closeMenu={{dd.close}} @items={{this.actions}} />
            </:content>
          </BoxelDropdown>
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
              @kind='secondary-light'
              @size='small'
              class='show-all-results'
              {{on 'click' this.showAll}}
              data-test-show-all-results-button
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

              {{this.showAllText}}
            </Button>
          {{/if}}

        </div>
      </div>
    </div>
    <style>
      .result {
        color: black;
        border: 1px solid var(--boxel-border-color);
        width: 100%;
      }
      .search-icon-container {
        background-color: var(--boxel-button-border-color);
        display: flex;
        padding: var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-sm);
      }
      .header {
        --boxel-label-color: var(--boxel-400);
        --boxel-label-font-weight: 500;
        --boxel-label-font: 500 var(--boxel-font-xs);
      }
      .body {
        display: flex;
        flex-direction: column;
        font-weight: bold;
        padding: var(--boxel-sp-sm) var(--boxel-sp-sm) var(--boxel-sp-xxs)
          var(--boxel-sp-sm);
        gap: var(--boxel-sp-xxxs);
      }

      .footer {
        color: var(--boxel-header-text-color);
        text-overflow: ellipsis;
      }
      .show-all-results {
        --icon-color: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
        --boxel-button-padding: 0px;
        --boxel-button-font: var(--boxel-font-xs);
        font-weight: bold;
        color: var(--boxel-highlight);
        display: flex;
        gap: var(--boxel-sp-xxs);
        border: none;
      }
    </style>
  </template>
}

export class CommandResult extends CardDef {
  @field intent = contains(StringField);
  @field cardIds = containsMany(StringField);
  static embedded = EmbeddedView;
}
