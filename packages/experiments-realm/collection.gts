import BooleanField from 'https://cardstack.com/base/boolean';
import {
  CardDef,
  StringField,
  contains,
  field,
  linksToMany,
  FieldDef,
  Component,
  type CardContext,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import GlimmerComponent from '@glimmer/component';
import { cn } from '@cardstack/boxel-ui/helpers';
import {
  baseRealm,
  chooseCard,
  catalogEntryRef,
  PrerenderedCard,
  CardContextName,
} from '@cardstack/runtime-common';

import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import {
  AddButton,
  CardContainer,
  Tooltip,
} from '@cardstack/boxel-ui/components';
// import { CardsGrid } from 'https://cardstack.com/base/cards-grid';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

class ViewField extends FieldDef {
  static displayName = 'Collection View';

  // .     card-chooser + ,cards-grid, table (app-card), board don't touch yet
  views = ['list', 'grid', 'table', 'board'];
}

// class QueryField extends FieldDef {
//   get serialized() {}

//   //use query field
//   // export class QueryField extends FieldDef {
//   // query component to choose is, and, or
//   // }
//   //have to pass the info of the cards field
//   //so we can use card chooser
//   // this is to build like a filter assignee in linear
//   //where we can choose from a dropdown
// }

export class Grid extends GlimmerComponent<{
  Args: {
    context?: CardContext;
  };
  Element: HTMLElement;
}> {
  <template>
    <ul class='cards' data-test-cards-grid-cards>
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
          @query={{this.query}}
          @format='embedded'
          @realms={{this.realms}}
        >

          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{!-- {{#each cards as |card|}}
              <CardContainer class='card'>
                <li
                  {{@context.cardComponentModifier
                    cardId=card.url
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                  data-test-cards-grid-item={{removeFileExtension card.url}}
                  {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                  data-cards-grid-item={{removeFileExtension card.url}}
                >
                  {{card.component}}
                </li>
              </CardContainer>
            {{/each}} --}}
            <CardsGridComponent @instances={{cards}} />
          </:response>
        </PrerenderedCardSearch>
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
    <style>
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
      .add-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        bottom: var(--boxel-sp-xl);
        z-index: 1;
      }
      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }
    </style>
  </template>

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

  get realms() {
    return ['http://localhost:4201/experiments/'];
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
      realmURL: new URL('http://localhost:4201/experiments/'), //this.args.model[realmURL],
    });
  });
}
class Isolated extends Component<typeof Collection> {
  queryResults = [];
  get instances() {
    return this.args.model.showMaterialized
      ? this.args.model.cardsList ?? []
      : this.queryResults;
  }

  <template>
    <div class='breadcrumb'> </div>

    <div>
      <div class='filter-widget'> </div>
    </div>
    <div>
      <div class='view-control-panel'>
      </div>
      <div class='cards-grid'>
        <Grid @context={{this.args.context}} />
      </div>
    </div>

    <style>
      .cards-grid {
        --grid-card-width: 11.125rem;
        --grid-card-height: 15.125rem;

        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl);
        position: relative; /* Do not change this */
      }
    </style>
  </template>
}

//each item always has a conforming UI
export class Collection extends CardDef {
  static displayName = 'Collection';
  @field query = contains(StringField); //serialized
  @field showMaterialized = contains(BooleanField);
  @field view = contains(ViewField); //format , table / list / grid / board
  // a collection should be able to determine its preferred embedded template root class
  // UI switcher

  @field cardsList = linksToMany(CardDef); //materialization point

  get _query() {
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

  // @field preferredSize
  //can use other ppls template
  //if no data, we just don't use a field
  // collection is uniform, only one template at a time

  //card maker will decide how your parent template looks
  // dont have to care about your child template

  materializeToCard() {}

  static isolated = Isolated;
}

// class View extends GlimmerComponent<{

// }>

// class GridView extends GlimmerComponent<{

// }>
// class ListView extends GlimmerComponent<{

// }>
// class TableView extends GlimmerComponent<{

// }>
// class BoardView extends GlimmerComponent<{

// }>

//only takes in pre-rendered card
export class CardsGridComponent extends GlimmerComponent<{
  Args: {
    instances: PrerenderedCard[] | [];
    context?: CardContext;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    <ul class={{cn 'cards-grid' list-format=@isListFormat}} ...attributes>
      {{! use "key" to keep the list stable between refreshes }}

      {{#each @instances key='id' as |card|}}
        <CardContainer class='card'>
          <li
            {{@context.cardComponentModifier
              cardId=card.url
              format='data'
              fieldType=undefined
              fieldName=undefined
            }}
            data-test-cards-grid-item={{removeFileExtension card.url}}
            {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
            data-cards-grid-item={{removeFileExtension card.url}}
          >
            {{card.component}}
          </li>
        </CardContainer>
      {{/each}}
    </ul>
    <style>
      .card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        overflow: hidden;
        cursor: pointer;
        container-name: embedded-card;
        container-type: size;
      }
      .cards-grid {
        --grid-card-width: 10.25rem; /* 164px */
        --grid-card-height: 14rem; /* 224px */
        list-style-type: none;
        margin: 0;
        padding: var(--cards-grid-padding, 0);
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--grid-card-width));
        grid-auto-rows: max-content;
        gap: var(--boxel-sp-xl) var(--boxel-sp-lg);
      }
      .cards-grid.list-format {
        --grid-card-width: 18.75rem; /* 300px */
        --grid-card-height: 12rem; /* 192px */
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
    </style>
  </template>

  getComponent = (card: CardDef) => card.constructor.getComponent(card);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
