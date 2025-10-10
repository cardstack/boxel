import { expect, test } from '@playwright/test';
import { Credentials, putEvent, registerUser } from '../docker/synapse';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
} from '../helpers/matrix-constants';

import {
  login,
  getRoomId,
  sendMessage,
  registerRealmUsers,
  getRoomEvents,
  showAllCards,
  waitUntil,
  setupUserSubscribed,
  getAgentId,
  setSkillsRedirect,
  setupPermissions,
} from '../helpers';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  startServer as startRealmServer,
  type IsolatedRealmServer,
  appURL,
} from '../helpers/isolated-realm-server';

test.describe('Commands', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  let userCred: Credentials;
  test.beforeEach(async ({ page }) => {
    await setSkillsRedirect(page);
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    userCred = await registerUser(synapse, 'user1', 'pass');
    await setupUserSubscribed('@user1:localhost', realmServer);
    await setupPermissions('@user1:localhost', `${appURL}/`, realmServer);
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await realmServer.stop();
  });

  test(`it includes the patch tool in message event when top-most card is writable and context is shared`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await showAllCards(page);
    await page
      .locator(
        `[data-test-stack-card="${appURL}/index"] [data-test-cards-grid-item="${appURL}/mango"]`,
      )
      .click();
    await expect(
      page.locator(`[data-test-stack-card="${appURL}/mango"]`),
    ).toHaveCount(1);
    await sendMessage(page, room1, 'please change this card');
    let message;
    await expect(async () => {
      message = (await getRoomEvents()).pop()!;
      expect(message?.content?.msgtype).toStrictEqual(
        APP_BOXEL_MESSAGE_MSGTYPE,
      );
    }).toPass();
    let boxelMessageData = JSON.parse(message!.content.data);

    expect(boxelMessageData.context.tools.length).toEqual(1);
    let patchCardTool = boxelMessageData.context.tools.find(
      (t: any) => t.function.name === 'patchCardInstance',
    );
    expect(patchCardTool).toMatchObject({
      type: 'function',
      function: {
        name: 'patchCardInstance',
        description:
          'Propose a patch to an existing card instance to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
        parameters: {
          type: 'object',
          properties: {
            attributes: {
              type: 'object',
              properties: {
                cardId: {
                  type: 'string',
                  const: `${appURL}/mango`,
                },
                patch: {
                  type: 'object',
                  properties: {
                    attributes: {
                      type: 'object',
                      properties: {
                        firstName: {
                          type: 'string',
                        },
                        lastName: {
                          type: 'string',
                        },
                        email: {
                          type: 'string',
                        },
                        posts: {
                          type: 'number',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ['attributes', 'description'],
        },
      },
    });
  });

  test(`it does not include patch tool in message event for an open card that is not attached`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await showAllCards(page);
    await page
      .locator(
        `[data-test-stack-card="${appURL}/index"] [data-test-cards-grid-item="${appURL}/mango"]`,
      )
      .click();
    await expect(
      page.locator(`[data-test-stack-card="${appURL}/mango"]`),
    ).toHaveCount(1);
    await page
      .locator(
        `[data-test-attached-card="${appURL}/mango"] [data-test-remove-card-btn]`,
      )
      .click();
    await sendMessage(page, room1, 'please change this card');
    let message;
    await expect(async () => {
      message = (await getRoomEvents()).pop()!;
      expect(message?.content?.msgtype).toStrictEqual(
        APP_BOXEL_MESSAGE_MSGTYPE,
      );
    }).toPass();
    let boxelMessageData = JSON.parse(message!.content.data);
    expect(boxelMessageData.context.tools).toMatchObject([]);
  });

  test(`applying a command dispatches a CommandResultEvent if command is succesful`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    let cardId = `${appURL}/hassan`;
    let content = {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      body: 'some command',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '1',
          name: 'patchCardInstance',
          arguments: {
            description: 'Patching card',
            attributes: {
              cardId,
              patch: {
                attributes: {
                  firstName: 'Dave',
                },
              },
            },
          },
        },
      ],
    };

    await showAllCards(page);
    await page
      .locator(
        `[data-test-stack-card="${appURL}/index"] [data-test-cards-grid-item="${cardId}"]`,
      )
      .click();
    await putEvent(userCred.accessToken, room1, 'm.room.message', '1', content);
    await page.locator('[data-test-command-apply]').click();
    await page.locator('[data-test-command-idle]');

    await expect(async () => {
      let events = await getRoomEvents('user1', 'pass', room1);
      let commandResultEvent = (events as any).find(
        (e: any) => e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      );
      await expect(commandResultEvent).toBeDefined();
    }).toPass();
  });

  test(`applying a search command dispatches a result event if command is succesful and result is returned`, async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    let card_id = `${appURL}/hassan`;
    let content = {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      body: 'some command',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '1',
          name: 'SearchCardsByTypeAndTitleCommand_a959',
          arguments: {
            description: 'Searching for card',
            attributes: {
              type: {
                module: `${appURL}person`,
                name: 'Person',
              },
            },
          },
        },
      ],
    };

    await showAllCards(page);
    await page
      .locator(
        `[data-test-stack-card="${appURL}/index"] [data-test-cards-grid-item="${card_id}"]`,
      )
      .click();
    await putEvent(userCred.accessToken, room1, 'm.room.message', '1', content);
    await page.locator('[data-test-command-apply]').click();
    await page.locator('[data-test-command-idle]');
    await expect(async () => {
      let events = await getRoomEvents('user1', 'pass', room1);
      let commandResultEvent = (events as any).find(
        (e: any) => e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      );
      await expect(commandResultEvent).toBeDefined();
      await expect(
        JSON.parse(commandResultEvent.content.data).card,
      ).toBeDefined();
    }).toPass();
  });

  test('an autoexecuted command does not run again when the message is re-rendered', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    await showAllCards(page);

    // create a skill card
    await page.locator('[data-test-create-new-card-button]').click();
    await page
      .locator('[data-test-select="https://cardstack.com/base/cards/skill"]')
      .click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await page
      .locator('[data-test-field="instructions"] textarea')
      .fill(
        'Here is a command you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode.',
      );
    await page
      .locator('[data-test-field="commands"] [data-test-add-new]')
      .click();
    await page
      .locator('[data-test-field="codeRef"] input')
      .fill('@cardstack/boxel-host/commands/switch-submode/default');
    await page
      .locator('[data-test-field="title"] input')
      .fill('Automatic Switch Command');
    await page.waitForSelector('[data-test-last-saved]');

    // close the Skill card
    await page.locator('[data-test-close-button]').click();

    // Add the skill card to the assistant
    await expect(
      page.locator('[data-test-skill-menu][data-test-pill-menu-button]'),
    ).toBeVisible();
    await page
      .locator('[data-test-skill-menu][data-test-pill-menu-button]')
      .click();
    await page
      .locator('[data-test-skill-menu] [data-test-pill-menu-add-button]')
      .click();
    await page
      .locator('[data-test-card-catalog-item]', {
        hasText: 'Automatic Switch Command',
      })
      .click();
    await page.locator('[data-test-card-catalog-go-button]').click();

    // fill in message field with "Switch to code mode"
    await page
      .locator('[data-test-boxel-input-id="ai-chat-input"]')
      .fill('Switch to code mode');
    await page.locator('[data-test-send-message-btn]').click();
    await page.locator('[data-test-message-idx="0"]').waitFor();

    let roomId = await getRoomId(page);
    let roomEvents = await getRoomEvents('user1', 'pass', roomId);
    let numEventsBeforeResponse = roomEvents.length;
    let agentId = getAgentId(roomEvents);
    // Note: this should really be posted by the aibot user but we can't do that easily
    // in this test, and this reproduces the bug
    await putEvent(userCred.accessToken, roomId, 'm.room.message', '1', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      body: '',
      data: JSON.stringify({
        context: {
          agentId,
        },
      }),
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '5e226a0f-4014-4e21-b051-ebbb92cabdcc',
          name: 'switch-submode_dd88',
          arguments: {
            description: 'Switching to code submode',
            attributes: {
              submode: 'code',
            },
          },
        },
      ],
    });
    await page.locator('[data-test-message-idx="1"]').waitFor();

    // Note: you don't have to click on apply button, because command on Skill
    // has requireApproval set to false
    await page.waitForSelector(
      '[data-test-message-idx="1"] [data-test-apply-state="applied"]',
    );

    await expect(
      page.locator('[data-test-message-idx="1"] [data-test-command-id]'),
    ).not.toHaveClass(/is-failed/);

    // check we're in code mode
    await page.waitForSelector('[data-test-submode-switcher=code]');
    await expect(page.locator('[data-test-submode-switcher=code]')).toHaveCount(
      1,
    );

    // verify that command result event was created correctly
    await waitUntil(
      async () =>
        (await getRoomEvents('user1', 'pass', roomId)).length >
        numEventsBeforeResponse + 2,
    );
    let message = (await getRoomEvents('user1', 'pass', roomId))
      .reverse()
      .slice(0, 5)
      .find((message) => {
        return (
          message.content.msgtype ===
          APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE
        );
      });
    expect(message).toBeDefined();
    expect(message!.content['m.relates_to']?.rel_type).toStrictEqual(
      APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    );
    expect((message!.content['m.relates_to'] as any)?.key).toStrictEqual(
      'applied',
    );
    expect((message!.content as any).commandRequestId).toStrictEqual(
      '5e226a0f-4014-4e21-b051-ebbb92cabdcc',
    );

    await page.fill('[data-test-message-field]', 'OK now switch back');
    await page.click('[data-test-send-message-btn]');

    await page.waitForSelector('[data-test-message-idx="2"]');

    // Note: this should really be posted by the aibot user but we can't do that easily
    // in this test, and this reproduces the bug
    await putEvent(userCred.accessToken, roomId, 'm.room.message', '2', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: JSON.stringify({
        context: {
          agentId,
        },
      }),
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'a8fe43a4-7bd3-40a7-8455-50e31038e3a4',
          name: 'switch-submode_dd88',
          arguments: {
            description: 'Switching to interact submode',
            attributes: {
              submode: 'interact',
            },
          },
        },
      ],
    });

    await page.waitForSelector('[data-test-message-idx="3"]');

    await page.waitForSelector(
      '[data-test-message-idx="3"] [data-test-apply-state="applied"]',
    );

    await expect(
      page.locator('[data-test-message-idx="3"] [data-test-command-id]'),
    ).not.toHaveClass(/is-failed/);

    // check we're in interact mode
    await page.waitForSelector('[data-test-submode-switcher=interact]');
    await expect(
      page.locator('[data-test-submode-switcher=interact]'),
    ).toHaveCount(1);
  });
});
