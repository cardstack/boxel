import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import {
  contains,
  field,
  Component,
  CardDef,
  realmInfo,
  realmURL,
  type BaseDef,
} from './card-api';
import {
  AddButton,
  CardContainer,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import {
  chooseCard,
  catalogEntryRef,
  baseRealm,
  isCardInstance,
} from '@cardstack/runtime-common';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from './catalog-entry';
import StringField from './string';

class Isolated extends Component<typeof CardsGrid> {
  <template>
    <div class='cards-grid'>
      <ul class='cards' data-test-cards-grid-cards>
        {{#let
          (component @context.prerenderedCardSearchComponent)
          as |PrerenderedCardSearchComponent|
        }}
          <PrerenderedCardSearchComponent
            @query={{this.query}}
            @format='embedded'
            @realms={{this.realms}}
          >

            <:loading>
              Loading...
            </:loading>
            <:response as |cards|>
              {{#each cards as |card|}}
                <CardContainer class='card'>
                  <li
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                  >
                    {{card.component}}
                  </li>
                </CardContainer>
              {{/each}}
            </:response>
          </PrerenderedCardSearchComponent>
        {{/let}}
      </ul>

      {{#if @context.actions.createCard}}
        <div class='add-button'>
          <Tooltip @placement='left' @offset={{6}}>
            <:trigger>
              <AddButton {{on 'click' this.createNew}} />
            </:trigger>
            <:content>
              Add a new card to this collection
            </:content>
          </Tooltip>
        </div>
      {{/if}}
    </div>

    <style>
      .card {
        width: 212px;
        height: 80px;
        overflow: hidden;
        container-name: embedded-card;
        container-type: size;
      }
      .cards-grid {
        --grid-card-text-thumbnail-height: 6.25rem;
        --grid-card-label-color: var(--boxel-450);
        --grid-card-width: 11.125rem;
        --grid-card-height: 15.125rem;

        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl);
        position: relative; /* Do not change this */
      }
      .cards {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(var(--grid-card-width), 1fr)
        );
        gap: var(--boxel-sp);
        justify-items: center;
        height: 100%;
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }

      .add-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        bottom: var(--boxel-sp-xl);
        z-index: 1;
      }
      .grid-card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
      }
      .grid-card.embedded-format {
        width: 311px;
        height: 76px;
        overflow: hidden;
        cursor: pointer;
        container-name: embedded-card;
        container-type: size;
      }
      .grid-card > *,
      .grid-thumbnail-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .grid-thumbnail {
        display: flex;
        align-items: center;
        height: var(--grid-card-text-thumbnail-height);
        background-color: var(--boxel-teal);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        color: var(--boxel-light);
        padding: var(--boxel-sp-lg) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .grid-title {
        margin: 0;
        font: 500 var(--boxel-font-sm);
        text-align: center;
      }
      .grid-display-name {
        margin: 0;
        font: 500 var(--boxel-font-xs);
        text-align: center;
        color: var(--grid-card-label-color);
      }
      .grid-thumbnail + * {
        margin-top: var(--boxel-sp-lg);
      }
      .grid-title + .grid-display-name {
        margin-top: 0.2em;
      }
    </style>
  </template>

  get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get query() {
    return {
      filter: {
        not: {
          eq: {
            _cardType: 'Cards Grid',
          },
        },
      },
      // sorting by title so that we can maintain stability in
      // the ordering of the search results (server sorts results
      // by order indexed by default)
      sort: [
        {
          on: {
            module: `${baseRealm.url}card-api`,
            name: 'CardDef',
          },
          by: '_cardType',
        },
        {
          on: {
            module: `${baseRealm.url}card-api`,
            name: 'CardDef',
          },
          by: 'title',
        },
      ],
    };
  }

  @action
  createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let card = await chooseCard<CatalogEntry>({
      filter: {
        on: catalogEntryRef,
        eq: { isField: false },
      },
    });
    if (!card) {
      return;
    }

    await this.args.context?.actions?.createCard?.(card.ref, new URL(card.id), {
      realmURL: this.args.model[realmURL],
    });
  });
}

export class CardsGrid extends CardDef {
  static displayName = 'Cards Grid';
  static isolated = Isolated;
  @field realmName = contains(StringField, {
    computeVia: function (this: CardsGrid) {
      return this[realmInfo]?.name;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: CardsGrid) {
      return this.realmName;
    },
  });

  static getDisplayName(instance: BaseDef) {
    if (isCardInstance(instance)) {
      return (instance as CardDef)[realmInfo]?.name ?? this.displayName;
    }
    return this.displayName;
  }
}
