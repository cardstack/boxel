import type { MatrixClient } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';

import { uuidv4 } from '@cardstack/runtime-common';
import type { PromptParts } from '@cardstack/runtime-common/ai';
import type { PendingCodePatchCorrectnessCheck } from '@cardstack/runtime-common/ai/types';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
} from '@cardstack/runtime-common/matrix-constants';
import {
  encodeCommandRequests,
  type CommandRequest,
} from '@cardstack/runtime-common/commands';

export const CHECK_CORRECTNESS_COMMAND_NAME = 'checkCorrectness';

export async function publishCodePatchCorrectnessMessage(
  summary: PendingCodePatchCorrectnessCheck,
  client: MatrixClient,
) {
  let body = '';
  let commandRequests = buildCheckCorrectnessCommandRequests(summary);
  let baseContent = {
    body,
    msgtype: APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
    format: 'org.matrix.custom.html',
    'm.relates_to': {
      rel_type: APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
      event_id: summary.targetEventId,
    },
  } as unknown as RoomMessageEventContent;

  let content: RoomMessageEventContent & Record<string, unknown> = {
    ...baseContent,
    isStreamingFinished: true,
  };
  if (summary.context) {
    content.data = { context: summary.context };
  }
  if (commandRequests.length) {
    content[APP_BOXEL_COMMAND_REQUESTS_KEY] =
      encodeCommandRequests(commandRequests);
  }
  await client.sendEvent(summary.roomId, 'm.room.message', content);
}

export function buildCheckCorrectnessCommandRequests(
  summary: PendingCodePatchCorrectnessCheck,
): Partial<CommandRequest>[] {
  let requests: Partial<CommandRequest>[] = [];
  for (let file of summary.files) {
    let sourceRef = file.sourceUrl || file.displayName;
    requests.push({
      id: `check-${uuidv4()}`,
      name: CHECK_CORRECTNESS_COMMAND_NAME,
      arguments: {
        description: `Check correctness of ${file.displayName}`,
        attributes: {
          targetType: 'file',
          targetRef: sourceRef,
          fileUrl: sourceRef,
        },
      },
    });
  }
  for (let card of summary.cards) {
    requests.push({
      id: `check-${uuidv4()}`,
      name: CHECK_CORRECTNESS_COMMAND_NAME,
      arguments: {
        description: `Check correctness of ${card.cardId}`,
        attributes: {
          targetType: 'card',
          targetRef: card.cardId,
          cardId: card.cardId,
        },
      },
    });
  }
  return requests;
}

export function ensureLegacyPatchSummaryPrompt(promptParts: PromptParts) {
  if (!promptParts.pendingCodePatchCorrectnessChecks) {
    return;
  }

  let instruction = `Briefly summarize the recent code changes for the user. Max 1-2 sentences.`;

  promptParts.messages = promptParts.messages ?? [];
  promptParts.messages.push({
    role: 'user',
    content: instruction,
  });
  promptParts.shouldRespond = true;
}
