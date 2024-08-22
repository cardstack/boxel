import BooleanField from 'https://cardstack.com/base/boolean';
import {
  CardDef,
  contains,
  field,
  linksToMany,
  Component,
  type CardContext,
  realmURL,
  getFields,
  BaseDefConstructor,
  Field,
} from 'https://cardstack.com/base/card-api';

import GlimmerComponent from '@glimmer/component';
import {
  chooseCard,
  catalogEntryRef,
  Query,
  codeRefWithAbsoluteURL,
  Filter,
  getCard,
  loadCard,
  isResolvedCodeRef,
  identifyCard,
  ResolvedCodeRef,
  CodeRef,
} from '@cardstack/runtime-common';

import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { Resolved, restartableTask } from 'ember-concurrency';
import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';

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
import { DropdownMenu } from './collection-dropdown';
import { QueryField } from './collection-query';

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

type StatusOptions = 'To Do' | 'In Progress' | 'Done';

// const statusOptionVals: StatusOptions = ['To Do', 'In Progress', 'Done'];

interface FiltersToQuery {
  active: boolean;
  name: string;
  field: any;
  codeRef: CodeRef | undefined;
  filterQuery?: (
    fieldName: string,
    value: string | number | boolean | undefined,
  ) => Filter; // our query filter
}

class Isolated extends Component<typeof Collection> {
  // widget = new QueryWidget();
  @tracked filters: TrackedArray<FiltersToQuery> = new TrackedArray([]);

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

  get baseFilter() {
    return {
      ...{
        type: {
          //task type
          ...this.codeRef,
        },
      },
    };
  }

  get parsedFiltersToQuery() {
    return Array.from(this.filters).filter((f) => f.active);
  }

  get query() {
    console.log('===query====');
    console.log(this.parsedFiltersToQuery);
    let correctFilters = [];
    return {
      filter: {
        every: [this.baseFilter, ...this.parsedFiltersToQuery],
      },
    } as Query;
  }

  @action updateQuery() {
    this.args.model.query = { ...this.query };
  }

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
      <button {{on 'click' this.displayQuery}}>Display Query</button>
      <div class='breadcrumb'> </div>
      <div>
        <h3>Ref:</h3>
        <@fields.ref />
      </div>
      <div>
        <h3>Query:</h3>
        <div>
          <h5>Base Query:</h5>
          {{this.queryString}}
        </div>
        <div>
          <h5>Query:</h5>
          <@fields.query />
        </div>
      </div>

      <main>

        <aside class='widget-panel'>
          <div>
            <h3>Filter By Field:</h3>
            <ul>
              {{#each this.filters as |filter|}}
                <div>
                  <h4>{{filter.name}}</h4>
                  <DropdownMenu
                    @codeRef={{filter.codeRef}}
                    @context={{@context}}
                    @model={{@model}}
                    @currentRealm={{this.currentRealm}}
                    @onSelect={{this.onSelect}}
                  />
                </div>
              {{/each}}
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

  @action
  onSelect(selection: any, fieldName?: string) {
    let id = selection.data.url; //card id
    if (id) {
      this.selectCard.perform(id);
      //   let cardResource = await getCard(url);
      //   await cardResource.loaded;
      //   let card = cardResource.card;
      // this.loadRootCard.perform();
      // this.selectCard.perform(selection.data.url);
      // this.importCodeRef.perform();
    }
  }

  // we need something to go from codeRef -> typeof BaseDef
  @action displayQuery() {
    this.loadRootCard.perform();
  }

  // we need this bcos we need to know the field values inside of the card
  selectCard = restartableTask(async (id: string) => {
    let cardResource = await getCard(new URL(id));
    await cardResource.loaded;
    let card = cardResource.card;
    if (card) {
      //reason why I need to load the card is becos I need to know its values so I can create a proper filter
      // and its oso pre-rendered
      //look into my map of filters
      //iterate thru filters via fieldName
      //check if my card has a fieldValue for a filter
    }
  });

  loadRootCard = restartableTask(async () => {
    let codeRef = this.codeRef;
    if (codeRef && isResolvedCodeRef(codeRef)) {
      // let loader = (globalThis as any).loader;
      let card = await loadCard(codeRef, { loader: import.meta.loader }); //https://linear.app/cardstack/issue/CS-7122/fix-and-add-type-to-importmetaloader
      let fields = getFields(card); //use card-type resource
      let entries = Object.entries(fields).map(async ([fieldName, field]) => {
        if (
          field.fieldType === 'linksTo' ||
          field.fieldType === 'linksToMany'
        ) {
          debugger;
          let codeRef = await identifyCard(field.card);
          let fieldFilter: FiltersToQuery = {
            name: fieldName,
            active: true,
            field,
            codeRef,
          };
          let fields2 = getFields(field.card);
          Object.entries(fields2).map(([fieldName2, field2]) => {
            fieldFilter.filterQuery = (value: string) => {
              let key = `${fieldName}.${fieldName2}`;
              return {
                eq: {
                  [key]: value,
                },
              };
            };
          });
          console.log('====');
          console.log(fieldFilter);
          this.filters.push(fieldFilter);
        }
      });
    }
  });

  fieldToFilter(
    codeRef: ResolvedCodeRef,
    fieldName: string,
    field: Field<BaseDefConstructor>,
  ) {}
  // getCardType(this, () => cardDefinition);

  // importCodeRef = restartableTask(async () => {
  //   let codeRef = this.codeRef;
  //   if (codeRef && isResolvedCodeRef(codeRef)) {
  //     let loader: Loader = (import.meta as any).loader;
  //     let module = await loader.import(codeRef.module);
  //     let exportedCards = Object.entries(module).filter(
  //       ([_, declaration]) =>
  //         declaration &&
  //         typeof declaration === 'function' &&
  //         'isCardDef' in declaration,
  //     );
  //     console.log('===');
  //     console.log(exportedCards);
  //   }
  // });

  // selectCard = restartableTask(async (id: string) => {
  //   let url = new URL(id);
  //   let cardResource = await getCard(url);
  //   await cardResource.loaded;
  //   let card = cardResource.card;
  //   let cardConstructor = card?.constructor;
  //   if (cardConstructor) {
  //     let fields = getFields(cardConstructor);
  //   }

  //   let codeRef = this.codeRef;
  //   if (codeRef) {
  //     if (isResolvedCodeRef(codeRef)) {
  //       let cardResource = await getCard(new URL(codeRef.module));
  //       await cardResource.loaded;
  //       let cardConstructor = card?.constructor;
  //       if (cardConstructor) {
  //         let fields = getFields(cardConstructor);
  //         debugger;
  //         Object.entries(fields).map(([name, field]) => {
  //           console.log('====');
  //           console.log(name);
  //           console.log(field.fieldType);
  //         });
  //       }
  //     }

  //     // let type = await loadCard(this.codeRef);
  //   }
  // });

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
