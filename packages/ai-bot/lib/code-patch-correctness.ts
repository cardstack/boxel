import type { MatrixClient } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events.js';

import { uuidv4 } from '@cardstack/runtime-common';
import { describeCheckTargetCount } from '@cardstack/runtime-common/ai/correctness-targets';
import { externalizeOversizedFields } from '@cardstack/runtime-common/ai/external-fields';
import type { PendingCodePatchCorrectnessCheck } from '@cardstack/runtime-common/ai/types';
import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  MAX_MATRIX_EVENT_CONTENT_BYTES,
} from '@cardstack/runtime-common/matrix-constants';
import {
  encodeToolRequests,
  type ToolRequest,
} from '@cardstack/runtime-common/commands';

import { uploadToMatrix } from './bot-tools/results.ts';

export const CHECK_CORRECTNESS_TOOL_NAME = 'checkCorrectness';

// One file or card in a check request. `attempt` is left out on a target's
// first automated round.
export interface CheckCorrectnessTarget {
  type: 'file' | 'card';
  ref: string;
  lintIssues?: string[];
  attempt?: number;
}

type CorrectnessEventContent = RoomMessageEventContent &
  Record<string, unknown>;

// The content budget for a correctness event. AI_BOT_MAX_EVENT_CONTENT_BYTES
// lowers it, so a live run can send its requests through Matrix media without
// a bulk edit large enough to need it.
export function maxCorrectnessEventContentBytes(): number {
  let override = Number(process.env.AI_BOT_MAX_EVENT_CONTENT_BYTES);
  return Number.isInteger(override) && override > 0
    ? override
    : MAX_MATRIX_EVENT_CONTENT_BYTES;
}

// Sends the checks for a reply's edits as one event, with one check request
// for all of its targets. When the event would pass Matrix's size limit, the
// request is carried in Matrix media (externalizeOversizedFields), so a bulk
// edit is checked in full however many cards it changed.
export async function publishCodePatchCorrectnessMessage(
  summary: PendingCodePatchCorrectnessCheck,
  client: MatrixClient,
  maxContentBytes = maxCorrectnessEventContentBytes(),
) {
  let content = await externalizeOversizedFields(
    buildCodePatchCorrectnessEvent(summary),
    [APP_BOXEL_TOOL_REQUESTS_KEY],
    (json) => uploadToMatrix(client, json, 'application/json'),
    maxContentBytes,
  );
  await client.sendEvent(summary.roomId, 'm.room.message', content);
}

// Modules first, since one broken definition breaks every instance of it,
// then the other files, then the cards.
export function buildCheckCorrectnessTargets(
  summary: PendingCodePatchCorrectnessCheck,
): CheckCorrectnessTarget[] {
  let attemptsByTargetKey = summary.attemptsByTargetKey ?? {};
  let attemptFor = (type: string, ref: string) =>
    attemptsByTargetKey[`${type}:${ref}|event:${summary.targetEventId}`] ?? 1;
  let files = summary.files.map((file): CheckCorrectnessTarget => {
    let ref = file.sourceUrl || file.displayName;
    let attempt = attemptFor('file', ref);
    return {
      type: 'file',
      ref,
      ...(file.lintIssues?.length ? { lintIssues: file.lintIssues } : {}),
      ...(attempt > 1 ? { attempt } : {}),
    };
  });
  let cards = summary.cards.map((card): CheckCorrectnessTarget => {
    let attempt = attemptFor('card', card.cardId);
    return {
      type: 'card',
      ref: card.cardId,
      ...(attempt > 1 ? { attempt } : {}),
    };
  });
  let isModule = (target: CheckCorrectnessTarget) =>
    target.ref.endsWith('.gts');
  return [
    ...files.filter(isModule),
    ...files.filter((target) => !isModule(target)),
    ...cards,
  ];
}

export function buildCodePatchCorrectnessEvent(
  summary: PendingCodePatchCorrectnessCheck,
): CorrectnessEventContent {
  let targets = buildCheckCorrectnessTargets(summary);
  let content = {
    body: '',
    msgtype: APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
    format: 'org.matrix.custom.html',
    'm.relates_to': {
      rel_type: APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
      event_id: summary.targetEventId,
    },
    isStreamingFinished: true,
  } as unknown as CorrectnessEventContent;
  // The host reads only the agent id from this event's context, to decide
  // which of the user's tabs runs the checks. The rest of the reply's
  // context (its tool definitions among it) would only take up room.
  let agentId = summary.context?.agentId;
  if (agentId) {
    content.data = { context: { agentId } };
  }
  let request: Partial<ToolRequest> = {
    id: `check-${uuidv4()}`,
    name: CHECK_CORRECTNESS_TOOL_NAME,
    arguments: {
      description: `Check ${describeCheckTargetCount(targets)}`,
      attributes: { targets },
    },
  };
  content[APP_BOXEL_TOOL_REQUESTS_KEY] = encodeToolRequests([request]);
  return content;
}
