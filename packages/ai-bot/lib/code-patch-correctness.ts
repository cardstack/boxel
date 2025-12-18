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
import { MAX_CORRECTNESS_FIX_ATTEMPTS } from '@cardstack/runtime-common/ai/correctness-constants';

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
  let data: Record<string, unknown> = {};
  if (summary.context) {
    data.context = summary.context;
  }
  if (summary.attemptsByTargetKey) {
    data.attemptsByTargetKey = summary.attemptsByTargetKey;
  }
  if (Object.keys(data).length > 0) {
    content.data = data;
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
  let attemptsByTargetKey = summary.attemptsByTargetKey ?? {};
  for (let file of summary.files) {
    let sourceRef = file.sourceUrl || file.displayName;
    let targetKey = summary.targetEventId
      ? `file:${sourceRef}|event:${summary.targetEventId}`
      : `file:${sourceRef}`;
    let correctnessCheckAttempt = attemptsByTargetKey[targetKey] ?? 1;
    if (correctnessCheckAttempt > MAX_CORRECTNESS_FIX_ATTEMPTS) {
      continue;
    }
    requests.push({
      id: `check-${uuidv4()}`,
      name: CHECK_CORRECTNESS_COMMAND_NAME,
      arguments: {
        description: `Check correctness of ${file.displayName}`,
        attributes: {
          targetType: 'file',
          targetRef: sourceRef,
          fileUrl: sourceRef,
          roomId: summary.roomId,
          targetEventId: summary.targetEventId,
          correctnessCheckAttempt,
        },
      },
    });
  }
  for (let card of summary.cards) {
    let targetKey = summary.targetEventId
      ? `card:${card.cardId}|event:${summary.targetEventId}`
      : `card:${card.cardId}`;
    let correctnessCheckAttempt = attemptsByTargetKey[targetKey] ?? 1;
    if (correctnessCheckAttempt > MAX_CORRECTNESS_FIX_ATTEMPTS) {
      continue;
    }
    requests.push({
      id: `check-${uuidv4()}`,
      name: CHECK_CORRECTNESS_COMMAND_NAME,
      arguments: {
        description: `Check correctness of ${card.cardId}`,
        attributes: {
          targetType: 'card',
          targetRef: card.cardId,
          cardId: card.cardId,
          roomId: summary.roomId,
          targetEventId: summary.targetEventId,
          correctnessCheckAttempt,
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

  let instruction = `Briefly summarize the most recent code changes or card patches for the user - list the files and cards that were patched.`;

  promptParts.messages = promptParts.messages ?? [];
  promptParts.messages.push({
    role: 'user',
    content: instruction,
  });
  promptParts.shouldRespond = true;
}
