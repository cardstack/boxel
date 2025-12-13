import { expect, test } from './fixtures';
import { putEvent } from '../docker/synapse';
import {
  getRoomId,
  createSubscribedUserAndLogin,
  getRoomEvents,
  showAllCards,
  createRealm,
  postNewCard,
} from '../helpers';
import { getMatrixTestContext } from '../helpers';
import { registerUser, loginUser } from '../docker/synapse';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
} from '../helpers/matrix-constants';
import { appURL } from '../helpers/isolated-realm-server';

const serverIndexUrl = new URL(appURL).origin;

function uniqueRealmName(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

test.describe('Correctness Checks', () => {
  test(`checkCorrectness command executes and returns CorrectnessResultCard`, async ({
    page,
  }) => {
    const { username, password, credentials } =
      await createSubscribedUserAndLogin(
        page,
        'correctness-check',
        serverIndexUrl,
      );
    const realmName = uniqueRealmName('correctness-check');
    await createRealm(page, realmName);
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;

    // Create a card to check correctness on
    const cardId = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          name: 'Billy',
          hasError: false,
        },
        meta: {
          adoptsFrom: {
            module: `${appURL}/boom-pet`,
            name: 'Pet',
          },
        },
      },
    });

    await page.goto(realmURL);
    let roomId = await getRoomId(page);
    await showAllCards(page);
    let testCard = page.locator(`[data-test-cards-grid-item="${cardId}"]`);
    await testCard.waitFor();
    await testCard.click();
    await expect(
      page.locator(`[data-test-stack-card="${cardId}"]`),
    ).toHaveCount(1);

    // Use the existing agentId from sessionStorage (same source the host uses) so the command auto-applies
    let agentId = await page.evaluate(() => {
      let existing = window.sessionStorage.getItem('agentId');
      if (existing) {
        return existing;
      }
      let generated =
        (window.crypto as Crypto | undefined)?.randomUUID?.() ||
        Math.random().toString(36).slice(2, 10);
      window.sessionStorage.setItem('agentId', generated);
      return generated;
    });

    const commandRequestId = `check-correctness-${Date.now()}`;

    // Ensure bot user exists and is in the room
    const { synapse } = getMatrixTestContext();
    const botPassword = 'bot-password';
    try {
      await registerUser(synapse, 'aibot', botPassword);
    } catch {
      // user may already exist
    }
    let botCredentials = await loginUser('aibot', botPassword);
    await fetch(
      `http://localhost:${synapse.port}/_matrix/client/v3/rooms/${roomId}/join`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${botCredentials.accessToken}` },
      },
    );

    // Simulate a correctness check message from the AI bot (same approach as commands.spec.ts)
    let commandRequests = [
      {
        id: commandRequestId,
        name: 'checkCorrectness',
        arguments: {
          description: `Check correctness of test card`,
          attributes: {
            targetType: 'card',
            targetRef: cardId,
            cardId: cardId,
            roomId: roomId,
          },
        },
      },
    ];

    await putEvent(
      credentials.accessToken,
      roomId,
      'm.room.message',
      commandRequestId,
      {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        data: {
          context: {
            agentId,
          },
        },
        [APP_BOXEL_COMMAND_REQUESTS_KEY]: commandRequests,
      },
    );

    // Wait for the command to render
    let commandContainer = page.locator(
      `[data-test-command-id="${commandRequestId}"]`,
    );
    await commandContainer.waitFor();

    // Wait for the command to auto-apply
    await commandContainer
      .locator('[data-test-apply-state="applied"]')
      .waitFor();

    // Verify the command didn't fail
    await expect(commandContainer).not.toHaveClass(/is-failed/);

    // Verify the command description is displayed
    await expect(
      commandContainer.locator('.command-description'),
    ).toContainText('Check correctness');

    // Verify the command result event was dispatched with correct data
    let commandResultEvent: any;
    await expect(async () => {
      let events = await getRoomEvents(username, password, roomId);
      commandResultEvent = events.find(
        (e: any) => e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      );
      expect(commandResultEvent).toBeDefined();
    }).toPass();

    // Verify the command result has the correct structure
    expect(commandResultEvent!.content.msgtype).toStrictEqual(
      APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
    );
    expect(commandResultEvent!.content['m.relates_to']?.rel_type).toStrictEqual(
      APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    );
    expect(commandResultEvent!.content['m.relates_to']?.key).toStrictEqual(
      'applied',
    );
    expect(commandResultEvent!.content.commandRequestId).toStrictEqual(
      commandRequestId,
    );

    // Verify the result contains a CorrectnessResultCard FileDef
    let commandResultData =
      typeof commandResultEvent!.content.data === 'string'
        ? JSON.parse(commandResultEvent!.content.data)
        : commandResultEvent!.content.data;
    expect(commandResultData.card).toBeDefined();
    expect(commandResultData.card.contentType).toStrictEqual(
      'application/vnd.card+json',
    );
    expect(commandResultData.card.url).toBeDefined();

    // Fetch the actual CorrectnessResultCard content from the matrix server
    let cardUrl = commandResultData.card.url;
    let cardFileUrl = `${cardId}.json`;

    let response: Response | undefined;
    await expect(async () => {
      response = await fetch(cardUrl, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      });
      expect(response.ok).toBe(true);
    }).toPass();

    expect(response).toBeDefined();
    let cardJson = await response!.json();

    // Verify the CorrectnessResultCard structure
    expect(cardJson.data).toBeDefined();
    expect(cardJson.data.attributes).toBeDefined();

    // Verify the CorrectnessResultCard fields
    expect(typeof cardJson.data.attributes.correct).toBe('boolean');
    expect(Array.isArray(cardJson.data.attributes.errors)).toBe(true);
    expect(Array.isArray(cardJson.data.attributes.warnings)).toBe(true);

    // Since we're checking a valid card, correctness should be true with no errors
    expect(cardJson.data.attributes.correct).toBe(true);
    expect(cardJson.data.attributes.errors).toHaveLength(0);

    // --- Break the card using a search/replace code patch message ---
    let realmToken = await page.evaluate((realmURL) => {
      let sessions = JSON.parse(
        window.localStorage.getItem('boxel-session') ?? '{}',
      );
      return sessions[realmURL];
    }, realmURL);
    expect(realmToken).toBeDefined();

    let originalResponse = await fetch(cardFileUrl, {
      headers: {
        Authorization: realmToken as string,
      },
    });

    let originalContent = await originalResponse.text();
    let brokenContent = originalContent.replace(
      `"hasError": false`,
      `"hasError": true`,
    );

    const breakMessageBody = `\`\`\`
${cardId}.json
╔═══ SEARCH ════╗
${originalContent}
╠═══════════════╣
${brokenContent}
╚═══ REPLACE ═══╝
\`\`\``;

    await putEvent(
      botCredentials.accessToken,
      roomId,
      'm.room.message',
      'break',
      {
        body: breakMessageBody,
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        data: JSON.stringify({
          context: {
            agentId,
          },
        }),
      },
    );

    let acceptAllButton = page.locator('[data-test-accept-all]');
    await acceptAllButton.waitFor();
    await acceptAllButton.click();
    await page
      .locator(
        `[data-test-message-idx="1"] [data-test-code-block-index="0"] [data-test-apply-state="applied"]`,
      )
      .waitFor();

    // --- Run correctness check again; this time expect errors ---
    const failingCommandRequestId = `check-correctness-${Date.now()}`;
    let failingCommandRequests = [
      {
        id: failingCommandRequestId,
        name: 'checkCorrectness',
        arguments: {
          description: `Check correctness of broken test card`,
          attributes: {
            targetType: 'card',
            targetRef: cardId,
            cardId: cardId,
            roomId: roomId,
          },
        },
      },
    ];

    await putEvent(
      credentials.accessToken,
      roomId,
      'm.room.message',
      failingCommandRequestId,
      {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        data: {
          context: {
            agentId,
          },
        },
        [APP_BOXEL_COMMAND_REQUESTS_KEY]: failingCommandRequests,
      },
    );

    let failingCommandContainer = page.locator(
      `[data-test-command-id="${failingCommandRequestId}"]`,
    );
    await failingCommandContainer.waitFor();

    await failingCommandContainer
      .locator('[data-test-apply-state="failed"]')
      .waitFor();

    let failingCommandResultEvent: any;
    await expect(async () => {
      let events = await getRoomEvents(username, password, roomId);
      failingCommandResultEvent = events.find(
        (e: any) =>
          e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          e.content.commandRequestId === failingCommandRequestId,
      );
      expect(failingCommandResultEvent).toBeDefined();
    }).toPass();

    let failingCommandResultData =
      typeof failingCommandResultEvent!.content.data === 'string'
        ? JSON.parse(failingCommandResultEvent!.content.data)
        : failingCommandResultEvent!.content.data;
    expect(failingCommandResultData.card).toBeDefined();
    expect(failingCommandResultData.card.contentType).toStrictEqual(
      'application/vnd.card+json',
    );
    expect(failingCommandResultData.card.url).toBeDefined();

    let failingCardUrl = failingCommandResultData.card.url;
    let failingResponse: Response | undefined;
    await expect(async () => {
      failingResponse = await fetch(failingCardUrl, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      });
      expect(failingResponse.ok).toBe(true);
    }).toPass();
    expect(failingResponse).toBeDefined();
    let failingCardJson = await failingResponse!.json();

    expect(failingCardJson.data).toBeDefined();
    expect(failingCardJson.data.attributes).toBeDefined();
    expect(failingCardJson.data.attributes.correct).toBe(false);
    expect(Array.isArray(failingCardJson.data.attributes.errors)).toBe(true);
    expect(failingCardJson.data.attributes.errors.length).toBeGreaterThan(0);
    expect(
      failingCardJson.data.attributes.errors.some((err: string) =>
        err.includes(
          `hasError was set to true because we deliberately want to get this card to a broken state`,
        ),
      ),
    ).toBe(true);

    // The card should be flagged with an instance error when viewed on the stack
    let errorCard = page.locator(`[data-test-stack-card="${cardId}"]`);
    await errorCard.waitFor();

    await expect(
      page
        .locator(`[data-test-stack-card="${cardId}"] [data-test-error-message]`)
        .first(),
    ).toContainText(
      'hasError was set to true because we deliberately want to get this card to a broken state',
    );

    // --- Revert the card using a search/replace code patch message and verify correctness is restored ---
    const revertMessageBody = `\`\`\`
${cardId}.json
╔═══ SEARCH ════╗
${brokenContent}
╠═══════════════╣
${originalContent}
╚═══ REPLACE ═══╝
\`\`\``;

    await putEvent(
      botCredentials.accessToken,
      roomId,
      'm.room.message',
      'revert',
      {
        body: revertMessageBody,
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        data: JSON.stringify({
          context: {
            agentId,
          },
        }),
      },
    );

    acceptAllButton = page.locator('[data-test-accept-all]');
    await acceptAllButton.waitFor();
    await acceptAllButton.click();
    await page
      .locator(
        `[data-test-message-idx="3"] [data-test-code-block-index="0"] [data-test-apply-state="applied"]`,
      )
      .waitFor();

    // Run correctness check again
    const finalCommandRequestId = `check-correctness-${Date.now()}`;
    let finalCommandRequests = [
      {
        id: finalCommandRequestId,
        name: 'checkCorrectness',
        arguments: {
          description: `Check correctness after revert`,
          attributes: {
            targetType: 'card',
            targetRef: cardId,
            cardId: cardId,
            roomId: roomId,
          },
        },
      },
    ];

    await putEvent(
      credentials.accessToken,
      roomId,
      'm.room.message',
      finalCommandRequestId,
      {
        body: '',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        data: {
          context: {
            agentId,
          },
        },
        [APP_BOXEL_COMMAND_REQUESTS_KEY]: finalCommandRequests,
      },
    );

    let finalCommandContainer = page.locator(
      `[data-test-command-id="${finalCommandRequestId}"]`,
    );
    await finalCommandContainer.waitFor();
    await finalCommandContainer
      .locator('[data-test-apply-state="applied"]')
      .waitFor();

    let finalCommandResultEvent: any;
    await expect(async () => {
      let events = await getRoomEvents(username, password, roomId);
      finalCommandResultEvent = events.find(
        (e: any) =>
          e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          e.content.commandRequestId === finalCommandRequestId,
      );
      expect(finalCommandResultEvent).toBeDefined();
    }).toPass();

    let finalCommandResultData =
      typeof finalCommandResultEvent!.content.data === 'string'
        ? JSON.parse(finalCommandResultEvent!.content.data)
        : finalCommandResultEvent!.content.data;
    expect(finalCommandResultData.card).toBeDefined();
    expect(finalCommandResultData.card.contentType).toStrictEqual(
      'application/vnd.card+json',
    );
    expect(finalCommandResultData.card.url).toBeDefined();

    let finalCardUrl = finalCommandResultData.card.url;
    let finalResponse: Response | undefined;
    await expect(async () => {
      finalResponse = await fetch(finalCardUrl, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      });
      expect(finalResponse.ok).toBe(true);
    }).toPass();
    expect(finalResponse).toBeDefined();
    let finalCardJson = await finalResponse!.json();

    expect(finalCardJson.data).toBeDefined();
    expect(finalCardJson.data.attributes).toBeDefined();
    expect(finalCardJson.data.attributes.correct).toBe(true);
    expect(Array.isArray(finalCardJson.data.attributes.errors)).toBe(true);
    expect(finalCardJson.data.attributes.errors).toHaveLength(0);
  });
});
