import {
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
} from '../matrix-constants.ts';

export interface StopRuleEvent {
  type: string;
  sender?: string;
  content?: { msgtype?: string } | unknown;
}

// Stop ends the assistant's loop, not only the turn that is streaming. A stop
// event from a person in the room holds until a person sends the next
// message: results of tools that were already running still land, but none
// of them starts another turn. Both ai-bot (deciding whether to generate) and
// the host (deciding which tools to still run and whether to offer Stop)
// read the room through this one rule, so they agree on when a stop applies.
//
// Returns the stop event in force at the end of `events` (in timeline order),
// or undefined when the loop is not stopped.
export function stopInForce<T extends StopRuleEvent>(
  events: readonly T[],
  aiBotUserId: string,
): T | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    let event = events[i];
    if (!event.sender || event.sender === aiBotUserId) {
      continue;
    }
    if (event.type === APP_BOXEL_STOP_GENERATING_EVENT_TYPE) {
      return event;
    }
    if (isPersonMessage(event)) {
      return undefined;
    }
  }
  return undefined;
}

function isPersonMessage(event: StopRuleEvent): boolean {
  if (event.type !== 'm.room.message') {
    return false;
  }
  let msgtype = (event.content as { msgtype?: string } | undefined)?.msgtype;
  return (
    msgtype !== APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE &&
    msgtype !== APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
  );
}

// The failure reason a call carries when the stop kept it from running. It
// rides a 'canceled' tool result, so the model reads on the next turn that
// the call never ran and why.
export const STOPPED_TOOL_CALL_REASON =
  'The user stopped the assistant before this tool call ran.';
