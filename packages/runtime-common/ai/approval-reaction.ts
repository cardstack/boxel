// A held tool call is approved the way a person approves anything in a
// chat: a 👍 on the message that asks. ai-bot holds a call it runs itself
// until a human answers it (see ToolRequest.approvalRequired); the answer is
// an `m.reaction` annotating the bot message that carries the call, so any
// Matrix client can give it, every member sees who gave it, and a room with
// several people reads as people approving, not as a button one of them
// pressed. 👍 approves the held calls on that message and 👎 declines them;
// ai-bot then posts each call's real result, which settles it.

export const APPROVE_REACTION_KEY = '👍';
export const DECLINE_REACTION_KEY = '👎';

export type ApprovalVerdict = 'approve' | 'decline';

export interface ApprovalReaction {
  verdict: ApprovalVerdict;
  // who reacted: the person whose answer this is
  sender: string;
  // the bot message the reaction annotates, which carries the held calls
  targetEventId: string;
  // the reaction event itself
  eventId?: string;
}

interface ReactionLike {
  type: string;
  sender?: string;
  event_id?: string;
  content?: unknown;
}

// a thumb in any skin tone, with or without the emoji presentation selector
const THUMB_DECORATION = new RegExp(
  ['FE0F', '1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']
    .map((code) => `\\u{${code}}`)
    .join('|'),
  'gu',
);

function verdictForKey(key: unknown): ApprovalVerdict | undefined {
  if (typeof key !== 'string') {
    return undefined;
  }
  let bare = key.replace(THUMB_DECORATION, '').trim();
  if (bare === APPROVE_REACTION_KEY) {
    return 'approve';
  }
  if (bare === DECLINE_REACTION_KEY) {
    return 'decline';
  }
  return undefined;
}

// The approval answer an event gives, if it is one: an `m.reaction`
// annotation keyed 👍 or 👎. A redacted reaction has lost its content and
// gives none.
export function approvalReaction(
  event: ReactionLike,
): ApprovalReaction | undefined {
  if (event.type !== 'm.reaction' || !event.sender) {
    return undefined;
  }
  let relation = (event.content as Record<string, any> | undefined)?.[
    'm.relates_to'
  ];
  if (
    relation?.rel_type !== 'm.annotation' ||
    typeof relation.event_id !== 'string'
  ) {
    return undefined;
  }
  let verdict = verdictForKey(relation.key);
  if (!verdict) {
    return undefined;
  }
  return {
    verdict,
    sender: event.sender,
    targetEventId: relation.event_id,
    eventId: event.event_id,
  };
}

// The answer each bot message got: the first human 👍 or 👎 on it, in
// history order. The bot's own reactions never answer, and a later reaction
// does not overturn an earlier one: whoever answered first decided.
export function approvalReactionsByEvent(
  history: ReactionLike[],
  aiBotUserId: string,
): Map<string, ApprovalReaction> {
  let answers = new Map<string, ApprovalReaction>();
  for (let event of history) {
    let reaction = approvalReaction(event);
    if (
      !reaction ||
      reaction.sender === aiBotUserId ||
      answers.has(reaction.targetEventId)
    ) {
      continue;
    }
    answers.set(reaction.targetEventId, reaction);
  }
  return answers;
}

// The reason a declined call's result carries, so the model reads who
// declined and does not ask again.
export function declinedByReactionReason(
  description: string,
  sender: string,
): string {
  return `${sender} declined this call (${description}) with a 👎. Do not request it again unless the user asks you to.`;
}
