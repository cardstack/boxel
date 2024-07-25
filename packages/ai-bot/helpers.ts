import {
  LooseCardResource,
  type LooseSingleCardDocument,
  type CardResource,
} from '@cardstack/runtime-common';
import { MODIFY_SYSTEM_MESSAGE } from '@cardstack/runtime-common/helpers/ai';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CardFragmentContent,
  CommandEvent,
  CommandResultEvent,
  ReactionEvent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';
import { MatrixEvent, type IRoomEvent } from 'matrix-js-sdk';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';

export const SKILL_INSTRUCTIONS_MESSAGE =
  '\nThe user has given you the following instructions. You must obey these instructions when responding to the user:\n';

type CommandMessage = {
  type: 'command';
  content: any;
};

type TextMessage = {
  type: 'text';
  content: string;
  complete: boolean;
};

export type Message = CommandMessage | TextMessage;

export function constructHistory(history: IRoomEvent[]) {
  /**
   * We send a lot of events to create messages,
   * as we stream updates to the UI. This works by
   * sending a new event with the full content and
   * information about which event it should replace
   *
   * This function is to construct the chat as a user
   * would see it - with only the latest event for each
   * message.
   */
  const fragments = new Map<string, CardFragmentContent>(); // eventId => fragment
  const latestEventsMap = new Map<string, DiscreteMatrixEvent>();
  for (let rawEvent of history) {
    if (rawEvent.content.data) {
      rawEvent.content.data = JSON.parse(rawEvent.content.data);
    }
    let event = { ...rawEvent } as DiscreteMatrixEvent;
    if (event.type !== 'm.room.message') {
      continue;
    }
    let eventId = event.event_id!;
    if (event.content.msgtype === 'org.boxel.cardFragment') {
      fragments.set(eventId, event.content);
      continue;
    } else if (event.content.msgtype === 'org.boxel.message') {
      let { attachedCardsEventIds, attachedSkillEventIds } = event.content.data;
      if (attachedCardsEventIds && attachedCardsEventIds.length > 0) {
        event.content.data.attachedCards = attachedCardsEventIds.map((id) =>
          serializedCardFromFragments(id, fragments),
        );
      }
      if (attachedSkillEventIds && attachedSkillEventIds.length > 0) {
        event.content.data.skillCards = attachedSkillEventIds.map((id) =>
          serializedCardFromFragments(id, fragments),
        );
      }
    }
    if (event.content['m.relates_to']?.rel_type === 'm.replace') {
      eventId = event.content['m.relates_to']!.event_id!;
      event.event_id = eventId;
    }
    const existingEvent = latestEventsMap.get(eventId);
    if (
      !existingEvent ||
      // we check the timestamps of the events because the existing event may
      // itself be an already replaced event. The idea is that you can perform
      // multiple replacements on an event. In order to prevent backing out a
      // subsequent replacement we also assert that the replacement timestamp is
      // after the event that it is replacing
      existingEvent.origin_server_ts < event.origin_server_ts
    ) {
      latestEventsMap.set(eventId, event);
    }
  }
  let latestEvents = Array.from(latestEventsMap.values());
  latestEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  return latestEvents;
}

function serializedCardFromFragments(
  eventId: string,
  fragments: Map<string, CardFragmentContent>,
): LooseSingleCardDocument {
  let fragment = fragments.get(eventId);
  if (!fragment) {
    throw new Error(
      `No card fragment found in fragments cache for event id ${eventId}`,
    );
  }
  let cardFragments: CardFragmentContent[] = [];
  let currentFragment: string | undefined = eventId;
  do {
    let fragment = fragments.get(currentFragment);
    if (!fragment) {
      throw new Error(
        `No card fragment found in cache for event id ${eventId}`,
      );
    }
    cardFragments.push(fragment);
    currentFragment = fragment.data.nextFragment;
  } while (currentFragment);

  cardFragments.sort((a, b) => (a.data.index = b.data.index));
  if (cardFragments.length !== cardFragments[0].data.totalParts) {
    throw new Error(
      `Expected to find ${cardFragments[0].data.totalParts} fragments for fragment of event id ${eventId} but found ${cardFragments.length} fragments`,
    );
  }
  return JSON.parse(
    cardFragments.map((f) => f.data.cardFragment).join(''),
  ) as LooseSingleCardDocument;
}

