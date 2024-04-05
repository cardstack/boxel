import { type LooseSingleCardDocument } from '@cardstack/runtime-common';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CardFragmentContent,
} from 'https://cardstack.com/base/room';
import { type IRoomEvent } from 'matrix-js-sdk';

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
      if (
        event.content.data.attachedCardsEventIds &&
        event.content.data.attachedCardsEventIds.length > 0
      ) {
        event.content.data.attachedCards =
          event.content.data.attachedCardsEventIds!.map((id) =>
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
  role: 'system' | 'user' | 'assistant';
}

export function getRelevantCards(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
) {
  let relevantCards: Map<string, any> = new Map();
  for (let event of history) {
    if (event.type !== 'm.room.message') {
      continue;
    }
    if (event.sender !== aiBotUserId) {
      let { content } = event;
      if (content.msgtype === 'org.boxel.message') {
        const attachedCards = content.data?.attachedCards || [];
        for (let card of attachedCards) {
          if (card.data.id) {
            relevantCards.set(card.data.id, card.data);
          } else {
            throw new Error(`bug: don't know how to handle card without ID`);
          }
        }
      }
    }
  }

  // Return the cards in a consistent manner
  let sortedCards = Array.from(relevantCards.values()).sort((a, b) => {
    return a.id.localeCompare(b.id);
  });
  return sortedCards;
}

export function getLastUserMessage(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
) {
  let lastMessage: DiscreteMatrixEvent | null = null;
  for (let event of history) {
    if (event.type === 'm.room.message' && event.sender !== aiBotUserId) {
      lastMessage = event;
    }
  }
  return lastMessage;
}

export function getFunctions(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
) {
  const lastMessage = getLastUserMessage(history, aiBotUserId);
  if (
    lastMessage !== null &&
    lastMessage.content.msgtype === 'org.boxel.message' &&
    lastMessage.content.data?.context?.functions
  ) {
    return lastMessage.content.data.context.functions;
  } else {
    // If it's a different message type, or there are no functions, return an empty array
    return [];
  }
}

export function shouldSetRoomTitle(
  rawEventLog: DiscreteMatrixEvent[],
  aiBotUserId: string,
  additionalCommands = 0, // These are any that have been sent since the event log was retrieved
) {
  // If the room title has been set already, we don't want to set it again
  let nameEvents = rawEventLog.filter((event) => event.type === 'm.room.name');
  if (nameEvents.length > 1) {
    return false;
  }

  // If there has been a command sent,
  // we should be at a stage where we can set the room title
  let commandsSent = rawEventLog.filter(
    (event) =>
      event.type === 'm.room.message' &&
      event.content.msgtype === 'org.boxel.command',
  );

  if (commandsSent.length + additionalCommands > 0) {
    return true;
  }

  // If there has been a 5 user messages we should still set the room title
  let userEvents = rawEventLog.filter(
    (event) => event.sender !== aiBotUserId && event.type === 'm.room.message',
  );
  if (userEvents.length >= 5) {
    return true;
  }

  return false;
}

export function getStartOfConversation(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  maxLength = 2000,
) {
  /**
   * Get just the start of the conversation
   * useful for summarizing while limiting the context
   */
  let messages: OpenAIPromptMessage[] = [];
  let totalLength = 0;
  for (let event of history) {
    if (event.type !== 'm.room.message') {
      continue;
    }
    let body = event.content.body;
    if (body && totalLength + body.length <= maxLength) {
      if (event.sender === aiBotUserId) {
        messages.push({
          role: 'assistant',
          content: body,
        });
      } else {
        messages.push({
          role: 'user',
          content: body,
        });
      }
      totalLength += body.length;
    }
  }
  return messages;
}

export function getLatestSystemPrompt(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
) {
  const lastUserMessage = getLastUserMessage(history, aiBotUserId);
  if (
    lastUserMessage !== null &&
    lastUserMessage.content.msgtype === 'org.boxel.message' &&
    lastUserMessage.content.data?.context?.systemPrompt
  ) {
    return lastUserMessage.content.data.context.systemPrompt;
  } else {
    return '';
  }
}

export function getModifyPrompt(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
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
    let body = event.content.body;
    if (body) {
      if (event.sender === aiBotUserId) {
        historicalMessages.push({
          role: 'assistant',
          content: body,
        });
      } else {
        // With a tool result we must also construct the message from the assistant with the tool call in it.
        if (event.content.data?.role == 'tool') {
          let toolCall = event.content.data.functionCall;
          let result = event.content.data.result;
          // tool call
          historicalMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: [toolCall],
          });
          // tool result
          historicalMessages.push({
            tool_call_id: toolCall.id,
            role: 'tool' as const,
            name: toolCall.function.name,
            content: JSON.stringify(result),
          });
        } else {
          historicalMessages.push({
            role: 'user',
            content: body,
          });
        }
      }
    }
  }

  let systemPrompt = getLatestSystemPrompt(history, aiBotUserId);
  systemPrompt = systemPrompt.replace(
    '{{ attachedCards }}',
    JSON.stringify(getRelevantCards(history, aiBotUserId)),
  );
  console.log('systemPrompt: ', systemPrompt);

  let messages: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ];

  messages = messages.concat(historicalMessages);
  console.log('messages to send: ', JSON.stringify(messages, null, 2));
  return messages;
}

export function cleanContent(content: string) {
  content = content.trim();
  content = content.replace(/```json/g, '');
  content = content.replace(/`/g, '');
  if (content.endsWith('json')) {
    content = content.slice(0, -4);
  }
  return content.trim();
}
