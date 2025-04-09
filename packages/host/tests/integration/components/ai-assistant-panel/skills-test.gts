import { waitFor, click, fillIn, settled, skip } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  lookupLoaderService,
  getMonacoContent,
  setMonacoContent,
} from '../../../helpers';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | skills', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = lookupLoaderService().loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      // deterministic clock so that, for example, screenshots
      // have consistent content
      let clock = new Date(2024, 8, 19).getTime();
      return () => (clock += 10);
    })(),
  });

  let { getRoomEvents, getRoomState } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
    }

    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-address>
            <h3 data-test-city={{@model.city}}>
              <@fields.city />
            </h3>
            <h3 data-test-country={{@model.country}}>
              <@fields.country />
            </h3>
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field address = contains(Address);
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
          <div data-test-addresses>Address: <@fields.address /></div>
        </template>
      };
    }

    let petMango = new Pet({ name: 'Mango' });
    let petJackie = new Pet({ name: 'Jackie' });

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'address.gts': { Address },
        'person.gts': { Person },
        'Pet/mango.json': petMango,
        'Pet/jackie.json': petJackie,
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
          pet: petMango,
        }),
        'Person/burcu.json': new Person({
          firstName: 'Burcu',
          friends: [petJackie, petMango],
        }),
        'Person/mickey.json': new Person({
          firstName: 'Mickey',
        }),
        'Person/justin.json': new Person({ firstName: 'Justin' }),
        'Person/ian.json': new Person({ firstName: 'Ian' }),
        'Person/matic.json': new Person({ firstName: 'Matic' }),
        'Person/buck.json': new Person({ firstName: 'Buck' }),
        'Person/hassan.json': new Person({ firstName: 'Hassan' }),
        'search-and-open-card-command.ts': `
            import { Command } from '@cardstack/runtime-common';
            import { SearchCardsByTypeAndTitleCommand } from '@cardstack/boxel-host/commands/search-cards';
            import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
            import type { SearchCardsByTypeAndTitleInput } from 'https://cardstack.com/base/commands/search-card-result';

            export default class SearchAndOpenCardCommand extends Command<
              typeof SearchCardsByTypeAndTitleInput,
              undefined
            > {
              static displayName = 'SearchAndOpenCardCommand';
              async getInputType() {
                return new SearchCardsByTypeAndTitleCommand(
                  this.commandContext,
                ).getInputType();
              }
              protected async run(
                input: SearchCardsByTypeAndTitleInput,
              ): Promise<undefined> {
                let searchCommand = new SearchCardsByTypeAndTitleCommand(
                  this.commandContext,
                );
                let searchResult = await searchCommand.execute(input);
                if (searchResult.cardIds.length > 0) {
                  let showCardCommand = new ShowCardCommand(this.commandContext);
                  await showCardCommand.execute({
                    cardIdToShow: searchResult.cardIds[0],
                  });
                }
                return undefined;
              }
            }
        `,
        'Skill/example.json': {
          data: {
            attributes: {
              title: 'Exanple Skill',
              description: 'This skill card is for testing purposes',
              instructions: 'This is an example skill card',
              commands: [
                {
                  codeRef: {
                    name: 'default',
                    module: `${testRealmURL}search-and-open-card-command`,
                  },
                  requiresApproval: true,
                },
              ],
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/skill-card',
                name: 'SkillCard',
              },
            },
          },
        },
        '.realm.json': `{ "name": "${realmName}" }`,
      },
    });
  });

  async function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    await operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  async function openAiAssistant(): Promise<string> {
    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-settled]');
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  async function renderAiAssistantPanel(id?: string) {
    await setCardInOperatorModeState(id);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('same skill card added twice with no changes results in no-op', async function (assert) {
    const roomId = await renderAiAssistantPanel(
      `${testRealmURL}Person/fadhlan`,
    );
    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-select="http://test-realm/test/Skill/example"]');
    await click('[data-test-card-catalog-go-button]');

    const initialCardFragmentEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const initialRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Attach the skill card without changing it
    await click('[data-test-choose-card-btn]');
    await click('[data-test-select="http://test-realm/test/Skill/example"]');
    await click('[data-test-card-catalog-go-button]');
    await click(
      '[data-test-attached-card="http://test-realm/test/Person/fadhlan"] [data-test-remove-card-btn]',
    );
    await click('[data-test-send-message-btn]');

    const finalCardFragmentEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.strictEqual(
      finalCardFragmentEvents.length,
      initialCardFragmentEvents.length,
      'No new cards should attached when adding the same unchanged skill card',
    );
    assert.deepEqual(
      finalRoomStateSkillsJson,
      initialRoomStateSkillsJson,
      'room state has not changed',
    );
  });

  test('updated skill card instructions result in new event and updated room state', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-select="http://test-realm/test/Skill/example"]');
    await click('[data-test-card-catalog-go-button]');

    const initialCardFragmentEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const initialRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    await click('[data-test-edit-button]');
    await fillIn(
      '[data-test-field="instructions"] textarea',
      'Updated instructions',
    );
    await click('[data-test-edit-button]');

    // skill card will be auto-attached since it is open
    await click('[data-test-send-message-btn]');

    const finalCardFragmentEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.strictEqual(
      finalCardFragmentEvents.length,
      initialCardFragmentEvents.length + 1,
      'New card should be attached',
    );
    assert.notDeepEqual(
      finalRoomStateSkillsJson,
      initialRoomStateSkillsJson,
      'room state has changed',
    );
  });

  // CS-8380
  skip('updated command definition results in new event and updated room state', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-select="http://test-realm/test/Skill/example"]');
    await click('[data-test-card-catalog-go-button]');

    console.log(getRoomEvents(roomId));
    const initialCardFragmentEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const initialCommandDefEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
    );
    const initialRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="search-and-open-card-command.ts"]');

    let commandSrc = getMonacoContent();
    setMonacoContent(
      commandSrc.replace(
        `static displayName = 'SearchAndOpenCardCommand';`,
        `static displayName = 'SearchAndOpenCardCommand';\ndescription = 'Search for a card, and then open it in interact mode';`,
      ),
    );
    await settled();

    console.log(getRoomEvents(roomId));
    const afterCodeModeCardFragmentEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const afterCodeModeCommandDefEvents = getRoomEvents(roomId).filter(
      (e) => e.content?.msgtype === APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
    );
    const afterCodeModeRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    assert.strictEqual(
      afterCodeModeCardFragmentEvents.length,
      initialCardFragmentEvents.length + 2,
      '2 New skill cards should be attached',
    );
    assert.strictEqual(
      afterCodeModeCommandDefEvents.length,
      initialCommandDefEvents.length,
      'No new command definition events for default code mode skills',
    );

    assert.notDeepEqual(
      afterCodeModeRoomStateSkillsJson,
      initialRoomStateSkillsJson,
      'room state has changed to reference new skill card events',
    );

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');

    // The skill card will be auto-attached since it is open
    await click('[data-test-send-message-btn]');

    console.log(getRoomEvents(roomId));
    const finalEvents = getRoomEvents(roomId);
    const finalCommandDefEvents = finalEvents.filter(
      (e) => e.content?.msgtype === APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
    );
    const finalCardFragmentEvents = finalEvents.filter(
      (e) => e.content?.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE,
    );
    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    assert.strictEqual(
      finalCardFragmentEvents.length,
      afterCodeModeCardFragmentEvents.length,
      'Skill card did not change and so is not re-uploaded',
    );
    assert.strictEqual(
      finalCommandDefEvents.length,
      afterCodeModeCommandDefEvents.length + 1,
      'New command definition event should be created since command is updated',
    );

    assert.deepEqual(
      finalRoomStateSkillsJson,
      afterCodeModeRoomStateSkillsJson,
      'room state has not changed since the skill card event is unchanged',
    );
  });
});
