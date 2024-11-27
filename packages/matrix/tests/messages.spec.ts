import { expect, test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  login,
  logout,
  createRoom,
  getRoomId,
  openRoom,
  assertMessages,
  writeMessage,
  sendMessage,
  reloadAndOpenAiAssistant,
  isInRoom,
  registerRealmUsers,
  selectCardFromCatalog,
  getRoomEvents,
  setupTwoStackItems,
  showAllCards,
  setupUserSubscribed,
} from '../helpers';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';

test.describe('Room messages', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  test.beforeEach(async () => {
    test.setTimeout(120_000);
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    realmServer = await startRealmServer();
    await setupUserSubscribed('@user1:localhost', realmServer);
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await realmServer.stop();
  });

  test(`it can send a message in a room`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await expect(page.locator('[data-test-new-session]')).toHaveCount(1);
    await expect(page.locator('[data-test-message-field]')).toHaveValue('');

    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await assertMessages(page, []);

    await page.locator('[data-test-message-field]').click();
    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await assertMessages(page, []);

    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await assertMessages(page, []);

    await writeMessage(page, room1, 'Message 1');
    await page.locator('[data-test-send-message-btn]').click();

    await expect(page.locator('[data-test-message-field]')).toHaveValue('');
    await expect(page.locator('[data-test-new-session]')).toHaveCount(0);
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await writeMessage(page, room1, 'Message 2');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Hello World!');
    await assertMessages(page, [{ from: 'user1', message: 'Message 1' }]);

    await page.keyboard.press('Enter');
    const messages = [
      { from: 'user1', message: 'Message 1' },
      { from: 'user1', message: 'Message 2\n\nHello World!' },
    ];
    await assertMessages(page, messages);

    let room2 = await createRoom(page);
    await openRoom(page, room1);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await assertMessages(page, messages);

    await logout(page);
    await login(page, 'user1', 'pass', { url: appURL });
    await openRoom(page, room1);
    await assertMessages(page, messages);

    // make sure that room state doesn't leak
    await openRoom(page, room2);
    await isInRoom(page, room2);
    await assertMessages(page, []);

    await openRoom(page, room1);
    await assertMessages(page, messages);
  });

  test(`it can load all events back to beginning of timeline for timelines that truncated`, async ({
    page,
  }) => {
    // generally the matrix server paginates after 10 messages
    const totalMessageCount = 20;

    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);

    for (let i = 1; i <= totalMessageCount; i++) {
      await sendMessage(page, room1, `message ${i}`);
    }
    await logout(page);

    await login(page, 'user1', 'pass', { url: appURL });
    await openRoom(page, room1);

    await expect(page.locator('[data-test-message-idx]')).toHaveCount(
      totalMessageCount,
    );
  });

  test(`it can send a markdown message`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, 'message with _style_');
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'message with style',
      },
    ]);
    await expect(
      page.locator(`[data-test-message-idx="0"] .content em`),
    ).toContainText('style');
  });

  test(`it can create a room specific pending message`, async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, 'Hello');
    let room2 = await createRoom(page);
    await openRoom(page, room1);

    await writeMessage(page, room1, 'room 1 message');
    await openRoom(page, room2);
    await expect(
      page.locator(`[data-test-message-field="${room2}"]`),
    ).toHaveValue('');

    await openRoom(page, room1);
    await expect(
      page.locator(`[data-test-message-field="${room1}"]`),
    ).toHaveValue('room 1 message');

    await openRoom(page, room2);
    await expect(
      page.locator(`[data-test-message-field="${room2}"]`),
    ).toHaveValue('');

    await writeMessage(page, room2, 'room 2 message');
    await openRoom(page, room1);
    await expect(
      page.locator(`[data-test-message-field="${room1}"]`),
    ).toHaveValue('room 1 message');
    await openRoom(page, room2);
    await expect(
      page.locator(`[data-test-message-field="${room2}"]`),
    ).toHaveValue('room 2 message');
  });

  test('can add a card to a markdown message', async ({ page }) => {
    const testCard = `${appURL}/hassan`;
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();

    await page.locator('[data-test-choose-card-btn]').click();
    await page
      .locator(
        `[data-test-realm="Test Workspace A"] [data-test-show-more-cards]`,
      )
      .click();
    await page.locator(`[data-test-select="${testCard}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await expect(
      page.locator(`[data-test-attached-card="${testCard}"]`),
    ).toContainText('Hassan');

    await page.locator('[data-test-message-field]').fill('This is _my_ card');
    await page.locator('[data-test-send-message-btn]').click();

    await assertMessages(page, [
      {
        from: 'user1',
        message: 'This is my card',
        cards: [
          {
            id: testCard,
            title: 'Hassan',
            realmIconUrl: 'https://boxel-images.boxel.ai/icons/cardstack.png',
          },
        ],
      },
    ]);
    await expect(
      page.locator(`[data-test-message-idx="0"] .content em`),
    ).toContainText('my');
  });

  test('can add a card that is over 65K to a message (i.e. split card into multiple matrix events)', async ({
    page,
  }) => {
    const testCard = `${appURL}/big-card`; // this is a 153KB card
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();
    await page.locator('[data-test-choose-card-btn]').click();
    await page
      .locator(
        `[data-test-realm="Test Workspace A"] [data-test-show-more-cards]`,
      )
      .click();
    await page.locator(`[data-test-select="${testCard}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await expect(
      page.locator(`[data-test-attached-card="${testCard}"]`),
    ).toContainText('Big Card');

    await page.locator('[data-test-message-field]').fill('This is a big card');
    await page.locator('[data-test-send-message-btn]').click();
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'This is a big card',
        cards: [{ id: testCard, title: 'Big Card' }],
      },
    ]);

    // peek into the matrix events and confirm there are multiple card fragments
    let messages = await getRoomEvents();
    let cardFragments = messages.filter(
      (message) =>
        message.type === 'm.room.message' &&
        message.content?.msgtype === 'org.boxel.cardFragment',
    );
    expect(cardFragments.length).toStrictEqual(4);
    let lastFragment = messages.findIndex((m) => m === cardFragments[2]);
    let boxelMessage = messages[lastFragment + 2];
    let boxelMessageData = JSON.parse(boxelMessage.content.data);
    // the card fragment events need to come before the boxel message event they
    // are used in, and the boxel message should point to the first fragment
    expect(boxelMessageData.attachedCardsEventIds).toMatchObject([
      // card fragments are posted in reverse order so we can fashion the
      // nextFragment property, so the item at index #2 is the first fragment
      cardFragments[2].event_id,
    ]);
  });

  test('it can strip out base64 image fields from cards sent in messages', async ({
    page,
  }) => {
    const testCard = `${appURL}/mango-puppy`; // this is a 153KB card
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();
    await page.locator('[data-test-choose-card-btn]').click();

    await page
      .locator(
        `[data-test-realm="Test Workspace A"] [data-test-show-more-cards]`,
      )
      .click();
    await page.locator(`[data-test-select="${testCard}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await expect(
      page.locator(`[data-test-attached-card="${testCard}"]`),
    ).toContainText('Mango the Puppy');

    await page
      .locator('[data-test-message-field]')
      .fill('This is a card without base64');
    await page.locator('[data-test-send-message-btn]').click();
    await assertMessages(page, [
      {
        from: 'user1',
        message: 'This is a card without base64',
        cards: [{ id: testCard, title: 'Mango the Puppy' }],
      },
    ]);

    let messages = await getRoomEvents();
    let message = messages[messages.length - 3];
    let messageData = JSON.parse(message.content.data);
    let serializeCard = JSON.parse(messageData.cardFragment);

    expect(serializeCard.data.attributes.name).toStrictEqual('Mango the Puppy');
    expect(serializeCard.data.attributes.picture).toBeUndefined();
  });

  test('can send only a card as a message', async ({ page }) => {
    const testCard = `${appURL}/hassan`;
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, undefined, [testCard]);
    await assertMessages(page, [
      {
        from: 'user1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);
  });

  test('can send cards with types unsupported by matrix', async ({ page }) => {
    const testCard = `${appURL}/type-examples`;
    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);

    // Send a card that contains a type that matrix doesn't support
    await sendMessage(page, room1, undefined, [testCard]);
    await assertMessages(page, [
      {
        from: 'user1',
        cards: [{ id: testCard, title: 'Type Examples' }],
      },
    ]);
  });

  test('can remove a card from a pending message', async ({ page }) => {
    const testCard = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();

    await selectCardFromCatalog(page, testCard);
    await selectCardFromCatalog(page, testCard2);
    await expect(
      page.locator(`[data-test-attached-card="${testCard}"]`),
    ).toContainText('Hassan');
    await expect(
      page.locator(`[data-test-attached-card="${testCard2}"]`),
    ).toContainText('Mango');

    await page
      .locator(
        `[data-test-attached-card="${testCard}"] [data-test-remove-card-btn]`,
      )
      .click();
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);

    await page.locator('[data-test-message-field]').fill('1 card');
    await page.locator('[data-test-send-message-btn]').click();

    await selectCardFromCatalog(page, testCard);
    await expect(
      page.locator(`[data-test-attached-card="${testCard}"]`),
    ).toContainText('Hassan');
    await page
      .locator(
        `[data-test-attached-card="${testCard}"] [data-test-remove-card-btn]`,
      )
      .click();
    await expect(
      page.locator(`[data-test-chat-input-area] [data-test-attached-card]`),
    ).toHaveCount(0);

    await page.locator('[data-test-message-field]').fill('no card');
    await page.locator('[data-test-send-message-btn]').click();

    await page.pause();

    await assertMessages(page, [
      {
        from: 'user1',
        message: '1 card',
        cards: [{ id: testCard2, title: 'Mango' }],
      },
      {
        from: 'user1',
        message: 'no card',
      },
    ]);
  });

  test('can render multiple cards in a room', async ({ page }) => {
    // the loader deadlocking issue would otherwise prevent this

    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const message1 = {
      from: 'user1',
      message: 'message 1',
      cards: [{ id: testCard1, title: 'Hassan' }],
    };
    const message2 = {
      from: 'user1',
      message: 'message 2',
      cards: [{ id: testCard2, title: 'Mango' }],
    };

    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);

    await sendMessage(page, room1, 'message 1', [testCard1]);
    await assertMessages(page, [message1]);

    await sendMessage(page, room1, 'message 2', [testCard2]);
    await assertMessages(page, [message1, message2]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await assertMessages(page, [message1, message2]);

    await logout(page);
    await login(page, 'user1', 'pass', { url: appURL });
    await openRoom(page, room1);
    await assertMessages(page, [message1, message2]);
  });

  test('can send multiple cards in a message', async ({ page }) => {
    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const message = {
      from: 'user1',
      message: 'message 1',
      cards: [
        { id: testCard1, title: 'Hassan' },
        { id: testCard2, title: 'Mango' },
      ],
    };

    await login(page, 'user1', 'pass', { url: appURL });
    let room1 = await getRoomId(page);

    await selectCardFromCatalog(page, testCard1);
    await selectCardFromCatalog(page, testCard2);
    await sendMessage(page, room1, 'message 1');
    await assertMessages(page, [message]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await assertMessages(page, [message]);

    await logout(page);
    await login(page, 'user1', 'pass', { url: appURL });
    await openRoom(page, room1);
    await assertMessages(page, [message]);
  });

  test('attached cards are not duplicated', async ({ page }) => {
    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const testCard3 = `${appURL}/type-examples`;

    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();

    await selectCardFromCatalog(page, testCard2);
    await selectCardFromCatalog(page, testCard1);
    await selectCardFromCatalog(page, testCard2);
    await selectCardFromCatalog(page, testCard3);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(3);

    await page.locator('[data-test-send-message-btn]').click();
    await assertMessages(page, [
      {
        from: 'user1',
        cards: [
          { id: testCard2, title: 'Mango' },
          { id: testCard1, title: 'Hassan' },
          { id: testCard3, title: 'Type Examples' },
        ],
      },
    ]);
  });

  test('displays view all pill if attached card more than 4', async ({
    page,
  }) => {
    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const testCard3 = `${appURL}/type-examples`;
    const testCard4 = `${appURL}/fadhlan`;
    const testCard5 = `${appURL}/van-gogh`;

    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();

    await selectCardFromCatalog(page, testCard1);
    await selectCardFromCatalog(page, testCard2);
    await selectCardFromCatalog(page, testCard3);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(3);

    await selectCardFromCatalog(page, testCard4);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(4);
    await expect(page.locator(`[data-test-view-all]`)).toHaveCount(0);

    await selectCardFromCatalog(page, testCard5);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(3);
    await expect(page.locator(`[data-test-view-all]`)).toHaveCount(1);

    await page.locator('[data-test-view-all]').click();
    await expect(page.locator(`[data-test-view-all]`)).toHaveCount(0);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(5);
  });

  test.describe('auto-attachment of cards in matrix room', () => {
    test.beforeEach(async ({ page }) => {
      await login(page, 'user1', 'pass', { url: appURL });
      await getRoomId(page);
      await showAllCards(page);
    });

    test('displays auto-attached card (1 stack)', async ({ page }) => {
      const testCard1 = `${appURL}/hassan`;
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });
    test('manually attached card is not auto-attached', async ({ page }) => {
      const testCard1 = `${appURL}/hassan`;
      await selectCardFromCatalog(page, testCard1);
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveCount(0);
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });

    test('manually attached card overwrites auto-attached card', async ({
      page,
    }) => {
      const testCard1 = `${appURL}/hassan`;
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await selectCardFromCatalog(page, testCard1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveCount(0);
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });
    test('does not auto-attach index card', async ({ page }) => {
      const indexCard = `${appURL}/index`;
      await expect(
        page.locator(`[data-test-stack-card="${indexCard}"]`),
      ).toHaveCount(1); // The index card appears by default, we verify it exists here
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(0);
    });

    test('replaces auto-attached card when drilling down (1 stack)', async ({
      page,
    }) => {
      const testCard1 = `${appURL}/jersey`;
      const embeddedCard = `${appURL}/justin`;
      await showAllCards(page);
      await expect(
        page.locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item="${testCard1}"]`,
        ),
      ).toHaveCount(1);
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item="${testCard1}"]`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await expect(
        page.locator(`[data-test-attached-card="${testCard1}"]`),
      ).toHaveCount(1);

      await page
        .locator(
          `[data-test-stack-card='${testCard1}'] [data-test-card-format="fitted"]`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await expect(
        page.locator(`[data-test-attached-card="${embeddedCard}"]`),
      ).toHaveCount(1);
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [{ id: embeddedCard, title: 'Justin T' }],
        },
      ]);
    });

    test('auto-attached card will get auto-remove when closing a stack', async ({
      page,
    }) => {
      const testCard1 = `${appURL}/hassan`;
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page
        .locator(
          `[data-test-stack-card='${testCard1}'] [data-test-close-button]`,
        )
        .click();

      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(0);
    });

    test('can manually remove auto-attached card', async ({ page }) => {
      const testCard1 = `${appURL}/hassan`;
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page
        .locator(
          `[data-test-attached-card='${testCard1}'] [data-test-remove-card-btn]`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(0);
      await expect(
        page.locator(`[data-test-stack-card='${testCard1}']`),
      ).toHaveCount(1); //card still on stack
    });

    test('re-opening previously removed auto-attached card will auto attach again', async ({
      page,
    }) => {
      const testCard1 = `${appURL}/hassan`;
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page
        .locator(
          `[data-test-attached-card='${testCard1}'] [data-test-remove-card-btn]`,
        )
        .click();
      await page
        .locator(
          `[data-test-stack-card='${testCard1}'] [data-test-close-button]`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(0);
      await page
        .locator(
          `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
        )
        .click();
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });

    test('(2 stack) displays both top cards as auto-attached ', async ({
      page,
    }) => {
      const testCard1 = `${appURL}/hassan`;
      const testCard2 = `${appURL}/mango`;
      await setupTwoStackItems(page, testCard1, testCard2);
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(2);
      await expect(
        page.locator(`[data-test-attached-card="${testCard1}"]`),
      ).toHaveCount(1);
      await expect(
        page.locator(`[data-test-attached-card="${testCard2}"]`),
      ).toHaveCount(1);
      await page.locator(`[data-test-attached-card="${testCard1}"]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page.locator(`[data-test-attached-card="${testCard2}"]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [
            { id: testCard1, title: 'Hassan' },
            { id: testCard2, title: 'Mango' },
          ],
        },
      ]);
    });

    test('(2 stack) if both top cards are the same, only one auto-attached pill', async ({
      page,
    }) => {
      const testCard1 = `${appURL}/hassan`;
      await setupTwoStackItems(page, testCard1, testCard1);
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await expect(
        page.locator(`[data-test-attached-card="${testCard1}"]`),
      ).toHaveCount(1);
      await page.locator(`[data-test-attached-card="${testCard1}"]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveText(
        'Topmost card is shared automatically',
      );
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: 'user1',
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });
  });

  test('it can send the prompts on new-session room as chat message on click', async ({
    page,
  }) => {
    const prompt = {
      from: 'user1',
      message: 'Make this more polite.', // a prompt on new-session template
      cards: [],
    };
    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();

    await expect(page.locator(`[data-test-new-session]`)).toHaveCount(1);
    await expect(page.locator(`[data-test-prompt]`)).toHaveCount(3);

    await page.locator(`[data-test-prompt="1"]`).click();
    await expect(page.locator(`[data-test-new-session]`)).toHaveCount(0);
    await assertMessages(page, [prompt]);
  });

  test('sending a prompt submits attached cards', async ({ page }) => {
    const testCard1 = `${appURL}/mango`;
    const testCard2 = `${appURL}/hassan`;

    await login(page, 'user1', 'pass', { url: appURL });
    await getRoomId(page);
    await showAllCards(page);
    await page
      .locator(
        `[data-test-stack-item-content] [data-test-cards-grid-item='${testCard1}']`,
      )
      .click();

    await page
      .locator('[data-test-message-field]')
      .fill(`Change title to Mango`);
    await selectCardFromCatalog(page, testCard2);
    await expect(page.locator(`[data-test-message-field]`)).toHaveValue(
      'Change title to Mango',
    );
    await expect(
      page.locator(`[data-test-chat-input-area] [data-test-attached-card]`),
    ).toHaveCount(2);

    await page.locator(`[data-test-prompt="0"]`).click();

    const message1 = {
      from: 'user1',
      message: 'Fill in the title and description.', // prompt is submitted
      cards: [
        { id: testCard1, title: 'Mango' }, // auto-attached card is submitted
        { id: testCard2, title: 'Hassan' }, // attached card is submitted
      ],
    };
    await assertMessages(page, [message1]);

    await expect(
      page.locator(`[data-test-chat-input-area] [data-test-attached-card]`),
    ).toHaveCount(2); // attached cards remain
    await expect(page.locator(`[data-test-message-field]`)).toHaveValue(
      'Change title to Mango',
    ); // previously typed message remains

    await page.locator('[data-test-send-message-btn]').click();

    const message2 = {
      from: 'user1',
      message: 'Change title to Mango',
      cards: [
        { id: testCard1, title: 'Mango' },
        { id: testCard2, title: 'Hassan' },
      ],
    };
    await assertMessages(page, [message1, message2]);

    await expect(
      page.locator(`[data-test-chat-input-area] [data-test-attached-card]`),
    ).toHaveCount(1); // only auto-attached card remains
    await expect(page.locator(`[data-test-message-field]`)).toBeEmpty(); // message field is empty

    await page.locator('[data-test-send-message-btn]').click();

    const message3 = {
      from: 'user1',
      cards: [{ id: testCard1, title: 'Mango' }],
    };
    await assertMessages(page, [message1, message2, message3]);
  });

  test('ai panel stays open when last card is closed and workspace chooser is opened', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass', { url: appURL });
    await page
      .locator('[data-test-stack-card] [data-test-close-button]')
      .click();
    await expect(page.locator('[data-test-workspace-chooser]')).toHaveCount(1);

    page
      .locator('[data-test-message-field]')
      .fill('Sending message with no card open');

    await page.locator('[data-test-send-message-btn]').click();

    await assertMessages(page, [
      {
        from: 'user1',
        message: 'Sending message with no card open',
        cards: [],
      },
    ]);
  });

  test('attaches a card in a conversation multiple times', async ({ page }) => {
    const testCard = `${appURL}/hassan`;

    await login(page, 'user1', 'pass', { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();
    await showAllCards(page);

    for (let i = 1; i <= 3; i++) {
      await page.locator('[data-test-message-field]').fill(`Message - ${i}`);
      await selectCardFromCatalog(page, testCard);
      await page.locator('[data-test-send-message-btn]').click();
    }

    await assertMessages(page, [
      {
        from: 'user1',
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: 'user1',
        message: 'Message - 2',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: 'user1',
        message: 'Message - 3',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);

    // There should only be one card fragments event for multiple message events
    // if the card remains unchanged and is attached multiple times.
    let events = await getRoomEvents();
    let messageEvents = events.filter(
      (e) =>
        e.type === 'm.room.message' &&
        e.content.msgtype === 'org.boxel.message',
    );
    let cardFragmentEvents = events.filter(
      (e) =>
        e.type === 'm.room.message' &&
        e.content.msgtype === 'org.boxel.cardFragment' &&
        !e.content.data.nextFragment,
    );
    expect(messageEvents.length).toEqual(3);
    expect(cardFragmentEvents.length).toEqual(2);
  });

  test('displays error message if message is too large', async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });

    await page.locator('[data-test-message-field]').fill('a'.repeat(65000));
    await page.locator('[data-test-send-message-btn]').click();

    await expect(page.locator('[data-test-ai-assistant-message]')).toHaveCount(
      1,
    );
    await expect(page.locator('[data-test-card-error]')).toContainText(
      'Message is too large',
    );
    await expect(page.locator('[data-test-ai-bot-retry-button]')).toHaveCount(
      0,
    );
  });
});
