import { on } from '@ember/modifier';
import { click, fillIn, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { GridContainer } from '@cardstack/boxel-ui/components';

import { baseRealm } from '@cardstack/runtime-common';

import type { SwitchSubmodeInput } from 'https://cardstack.com/base/command';

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
import { setupApplicationTest } from '../helpers/setup';
import { waitUntil } from '@ember/test-helpers';

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
      assert
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
          assert
            .dom(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"] [data-test-realm-icon-url="${card.realmIconUrl}"]`,
            )
            .exists({ count: 1 });
        }
      });
    } else {
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-message-cards]`)
        .doesNotExist();
    }
  }
}

module('Acceptance | Commands tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);
  let { simulateRemoteMessage, getRoomIds, getRoomEvents } = setupMockMatrix(
    hooks,
    {
      loggedInAs: '@testuser:staging',
      activeRealms: [baseRealm.url, testRealmURL],
    },
  );
  setupBaseRealm(hooks);

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
        runSwitchToCodeModeCommandViaAiAssistant = () => {
          let commandContext = this.args.context?.commandContext;
          if (!commandContext) {
            console.error('No command context found');
            return;
          }
          let switchSubmodeCommand = commandContext.lookupCommand<
            SwitchSubmodeInput,
            undefined
          >('switch-submode');
          commandContext.sendAiAssistantMessage({
            prompt: 'Switch to code mode',
            commands: [{ command: switchSubmodeCommand, autoExecute: true }],
          });
        };
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
          <button
            {{on 'click' this.runSwitchToCodeModeCommandViaAiAssistant}}
            data-test-switch-to-code-mode-button
          >Switch to code-mode</button>
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

  test('a command sent via sendAiAssistantMessage with autoExecute flag can be automatically executed by the bot', async function (assert) {
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
    const testCard = `${testRealmURL}Person/hassan`;

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    //Test the scenario where there is an update to the card
    await click(
      `[data-test-stack-card="${testRealmURL}index"] [data-test-cards-grid-item="${testCard}"]`,
    );
    await click('[data-test-switch-to-code-mode-button]');
    await waitUntil(() => getRoomIds().length > 0);
    let roomId = getRoomIds()[0];
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, 'org.boxel.message');
    let boxelMessageData = message.content.data;
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.ok(
      /^SwitchSubmodeCommand_/.test(toolName),
      'The function name start with SwitchSubmodeCommand_',
    );
    assert.strictEqual(
      boxelMessageData.context.tools[0].function.description,
      'Navigate the UI to another submode. Possible values for submode are "interact" and "code".',
    );
    // TODO: do we need to include `required: ['attributes'],` in the parameters object? If so, how?
    assert.deepEqual(boxelMessageData.context.tools[0].function.parameters, {
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            submode: {
              type: 'string',
            },
            title: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            thumbnailURL: {
              type: 'string',
            },
          },
        },
        relationships: {
          properties: {},
          required: [],
          type: 'object',
        },
      },
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Switching to code submode',
      msgtype: 'org.boxel.command',
      formatted_body: 'Switching to code submode',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            submode: 'code',
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await waitFor('[data-test-submode-switcher=code]');
    assert.dom('[data-test-submode-switcher=code]').exists();
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${testCard}.json`);
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await click('[data-test-open-ai-assistant]');
    assert
      .dom(
        '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
      )
      .containsText('Switch to code mode');
    assert
      .dom('[data-test-message-idx="1"][data-test-boxel-message-from="aibot"]')
      .containsText('Switching to code submode');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
  });
});