export interface OpenAIPromptMessage {
  /**
   * The contents of the message. `content` is required for all messages, and may be
   * null for assistant messages with function calls.
   */
  content: string | null;
  /**
   * The role of the messages author. One of `system`, `user`, `assistant`, or
   * `function`.
   */
  role: 'system' | 'user' | 'assistant' | 'tool';
  tool_calls?: ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

function setRelevantCards(
  cardMap: Map<string, CardResource> = new Map(),
  cards: LooseSingleCardDocument[] = [],
) {
  for (let card of cards) {
    if (card.data.id) {
      cardMap.set(card.data.id, card.data as CardResource);
    } else {
      throw new Error(`bug: don't know how to handle card without ID`);
    }
  }
  return cardMap;
}

interface RelevantCards {
  mostRecentlyAttachedCard: LooseCardResource | undefined;
  attachedCards: LooseCardResource[];
  skillCards: CardResource[];
}

function getMostRecentlyAttachedCard(attachedCards: LooseSingleCardDocument[]) {
  let cardResources = attachedCards.filter((c) => c.data.id).map((c) => c.data);
  return cardResources.length
    ? cardResources[cardResources.length - 1]
    : undefined;
}

export function getRelevantCards(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): RelevantCards {
  let mostRecentlyAttachedCard: LooseCardResource | undefined;
  let attachedCardMap = new Map<string, CardResource>();
  let skillCardMap = new Map<string, CardResource>();
  let latestMessageEventId = history
    .filter((ev) => ev.sender !== aiBotUserId && ev.type === 'm.room.message')
    .slice(-1)[0]?.event_id;
  for (let event of history) {
    if (event.type !== 'm.room.message') {
      continue;
    }
    if (event.sender !== aiBotUserId) {
      let { content } = event;
      if (content.msgtype === 'org.boxel.message') {
        setRelevantCards(attachedCardMap, content.data?.attachedCards);
        if (content.data?.attachedCards) {
          mostRecentlyAttachedCard = getMostRecentlyAttachedCard(
            content.data?.attachedCards,
          );
        }

        // setting skill card instructions only based on the latest boxel message event (not cumulative)
        if (event.event_id === latestMessageEventId) {
          setRelevantCards(skillCardMap, content.data?.skillCards);
        }
      }
    }
  }
  // Return the cards in a consistent manner
  let sortedCards = Array.from(attachedCardMap.values()).sort((a, b) => {
    return a.id.localeCompare(b.id);
  });

  let skillCards = Array.from(skillCardMap.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return {
    mostRecentlyAttachedCard: mostRecentlyAttachedCard,
    attachedCards: sortedCards,
    skillCards,
  };
}

export function getTools(history: DiscreteMatrixEvent[], aiBotUserId: string) {
  // Just get the users messages
  const userMessages = history.filter((event) => event.sender !== aiBotUserId);
  // Get the last message
  if (userMessages.length === 0) {
    // If the user has sent no messages, there are no relevant tools to return
    return [];
  }
  const lastMessage = userMessages[userMessages.length - 1];
  if (
    lastMessage.type === 'm.room.message' &&
    lastMessage.content.msgtype === 'org.boxel.message' &&
    lastMessage.content.data?.context?.tools
  ) {
    return lastMessage.content.data.context.tools;
  } else {
    // If it's a different message type, or there are no tools, return an empty array
    return [];
  }
}

export function isCommandResultEvent(
  event: DiscreteMatrixEvent,
): event is CommandResultEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === 'org.boxel.commandResult'
  );
}

export function isReactionEvent(
  event: DiscreteMatrixEvent,
): event is ReactionEvent {
  return (
    event.type === 'm.reaction' &&
    event.content['m.relates_to'].rel_type === 'm.annotation'
  );
}

function getReactionStatus(
  commandEvent: DiscreteMatrixEvent,
  history: DiscreteMatrixEvent[],
) {
  let maybeReactionEvent = history.find((e) => {
    if (
      isReactionEvent(e) &&
      e.content['m.relates_to']?.event_id === commandEvent.event_id
    ) {
      return true;
    }
    return false;
  });
  return maybeReactionEvent && isReactionEvent(maybeReactionEvent)
    ? maybeReactionEvent.content['m.relates_to'].key
    : undefined;
}

function getCommandResult(
  commandEvent: CommandEvent,
  history: DiscreteMatrixEvent[],
) {
  let maybeCommandResultEvent = history.find((e) => {
    if (
      isCommandResultEvent(e) &&
      e.content['m.relates_to']?.event_id === commandEvent.event_id
    ) {
      return true;
    }
    return false;
  });
  return maybeCommandResultEvent &&
    isCommandResultEvent(maybeCommandResultEvent)
    ? maybeCommandResultEvent.content.result
    : undefined;
}

