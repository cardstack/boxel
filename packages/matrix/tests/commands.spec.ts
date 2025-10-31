import { expect, test } from '@playwright/test';
import { putEvent } from '../docker/synapse';
import {
  getRoomId,
  sendMessage,
  createSubscribedUserAndLogin,
  getRoomEvents,
  showAllCards,
  setSkillsRedirect,
  getAgentId,
  createRealm,
  postNewCard,
} from '../helpers';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
} from '../helpers/matrix-constants';
import { appURL } from '../helpers/isolated-realm-server';

const serverIndexUrl = new URL(appURL).origin;

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

test.describe('Commands', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await setSkillsRedirect(page);
  });

  test(`it includes the patch tool in message event when top-most card is writable and context is shared`, async ({
    page,
  }) => {
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'commands-patch-tool',
      serverIndexUrl,
    );
    const realmName = uniqueRealmName('commands-patch-tool');
    await createRealm(page, realmName);
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    const cardId = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          cardInfo: {
            title: 'Patch Tool Card',
            description: 'Card for patch tool test',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });

    await page.goto(realmURL);
    let room1 = await getRoomId(page);
    await showAllCards(page);
    let realmCard = page.locator(`[data-test-cards-grid-item="${cardId}"]`);
    await realmCard.waitFor();
    await realmCard.click();
    await expect(
      page.locator(`[data-test-stack-card="${cardId}"]`),
    ).toHaveCount(1);
    await sendMessage(page, room1, 'please change this card');
    let message;
    await expect(async () => {
      message = (await getRoomEvents(username, password, room1)).pop()!;
      expect(message?.content?.msgtype).toStrictEqual(
        APP_BOXEL_MESSAGE_MSGTYPE,
      );
    }).toPass();
    let boxelMessageData = JSON.parse(message!.content.data);
    expect(boxelMessageData.context.tools.length).toBeGreaterThan(0);
    let patchCardTool = boxelMessageData.context.tools.find(
      (t: any) => t.function?.name === 'patchCardInstance',
    );
    expect(patchCardTool).toBeDefined();
    expect(
      patchCardTool?.function?.parameters?.properties?.attributes?.properties
        ?.cardId?.const,
    ).toEqual(cardId);
  });

  test(`it does not include patch tool in message event for an open card that is not attached`, async ({
    page,
  }) => {
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'commands-unattached',
      serverIndexUrl,
    );
    const realmName = uniqueRealmName('commands-unattached');
    await createRealm(page, realmName);
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    const cardId = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          cardInfo: {
            title: 'Detachable Card',
            description: 'Card for unattached patch tool test',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });

    await page.goto(realmURL);
    let room1 = await getRoomId(page);
    await showAllCards(page);
    let realmCard = page.locator(`[data-test-cards-grid-item="${cardId}"]`);
    await realmCard.waitFor();
    await realmCard.click();
    await expect(
      page.locator(`[data-test-stack-card="${cardId}"]`),
    ).toHaveCount(1);
    await page
      .locator(
        `[data-test-attached-card="${cardId}"] [data-test-remove-card-btn]`,
      )
      .click();
    await sendMessage(page, room1, 'please change this card');
    let message;
    await expect(async () => {
      message = (await getRoomEvents(username, password, room1)).pop()!;
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
    const { username, password, credentials } =
      await createSubscribedUserAndLogin(
        page,
        'commands-command-result',
        serverIndexUrl,
      );
    const realmName = uniqueRealmName('commands-command-result');
    await createRealm(page, realmName);
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    const cardId = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          cardInfo: {
            title: 'Test card title',
            description: 'Test card description',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });

    await page.goto(realmURL);
    let room1 = await getRoomId(page);
    await showAllCards(page);
    let newCard = page.locator(`[data-test-cards-grid-item="${cardId}"]`);
    await newCard.waitFor();
    await newCard.click();
    await expect(
      page.locator(`[data-test-stack-card="${cardId}"]`),
    ).toHaveCount(1);
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
                  cardInfo: {
                    title: 'Updated card title',
                  },
                },
              },
            },
          },
        },
      ],
    };

    await putEvent(
      credentials.accessToken,
      room1,
      'm.room.message',
      '1',
      content,
    );
    await page.locator('[data-test-command-apply]').click();
    await page.locator('[data-test-command-idle]');

    await expect(async () => {
      let events = await getRoomEvents(username, password, room1);
      let commandResultEvent = (events as any).find(
        (e: any) => e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      );
      await expect(commandResultEvent).toBeDefined();
    }).toPass();
  });

  test(`applying a search command dispatches a result event if command is succesful and result is returned`, async ({
    page,
  }) => {
    const { username, password, credentials } =
      await createSubscribedUserAndLogin(page, 'commands-search');
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
    let hassanCard = page.locator(`[data-test-cards-grid-item="${cardId}"]`);
    await hassanCard.waitFor();
    await hassanCard.click();
    await putEvent(
      credentials.accessToken,
      room1,
      'm.room.message',
      '1',
      content,
    );
    await page.locator('[data-test-command-apply]').click();
    await page.locator('[data-test-command-idle]');
    await expect(async () => {
      let events = await getRoomEvents(username, password, room1);
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
    const { username, password, credentials } =
      await createSubscribedUserAndLogin(
        page,
        'commands-autoexec',
        serverIndexUrl,
      );
    const realmName = uniqueRealmName('commands-autoexec');
    await createRealm(page, realmName);
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    await page.goto(realmURL);
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
    let roomEvents = await getRoomEvents(username, password, roomId);
    let numEventsBeforeResponse = roomEvents.length;
    let agentId = getAgentId(roomEvents);
    // Note: this should really be posted by the aibot user but we can't do that easily
    // in this test, and this reproduces the bug
    await putEvent(credentials.accessToken, roomId, 'm.room.message', '1', {
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
    await expect(async () => {
      let events = (await getRoomEvents(username, password, roomId)) || [];
      expect(events.length).toBeGreaterThan(numEventsBeforeResponse + 2);
    }).toPass();

    let message = (await getRoomEvents(username, password, roomId))
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
    await putEvent(credentials.accessToken, roomId, 'm.room.message', '2', {
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
