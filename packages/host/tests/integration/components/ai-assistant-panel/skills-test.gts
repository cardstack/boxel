import { waitFor, click, fillIn, settled } from '@ember/test-helpers';
import { waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, skip, test } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  rri,
  skillCardRef,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  addSkillToAiAssistant,
  envSkillId,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  getMonacoContent,
  setMonacoContent,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
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
  CardsGrid,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

import type { FileDef } from '@cardstack/base/file-api';

module('Integration | ai-assistant-panel | skills', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
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

  let { getRoomState, getRoomEvents, simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
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

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'address.gts': { Address },
        'person.gts': { Person },
        'Pet/mango.json': petMango,
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
          pet: petMango,
        }),
        'search-and-open-card-command.ts': `
            import { Command } from '@cardstack/runtime-common';
            import { SearchCardsByTypeAndTitleTool } from '@cardstack/boxel-host/commands/search-cards';
            import ShowCardTool from '@cardstack/boxel-host/commands/show-card';
            import type { SearchCardsByTypeAndTitleInput } from '@cardstack/base/commands/search-card-result';

            export default class SearchAndOpenCardCommand extends Command<
              typeof SearchCardsByTypeAndTitleInput,
              undefined
            > {
              static displayName = 'SearchAndOpenCardCommand';
              static actionVerb = 'Search';
              async getInputType() {
                return new SearchCardsByTypeAndTitleTool(
                  this.toolContext,
                ).getInputType();
              }
              protected async run(
                input: SearchCardsByTitleInput,
              ): Promise<undefined> {
                let searchCommand = new SearchCardsByTypeAndTitleTool(
                  this.toolContext,
                );
                let searchResult = await searchCommand.execute(input);
                if (searchResult.cardIds.length > 0) {
                  let showCardCommand = new ShowCardTool(this.toolContext);
                  await showCardCommand.execute({
                    cardId: searchResult.cardIds[0],
                  });
                }
                return undefined;
              }
            }
        `,
        'placeholder-command.ts': `
            import { Command } from '@cardstack/runtime-common';

            export default class PlaceholderCommand extends Command<undefined, undefined> {
              static displayName = 'PlaceholderCommand';
              static actionVerb = 'Placeholder';
              async getInputType() {
                return undefined;
              }
              protected async run(): Promise<undefined> {
                return undefined;
              }
            }
        `,
        'Skill/example.json': {
          data: {
            attributes: {
              cardTitle: 'Exanple Skill',
              cardDescription: 'This skill card is for testing purposes',
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
              adoptsFrom: skillCardRef,
            },
          },
        },
        'Skill/example2.json': {
          data: {
            attributes: {
              cardTitle: 'Exanple 2 Skill',
              cardDescription: 'This skill card is also for testing purposes',
              instructions: 'This is a second example skill card',
              commands: [
                {
                  codeRef: {
                    name: 'default',
                    module: `${testRealmURL}search-and-open-card-command`,
                  },
                  requiresApproval: true,
                },
                {
                  codeRef: {
                    name: 'default',
                    module: `${testRealmURL}placeholder-command`,
                  },
                  requiresApproval: true,
                },
              ],
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
        // A skill expressed as a markdown file (`boxel.kind: skill`), at the
        // realm root so it appears directly in the file chooser's tree.
        'realm-sync-skill.md': `---
name: Realm Sync Skill
description: A skill expressed as a markdown file
boxel:
  kind: skill
  commands:
    - codeRef:
        module: '${testRealmURL}placeholder-command'
        name: default
      requiresApproval: false
---
# Realm Sync Skill

Instructions live in the markdown body.
`,
        'hello.txt': 'Hello, world!',
        'index.json': new CardsGrid(),
        'realm.json': realmConfigCardJSON({ name: realmName }),
      },
    });
  });

  async function renderAiAssistantPanel(id?: string) {
    operatorModeStateService.restore({
      stacks: id ? [[{ id, format: 'isolated' }]] : [[]],
      aiAssistantOpen: true,
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-room-settled]');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-active-skills-count]')
          ?.textContent?.trim() === '1 Skill',
      {
        timeout: 5000,
        timeoutMessage: 'Timed out waiting for env skill to be active',
      },
    );
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  test('same skill card added twice with no changes results in no-op', async function (assert) {
    const roomId = await renderAiAssistantPanel(
      `${testRealmURL}Person/fadhlan`,
    );

    assert.dom('[data-test-active-skills-count]').containsText('1 Skill');
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    assert.dom('[data-test-skill-menu]').containsText('Skills: 1 of 1 active');
    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);
    await waitUntil(() =>
      document
        .querySelector('[data-test-skill-menu]')
        ?.textContent?.includes('Skills: 2 of 2 active'),
    );
    assert.dom('[data-test-skill-menu]').containsText('Skills: 2 of 2 active');

    const initialRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Attach the skill card without changing it
    await click('[data-test-attach-button]');
    await click('[data-test-attach-card-btn]');
    await click(
      '[data-test-item-button="http://test-realm/test/Skill/example"]',
    );
    await click('[data-test-card-chooser-go-button]');
    await click(
      '[data-test-attached-card="http://test-realm/test/Person/fadhlan"] [data-test-remove-card-btn]',
    );
    await click('[data-test-send-message-btn]');

    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.deepEqual(
      finalRoomStateSkillsJson.enabledSkillCards.map((c: any) => c.sourceUrl),
      initialRoomStateSkillsJson.enabledSkillCards.map((c: any) => c.sourceUrl),
      'enabled skill cards have not changed',
    );
    assert.deepEqual(
      finalRoomStateSkillsJson.disabledSkillCards,
      initialRoomStateSkillsJson.disabledSkillCards,
      'disabled skill cards have not changed',
    );
    assert.deepEqual(
      finalRoomStateSkillsJson.toolDefinitions.map((c: any) => c.sourceUrl),
      initialRoomStateSkillsJson.toolDefinitions.map((c: any) => c.sourceUrl),
      'command definitions have not changed',
    );
  });

  test('skill picker can add a skill through the UI', async function (assert) {
    const roomId = await renderAiAssistantPanel();
    let skillId = `${testRealmURL}Skill/example`;

    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await waitFor(`[data-test-item-button="${skillId}"]`);
    await click(`[data-test-item-button="${skillId}"]`);
    await click('[data-test-card-chooser-go-button]');

    await waitUntil(
      () =>
        Boolean(
          getRoomState(
            roomId,
            APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
          )?.enabledSkillCards?.some((card: any) => card.sourceUrl === skillId),
        ),
      {
        timeout: 5000,
        timeoutMessage: `timed out waiting for ${skillId} to be enabled`,
      },
    );
    await click('[data-test-skill-menu]');
    assert
      .dom(`[data-test-skill-options-button="${skillId}"]`)
      .exists('selected skill is shown in the skill menu');
    assert.dom('[data-test-skill-menu]').containsText('Skills: 2 of 2 active');
  });

  test('skill picker can add a skill markdown file through the single mixed chooser', async function (assert) {
    const roomId = await renderAiAssistantPanel();
    let skillId = `${testRealmURL}realm-sync-skill.md`;

    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    // A skill markdown file surfaces as a result tile in the same mixed chooser
    // as skill cards; picking it routes to the markdown-attach path by kind.
    await waitFor(`[data-test-item-button="${skillId}"]`);
    await click(`[data-test-item-button="${skillId}"]`);
    await click('[data-test-card-chooser-go-button]');

    await waitUntil(
      () =>
        Boolean(
          getRoomState(
            roomId,
            APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
          )?.enabledSkillCards?.some((card: any) => card.sourceUrl === skillId),
        ),
      {
        timeout: 5000,
        timeoutMessage: `timed out waiting for ${skillId} to be enabled`,
      },
    );

    let skillsState = getRoomState(roomId, APP_BOXEL_ROOM_SKILLS_EVENT_TYPE);
    assert.ok(
      skillsState.toolDefinitions?.some((c: any) =>
        c.sourceUrl?.includes('placeholder-command'),
      ),
      "the markdown skill's frontmatter command is uploaded as a command definition",
    );

    await click('[data-test-skill-menu]');
    assert
      .dom(`[data-test-skill-toggle="${skillId}-on"]`)
      .exists('the attached skill markdown is enabled in the menu');
    assert
      .dom('[data-test-skill-menu]')
      .containsText(
        'Realm Sync Skill',
        'the pill is titled from the markdown frontmatter name',
      );
  });

  test('the separate skill-file button is retired in favor of the single mixed chooser', async function (assert) {
    await renderAiAssistantPanel();

    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    assert
      .dom('[data-test-skill-menu] [data-test-pill-menu-add-button]')
      .exists('a single add button remains');
    assert
      .dom('[data-test-skill-menu] [data-test-pill-menu-add-markdown-button]')
      .doesNotExist(
        'the second, file-tree skill button is gone — one chooser handles both kinds',
      );
  });

  test('canceling the skill chooser re-enables the add button', async function (assert) {
    await renderAiAssistantPanel();

    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    await waitFor('[data-test-card-chooser-modal]');
    await click('[data-test-card-chooser-cancel-button]');

    // Canceling settles the chooser promise, so the trigger button returns to
    // its enabled state. A chooser that left its deferred unsettled would hang
    // the attach task and leave this button stuck disabled.
    await waitUntil(
      () => !document.querySelector('[data-test-card-chooser-modal]'),
    );
    assert
      .dom('[data-test-skill-menu] [data-test-pill-menu-add-button]')
      .isNotDisabled('the add button is re-enabled after canceling');

    // The chooser can be reopened after canceling.
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await waitFor('[data-test-card-chooser-modal]');
    assert
      .dom('[data-test-card-chooser-modal]')
      .exists('the chooser reopens after canceling');
  });

  test('skill picker excludes already-enabled skills', async function (assert) {
    await renderAiAssistantPanel();
    let enabledSkillId = `${testRealmURL}Skill/example`;
    let availableSkillId = `${testRealmURL}Skill/example2`;

    await addSkillToAiAssistant(enabledSkillId);

    if (
      !document.querySelector(
        '[data-test-skill-menu] [data-test-pill-menu-add-button]',
      )
    ) {
      await click('[data-test-skill-menu][data-test-pill-menu-button]');
    }
    await waitFor('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await fillIn('[data-test-search-field]', 'Exanple');
    await waitFor(`[data-test-item-button="${availableSkillId}"]`);

    assert
      .dom(`[data-test-item-button="${enabledSkillId}"]`)
      .doesNotExist('already-enabled skill is excluded from the picker');
    assert
      .dom(`[data-test-item-button="${availableSkillId}"]`)
      .exists('a different skill remains available in the picker');
  });

  test('skill picker excludes an already-attached markdown skill', async function (assert) {
    await renderAiAssistantPanel();
    let attachedMarkdownSkillId = `${testRealmURL}realm-sync-skill.md`;
    let availableCardSkillId = `${testRealmURL}Skill/example`;

    // The file row carries `id` in its search doc (Phase 1), so the same
    // client-built `not: { eq: { id } }` exclusion that hides an attached card
    // skill also hides an attached markdown skill from the mixed chooser.
    await addSkillToAiAssistant(attachedMarkdownSkillId);

    if (
      !document.querySelector(
        '[data-test-skill-menu] [data-test-pill-menu-add-button]',
      )
    ) {
      await click('[data-test-skill-menu][data-test-pill-menu-button]');
    }
    await waitFor('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await waitFor(`[data-test-item-button="${availableCardSkillId}"]`);

    assert
      .dom(`[data-test-item-button="${attachedMarkdownSkillId}"]`)
      .doesNotExist('the already-attached markdown skill is excluded');
    assert
      .dom(`[data-test-item-button="${availableCardSkillId}"]`)
      .exists('an unattached skill card remains available');
  });

  test('skill pill menu opens the skill card', async function (assert) {
    await renderAiAssistantPanel();

    let skillId = rri(`${testRealmURL}Skill/example`);
    await addSkillToAiAssistant(skillId);
    assert.false(
      operatorModeStateService.getOpenCardIds().includes(skillId),
      'skill card is not open before using the menu',
    );

    await click('[data-test-skill-menu]');
    await click(`[data-test-skill-options-button="${skillId}"]`);
    await waitFor('[data-test-boxel-menu-item-text="Open Skill Card"]');
    await click('[data-test-boxel-menu-item-text="Open Skill Card"]');
    await waitUntil(() =>
      operatorModeStateService.getOpenCardIds().includes(skillId),
    );

    assert.true(
      operatorModeStateService.getOpenCardIds().includes(skillId),
      'skill card is opened in operator mode',
    );
  });

  test('skill pill menu opens the skill markdown file', async function (assert) {
    await renderAiAssistantPanel();

    let skillId = `${testRealmURL}realm-sync-skill.md`;
    await addSkillToAiAssistant(skillId);

    assert
      .dom(`[data-test-stack-card="${skillId}"]`)
      .doesNotExist('skill file is not open before using the menu');

    await click('[data-test-skill-menu]');
    await click(`[data-test-skill-options-button="${skillId}"]`);
    await waitFor('[data-test-boxel-menu-item-text="Open Skill File"]');
    await click('[data-test-boxel-menu-item-text="Open Skill File"]');

    await waitFor(`[data-test-stack-card="${skillId}"]`);
    assert
      .dom(`[data-test-stack-card="${skillId}"]`)
      .exists('skill markdown file is opened as a stack item');
  });

  test('skill pill menu opens the skill card while in code mode', async function (assert) {
    await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    let skillId = `${testRealmURL}Skill/example`;
    await addSkillToAiAssistant(skillId);

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await click('[data-test-skill-menu]');
    let initialCodePath = operatorModeStateService.codePathString;

    await click(`[data-test-skill-options-button="${skillId}"]`);
    await waitFor('[data-test-boxel-menu-item-text="Open Skill Card"]');
    await click('[data-test-boxel-menu-item-text="Open Skill Card"]');

    await waitUntil(
      () =>
        operatorModeStateService.codePathString &&
        operatorModeStateService.codePathString !== initialCodePath &&
        operatorModeStateService.codePathString.includes('skill'),
      { timeoutMessage: 'timed out waiting for code mode to open skill card' },
    );

    assert.ok(
      operatorModeStateService.codePathString?.includes('skill'),
      'skill definition is opened in code mode',
    );
  });

  test('ensures command definitions are reuploaded only when content changes (different rooms)', async function (assert) {
    // Create and set up first room
    const roomId1 = await renderAiAssistantPanel(
      `${testRealmURL}Skill/example`,
    );
    const skillId = `${testRealmURL}Skill/example`;
    await addSkillToAiAssistant(skillId);
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Upload the skill cards and command definitions',
    );
    await click('[data-test-send-message-btn]');

    const room1StateSkillsJson = getRoomState(
      roomId1,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Create and set up second room
    await click('[data-test-create-room-btn]');
    await waitFor('[data-test-room-settled]');
    const roomId2 = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId2) {
      throw new Error('Expected a room ID');
    }

    // Add the same skill card without changes
    await addSkillToAiAssistant(skillId);
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Use the previous command definition',
    );
    await click('[data-test-send-message-btn]');

    const room2StateSkillsJson = getRoomState(
      roomId2,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Verify both rooms have command definitions
    assert.ok(
      room1StateSkillsJson.toolDefinitions?.length > 0,
      'first room has command definitions',
    );
    assert.ok(
      room2StateSkillsJson.toolDefinitions?.length > 0,
      'second room has command definitions',
    );

    // Verify the command definitions are the same between rooms when content hasn't changed
    assert.deepEqual(
      room1StateSkillsJson.toolDefinitions,
      room2StateSkillsJson.toolDefinitions,
      "command definitions are the same between rooms when content hasn't changed",
    );

    // Now modify the command content
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

    // Create a third room after modifying the command
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await click('[data-test-create-room-btn]');
    await waitFor('[data-test-room-settled]');
    const roomId3 = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId3) {
      throw new Error('Expected a room ID');
    }

    // Add the skill card with modified command
    await addSkillToAiAssistant(skillId);
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Change the command',
    );
    await click('[data-test-send-message-btn]');

    const room3StateSkillsJson = getRoomState(
      roomId3,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Verify the command definitions are different after content change
    assert.notDeepEqual(
      room2StateSkillsJson.toolDefinitions,
      room3StateSkillsJson.toolDefinitions,
      'command definitions are different after content change',
    );

    // Verify the command definitions have different URLs after content change
    const room2CommandUrls = room2StateSkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.url,
    );
    const room3CommandUrls = room3StateSkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.url,
    );
    const room2CommandSourceUrls = room2StateSkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.sourceUrl,
    );
    const room3CommandSourceUrls = room3StateSkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.sourceUrl,
    );
    const room2CommandHashes = room2StateSkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.contentHash,
    );
    const room3CommandHashes = room3StateSkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.contentHash,
    );
    assert.notDeepEqual(
      room2CommandUrls,
      room3CommandUrls,
      'command definition URLs are different after content change',
    );
    assert.deepEqual(
      room2CommandSourceUrls,
      room3CommandSourceUrls,
      'command definition source URLs are the same between rooms',
    );
    assert.notDeepEqual(
      room2CommandHashes,
      room3CommandHashes,
      'command definition hashes are different after content change',
    );
  });

  // TODO: restore in CS-9085
  skip('ensures command definitions are reuploaded only when content changes (same room)', async function (assert) {
    // Create and set up first room
    const roomId1 = await renderAiAssistantPanel(
      `${testRealmURL}Skill/example`,
    );

    await waitFor('[data-test-room-settled]');
    assert.dom('[data-test-active-skills-count]').containsText('1 Skill');
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    assert.dom('[data-test-skill-menu]').containsText('Skills: 1 of 1 active');
    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Upload the skill cards and command definitions',
    );
    await click('[data-test-send-message-btn]');

    const room1State1SkillsJson = getRoomState(
      roomId1,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Now modify the command content
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

    // Create a third room after modifying the command
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'Hey, I updated the command',
    );
    let room1EventsCount = getRoomEvents(roomId1).length;
    await click('[data-test-send-message-btn]');
    await waitUntil(() => getRoomEvents(roomId1).length > room1EventsCount, {
      timeoutMessage: 'timed out waiting for room events to increase',
    });

    const room1State2SkillsJson = getRoomState(
      roomId1,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    // Verify the command definitions are different after content change
    assert.notDeepEqual(
      room1State1SkillsJson.toolDefinitions,
      room1State2SkillsJson.toolDefinitions,
      'command definitions are different after content change',
    );

    // Verify the command definitions have different URLs after content change
    const room1State1CommandUrls = room1State1SkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.url,
    );
    const room1State2CommandUrls = room1State2SkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.url,
    );
    const room1State1CommandSourceUrls =
      room1State1SkillsJson.toolDefinitions.map((cmd: any) => cmd.sourceUrl);
    const room1State2CommandSourceUrls =
      room1State2SkillsJson.toolDefinitions.map((cmd: any) => cmd.sourceUrl);
    const room1State1CommandHashes = room1State1SkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.contentHash,
    );
    const room1State2CommandHashes = room1State2SkillsJson.toolDefinitions.map(
      (cmd: any) => cmd.contentHash,
    );
    assert.notDeepEqual(
      room1State1CommandUrls,
      room1State2CommandUrls,
      'command definition URLs are different after content change',
    );
    assert.deepEqual(
      room1State1CommandSourceUrls,
      room1State2CommandSourceUrls,
      'command definition source URLs are the same between rooms',
    );
    assert.notDeepEqual(
      room1State1CommandHashes,
      room1State2CommandHashes,
      'command definition hashes are different after content change',
    );
  });

  test('updated skill card instructions result in new event and updated room state when sending message', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);

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
    await click('[data-test-close-button]');

    // skill card will be auto-attached since it is open
    await fillIn(
      '[data-test-boxel-input-id="ai-chat-input"]',
      'This message should trigger uploading the updated',
    );
    await click('[data-test-send-message-btn]');

    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.notDeepEqual(
      finalRoomStateSkillsJson,
      initialRoomStateSkillsJson,
      'room state has changed',
    );
    // Don't assert contentHash/url for the unchanged skill card — these
    // can change due to async linksTo relationship loading producing
    // different serialization. sourceUrl is the stable identifier.
    assert.strictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find(
        (c: FileDef) => c.sourceUrl === envSkillId,
      ).sourceUrl,
      initialRoomStateSkillsJson.enabledSkillCards.find(
        (c: FileDef) => c.sourceUrl === envSkillId,
      ).sourceUrl,
      'unchanged skill card is still present',
    );

    assert.notStrictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).contentHash,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).contentHash,
      'skill card instructions have changed',
    );
    assert.notStrictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).url,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).url,
      'skill card instructions have changed',
    );
    assert.strictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).sourceUrl,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).sourceUrl,
      'skill card source URL has not changed',
    );
  });

  test('updated skill card instructions result in new event and updated room state when command is completing', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);

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
    await click('[data-test-close-button]');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: '721c8c78-d8c1-4cc1-a7e9-51d2d3143e4d',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: JSON.stringify({
            attributes: {
              cardDescription: 'Searching for card',
              type: {
                module: `${testRealmURL}person`,
                name: 'Person',
              },
            },
          }),
        },
      ],
    });
    await settled();
    // Click on the apply button, skill card will be updated since it has changed
    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');

    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.notDeepEqual(
      finalRoomStateSkillsJson,
      initialRoomStateSkillsJson,
      'room state has changed',
    );
    // Don't assert contentHash/url for the unchanged skill card — these
    // can change due to async linksTo relationship loading producing
    // different serialization. sourceUrl is the stable identifier.
    assert.strictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find(
        (c: FileDef) => c.sourceUrl === envSkillId,
      ).sourceUrl,
      initialRoomStateSkillsJson.enabledSkillCards.find(
        (c: FileDef) => c.sourceUrl === envSkillId,
      ).sourceUrl,
      'unchanged skill card is still present',
    );

    assert.notStrictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).contentHash,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).contentHash,
      'skill card instructions have changed',
    );
    assert.notStrictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).url,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).url,
      'skill card instructions have changed',
    );
    assert.strictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).sourceUrl,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).sourceUrl,
      'skill card source URL has not changed',
    );
  });

  test('updated skill card instructions result in new event and updated room state when code patch is completing', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);

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
    await click('[data-test-close-button]');

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\``;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await settled();
    // Click on the apply button, skill card will be updated since it has changed
    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');

    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.notDeepEqual(
      finalRoomStateSkillsJson,
      initialRoomStateSkillsJson,
      'room state has changed',
    );
    // Don't assert contentHash/url for the unchanged skill card — these
    // can change due to async linksTo relationship loading producing
    // different serialization. sourceUrl is the stable identifier.
    assert.strictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find(
        (c: FileDef) => c.sourceUrl === envSkillId,
      ).sourceUrl,
      initialRoomStateSkillsJson.enabledSkillCards.find(
        (c: FileDef) => c.sourceUrl === envSkillId,
      ).sourceUrl,
      'unchanged skill card is still present',
    );

    assert.notStrictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).contentHash,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).contentHash,
      'skill card instructions have changed',
    );
    assert.notStrictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).url,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).url,
      'skill card instructions have changed',
    );
    assert.strictEqual(
      finalRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).sourceUrl,
      initialRoomStateSkillsJson.enabledSkillCards.find((c: FileDef) =>
        c.sourceUrl.endsWith('example'),
      ).sourceUrl,
      'skill card source URL has not changed',
    );
  });

  test('updated command definition results in new event and updated room state', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);

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

    const afterCodeModeRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
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
    await waitFor('[data-test-message-idx]');

    let expectedCommandDefinitionCount =
      afterCodeModeRoomStateSkillsJson.toolDefinitions?.length ?? 0;

    await waitUntil(
      () => {
        let skillsState = getRoomState(
          roomId,
          APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
        );
        let currentLength = skillsState?.toolDefinitions?.length ?? 0;
        return currentLength === expectedCommandDefinitionCount;
      },
      {
        timeoutMessage:
          'timed out waiting for command definitions to settle to expected count',
      },
    );

    // The count is unchanged by an in-place definition update, so also wait
    // for the definitions content itself to change before comparing.
    await waitUntil(
      () => {
        let skillsState = getRoomState(
          roomId,
          APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
        );
        return (
          JSON.stringify(skillsState?.toolDefinitions) !==
          JSON.stringify(afterCodeModeRoomStateSkillsJson.toolDefinitions)
        );
      },
      {
        timeoutMessage:
          'timed out waiting for command definitions content to update',
      },
    );

    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    if (
      (finalRoomStateSkillsJson.toolDefinitions?.length ?? 0) !==
      expectedCommandDefinitionCount
    ) {
      console.log(
        `command definition count mismatch: afterCodeModeRoomStateSkills:\n${JSON.stringify(
          afterCodeModeRoomStateSkillsJson,
          null,
          2,
        )}\nfinalRoomStateSkillsJson:\n${JSON.stringify(
          finalRoomStateSkillsJson,
          null,
          2,
        )}`,
      );
    }

    // Don't assert contentHash/url for skill cards — these can change due
    // to async linksTo relationship loading. Compare sourceUrls instead.
    assert.deepEqual(
      finalRoomStateSkillsJson.enabledSkillCards.map((c: any) => c.sourceUrl),
      afterCodeModeRoomStateSkillsJson.enabledSkillCards.map(
        (c: any) => c.sourceUrl,
      ),
      'enabled skill cards are the same',
    );
    assert.deepEqual(
      finalRoomStateSkillsJson.disabledSkillCards.map((c: any) => c.sourceUrl),
      afterCodeModeRoomStateSkillsJson.disabledSkillCards.map(
        (c: any) => c.sourceUrl,
      ),
      'disabled skill cards are the same',
    );
    assert.notDeepEqual(
      finalRoomStateSkillsJson.toolDefinitions,
      afterCodeModeRoomStateSkillsJson.toolDefinitions,
      'command definitions are different',
    );

    let baselineUnchangedCommandDefinitions =
      afterCodeModeRoomStateSkillsJson.toolDefinitions.filter(
        (cmd: any) =>
          cmd.sourceUrl !==
          `${testRealmURL}search-and-open-card-command/default`,
      );
    let baselineChangedCommandDefinitions =
      afterCodeModeRoomStateSkillsJson.toolDefinitions.filter(
        (cmd: any) =>
          cmd.sourceUrl ===
          `${testRealmURL}search-and-open-card-command/default`,
      );

    let finalUnchangedCommandDefinitions =
      finalRoomStateSkillsJson.toolDefinitions.filter(
        (cmd: any) =>
          cmd.sourceUrl !==
          `${testRealmURL}search-and-open-card-command/default`,
      );
    let finalChangedCommandDefinitions =
      finalRoomStateSkillsJson.toolDefinitions.filter(
        (cmd: any) =>
          cmd.sourceUrl ===
          `${testRealmURL}search-and-open-card-command/default`,
      );
    assert.deepEqual(
      finalUnchangedCommandDefinitions,
      baselineUnchangedCommandDefinitions,
      'unchanged command definitions are the same',
    );
    assert.notDeepEqual(
      finalChangedCommandDefinitions,
      baselineChangedCommandDefinitions,
      'changed command definitions are different',
    );
  });

  test('adding skill card results in new command definitions being added but not duplicated', async function (assert) {
    const roomId = await renderAiAssistantPanel(`${testRealmURL}Skill/example`);

    await addSkillToAiAssistant(`${testRealmURL}Skill/example`);
    await click('[data-test-send-message-btn]');

    const initialRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );

    assert.strictEqual(
      initialRoomStateSkillsJson.toolDefinitions.filter((cmd: any) =>
        cmd.name.includes('search-and-open-card-command'),
      ).length,
      1,
      'search-and-open-card-command is present',
    );
    assert.strictEqual(
      initialRoomStateSkillsJson.toolDefinitions.filter((cmd: any) =>
        cmd.name.includes('placeholder'),
      ).length,
      0,
      'placeholder is not present',
    );
    // Attach the second skill card
    await addSkillToAiAssistant(`${testRealmURL}Skill/example2`);
    await click('[data-test-send-message-btn]');
    const finalRoomStateSkillsJson = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
    );
    assert.strictEqual(
      finalRoomStateSkillsJson.toolDefinitions.filter((cmd: any) =>
        cmd.name.includes('search-and-open-card-command'),
      ).length,
      1,
      'search-and-open-card-command is still present',
    );
    assert.strictEqual(
      finalRoomStateSkillsJson.toolDefinitions.filter((cmd: any) =>
        cmd.name.includes('placeholder'),
      ).length,
      1,
      'placeholder is now present',
    );
  });
});
