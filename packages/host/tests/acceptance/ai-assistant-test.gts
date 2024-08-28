import { click, fillIn, waitFor } from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';

import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { GridContainer } from '@cardstack/boxel-ui/components';

import {
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';

import {
  CardDef,
  Component,
  CardsGrid,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

async function selectCardFromCatalog(cardId: string) {
  await click('[data-test-choose-card-btn]');
  await waitFor(`[data-test-select="${cardId}"]`);
  await click(`[data-test-select="${cardId}"]`);
  await click('[data-test-card-catalog-go-button]');
}

async function assertMessages(
  assert: Assert,
  messages: {
    from: string;
    message?: string;
    cards?: { id: string; title?: string; realmIconUrl?: string }[];
  }[],
) {
  assert.dom('[data-test-message-idx]').exists({ count: messages.length });
  for (let [index, { from, message, cards }] of messages.entries()) {
    assert
      .dom(
        `[data-test-message-idx="${index}"][data-test-boxel-message-from="${from}"]`,
      )
      .exists({ count: 1 });
    if (message != null) {
      assert
        .dom(`[data-test-message-idx="${index}"] .content`)
        .containsText(message);
    }
    if (cards?.length) {
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-message-cards]`)
        .exists({ count: 1 });
      await assert
        .dom(`[data-test-message-idx="${index}"] [data-test-attached-card]`)
        .exists({ count: cards.length });
      cards.map(async (card) => {
        if (card.title) {
          if (message != null && card.title.includes(message)) {
            throw new Error(
              `This is not a good test since the message '${message}' overlaps with the asserted card text '${card.title}'`,
            );
          }
          // note: attached cards are in atom format (which display the title by default)
          assert
            .dom(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"]`,
            )
            .containsText(card.title);
        }

        if (card.realmIconUrl) {
          await assert
            .dom(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"] [data-test-realm-icon-url="${card.realmIconUrl}"]`,
            )
            .exists({ count: 1 });
        }
      });
    } else {
      await assert
        .dom(`[data-test-message-idx="${index}"] [data-test-message-cards]`)
        .doesNotExist();
    }
  }
}

module('Acceptance | AI Assistant tests', function (hooks) {
  setupApplicationTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);
  setupWindowMock(hooks);
  setupMockMatrix(hooks, { loggedInAs: '@testuser:staging' });

  hooks.beforeEach(async function () {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field favoriteTreat = contains(StringField);

      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <GridContainer class='container'>
            <h2><@fields.title /></h2>
            <div>
              <div>Favorite Treat: <@fields.favoriteTreat /></div>
              <div data-test-editable-meta>
                {{#if @canEdit}}
                  <@fields.title />
                  is editable.
                {{else}}
                  <@fields.title />
                  is NOT editable.
                {{/if}}
              </div>
            </div>
          </GridContainer>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          if (!this.firstName) {
            return;
          }
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          Pet:
          <@fields.pet />
          Friends:
          <@fields.friends />
        </template>
      };
    }

    let mangoPet = new Pet({ name: 'Mango' });

    await setupAcceptanceTestRealm({
      contents: {
        'person.gts': { Person },
        'pet.gts': { Pet },
        'Pet/ringo.json': new Pet({ name: 'Ringo' }),
        'Person/hassan.json': new Person({
          firstName: 'Hassan',
          lastName: 'Abdel-Rahman',
          pet: mangoPet,
          friends: [mangoPet],
        }),
        'Pet/mango.json': mangoPet,
        'Pet/vangogh.json': new Pet({ name: 'Van Gogh' }),
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          pet: mangoPet,
          friends: [mangoPet],
        }),
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
  });

  test('attaches a card in a conversation multiple times', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await click('[data-test-open-ai-assistant]');
    const testCard = `${testRealmURL}Person/hassan`;

    for (let i = 1; i <= 3; i++) {
      await waitFor('[data-test-message-field]');
      await fillIn('[data-test-message-field]', `Message - ${i}`);
      await selectCardFromCatalog(testCard);
      await click('[data-test-send-message-btn]');
    }

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message - 2',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message - 3',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);

    //Test the scenario where there is an update to the card
    await click(
      `[data-test-stack-card="${testRealmURL}index"] [data-test-cards-grid-item="${testCard}"]`,
    );
    await waitFor(
      `[data-test-stack-card="${testCard}"] [data-test-edit-button]`,
    );

    await click(`[data-test-stack-card="${testCard}"] [data-test-edit-button]`);
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Updated Name',
    );
    await click(`[data-test-stack-card="${testCard}"] [data-test-edit-button]`);

    await fillIn('[data-test-message-field]', `Message with updated card`);
    await click('[data-test-send-message-btn]');

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message - 2',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message - 3',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message with updated card',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
    ]);
  });
});
