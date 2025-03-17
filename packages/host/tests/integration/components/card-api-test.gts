import { action } from '@ember/object';
import { RenderingTestContext } from '@ember/test-helpers';

import { fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { provide, consume } from 'ember-provide-consume-context';
import { module, test } from 'qunit';

import { BoxelInput } from '@cardstack/boxel-ui/components';

import { Loader, CardContextName, type Query } from '@cardstack/runtime-common';

import { getSearch } from '@cardstack/host/resources/search';
import { getCard } from '@cardstack/host/resources/card-resource';
import LoaderService from '@cardstack/host/services/loader-service';

import {
  CardDocFiles,
  lookupLoaderService,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  setupBaseRealm,
  Component,
  // realmURL,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

interface CardContextProviderSignature {
  Args: {};
  Blocks: { default: [] };
}

class CardContextProvider extends GlimmerComponent<CardContextProviderSignature> {
  @provide(CardContextName)
  get context() {
    return {
      actions: {
        getCards: (getQuery: () => Query, getRealms: () => string[]) => {
          return getSearch(this, getQuery, getRealms);
        },
      },
    };
  }
}

interface CardContext {
  actions: any;
}

interface CardContextConsumerSignature {
  Blocks: { default: [CardContext] };
}

class CardContextConsumer extends GlimmerComponent<CardContextConsumerSignature> {
  @consume(CardContextName) declare dynamicCardContext: CardContext;

  get context() {
    return {
      ...this.dynamicCardContext,
    };
  }

  <template>
    {{yield this.context}}
  </template>
}

module('Integration | card api (Usage of publicAPI actions)', function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    loaderService = lookupLoaderService();
    loader = loaderService.loader;
  });

  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupBaseRealm(hooks);

  module('getCards', function (hooks) {
    hooks.beforeEach(async function (this: RenderingTestContext) {
      class Author extends CardDef {
        static displayName = 'Author';
        @field firstName = contains(StringField);
        @field lastName = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Author) {
            return [this.firstName, this.lastName].filter(Boolean).join(' ');
          },
        });
      }

      const authorCards: CardDocFiles = {
        'jane.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Jane',
              lastName: 'Doe',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}author`,
                name: 'Author',
              },
            },
          },
        },
        'hassan.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Justin',
              lastName: 'Bieber',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}author`,
                name: 'Author',
              },
            },
          },
        },
        'justin.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Justin',
              lastName: 'T',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}author`,
                name: 'Author',
              },
            },
          },
        },
      };
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'author.gts': { Author },
          ...authorCards,
        },
      });
    });
    test(`changing query updates search resource`, async function (assert) {
      class Isolated extends Component<typeof AuthorSearch> {
        @tracked name = 'Jane';
        get query() {
          return {
            filter: {
              on: {
                module: `${testRealmURL}author`,
                name: 'Author',
              },
              eq: {
                firstName: this.name,
              },
            },
          };
        }
        get realms() {
          return [testRealmURL]; //TODO: Investigate where meta is returned. Offer a context where the symbol exists
        }
        resource = this.args.context?.actions?.getCards
          ? this.args.context.actions.getCards(
              () => this.query,
              () => this.realms,
            )
          : undefined;

        get authors() {
          return this.resource?.instances ?? [];
        }
        @action setName(name: string) {
          this.name = name;
        }
        get queryString() {
          return JSON.stringify(this.query, null, 2);
        }
        <template>
          <div data-test-author-search>
            <BoxelInput
              @value={{this.name}}
              @onInput={{this.setName}}
              @placeholder='Search for an author'
              data-test-search-input
            />
            {{#if this.resource.isLoading}}
              Loading...
            {{else}}
              <h2> Query </h2>
              {{this.queryString}}
              <h2> Search Results </h2>
              {{#each this.authors as |author|}}
                <div data-test-title>{{author.title}}</div>
              {{/each}}
            {{/if}}
          </div>
        </template>
      }
      class AuthorSearch extends CardDef {
        static displayName = 'AuthorSearch';
        static isolated = Isolated;
      }
      let card = new AuthorSearch();
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <CardContextProvider>
              <CardContextConsumer>
                {{#let (getComponent card) as |Card|}}
                  <Card />
                {{/let}}
              </CardContextConsumer>
            </CardContextProvider>
          </template>
        },
      );
      assert
        .dom('[data-test-author-search] [data-test-title]')
        .hasText('Jane Doe');
      assert
        .dom('[data-test-author-search] [data-test-title]')
        .exists({ count: 1 });
      await fillIn(
        '[data-test-author-search] [data-test-search-input]',
        'Justin',
      );
      assert
        .dom('[data-test-author-search] [data-test-title]')
        .containsText('Justin');
      assert
        .dom('[data-test-author-search] [data-test-title]')
        .exists({ count: 2 });
    });
  });

  module('getCard', function (_) {
    hooks.beforeEach(async function (this: RenderingTestContext) {
      class StringFieldWithValue extends StringField {
        static displayName = 'StringFieldWithValue';

        static edit = class Edit extends Component<
          typeof StringFieldWithValue
        > {
          <template>
            {{@model}}
            <BoxelInput @value={{@model}} @onInput={{@set}} />
          </template>
        };
      }

      class SimpleCard extends CardDef {
        static displayName = 'SimpleCard';
        @field name = contains(StringFieldWithValue);

        static edit = class Edit extends Component<typeof this> {
          <template>
            <@fields.name />
          </template>
        };
      }
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'simple-card.gts': { SimpleCard },
          'simple-card.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'Jane Doe',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}simple-card`,
                  name: 'SimpleCard',
                },
              },
            },
          },
        },
      });
    });

    test('accessing property of card in getter should not cause re-render of the component', async function (assert) {
      class SampleUsageWithGetCard extends CardDef {
        static displayName = 'SampleUsageWithGetCard';
        @field name = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: SampleUsageWithGetCard) {
            return this.name;
          },
        });

        static edit = class Edit extends Component<
          typeof SampleUsageWithGetCard
        > {
          get id() {
            return `${testRealmURL}simple-card`;
          }

          private resource = getCard(this, () => this.id);

          get card() {
            // console.log(this.resource.card?.name); //<- this will cause a re-render
            // console.log(this.isNotJaneDoe);

            console.log(this.resource?.card?.name);
            return this.resource.card;
          }

          get isNotJaneDoe() {
            return this.card?.name !== 'Jane Doe';
          }

          <template>
            {{#if this.card}}
              {{#let (getComponent this.card) as |CardComponent|}}
                <CardComponent />
              {{/let}}
            {{else}}
              <div>
                Loading...
              </div>
            {{/if}}
          </template>
        };
      }
      let card = new SampleUsageWithGetCard();
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <CardContextProvider>
              <CardContextConsumer>
                {{#let (getComponent card) as |Card|}}
                  <Card @format='edit' />
                {{/let}}
              </CardContextConsumer>
            </CardContextProvider>
          </template>
        },
      );
      await this.pauseTest();
      assert.ok(true);
    });
  });
});

function getComponent(cardOrField: any) {
  return cardOrField.constructor.getComponent(cardOrField);
}
