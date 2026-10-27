import {
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  getToolRequests,
  isToolResultEventType,
  latestEventContent,
} from '../matrix-constants.ts';
import { approvalReaction } from './approval-reaction.ts';

export interface StopRuleEvent {
  type: string;
  sender?: string;
  event_id?: string;
  content?: unknown;
}

// Stop ends the assistant's loop, not only the turn that is streaming. ai-bot
// (deciding whether to generate and which of its own calls still run) and the
// host (deciding which tools still run and whether to offer Stop) both read
// the room through this one rule, so they agree on when a stop applies.
//
// The rule is about turns. A person's chat message starts a turn; everything
// until their next message (the bot's answers, tool results, further answers)
// belongs to it. A person's stop event stops the turn: nothing in it that has
// not started may start, and no result in it starts another answer. The stop
// holds until the person writes again, or asks for one of the turn's calls to
// go ahead after all (Run, Retry, Accept All, Approve): the host marks the
// result of such a call with `resumesAssistant`, which lifts the stop, and a
// 👍 on a bot message holding a call for approval lifts it the same way (see
// approval-reaction.ts). A 👍 on any other message is only a reaction. A
// decline or an automatic result never lifts it.
export interface StopState<T extends StopRuleEvent> {
  // The stop that holds at the end of the timeline, or undefined when the
  // loop is not stopped.
  inForce: T | undefined;
  // The bot messages whose turn is stopped now: their edits are not checked
  // for correctness, and Stop is not offered for them. A resuming result
  // takes the message it answers out again.
  stoppedMessageIds: ReadonlySet<string>;
  // The bot messages a stop ever hit. A tool of such a message that never got
  // a result must never start on its own, however the loop was resumed: the
  // person asked for one call, not the rest. Only grows.
  everStoppedMessageIds: ReadonlySet<string>;
}

// A bot message and its edits share one group of ids, so a result that
// relates to any edit resolves to the message.
type MessageIds = Set<string>;

// Reads the stop state at the end of `events`, which must be in timeline
// order.
export function readStopState<T extends StopRuleEvent>(
  events: readonly T[],
  aiBotUserId: string,
): StopState<T> {
  let groupById = new Map<string, MessageIds>();
  let currentTurn = new Set<MessageIds>();
  let turnStopped = false;
  let lastStop: T | undefined;
  let stoppedGroups = new Set<MessageIds>();
  let everStoppedMessageIds = new Set<string>();
  // The bot messages holding a call for approval, by any of their ids
  let heldGroups = new Set<MessageIds>();

  let endTurn = () => {
    if (turnStopped) {
      for (let group of currentTurn) {
        stoppedGroups.add(group);
      }
    }
  };

  for (let event of events) {
    if (!event.sender) {
      continue;
    }
    if (event.sender === aiBotUserId) {
      if (event.type !== 'm.room.message') {
        continue;
      }
      let group = groupFor(event, groupById);
      currentTurn.add(group);
      if (holdsCallForApproval(event)) {
        heldGroups.add(group);
      }
      if (turnStopped) {
        for (let id of group) {
          everStoppedMessageIds.add(id);
        }
      }
      continue;
    }
    if (isPersonMessage(event)) {
      endTurn();
      currentTurn = new Set();
      turnStopped = false;
    } else if (event.type === APP_BOXEL_STOP_GENERATING_EVENT_TYPE) {
      turnStopped = true;
      lastStop = event;
      for (let group of currentTurn) {
        for (let id of group) {
          everStoppedMessageIds.add(id);
        }
      }
    } else if (
      isResumingResult(event) ||
      isApprovingReaction(event, groupById, heldGroups)
    ) {
      turnStopped = false;
      let answered = relatedEventId(event);
      let group = answered ? groupById.get(answered) : undefined;
      if (group) {
        stoppedGroups.delete(group);
      }
    }
  }
  endTurn();

  let stoppedMessageIds = new Set<string>();
  for (let group of stoppedGroups) {
    for (let id of group) {
      stoppedMessageIds.add(id);
    }
  }
  return {
    inForce: turnStopped ? lastStop : undefined,
    stoppedMessageIds,
    everStoppedMessageIds,
  };
}

function groupFor(
  event: StopRuleEvent,
  groupById: Map<string, MessageIds>,
): MessageIds {
  let ids = [event.event_id, replacedEventId(event)].filter(
    (id): id is string => typeof id === 'string',
  );
  let group = ids.map((id) => groupById.get(id)).find(Boolean) ?? new Set();
  for (let id of ids) {
    group.add(id);
    groupById.set(id, group);
  }
  return group;
}

function content(event: StopRuleEvent): Record<string, any> | undefined {
  return event.content && typeof event.content === 'object'
    ? (event.content as Record<string, any>)
    : undefined;
}

function replacedEventId(event: StopRuleEvent): string | undefined {
  let relation = content(event)?.['m.relates_to'];
  return relation?.rel_type === 'm.replace' ? relation.event_id : undefined;
}

function relatedEventId(event: StopRuleEvent): string | undefined {
  return content(event)?.['m.relates_to']?.event_id;
}

function isPersonMessage(event: StopRuleEvent): boolean {
  if (event.type !== 'm.room.message') {
    return false;
  }
  let msgtype = content(event)?.msgtype;
  return (
    msgtype !== APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE &&
    msgtype !== APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
  );
}

// A person's 👍 on a bot message that holds a call for approval
function isApprovingReaction(
  event: StopRuleEvent,
  groupById: Map<string, MessageIds>,
  heldGroups: Set<MessageIds>,
): boolean {
  let reaction = approvalReaction(event);
  if (reaction?.verdict !== 'approve') {
    return false;
  }
  let group = groupById.get(reaction.targetEventId);
  return Boolean(group && heldGroups.has(group));
}

function holdsCallForApproval(event: StopRuleEvent): boolean {
  let eventContent = content(event);
  let contents = [
    latestEventContent(event as { content?: Record<string, any> }),
    eventContent?.['m.new_content'],
  ];
  return contents.some((c) =>
    (getToolRequests<{ approvalRequired?: boolean }>(c) ?? []).some(
      (request) => request?.approvalRequired === true,
    ),
  );
}

function isResumingResult(event: StopRuleEvent): boolean {
  return (
    isToolResultEventType(event.type) &&
    content(event)?.resumesAssistant === true
  );
}

// The failure reason a call carries when the stop kept it from running. It
// rides a 'canceled' tool result, so the model reads on the next turn that
// the call never ran and why.
export const STOPPED_TOOL_CALL_REASON =
  'The user stopped the assistant before this tool call ran.';
