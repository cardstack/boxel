import type { MatrixClient } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events.js';

import { logger, uuidv4 } from '@cardstack/runtime-common';
import { describeCheckTargetCount } from '@cardstack/runtime-common/ai/correctness-targets';
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

import { errorReporter } from './sentry.ts';

let log = logger('ai-bot');

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

// Sends the checks for a reply's edits. They go in as few events as fit
// Matrix's size limit, each holding one check request for its share of the
// targets, so a bulk edit is checked in full however many cards it changed.
// The events all relate to the reply, and the first holds the modules.
// When an event after the first fails to send, the error is reported and not
// thrown: the error message the caller would post would end the group, while
// the result of an event already sent brings the bot back to send the rest.
export async function publishCodePatchCorrectnessMessage(
  summary: PendingCodePatchCorrectnessCheck,
  client: MatrixClient,
  maxContentBytes = MAX_MATRIX_EVENT_CONTENT_BYTES,
) {
  let events = buildCodePatchCorrectnessEvents(summary, maxContentBytes);
  for (let [index, content] of events.entries()) {
    try {
      await client.sendEvent(summary.roomId, 'm.room.message', content);
    } catch (error) {
      if (index === 0) {
        throw error;
      }
      log.error(
        `Sent ${index} of ${events.length} correctness events for ${summary.targetEventId}; the rest are sent once a result comes back`,
        error,
      );
      errorReporter.captureException(error, {
        extra: {
          roomId: summary.roomId,
          targetEventId: summary.targetEventId,
          sentEvents: index,
          totalEvents: events.length,
        },
      });
      return;
    }
  }
}

// Each part's size is counted from the size of an event with no targets and
// the description of all of them, which is at least as long as any part's,
// so every event fits the budget.
export function buildCodePatchCorrectnessEvents(
  summary: PendingCodePatchCorrectnessCheck,
  maxContentBytes = MAX_MATRIX_EVENT_CONTENT_BYTES,
): CorrectnessEventContent[] {
  let events: CorrectnessEventContent[] = [];
  let part: CheckCorrectnessTarget[] = [];
  let partBytes = 0;
  let targets = buildCheckCorrectnessTargets(summary);
  let emptyBytes = contentBytes(
    buildEventContent(summary, [], describeTargets(targets)),
  );
  for (let target of targets) {
    let fitted = fitTarget(target, maxContentBytes - emptyBytes);
    let bytes = targetBytes(fitted);
    if (part.length && emptyBytes + partBytes + bytes > maxContentBytes) {
      events.push(buildEventContent(summary, part));
      part = [];
      partBytes = 0;
    }
    part.push(fitted);
    partBytes += bytes;
  }
  if (part.length) {
    events.push(buildEventContent(summary, part));
  }
  return events;
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

function buildEventContent(
  summary: PendingCodePatchCorrectnessCheck,
  targets: CheckCorrectnessTarget[],
  description = describeTargets(targets),
): CorrectnessEventContent {
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
      description,
      attributes: { targets },
    },
  };
  content[APP_BOXEL_TOOL_REQUESTS_KEY] = encodeToolRequests([request]);
  return content;
}

function describeTargets(targets: CheckCorrectnessTarget[]): string {
  return `Check ${describeCheckTargetCount(targets)}`;
}

function contentBytes(content: CorrectnessEventContent): number {
  return Buffer.byteLength(JSON.stringify(content));
}

// What a target adds to the content: its JSON, escaped into the request's
// arguments string, and the comma before it (the first target has none, so
// this is never short).
function targetBytes(target: CheckCorrectnessTarget): number {
  return Buffer.byteLength(JSON.stringify(JSON.stringify(target))) - 2 + 1;
}

// A target too large for an event of its own (thousands of lint issues)
// keeps as many lint issues as fit, and a last line counting the rest.
function fitTarget(
  target: CheckCorrectnessTarget,
  maxBytes: number,
): CheckCorrectnessTarget {
  let lintIssues = target.lintIssues;
  if (!lintIssues?.length || targetBytes(target) <= maxBytes) {
    return target;
  }
  let kept = lintIssues.length;
  let fitted: CheckCorrectnessTarget;
  do {
    kept = Math.floor(kept / 2);
    fitted = {
      ...target,
      lintIssues: [
        ...lintIssues.slice(0, kept),
        `…and ${lintIssues.length - kept} more lint issues`,
      ],
    };
  } while (kept > 0 && targetBytes(fitted) > maxBytes);
  return fitted;
}
