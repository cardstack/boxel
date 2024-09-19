import { baseRealm, getCard, primitive } from '@cardstack/runtime-common';
import {
  BaseDef,
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  createFromSerialized,
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
import { restartableTask } from 'ember-concurrency';

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};
function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

class CommandResultEmbeddedView extends Component<typeof CommandResult> {
  @tracked showAllResults = false;

  @cached
  get attachedResources(): AttachedCardResource[] | undefined {
    if (!this.cardIdsToDisplay.length) {
      return undefined;
    }
    let cards = this.cardIdsToDisplay.map((id) => {
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

  get cardIdsToDisplay() {
    if (!this.args.model.cardIds?.length) {
      return [];
    }
    if (this.showAllResults) {
      return this.args.model.cardIds;
    }
    return this.args.model.cardIds?.slice(0, this.paginateSize);
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
    return 5;
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
    <div data-test-command-result class='command-result'>
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
            {{on 'click' this.openCard}}
          />
        </:actions>
      </Header>
      <div class='body'>
        <ol class='result-list'>
          {{#each this.attachedResources as |cardResource|}}
            {{#if cardResource.cardError}}
              <li data-test-card-error={{cardResource.cardError.id}}>
                Error: cannot render card
                {{cardResource.cardError.id}}:
                {{cardResource.cardError.error.message}}
              </li>
            {{else if cardResource.card}}
              <li data-test-result-card={{cardResource.card.id}}>
                {{#let (getComponent cardResource.card) as |Component|}}
                  <Component @format='atom' @displayContainer={{false}} />
                {{/let}}
              </li>
            {{/if}}
          {{/each}}
        </ol>
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
    <style scoped>
      .command-result {
        color: black;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
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
        padding: 0 var(--boxel-sp-sm) 0 var(--boxel-sp-sm);
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
      .result-list {
        padding-left: var(--boxel-sp);
        margin-block-end: 0;
      }
      .result-list li {
        margin-bottom: var(--boxel-sp-xxs);
      }
    </style>
  </template>

  @action openCard() {
    this._openCard.perform();
  }

  _openCard = restartableTask(async () => {
    let searchCardRef = {
      name: 'SearchResult',
      module: `${baseRealm.url}command-result`,
    };
    let { cardIds } = this.args.model;
    let resource = {
      attributes: {
        title: 'Search Results',
        cardIds,
      },
      meta: { adoptsFrom: searchCardRef },
    };
    try {
      let card = await createFromSerialized(
        resource,
        { data: resource },
        undefined,
      );
      this.args.context?.actions?.viewCard(card);
    } catch (e) {
      throw e;
    }
  });
}

type JSONValue = string | number | boolean | null | JSONObject | [JSONValue];

type JSONObject = { [x: string]: JSONValue };

type JSONArray = JSONValue[];

type ToolCallResultObj = JSONObject | JSONArray;

class ToolCallResult extends FieldDef {
  static [primitive]: ToolCallResultObj;
}

export class CommandResult extends FieldDef {
  @field toolCallId = contains(StringField);
  @field toolCallResults = contains(ToolCallResult);
  @field cardIds = containsMany(StringField);

  static embedded = CommandResultEmbeddedView;
}

export class SearchResult extends CardDef {
  static displayName = 'Search Result';
  @field cardIds = containsMany(StringField);
  static isolated = class Isolated extends CommandResultEmbeddedView {
    <template>
      <ol class='result-list'>
        {{#each this.attachedResources as |cardResource|}}
          {{#if cardResource.cardError}}
            <li data-test-card-error={{cardResource.cardError.id}}>
              Error: cannot render card
              {{cardResource.cardError.id}}:
              {{cardResource.cardError.error.message}}
            </li>
          {{else if cardResource.card}}
            <li data-test-result-card={{cardResource.card.id}}>
              {{#let (getComponent cardResource.card) as |Component|}}
                <Component @format='atom' @displayContainer={{true}} />
              {{/let}}
            </li>
          {{/if}}
        {{/each}}
      </ol>
    </template>
  };
}
