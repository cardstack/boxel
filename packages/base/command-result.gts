import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { restartableTask } from 'ember-concurrency';
import {
  BoxelDropdown,
  Button,
  FieldContainer,
  Header,
  IconButton,
  Menu,
} from '@cardstack/boxel-ui/components';
import { eq, menuItem } from '@cardstack/boxel-ui/helpers';
import {
  ArrowLeft,
  IconMinusCircle,
  IconPlus,
  IconSearch,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';
import { getCard } from '@cardstack/runtime-common';
import {
  BaseDef,
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  type CardContext,
  type Format,
} from './card-api';

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};
function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

interface ResourceListSignature {
  resources: AttachedCardResource[];
  format: Format;
  context?: CardContext;
}

class ResourceList extends GlimmerComponent<ResourceListSignature> {
  <template>
    <ol class='result-list {{@format}}' data-test-result-list>
      {{#each @resources as |cardResource|}}
        {{#if cardResource.cardError}}
          <li
            class='result-list-item'
            data-test-card-error={{cardResource.cardError.id}}
          >
            Error: cannot render card
            {{cardResource.cardError.id}}:
            {{cardResource.cardError.error.message}}
          </li>
        {{else if cardResource.card}}
          <li
            class='result-list-item {{@format}}'
            data-test-result-card={{cardResource.card.id}}
            {{@context.cardComponentModifier
              card=cardResource.card
              format='data'
              fieldType=undefined
              fieldName=undefined
            }}
          >
            {{#let (getComponent cardResource.card) as |Component|}}
              <Component
                @format={{@format}}
                @displayContainer={{eq @format 'fitted'}}
              />
            {{/let}}
          </li>
        {{/if}}
      {{else}}
        No cards were found.
      {{/each}}
    </ol>
    <style scoped>
      .result-list {
        margin: 0;
        padding-left: var(--boxel-sp);
      }
      .result-list-item {
        margin-bottom: var(--boxel-sp-xxs);
      }
      .result-list.embedded,
      .result-list.fitted {
        --grid-card-width: 10.25rem; /* 164px */
        --grid-card-height: 14rem; /* 224px */
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--grid-card-width));
        grid-auto-rows: max-content;
        gap: var(--boxel-sp-xl) var(--boxel-sp-lg);
      }
      .result-list-item.embedded,
      .result-list-item.fitted {
        margin-bottom: 0;
        width: var(--grid-card-width);
        height: var(--grid-card-height);
      }
      .result-list-item :deep(.field-component-card.fitted-format) {
        height: 100%;
      }
    </style>
  </template>
}

class CommandResultEmbeddedView extends Component<typeof CommandResult> {
  @tracked attachedResources: AttachedCardResource[] = [];
  @tracked showAllResults = false;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this._getAttachments.perform();
  }

  private _getAttachments = restartableTask(async () => {
    try {
      if (!this.cardIdsToDisplay.length) {
        this.attachedResources = [];
      }
      let cards = await Promise.all(
        this.cardIdsToDisplay.map(async (id) => {
          let card = getCard(new URL(id));
          await card.loaded;
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
        }),
      );
      this.attachedResources = cards;
    } catch (e) {
      throw e;
    }
  });

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
        @subtitle='{{this.numberOfCards}} {{if
          (eq this.numberOfCards 1)
          "Result"
          "Results"
        }}'
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
          <BoxelDropdown>
            <:trigger as |bindings|>
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
            <:content as |dd|>
              <Menu
                class='options-menu'
                @items={{array
                  (menuItem
                    'Copy to Workspace' this.copyToWorkspace icon=ArrowLeft
                  )
                }}
                @closeMenu={{dd.close}}
              />
            </:content>
          </BoxelDropdown>
        </:actions>
      </Header>
      <div class='body'>
        <ResourceList @resources={{this.attachedResources}} @format='atom' />
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
        --boxel-label-font: 500 var(--boxel-font-xs);
        --boxel-header-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs) 0
          var(--left-padding);
      }
      .header :deep(.content) {
        gap: 0;
      }
      .icon-button {
        --icon-color: var(--boxel-dark);
      }
      .icon-button:hover {
        --icon-color: var(--boxel-highlight);
      }
      .options-menu :deep(.boxel-menu__item__content) {
        padding-right: var(--boxel-sp-xxs);
        padding-left: var(--boxel-sp-xxs);
      }
      .options-menu :deep(.check-icon) {
        display: none;
      }
      .body {
        display: flex;
        flex-direction: column;
        font-weight: 600;
        padding: var(--boxel-sp-sm);
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
        font-weight: 600;
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

  @action async copyToWorkspace() {
    let newCard = await this.args.context?.actions?.copyCard?.(
      this.args.model as CardDef,
    );
    if (!newCard) {
      console.error('Could not copy card to workspace.');
      return;
    }
    this.args.context?.actions?.viewCard(newCard);
  }
}

class CommandResultIsolated extends CommandResultEmbeddedView {
  <template>
    <section class='search-results'>
      <header>
        <h3>{{@model.title}}</h3>
        <p class='result-count'>
          {{this.numberOfCards}}
          {{if (eq this.numberOfCards 1) 'Result' 'Results'}}
        </p>
      </header>
      <div class='fields'>
        <FieldContainer
          @label='Description'
        >{{@model.description}}</FieldContainer>
        <FieldContainer @label='Filter'>
          <pre>{{@model.filterString}}</pre>
        </FieldContainer>
        <FieldContainer @label='Results'>
          <ResourceList
            @resources={{this.attachedResources}}
            @format='fitted'
            @context={{@context}}
          />
        </FieldContainer>
      </div>
    </section>
    <style scoped>
      .search-results {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
      }
      .search-results > * + * {
        margin-top: var(--boxel-sp-lg);
      }
      h3 {
        margin: 0;
        font: 600 var(--boxel-font-lg);
      }
      pre {
        margin: 0;
      }
      .result-count {
        margin: 0;
        font-weight: 500;
        color: var(--boxel-450);
      }
      .fields > * + * {
        margin-top: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

export class CommandResult extends CardDef {
  static displayName = 'Command Result';
  @field toolCallId = contains(StringField);
  @field toolCall = contains(StringField);
  @field cardIds = containsMany(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: CommandResult) {
      return this.tool?.filter ? 'Search Results' : 'Command Result';
    },
  });
  @field description = contains(StringField, {
    computeVia: function (this: CommandResult) {
      return this.tool?.description;
    },
  });

  get tool() {
    if (!this.toolCall) {
      return;
    }
    return JSON.parse(this.toolCall);
  }

  get filterString() {
    if (!this.tool.filter) {
      return;
    }
    return JSON.stringify(this.tool.filter, null, 2);
  }

  static embedded = CommandResultEmbeddedView;
  static isolated = CommandResultIsolated;
}