function toToolCall(event: CommandEvent): ChatCompletionMessageToolCall {
  return {
    id: event.content.data.toolCall.id,
    function: {
      name: event.content.data.toolCall.name,
      arguments: JSON.stringify(event.content.data.toolCall.arguments),
    },
    type: 'function',
  };
}

function toPromptMessageWithToolResult(
  event: CommandEvent,
  history: DiscreteMatrixEvent[],
): OpenAIPromptMessage {
  let commandResult = getCommandResult(event as CommandEvent, history);
  if (commandResult) {
    return {
      role: 'tool',
      content: commandResult,
      tool_call_id: event.content.data.toolCall.id,
    };
  } else {
    let reactionStatus = getReactionStatus(event, history);
    return {
      role: 'tool',
      content: reactionStatus ?? 'pending',
      tool_call_id: event.content.data.toolCall.id,
    };
  }
}

export function getModifyPrompt(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  tools: Tool[] = [],
) {
  // Need to make sure the passed in username is a full id
  if (
    aiBotUserId.indexOf(':') === -1 ||
    aiBotUserId.startsWith('@') === false
  ) {
    throw new Error("Username must be a full id, e.g. '@ai-bot:localhost'");
  }
  let historicalMessages: OpenAIPromptMessage[] = [];
  for (let event of history) {
    if (event.type !== 'm.room.message') {
      continue;
    }
    if (isCommandResultEvent(event)) {
      continue;
    }
    let body = event.content.body;
    if (body) {
      if (event.sender === aiBotUserId) {
        if (isCommandEvent(event)) {
          historicalMessages.push({
            role: 'assistant',
            content: body,
            tool_calls: [toToolCall(event)],
          });
          historicalMessages.push(
            toPromptMessageWithToolResult(event, history),
          );
        } else {
          historicalMessages.push({
            role: 'assistant',
            content: body,
          });
        }
      } else {
        historicalMessages.push({
          role: 'user',
          content: body,
        });
      }
    }
  }

  let { mostRecentlyAttachedCard, attachedCards, skillCards } =
    getRelevantCards(history, aiBotUserId);
  let systemMessage =
    MODIFY_SYSTEM_MESSAGE +
    `
  The user currently has given you the following data to work with:
  Cards:\n`;
  systemMessage += attachedCardsToMessage(
    mostRecentlyAttachedCard,
    attachedCards,
  );

  if (skillCards.length) {
    systemMessage += SKILL_INSTRUCTIONS_MESSAGE;
    systemMessage += skillCardsToMessage(skillCards);
    systemMessage += '\n';
  }

  if (tools.length == 0) {
    systemMessage +=
      'You are unable to edit any cards, the user has not given you access, they need to open the card on the stack and let it be auto-attached';
  }

  let messages: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: systemMessage,
    },
  ];

  messages = messages.concat(historicalMessages);
  return messages;
}

export const attachedCardsToMessage = (
  mostRecentlyAttachedCard: LooseCardResource | undefined,
  attachedCards: LooseCardResource[],
) => {
  let a =
    mostRecentlyAttachedCard !== undefined
      ? `Most recently shared card: ${JSON.stringify(
          mostRecentlyAttachedCard,
        )}.\n`
      : ``;
  let b =
    attachedCards.length > 0
      ? `All previously shared cards: ${JSON.stringify(attachedCards)}.\n`
      : ``;
  return a + b;
};

export const skillCardsToMessage = (cards: CardResource[]) => {
  return `${JSON.stringify(
    cards.map((card) => card.attributes?.instructions),
  )}`;
};

export function cleanContent(content: string) {
  content = content.trim();
  if (content.endsWith('json')) {
    content = content.slice(0, -4);
  }
  return content.trim();
}

export const isCommandReactionEvent = (event?: MatrixEvent) => {
  if (event === undefined) {
    return false;
  }
  let content = event.getContent();
  return (
    event.getType() === 'm.reaction' &&
    content['m.relates_to']?.rel_type === 'm.annotation'
  );
};

export const isCommandReactionStatusApplied = (event?: MatrixEvent) => {
  if (event === undefined) {
    return false;
  }
  let content = event.getContent();
  return (
    isCommandReactionEvent(event) && content['m.relates_to']?.key === 'applied'
  );
};

export function isCommandEvent(
  event: DiscreteMatrixEvent,
): event is CommandEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === 'org.boxel.command' &&
    event.content.format === 'org.matrix.custom.html' &&
    typeof event.content.data === 'object' &&
    typeof event.content.data.toolCall === 'object'
  );
}
