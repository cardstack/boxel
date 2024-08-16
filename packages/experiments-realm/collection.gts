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
} from 'https://cardstack.com/base/card-api';

import GlimmerComponent from '@glimmer/component';
import { chooseCard, catalogEntryRef, Query } from '@cardstack/runtime-common';

import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';
// import { CardsGrid } from 'https://cardstack.com/base/cards-grid';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { QueryWidget } from './query-widget';
import { CardsGridComponent } from './cards-grid-component';

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
    query?: Query;
  };
  Element: HTMLElement;
}> {
  <template>
    {{#let
      (component @context.prerenderedCardSearchComponent)
      as |PrerenderedCardSearch|
    }}
      <PrerenderedCardSearch
        @query={{@query}}
        @format='embedded'
        @realms={{this.realms}}
      >

        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          <CardsGridComponent @instances={{cards}} />
        </:response>
      </PrerenderedCardSearch>
    {{/let}}

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
  widget = new QueryWidget();
  @action filterByAssignee() {
    // let card = this.chooseCard.perform(); // maybe dont need chooesCard bcos we r only concern with data for query not the rendered form
    this.updateQuery();
  }

  @action filterByStatus() {
    // this.chooseCard.perform();
  }

  @action updateQuery() {
    // this._query =
  }

  get query() {
    return this.widget.query;
  }

  get queryString() {
    return JSON.stringify(this.query, null, 2);
  }

  //opens up the modal
  // - queries other options by type
  // private chooseCard = restartableTask(async () => {});

  get instances() {
    return this.args.model.showMaterialized
      ? this.args.model.cardsList ?? []
      : [];
  }

  <template>
    <section>
      <div class='breadcrumb'> </div>

      <main>

        <aside class='widget-panel'>
          <div>
            <h3>Filter By:</h3>
            <ul>
              <li>
                <button {{on 'click' this.filterByAssignee}}>Assignee</button>
              </li>
              <li>
                <button {{on 'click' this.filterByStatus}}>Status</button>
              </li>
            </ul>
          </div>
          <div>
            <h3>Sort By:</h3>
            <ul>
              <li>
                asc
              </li>
              <li>
                desc
              </li>
            </ul>
          </div>
        </aside>

        <div class='collection-panel'>

          <div>
            <div class='view-control-panel'>
              <span>View Control</span>

              <div class='view-control-rightbar'>
                <div>
                  <button>Table</button>
                  <button>List</button>
                </div>
              </div>

            </div>
            <Grid @context={{this.args.context}} @query={{this.query}} />
          </div>
        </div>

        <aside class='side-panel'>RelationShip</aside>
      </main>
    </section>
    <style>
      .breadcrumb {
        padding: var(--boxel-sp);
        background-color: var(--boxel-bg-2);
      }
      main {
        display: grid;
        grid-template-columns: 1fr 4fr 1fr;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
        container-type: inline-size;
        container-name: main;
      }
      .widget-panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        border: 1px solid #dddddd;
        border-radius: 10px;
        padding: var(--boxel-sp);
      }
      .widget-panel > * + * {
        margin-top: var(--boxel-sp);
        border-top: 1px solid #dddddd;
      }
      .collection-panel {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
        border: 1px solid #dddddd;
        border-radius: 10px;
      }
      .view-control-panel {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp);
        border: 1px solid #dddddd;
        border-radius: 10px;
        padding: var(--boxel-sp);
        margin-bottom: var(--boxel-sp);
      }
      .view-control-rightbar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .side-panel {
        border: 1px solid #dddddd;
        border-radius: 10px;
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}

// - collection is needed to persist views
// - materialise cards grid query into cards so it can be shared
// - maintains query field state inside card -- clarify with chris & luke
export class Collection extends CardDef {
  static displayName = 'Collection';
  @field query = contains(StringField); //serialized
  @field showMaterialized = contains(BooleanField);
  @field view = contains(ViewField); //format , table / list / grid / board
  // a collection should be able to determine its preferred embedded template root class
  // UI switcher

  @field cardsList = linksToMany(CardDef); //materialization point

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
