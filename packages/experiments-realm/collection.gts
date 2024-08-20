import BooleanField from 'https://cardstack.com/base/boolean';
import {
  CardDef,
  contains,
  field,
  linksToMany,
  Component,
  type CardContext,
  FieldDef,
  serialize,
  deserialize,
  BaseInstanceType,
  BaseDefConstructor,
  formatQuery,
  queryableValue,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import GlimmerComponent from '@glimmer/component';
import {
  chooseCard,
  catalogEntryRef,
  primitive,
  Query,
  assertQuery,
  stringifyQuery,
  parseToQuery,
  codeRefWithAbsoluteURL,
  Filter,
  getCard,
  ResolvedCodeRef,
  PrerenderedCard,
} from '@cardstack/runtime-common';

import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import {
  AddButton,
  BoxelSelect,
  Tooltip,
} from '@cardstack/boxel-ui/components';

// import { CardsGrid } from 'https://cardstack.com/base/cards-grid';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { CardsGridComponent } from './cards-grid-component';
import CodeRefField from '../base/code-ref';
import { ViewField } from './view';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import { EqFilter } from '@cardstack/runtime-common/query';

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

export class ConfigurableCardsGrid extends GlimmerComponent<{
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
  </template>

  get realms() {
    return ['http://localhost:4201/experiments/'];
  }
}

export class DropdownMenu extends GlimmerComponent<{
  Args: {
    context?: CardContext;
    query?: Query;
    model?: any;
    currentRealm?: URL;
  };
  Element: HTMLElement;
}> {
  <template>
    {{#let
      (component @context.prerenderedCardSearchComponent)
      as |PrerenderedCardSearch|
    }}
      <PrerenderedCardSearch
        @query={{this.query}}
        @format='atom'
        @realms={{this.realms}}
      >

        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          <h2>Power select</h2>
          <BoxelSelect
            @options={{cards}}
            @onChange={{this.onSelect}}
            @selected={{this.selected}}
            as |item|
          >
            <div>{{item.component}}</div>
          </BoxelSelect>
        </:response>
      </PrerenderedCardSearch>
    {{/let}}
  </template>

  @tracked selected: any = null; //state for selection

  @action onSelect(selection: any) {
    //resolve type here. selection should be pre-rendered
    // let id = selection.data.url;
    // this.selectCard.perform(id);
    this.selected = selection;
  }

  // export type BaseDefComponent = ComponentLike<{
  //   Blocks: {};
  //   Element: any;
  //   Args: {
  //     cardOrField: typeof BaseDef;
  //     fields: any;
  //     format: Format;
  //     model: any;
  //     set: Setter;
  //     fieldName: string | undefined;
  //     context?: CardContext;
  //     canEdit?: boolean;
  //   };
  // }>;

  //   export type SignatureFor<CardT extends BaseDefConstructor> = {
  //   Args: {
  //     model: PartialBaseInstanceType<CardT>;
  //     fields: FieldsTypeFor<InstanceType<CardT>>;
  //     set: Setter;
  //     fieldName: string | undefined;
  //     context?: CardContext;
  //     canEdit?: boolean;
  //   };
  // };

  private selectCard = restartableTask(async (id: string) => {
    //chosenCard
    let url = new URL(id);
    let cardResource = await getCard(url);
    await cardResource.loaded;
    let card = cardResource.card;
    //#Pattern2: Linking card
    //im not sure if this is the right way to do this
    let currentCardList = this.args.model['cardsList'] ?? [];
    if (card) {
      let newCardList = [...currentCardList, card];
      this.args.model['cardsList'] = newCardList;
    }

    // this.args.model;
    // this.args.fields;
  });

  get query() {
    let assigneeCodeRef = {
      name: 'TeamMember',
      module: 'productivity/task',
    } as ResolvedCodeRef;
    let codeRef = codeRefWithAbsoluteURL(
      assigneeCodeRef,
      this.args.currentRealm,
    );
    return {
      filter: {
        every: [
          {
            ...{
              type: codeRef,
            },
          },
          ,
        ],
      },
    };
  }

  get realms() {
    return ['http://localhost:4201/experiments/'];
  }
}

export class SortField extends FieldDef {
  // private chooseCard = restartableTask(async () => {
  //   let type = identifyCard(this.args.field.card) ?? baseCardRef;
  //   let chosenCard: CardDef | undefined = await chooseCard(
  //     { filter: { type } },
  //     {
  //       offerToCreate: { ref: type, relativeTo: undefined },
  //       createNewCard: this.cardContext?.actions?.createCard,
  //     },
  //   );
  //   if (chosenCard) {
  //     this.args.model.value = chosenCard;
  //   }
  // });
}

export class QueryField extends FieldDef {
  static [primitive]: Query;

  static [serialize](query: Query) {
    assertQuery(query);
    return stringifyQuery(query);
  }
  static async [deserialize]<T extends BaseDefConstructor>(this: T, val: any) {
    if (val === undefined || val === null) {
      return {} as BaseInstanceType<T>;
    }
    return parseToQuery(val) as BaseInstanceType<T>;
  }

  static [queryableValue](query: Query | undefined) {
    if (!query) {
      return undefined;
    }
    return stringifyQuery(query);
  }

  static [formatQuery](query: Query) {
    return stringifyQuery(query);
  }

  static edit = class Edit extends Component<typeof this> {
    get query() {
      return JSON.stringify(this.args.model, null, 2);
    }
    <template>
      {{this.query}}
    </template>
  };
}

export class BaseView extends Component<typeof QueryField> {
  <template>
    {{! Filter: }}
    {{!-- {{@model.filter}} --}}
    {{! Sort: }}
    {{!-- {{@model.name}} --}}
  </template>

  get getFilters() {
    return;
  }

  get getSorts() {
    return;
  }
}

export interface FilterWithState {
  active: boolean;
  filter: Filter;
}

type StatusOptions = 'To Do' | 'In Progress' | 'Done';

const statusOptionVals: StatusOptions = ['To Do', 'In Progress', 'Done'];

class Isolated extends Component<typeof Collection> {
  // widget = new QueryWidget();
  @tracked filters: TrackedArray<Filter> = new TrackedArray([]);

  get availableFilters() {
    return {
      assignee: this.assigneeFilter,
      status: this.statusFilter,
    };
  }

  //linksTo
  assigneeFilter(value: string) {
    return {
      eq: {
        'assignee.label': value,
      },
    };
  }

  //contains compound
  statusFilter(value: StatusOptions) {
    return {
      on: {
        ...this.codeRef,
      },
      eq: {
        'status.label': value,
      },
    } as EqFilter;
  }

  get codeRef() {
    if (!this.args.model.ref) {
      return;
    }
    // this kinda sucks
    return codeRefWithAbsoluteURL(this.args.model.ref, this.currentRealm);
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  get realms() {
    return ['http://localhost:4201/experiments/'];
  }

  get query() {
    return {
      filter: {
        every: [
          {
            ...{
              type: {
                //task type
                ...this.codeRef,
              },
            },
          },
          ,
          ...this.filters,
        ],
      },
    } as Query;
  }

  @action updateQuery() {
    this.args.model.query = { ...this.query };
  }

  @action onFilterField(value: string) {
    this.filters.push(this.assigneeFilter(value));
    this.updateQuery();
  }

  //buttons
  //should use card chooser
  @action activateAssigneeFilter(value: string) {
    this.filters.push(this.assigneeFilter(value));
    this.updateQuery();
  }

  @action activateStatusFilter(value: StatusOptions) {
    this.filters.push(this.statusFilter('To Do'));
    // this.filters.push({ eq: { 'status.label': value } });
    this.updateQuery();
  }

  @action add() {
    this.chooseCard.perform();
  }

  private chooseCard = restartableTask(async () => {
    let card = await chooseCard({
      filter: {
        on: catalogEntryRef,
        eq: { isField: false },
      },
    });
    if (!card) {
      return;
    }
  });

  get queryString() {
    return JSON.stringify(this.query, null, 2);
  }

  //opens up the modal
  // - queries other options by type
  // private chooseCard = restartableTask(async () => {});

  get materializedInstances() {
    return this.args.model.showMaterialized
      ? this.args.model.cardsList ?? []
      : [];
  }

  // not used
  // get listOfStatuses() {
  //   if (!this.args.model.ref) {
  //     return;
  //   }
  //   // this kinda sucks
  //   let codeRef = codeRefWithAbsoluteURL(
  //     this.args.model.ref,
  //     this.currentRealm,
  //   );
  //   console.log(codeRef);
  // }

  <template>
    <section>
      <@fields.ref />
      <div>
        {{this.queryString}}
      </div>
      <div class='breadcrumb'> </div>

      <main>

        <aside class='widget-panel'>
          <div>
            <h3>Filter By Field:</h3>
            <ul>
              <li>
                <button {{on 'click' this.add}}>Assignee</button>
              </li>
              <li>
                <h2>Assignee</h2>
                <DropdownMenu
                  @context={{@context}}
                  @model={{@model}}
                  @currentRealm={{this.currentRealm}}
                />
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
            {{! Search here }}
            <ConfigurableCardsGrid
              @context={{this.args.context}}
              @query={{this.query}}
            />

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

      .add-button {
        display: inline-block;
        position: sticky;
        left: 100%;
        bottom: var(--boxel-sp-xl);
        z-index: 1;
      }
    </style>
  </template>

  get fields() {
    debugger;
    return this.args.fields;
  }

  @action
  createNew() {
    //maybe create and link to cardsList
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

// collection has a few purposes
// - specifies its own query based upon a type
// - collection is needed to persist views
// - materialise cards grid query into cards so it can be shared
export class Collection extends CardDef {
  static displayName = 'Collection';
  @field ref = contains(CodeRefField);
  @field query = contains(QueryField);
  @field view = contains(ViewField); //format , table / list / grid / board
  @field showMaterialized = contains(BooleanField);
  // a collection should be able to determine its preferred embedded template root class
  // UI switcher

  // @field preferredSize
  //can use other ppls template
  //if no data, we just don't use a field
  // collection is uniform, only one template at a time

  //card maker will decide how your parent template looks
  // dont have to care about your child template

  materializeToCard() {}
  @field cardsList = linksToMany(CardDef); //materialization point

  static isolated = Isolated;
}
