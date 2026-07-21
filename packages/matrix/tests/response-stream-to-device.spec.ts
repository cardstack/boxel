import { createClient } from 'matrix-js-sdk';

import { expect, test } from './fixtures.ts';
import { getMatrixTestContext } from '../helpers/index.ts';
import { registerUser, loginUser, sync } from '../support/synapse/index.ts';
import { getSynapseURL } from '../support/environment-config.ts';
import { APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE } from '../support/matrix-constants.ts';

// The ai-bot's Responder streams to-device previews by calling the real
// matrix-js-sdk `sendToDevice`, which takes a Map<userId, Map<deviceId,
// content>> and iterates it internally (recursiveMapToObject). A plain nested
// object throws `TypeError: contentMap is not iterable` before anything reaches
// the wire. The ai-bot unit suite can't catch this: its FakeMatrixClient never
// exercises the real contract. This spec drives the real SDK against the
// dockerized Synapse so a regression in the payload shape fails here.

test.describe('ai-bot to-device response-stream previews', () => {
  test('a real matrix-js-sdk sendToDevice delivers a preview to the target device, and a plain-object payload is rejected', async () => {
    let { synapse } = getMatrixTestContext();

    // The bot is the sender; the human is the recipient on a specific device —
    // the originating device the preview is targeted at.
    for (let username of ['stream-bot', 'stream-human']) {
      try {
        await registerUser(synapse, username, 'password');
      } catch {
        // May already exist if Synapse is reused across runs.
      }
    }
    let bot = await loginUser('stream-bot', 'password');
    let human = await loginUser('stream-human', 'password');

    let botClient = createClient({
      baseUrl: getSynapseURL(synapse),
      accessToken: bot.accessToken,
      userId: bot.userId,
      deviceId: bot.deviceId,
    });

    // Exactly the payload shape the Responder builds in
    // packages/ai-bot/lib/responder.ts (sendToDevicePreview).
    let payload = {
      roomId: '!fake-room:localhost',
      parentEventId: '$fake-parent-event',
      sequence: 0,
      body: 'partial answer so far',
      reasoning: 'thinking…',
      toolRequests: [],
      isFinal: false,
    };

    // Positive path: the real client accepts the Map contract and Synapse
    // delivers the preview to the recipient's device.
    let contentMap = new Map([
      [human.userId, new Map([[human.deviceId, payload]])],
    ]);
    await botClient.sendToDevice(
      APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
      contentMap,
    );

    let received = await pollForToDeviceEvent(
      human.accessToken,
      APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
    );
    if (!received) {
      throw new Error('recipient device never received a to-device preview');
    }
    expect(received.sender).toBe(bot.userId);
    expect(received.content).toMatchObject(payload);

    // Negative path: the plain nested object the buggy code passed throws the
    // real SDK's TypeError before anything is sent — the exact production
    // failure the unit fake could not surface.
    let threw: unknown;
    try {
      await botClient.sendToDevice(APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE, {
        [human.userId]: { [human.deviceId]: payload },
      } as any);
    } catch (e) {
      threw = e;
    }
    expect(
      threw,
      'the real SDK rejects a plain-object contentMap',
    ).toBeInstanceOf(TypeError);

    botClient.stopClient();
  });
});

// Poll the recipient's /sync for a to-device event of the given type. Repeated
// initial syncs (no `since`) keep returning pending to-device events until the
// device acknowledges them by syncing past their batch, so polling is stable.
async function pollForToDeviceEvent(
  accessToken: string,
  type: string,
  timeoutMs = 20_000,
): Promise<{ type: string; sender: string; content: any } | undefined> {
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let res = await sync(accessToken);
    let events = res?.to_device?.events ?? [];
    let match = events.find((e: { type: string }) => e.type === type);
    if (match) {
      return match;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}
