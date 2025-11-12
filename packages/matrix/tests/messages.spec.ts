import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

import { Credentials, putEvent } from '../docker/synapse';
import {
  login,
  logout,
  createRoom,
  createSubscribedUserAndLogin,
  getRoomId,
  openRoom,
  assertMessages,
  writeMessage,
  sendMessage,
  reloadAndOpenAiAssistant,
  isInRoom,
  selectCardFromCatalog,
  getRoomEvents,
  setupTwoStackItems,
  showAllCards,
} from '../helpers';
import { appURL } from '../helpers/isolated-realm-server';
import { APP_BOXEL_MESSAGE_MSGTYPE } from '../helpers/matrix-constants';

test.describe('Room messages', () => {
  test(`it can send a message in a room`, async ({ page }) => {
    // TODO: Split up this test (CS-9722).
    // This tests multiple different behaviours beyond just sending a message.
    // There are tests for:
    // - sending messages with a button
    // - sending messages with Enter key
    // - handling whitespace only messages (not sending them)
    // - persisting messages across reloads
    // - ensuring room state doesn't leak between users
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'send-message',
    );
    let room1 = await getRoomId(page);
    await expect(page.locator('[data-test-new-session]')).toHaveCount(1);
    await expect(page.locator('[data-test-message-field]')).toHaveValue('');

    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await assertMessages(page, []);

    // Whitespace only messages are not sent
    await page.locator('[data-test-message-field]').click();
    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await assertMessages(page, []);

    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('[data-test-send-message-btn]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await assertMessages(page, []);

    // Text messages are sent
    await writeMessage(page, room1, 'Message 1');
    await expect(
      page.locator(`[data-test-message-field="${room1}"]`),
    ).toHaveValue('Message 1');
    await page.locator('[data-test-send-message-btn]').click();

    await expect(page.locator('[data-test-message-field]')).toHaveValue('');
    await expect(page.locator('[data-test-new-session]')).toHaveCount(0);
    await assertMessages(page, [{ from: username, message: 'Message 1' }]);

    // Enter can send a message
    await writeMessage(page, room1, 'Message 2');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('!');
    await assertMessages(page, [{ from: username, message: 'Message 1' }]);
    // Must wait for the send message button to appear, otherwise we hit
    // enter when the previous message is still sending.
    await expect(page.locator('[data-test-send-message-btn]')).toBeEnabled();
    await page.keyboard.press('Enter');
    const messages = [
      { from: username, message: 'Message 1' },
      { from: username, message: 'Message 2\n\n!' },
    ];
    await assertMessages(page, messages);

    let room2 = await createRoom(page);
    await openRoom(page, room1);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await assertMessages(page, messages);

    await logout(page);
    await login(page, username, password, { url: appURL });
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

    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'load-events',
    );
    let room1 = await getRoomId(page);

    for (let i = 1; i <= totalMessageCount; i++) {
      await sendMessage(page, room1, `message ${i}`);
    }
    await logout(page);

    await login(page, username, password, { url: appURL });
    await openRoom(page, room1);

    await expect(page.locator('[data-test-message-idx]')).toHaveCount(
      totalMessageCount,
    );
  });

  test(`it can send a markdown message, and escape html tags`, async ({
    page,
  }) => {
    const { username } = await createSubscribedUserAndLogin(page, 'markdown');
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, 'message with _style_');
    await assertMessages(page, [
      {
        from: username,
        message: 'message with style',
      },
    ]);
    await expect(
      page.locator(`[data-test-message-idx="0"] .content em`),
    ).toContainText('style');

    await sendMessage(page, room1, '<h1>Hello</h1> <template>Hello</template>');
    // this is to assert that the html tags are escaped
    let innerHTML = await page
      .locator('[data-test-message-idx="1"] .content')
      .evaluate((el) => el.innerHTML);
    expect(innerHTML).toContain(
      '&lt;h1&gt;Hello&lt;/h1&gt; &lt;template&gt;Hello&lt;/template&gt;',
    );
  });

  test(`it can create a room specific pending message`, async ({ page }) => {
    await createSubscribedUserAndLogin(page, 'pending-message');
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
    const { username } = await createSubscribedUserAndLogin(
      page,
      'add-card-markdown',
    );
    await page.locator(`[data-test-room-settled]`).waitFor();

    await page.locator('[data-test-attach-button]').click();
    await page.locator('[data-test-attach-card-btn]').click();
    await page.locator(`[data-test-search-field]`).fill(testCard);
    await page.locator(`[data-test-select="${testCard}"]`).click();
    await page.locator('[data-test-card-catalog-go-button]').click();
    await expect(
      page.locator(`[data-test-attached-card="${testCard}"]`),
    ).toContainText('Hassan');

    await page.locator('[data-test-message-field]').fill('This is _my_ card');
    await page.locator('[data-test-send-message-btn]').click();

    await assertMessages(page, [
      {
        from: username,
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

  test('it can strip out base64 image fields from cards sent in messages', async ({
    page,
  }) => {
    const testCard = `${appURL}/mango-puppy`; // this is a 153KB card
    const { username, password, credentials } =
      await createSubscribedUserAndLogin(page, 'strip-base64');
    await page.locator(`[data-test-room-settled]`).waitFor();
    await page.locator('[data-test-attach-button]').click();
    await page.locator('[data-test-attach-card-btn]').click();

    await page.locator(`[data-test-search-field]`).fill('Mango the Puppy');
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
        from: username,
        message: 'This is a card without base64',
        cards: [{ id: testCard, title: 'Mango the Puppy' }],
      },
    ]);

    let messages = await getRoomEvents(username, password);
    let message = messages[messages.length - 1];
    let messageData = JSON.parse(message.content.data);
    let cardText = await (
      await fetch(messageData.attachedCards[0].url, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      })
    ).text();
    let card = JSON.parse(cardText);

    expect(card.data.attributes.name).toStrictEqual('Mango the Puppy');
    expect(card.data.attributes.picture).toBeUndefined();
  });

  test('can send only a card as a message', async ({ page }) => {
    const testCard = `${appURL}/hassan`;
    const { username } = await createSubscribedUserAndLogin(page, 'card-only');
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, undefined, [testCard]);
    await assertMessages(page, [
      {
        from: username,
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);
  });

  test('currently viewed file is auto-attached', async ({ page }) => {
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'auto-attach-file',
    );
    await showAllCards(page);
    const testCard = `${appURL}/hassan`;
    await page.locator(`[data-test-cards-grid-item="${testCard}"]`).click();
    await page
      .locator(`[data-test-submode-switcher] > [data-test-boxel-button]`)
      .click();
    await page.locator(`[data-test-boxel-menu-item-text="Code"]`).click();

    await expect(page.locator(`[data-test-attached-file]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-attached-file="${appURL}/hassan.json"]`),
    ).toHaveCount(1);

    await page.locator(`[data-test-clickable-definition-container]`).click();
    await expect(page.locator(`[data-test-attached-file]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-attached-file="${appURL}/person.gts"]`),
    ).toHaveCount(1);

    await page
      .locator('[data-test-message-field]')
      .fill('Are there any computed fields in person.gts?');
    await page.locator('[data-test-send-message-btn]').click();
    await assertMessages(page, [
      {
        from: username,
        message: 'Are there any computed fields in person.gts?',
        files: [
          {
            sourceUrl: `${appURL}/person.gts`,
            name: 'person.gts',
          },
        ],
      },
    ]);

    let messages = await getRoomEvents(username, password);
    let lastMessage = messages[messages.length - 1];
    let attachedFiles = JSON.parse(lastMessage.content.data).attachedFiles;
    expect(attachedFiles.length).toStrictEqual(1);
    expect(attachedFiles[0].name).toStrictEqual('person.gts');
    expect(attachedFiles[0].contentType).toStrictEqual(
      'text/plain; charset=utf-8',
    );
    expect(attachedFiles[0].sourceUrl).toStrictEqual(`${appURL}/person.gts`);
    expect(attachedFiles[0].url).toMatch(
      /^http:\/\/localhost:8008\/_matrix\/client\/v1\/media\/download\/localhost\/[A-Za-z0-9]+\?allow_redirect=true$/,
    ); // Example http://localhost:8008/_matrix/client/v1/media/download/localhost/phPajGXxttKlRxWYYjYLTkFP (generated by matrix storage)
  });

  test('ensure attached files are sent with the message', async ({ page }) => {
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'ensure-files',
    );
    await showAllCards(page);
    const testCard = `${appURL}/hassan`;
    await page.locator(`[data-test-cards-grid-item="${testCard}"]`).click();
    await expect(
      page.locator(`[data-test-attached-card="${appURL}/hassan"]`),
    ).toHaveCount(1);
    await page
      .locator(`[data-test-submode-switcher] > [data-test-boxel-button]`)
      .click();
    await page.locator(`[data-test-boxel-menu-item-text="Code"]`).click();

    await expect(
      page.locator(`[data-test-attached-card="${appURL}/hassan"]`),
    ).toHaveCount(1);
    await expect(page.locator(`[data-test-attached-file]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-attached-file="${appURL}/hassan.json"]`),
    ).toHaveCount(1);

    await page.locator(`[data-test-clickable-definition-container]`).click();
    await expect(page.locator(`[data-test-attached-file]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-attached-file="${appURL}/person.gts"]`),
    ).toHaveCount(1);

    await page.locator('[data-test-attach-button]').click();
    await page.locator('[data-test-attach-file-btn]').click();
    await page.locator('[data-test-file="pet.gts"]').click();
    await page.locator('[data-test-choose-file-modal-add-button]').click();
    await expect(
      page.locator(`[data-test-attached-file="${appURL}/pet.gts"]`),
    ).toHaveCount(1);

    await page
      .locator('[data-test-message-field]')
      .fill('Are there any computed fields in person.gts?');
    await page.locator('[data-test-send-message-btn]').click();
    await assertMessages(page, [
      {
        from: username,
        message: 'Are there any computed fields in person.gts?',
        files: [
          {
            sourceUrl: `${appURL}/person.gts`,
            name: 'person.gts',
          },
          {
            sourceUrl: `${appURL}/pet.gts`,
            name: 'pet.gts',
          },
        ],
      },
    ]);

    let messages = await getRoomEvents(username, password);
    let lastMessage = messages[messages.length - 1];

    let attachedCards = JSON.parse(lastMessage.content.data).attachedCards;
    expect(attachedCards).toBeUndefined;
    let attachedFiles = JSON.parse(lastMessage.content.data).attachedFiles;
    expect(attachedFiles.length).toStrictEqual(2);
    expect(attachedFiles[1].name).toStrictEqual('pet.gts');
    expect(attachedFiles[1].contentType).toStrictEqual(
      'text/plain; charset=utf-8',
    );
    expect(attachedFiles[1].sourceUrl).toStrictEqual(`${appURL}/pet.gts`);
    expect(attachedFiles[1].url).toMatch(
      /^http:\/\/localhost:8008\/_matrix\/client\/v1\/media\/download\/localhost\/[A-Za-z0-9]+\?allow_redirect=true$/,
    ); // Example http://localhost:8008/_matrix/client/v1/media/download/localhost/phPajGXxttKlRxWYYjYLTkFP (generated by matrix storage)
  });

  test('can send cards with types unsupported by matrix', async ({ page }) => {
    const testCard = `${appURL}/type-examples`;
    const { username } = await createSubscribedUserAndLogin(
      page,
      'unsupported-type',
    );
    let room1 = await getRoomId(page);

    // Send a card that contains a type that matrix doesn't support
    await sendMessage(page, room1, undefined, [testCard]);
    await assertMessages(page, [
      {
        from: username,
        cards: [{ id: testCard, title: 'Type Examples' }],
      },
    ]);
  });

  test('can remove a card from a pending message', async ({ page }) => {
    const testCard = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const { username } = await createSubscribedUserAndLogin(
      page,
      'remove-card',
    );
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

    await assertMessages(page, [
      {
        from: username,
        message: '1 card',
        cards: [{ id: testCard2, title: 'Mango' }],
      },
      {
        from: username,
        message: 'no card',
      },
    ]);
  });

  test('can render multiple cards in a room', async ({ page }) => {
    // the loader deadlocking issue would otherwise prevent this

    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'render-multiple',
    );
    const message1 = {
      from: username,
      message: 'message 1',
      cards: [{ id: testCard1, title: 'Hassan' }],
    };
    const message2 = {
      from: username,
      message: 'message 2',
      cards: [{ id: testCard2, title: 'Mango' }],
    };

    let room1 = await getRoomId(page);

    await sendMessage(page, room1, 'message 1', [testCard1]);
    await assertMessages(page, [message1]);

    await sendMessage(page, room1, 'message 2', [testCard2]);
    await assertMessages(page, [message1, message2]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await assertMessages(page, [message1, message2]);

    await logout(page);
    await login(page, username, password, { url: appURL });
    await openRoom(page, room1);
    await assertMessages(page, [message1, message2]);
  });

  test('can send multiple cards in a message', async ({ page }) => {
    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'multi-card',
    );
    const message = {
      from: username,
      message: 'message 1',
      cards: [
        { id: testCard1, title: 'Hassan' },
        { id: testCard2, title: 'Mango' },
      ],
    };

    let room1 = await getRoomId(page);

    await selectCardFromCatalog(page, testCard1);
    await selectCardFromCatalog(page, testCard2);
    await sendMessage(page, room1, 'message 1');
    await assertMessages(page, [message]);

    await reloadAndOpenAiAssistant(page);
    await openRoom(page, room1);
    await assertMessages(page, [message]);

    await logout(page);
    await login(page, username, password, { url: appURL });
    await openRoom(page, room1);
    await assertMessages(page, [message]);
  });

  test('attached cards are not duplicated', async ({ page }) => {
    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const testCard3 = `${appURL}/type-examples`;

    const { username } = await createSubscribedUserAndLogin(
      page,
      'no-duplicate-cards',
    );
    await page.locator(`[data-test-room-settled]`).waitFor();

    await selectCardFromCatalog(page, testCard2);
    await selectCardFromCatalog(page, testCard1);
    await selectCardFromCatalog(page, testCard2);
    await selectCardFromCatalog(page, testCard3);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(3);

    await page.locator('[data-test-send-message-btn]').click();
    await assertMessages(page, [
      {
        from: username,
        cards: [
          { id: testCard2, title: 'Mango' },
          { id: testCard1, title: 'Hassan' },
          { id: testCard3, title: 'Type Examples' },
        ],
      },
    ]);
  });

  test('displays "view all" pill when there are more than 4 attached cards', async ({
    page,
  }) => {
    const testCard1 = `${appURL}/hassan`;
    const testCard2 = `${appURL}/mango`;
    const testCard3 = `${appURL}/type-examples`;
    const testCard4 = `${appURL}/fadhlan`;
    const testCard5 = `${appURL}/van-gogh`;

    await createSubscribedUserAndLogin(page, 'view-all');
    await page.locator(`[data-test-room-settled]`).waitFor();

    await selectCardFromCatalog(page, testCard1);
    await selectCardFromCatalog(page, testCard2);
    await selectCardFromCatalog(page, testCard3);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(3);

    await selectCardFromCatalog(page, testCard4);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(4);
    await expect(page.locator(`[data-test-view-all]`)).toHaveCount(0);

    await selectCardFromCatalog(page, testCard5);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(4); // current value of MAX_ITEMS_TO_DISPLAY in attachment-picker.gts
    await expect(page.locator(`[data-test-view-all]`)).toHaveCount(1);

    await page.locator('[data-test-view-all]').click();
    await expect(page.locator(`[data-test-view-all]`)).toHaveCount(0);
    await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(5);
  });

  test.describe('auto-attachment of cards in matrix room', () => {
    async function setupAutoAttachmentUser(
      page: Page,
      prefix: string,
    ): Promise<{
      username: string;
      password: string;
      credentials: Credentials;
    }> {
      const user = await createSubscribedUserAndLogin(page, prefix);
      await getRoomId(page);
      await showAllCards(page);
      return user;
    }

    test('displays auto-attached card (1 stack)', async ({ page }) => {
      const { username } = await setupAutoAttachmentUser(
        page,
        'auto-one-stack',
      );
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
          from: username,
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });
    test('manually attached card is not auto-attached', async ({ page }) => {
      const { username } = await setupAutoAttachmentUser(
        page,
        'manual-not-auto',
      );
      const testCard1 = `${appURL}/hassan`;
      await selectCardFromCatalog(page, testCard1);
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(1);
      await page.locator(`[data-test-attached-card]`).hover();
      await expect(page.locator(`[data-test-tooltip-content]`)).toHaveCount(0);
      await page.locator('[data-test-send-message-btn]').click();
      await assertMessages(page, [
        {
          from: username,
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });

    test('manually attached card overwrites auto-attached card', async ({
      page,
    }) => {
      const { username } = await setupAutoAttachmentUser(
        page,
        'manual-overwrites-auto',
      );
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
          from: username,
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });
    test('does not auto-attach index card', async ({ page }) => {
      await setupAutoAttachmentUser(page, 'no-index-auto');
      const indexCard = `${appURL}/index`;
      await expect(
        page.locator(`[data-test-stack-card="${indexCard}"]`),
      ).toHaveCount(1); // The index card appears by default, we verify it exists here
      await expect(page.locator(`[data-test-attached-card]`)).toHaveCount(0);
    });

    test('replaces auto-attached card when drilling down (1 stack)', async ({
      page,
    }) => {
      const { username } = await setupAutoAttachmentUser(
        page,
        'auto-replace-one-stack',
      );
      const testCard1 = `${appURL}/jersey`;
      const embeddedCard = `${appURL}/justin`;
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
          from: username,
          cards: [{ id: embeddedCard, title: 'Justin T' }],
        },
      ]);
    });

    test('auto-attached card will get auto-remove when closing a stack', async ({
      page,
    }) => {
      await setupAutoAttachmentUser(page, 'auto-remove-when-closing');
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
      await setupAutoAttachmentUser(page, 'manual-remove-auto');
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
      const { username } = await setupAutoAttachmentUser(
        page,
        'reopen-auto-attach',
      );
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
          from: username,
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });

    test('(2 stack) displays both top cards as auto-attached ', async ({
      page,
    }) => {
      const { username } = await setupAutoAttachmentUser(
        page,
        'auto-two-stack',
      );
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
          from: username,
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
      const { username } = await setupAutoAttachmentUser(
        page,
        'auto-two-stack-same',
      );
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
          from: username,
          cards: [{ id: testCard1, title: 'Hassan' }],
        },
      ]);
    });
  });

  test('ai panel stays open when last card is closed and workspace chooser is opened', async ({
    page,
  }) => {
    const { username } = await createSubscribedUserAndLogin(
      page,
      'ai-panel-open',
    );
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
        from: username,
        message: 'Sending message with no card open',
        cards: [],
      },
    ]);
  });

  test('attaches a card in a conversation multiple times', async ({ page }) => {
    const testCard = `${appURL}/hassan`;

    const { username, password } = await createSubscribedUserAndLogin(
      page,
      'attach-multiple',
    );
    await page.locator(`[data-test-room-settled]`).waitFor();
    await showAllCards(page);

    for (let i = 1; i <= 3; i++) {
      await page.locator('[data-test-message-field]').fill(`Message - ${i}`);
      await selectCardFromCatalog(page, testCard);
      await page.locator('[data-test-send-message-btn]').click();
    }

    await assertMessages(page, [
      {
        from: username,
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: username,
        message: 'Message - 2',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: username,
        message: 'Message - 3',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);

    // There should only be one card fragments event for multiple message events
    // if the card remains unchanged and is attached multiple times.
    let events = await getRoomEvents(username, password);
    let messageEvents = events.filter(
      (e) =>
        e.type === 'm.room.message' &&
        e.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE,
    );
    expect(messageEvents.length).toEqual(3);
  });

  test('it escapes html code sent by the user', async ({ page }) => {
    await createSubscribedUserAndLogin(page, 'escape-html');
    await page
      .locator('[data-test-message-field]')
      .fill('<h1>Hello, world!</h1><script>alert("Hello, world!")</script>');

    await page.locator('[data-test-send-message-btn]').click();

    // assert that message innerHTML is escaped
    let messageParagraph = await page.locator(
      '[data-test-ai-message-content] p',
    );
    let messageHTML = await messageParagraph.innerHTML();

    expect(messageHTML).toContain(
      '&lt;h1&gt;Hello, world!&lt;/h1&gt;&lt;script&gt;alert("Hello, world!")&lt;/script&gt;',
    );
  });

  test('displays error message if message is too large', async ({ page }) => {
    await createSubscribedUserAndLogin(page, 'message-too-large');

    await page.locator('[data-test-message-field]').fill('a'.repeat(65000));
    await page.locator('[data-test-send-message-btn]').click();

    await expect(page.locator('[data-test-ai-assistant-message]')).toHaveCount(
      1,
    );
    await expect(page.locator('[data-test-card-error]')).toContainText(
      'Message is too large',
    );
    await expect(
      page.locator('[data-test-alert-action-button="Retry"]'),
    ).toHaveCount(0);
  });

  test('filters out messages with m.replace when loading room history', async ({
    page,
  }) => {
    const { username, credentials } = await createSubscribedUserAndLogin(
      page,
      'filter-m-replace',
    );
    let room1 = await getRoomId(page);

    let event1 = await putEvent(
      credentials.accessToken,
      room1,
      'm.room.message',
      '1',
      {
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        body: 'Initial streaming message',
        isStreamingFinished: false,
      },
    );

    await assertMessages(page, [
      {
        from: username,
        message: 'Initial streaming message',
      },
    ]);

    let replaceEvent1 = await putEvent(
      credentials.accessToken,
      room1,
      'm.room.message',
      '2',
      {
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        body: 'Initial streaming message, additional text from replacement event 1',
        isStreamingFinished: false,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: event1.event_id,
        },
      },
    );

    await assertMessages(page, [
      {
        from: username,
        message:
          'Initial streaming message, additional text from replacement event 1',
      },
    ]);

    let replaceEvent2 = await putEvent(
      credentials.accessToken,
      room1,
      'm.room.message',
      '3',
      {
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        body: 'Initial streaming message, additional text from replacement event 1, additional text from replacement event 2',
        isStreamingFinished: false,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: event1.event_id,
        },
      },
    );

    await assertMessages(page, [
      {
        from: username,
        message:
          'Initial streaming message, additional text from replacement event 1, additional text from replacement event 2',
      },
    ]);

    await page.reload();
    let response = await page.waitForResponse(
      (response) =>
        response.url().includes('/messages') && response.status() === 200,
    );
    const body = await response.json();
    const messageEventIds = body.chunk
      .filter((e: { type: string }) => e.type === 'm.room.message')
      .map((e: { event_id: string }) => e.event_id);
    expect(messageEventIds).not.toContain(replaceEvent1.event_id);
    expect(messageEventIds).not.toContain(replaceEvent2.event_id);
    expect(messageEventIds).toContain(event1.event_id);

    await assertMessages(page, [
      {
        from: username,
        message:
          'Initial streaming message, additional text from replacement event 1, additional text from replacement event 2',
      },
    ]);
  });
});
