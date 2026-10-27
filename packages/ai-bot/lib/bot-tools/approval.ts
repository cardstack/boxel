import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import { approvalReactionsByEvent } from '@cardstack/runtime-common/ai';
import type { ApprovalReaction } from '@cardstack/runtime-common/ai';
import {
  getToolRequests,
  isToolResultEventType,
  latestEventContent,
} from '@cardstack/runtime-common/matrix-constants';

// The approval flow every bot tool shares. A tool's turn may mark a call
// `approvalRequired` (see BotToolTurn.needsApproval); the bot then holds it, and
// the host shows it with Approve / Decline. Approve sends a result with the
// 'approved' key, which is not the call's outcome; the bot finds the
// approved calls here and runs them through the tool's turn, and their real
// results settle them. Decline sends an 'invalid' result, which settles the
// call without a run.
//
// A person can also answer with a reaction on the bot message that carries
// the calls (see runtime-common/ai/approval-reaction.ts): a 👍 approves every
// held call on it, as an 'approved' result does; a 👎 declines them, and the
// bot posts their 'invalid' results itself, naming who declined.

export interface ReleasedToolCall {
  toolName: string;
  call: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  };
  // The bot message carrying the call; its result relates back to it.
  requestEventId: string;
}

// The tool calls in `history` that have an outcome: a result other than a
// user's approval.
export function settledToolCallIds(
  history: DiscreteMatrixEvent[],
): Set<string> {
  let settled = new Set<string>();
  for (let event of history) {
    let content = event.content as Record<string, any>;
    if (
      isToolResultEventType(event.type) &&
      typeof content?.commandRequestId === 'string' &&
      content?.['m.relates_to']?.key !== 'approved'
    ) {
      settled.add(content.commandRequestId);
    }
  }
  return settled;
}

// The held calls of `toolNames` that a human has approved and that have no
// outcome yet. Worked out from the whole history, so an approval is honored
// whichever event the handler runs for — one whose own handler was stood
// down for a newer event is picked up by the next — and a call already run
// or declined is never released again. A human's approval of anything else
// (a call not held, a host tool) releases nothing, and the bot's own events
// never approve.
export function releasedToolCalls(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  toolNames: ReadonlySet<string>,
): ReleasedToolCall[] {
  let approved = approvedByResult(history, aiBotUserId);
  let reactions = approvalReactionsByEvent(history, aiBotUserId);
  return heldToolCalls(history, aiBotUserId, toolNames).filter(
    ({ call, requestEventId }) =>
      approved.has(call.id) ||
      reactions.get(requestEventId)?.verdict === 'approve',
  );
}

// Whether a bot message (a matrix-js-sdk event, edits applied or not)
// holds a call for approval, so a reaction on it is an answer
export function holdsCallForApproval(event: {
  getContent(): Record<string, any>;
  getOriginalContent?(): Record<string, any>;
}): boolean {
  return [event.getContent(), event.getOriginalContent?.()].some((content) =>
    (getToolRequests<{ approvalRequired?: boolean }>(content) ?? []).some(
      (request) => request?.approvalRequired === true,
    ),
  );
}

export interface DeclinedToolCall extends ReleasedToolCall {
  // the 👎 that declined it
  reaction: ApprovalReaction;
}

// The held calls of `toolNames` a person declined with a 👎 on their message
// and that have no outcome yet: the bot posts their 'invalid' results. A call
// approved by an 'approved' result first stays approved.
export function declinedToolCalls(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  toolNames: ReadonlySet<string>,
): DeclinedToolCall[] {
  let reactions = approvalReactionsByEvent(history, aiBotUserId);
  let approved = approvedByResult(history, aiBotUserId);
  let declined: DeclinedToolCall[] = [];
  for (let held of heldToolCalls(history, aiBotUserId, toolNames)) {
    let reaction = reactions.get(held.requestEventId);
    if (reaction?.verdict === 'decline' && !approved.has(held.call.id)) {
      declined.push({ ...held, reaction });
    }
  }
  return declined;
}

function approvedByResult(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Set<string> {
  let approved = new Set<string>();
  for (let event of history) {
    let content = event.content as Record<string, any>;
    if (
      isToolResultEventType(event.type) &&
      typeof content?.commandRequestId === 'string' &&
      content?.['m.relates_to']?.key === 'approved' &&
      event.sender &&
      event.sender !== aiBotUserId
    ) {
      approved.add(content.commandRequestId);
    }
  }
  return approved;
}

// Every call of `toolNames` the bot holds for approval that has no outcome
// yet, with the bot message carrying it.
function heldToolCalls(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  toolNames: ReadonlySet<string>,
): ReleasedToolCall[] {
  let settled = settledToolCallIds(history);
  let released: ReleasedToolCall[] = [];
  for (let event of history) {
    if (
      event.type !== 'm.room.message' ||
      event.sender !== aiBotUserId ||
      !event.event_id
    ) {
      continue;
    }
    for (let request of getToolRequests<{
      id?: string;
      name?: string;
      arguments?: unknown;
      approvalRequired?: boolean;
    }>(latestEventContent(event)) ?? []) {
      if (
        !request?.id ||
        !request.name ||
        !toolNames.has(request.name) ||
        request.approvalRequired !== true ||
        settled.has(request.id) ||
        released.some((entry) => entry.call.id === request.id)
      ) {
        continue;
      }
      released.push({
        toolName: request.name,
        call: {
          id: request.id,
          type: 'function',
          function: {
            name: request.name,
            arguments:
              typeof request.arguments === 'string'
                ? request.arguments
                : JSON.stringify(request.arguments ?? {}),
          },
        },
        requestEventId: event.event_id,
      });
    }
  }
  return released;
}

// Why an approval released no call for this handler to run: an earlier
// handler already took the call on ('claimed'), the call's outcome is
// already in the room ('settled'), or no held request for it can be found in
// the history ('missing'), which means the approved call will never run.
// Undefined when the approval's call is among the calls this handler runs.
export function unreleasedApproval(
  history: DiscreteMatrixEvent[],
  approvedId: string | undefined,
  released: ReleasedToolCall[],
  claimed: ReleasedToolCall[],
): 'claimed' | 'settled' | 'missing' | undefined {
  if (claimed.some((entry) => entry.call.id === approvedId)) {
    return undefined;
  }
  if (released.some((entry) => entry.call.id === approvedId)) {
    return 'claimed';
  }
  if (approvedId && settledToolCallIds(history).has(approvedId)) {
    return 'settled';
  }
  return 'missing';
}

// The approved calls this process has taken on running, so a call runs once
// however many events show its approval before its result lands. A claim
// lasts until the call's outcome is in the room, and is dropped if the
// result never reached it, so a later run can try again.
export class ApprovalClaims {
  #claimed = new Set<string>();

  // Claims and returns the released calls not already claimed, after
  // dropping claims on calls the history shows settled.
  claim(
    history: DiscreteMatrixEvent[],
    released: ReleasedToolCall[],
  ): ReleasedToolCall[] {
    let settled = settledToolCallIds(history);
    for (let id of this.#claimed) {
      if (settled.has(id)) {
        this.#claimed.delete(id);
      }
    }
    let fresh = released.filter((entry) => !this.#claimed.has(entry.call.id));
    for (let entry of fresh) {
      this.#claimed.add(entry.call.id);
    }
    return fresh;
  }

  release(callId: string): void {
    this.#claimed.delete(callId);
  }
}
