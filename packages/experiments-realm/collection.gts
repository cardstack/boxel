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
import { restartableTask } from 'ember-concurrency';
import { AddButton, Tooltip } from '@cardstack/boxel-ui/components';

// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import { CardsGridComponent } from './cards-grid-component';
import CodeRefField from '../base/code-ref';
import { ViewField } from './view';
import { TrackedMap } from 'tracked-built-ins';
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

export interface FiltersToQuery {
  active: boolean;
  name: string;
  field: any;
  codeRef: CodeRef | undefined;
  typeName: string;
  innerName?: string;
  filterQuery?: (value: string | number | boolean | undefined) => Filter; // our query filter
  instance: any | undefined;
}

class Isolated extends Component<typeof Collection> {
  // widget = new QueryWidget();
  filters: TrackedMap<string, FiltersToQuery> = new TrackedMap();

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

  get correctFilters() {
    return this.filtersAsArray
      .filter((f) => f.active && f.instance)
      .reduce((acc: any[], filter) => {
        return [...acc, filter.instance];
      }, []);
  }

  get filtersAsArray() {
    return Array.from(this.filters.values());
  }

  get query() {
    return {
      filter: {
        every: [this.baseFilter, ...this.correctFilters],
      },
    } as Query;
  }

  @action updateQuery() {
    this.args.model.query = { ...this.query };
  }

  @action toggleActive(key: string) {
    let filter = this.filters.get(key);
    if (filter) {
      console.log('toggling active');
      filter.active = !filter.active;
      // let newFilter = { ...filter, active: !filter.active };
      this.filters.set(key, filter);
      this.updateQuery();
    }
  }

  get queryString() {
    return JSON.stringify(this.query, null, 2);
  }

  get materializedInstances() {
    return this.args.model.showMaterialized
      ? this.args.model.cardsList ?? []
      : [];
  }

  <template>
    <section>
      <button {{on 'click' this.displayQuery}}>Display Filter Component</button>
      <div class='breadcrumb'> </div>
      <div>
        <h3>Ref:</h3>
        <@fields.ref />
      </div>
      <div>
        <h3>Query:</h3>
        <h5>Query (in Component)</h5>

        {{this.queryString}}
        <h5>Query (in Card)</h5>
        <@fields.query />
      </div>

      <main>

        <aside class='widget-panel'>
          <div>
            <h3>Filter By Field:</h3>
            <ul>
              {{#each this.filtersAsArray as |filter|}}
                <div>
                  <DropdownMenu
                    @filter={{filter}}
                    @context={{@context}}
                    @model={{@model}}
                    @currentRealm={{this.currentRealm}}
                    @onSelect={{this.onSelect}}
                    @toggleActive={{this.toggleActive}}
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
  onSelect(selection: any, fieldName?: string, innerName?: string) {
    let id = selection.data.url; //card id
    if (id) {
      this.selectCard.perform(id, fieldName, innerName);
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

  getAvailableFilters(card: CardDef) {
    //get all the filters available
    return card;
  }

  // we need this bcos we need to know the field values inside of the card
  selectCard = restartableTask(
    async (id: string, fieldName?: string, innerName?: string) => {
      let cardResource = await getCard(new URL(id));
      await cardResource.loaded;
      let card = cardResource.card;
      if (card) {
        let key = `${fieldName}.${innerName}`;
        console.log('---selected card');
        console.log(key);
        debugger;
        let filter = this.filters.get(key);
        if (filter) {
          let val = card[innerName];
          filter.instance = filter.filterQuery(val);
          // let newFilter = { ...filter, instance: filter.filterQuery(val) };
          this.filters.set(key, filter);
          this.updateQuery();
        }
        console.log(this.filters.get(key));
        console.log(this.filters.get(key));

        //reason why I need to load the card is becos I need to know its values so I can create a proper filter
        // and its oso pre-rendered
        //look into my map of filters
        //iterate thru filters via fieldName
        //check if my card has a fieldValue for a filter
      }
    },
  );

  findFilter(card: CardDef) {
    return;
  }

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
          let codeRef = await identifyCard(field.card);
          let fieldFilter: FiltersToQuery = {
            name: fieldName,
            typeName: field.card.name,
            active: true,
            field,
            codeRef,
          };
          let fields2 = getFields(field.card);
          Object.entries(fields2).map(([fieldName2, field2]) => {
            if (field2.fieldType === 'contains') {
              let key = `${fieldName}.${fieldName2}`;
              fieldFilter = {
                ...fieldFilter,
                innerName: fieldName2,
                filterQuery: (value: string) => {
                  return {
                    on: {
                      ...this.codeRef,
                    },
                    eq: {
                      [key]: value,
                    },
                  };
                },
              };
              this.filters.set(key, fieldFilter);
              this.updateQuery();
            }
          });
        }
      });
    }
  });

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
