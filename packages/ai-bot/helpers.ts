import { type LooseSingleCardDocument } from '@cardstack/runtime-common';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CardFragmentContent,
} from 'https://cardstack.com/base/room';
import { type IRoomEvent } from 'matrix-js-sdk';

const MODIFY_SYSTEM_MESSAGE =
  '\
The user is using an application called Boxel, where they are working on editing "Cards" which are data models representable as JSON. \
The user may be non-technical and should not need to understand the inner workings of Boxel. \
The user may be asking questions about the contents of the cards rather than help editing them. Use your world knowledge to help them. \
If the user wants the data they see edited, AND the patchCard function is available, you MUST use the "patchCard" function to make the change. \
If the user wants the data they see edited, AND the patchCard function is NOT available, you MUST ask the user to open the card and share it with you \
If you do not call patchCard, the user will not see the change. \
You can ONLY modify cards shared with you, if there is no patchCard function or tool then the user hasn\'t given you access \
NEVER tell the user to use patchCard, you should always do it for them. \
If the user request is unclear, you may ask clarifying questions. \
You may make multiple function calls, all calls are gated by the user so multiple options can be explored.\
If a user asks you about things in the world, use your existing knowledge to help them. Only if necessary, add a *small* caveat at the end of your message to explain that you do not have live external data. \
\
If you need access to the cards the user can see, you can ask them to attach the cards.';

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
      let txnId = event.unsigned.transaction_id;
      fragments.set(txnId, event.content);
      continue;
    } else if (event.content.msgtype === 'org.boxel.message') {
      if (
        event.content.data.attachedCardsTxnIds &&
        event.content.data.attachedCardsTxnIds.length > 0
      ) {
        event.content.data.attachedCards =
          event.content.data.attachedCardsTxnIds!.map((id) =>
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
  txnId: string,
  fragments: Map<string, CardFragmentContent>,
): LooseSingleCardDocument {
  let fragment = fragments.get(txnId);
  if (!fragment) {
    throw new Error(
      `No card fragment found in fragments cache for txn id ${txnId}`,
    );
  }
  if (fragment.data.totalParts === 1) {
    return JSON.parse(fragment.data.cardFragment) as LooseSingleCardDocument;
  }

  let cardFragments = [
    fragment,
    ...[...fragments.values()]
      .filter((f) => f.data.firstFragment && f.data.firstFragment === txnId)
      .sort((a, b) => (a.data.index = b.data.index)),
  ];
  if (cardFragments.length !== fragment.data.totalParts) {
    throw new Error(
      `Expected to find ${fragment.data.totalParts} fragments for fragment of txn id ${txnId} but found ${cardFragments.length} fragments`,
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

export function getFunctions(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
) {
  // Just get the users messages
  const userMessages = history.filter((event) => event.sender !== aiBotUserId);
  // Get the last message
  if (userMessages.length === 0) {
    // If the user has sent no messages, there are no relevant functions to return
    return [];
  }
  const lastMessage = userMessages[userMessages.length - 1];
  if (
    lastMessage.type === 'm.room.message' &&
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
   * useful for summarising while limiting the context
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

export function getModifyPrompt(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  functions: any[] = [],
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
        historicalMessages.push({
          role: 'user',
          content: body,
        });
      }
    }
  }

  let systemMessage =
    MODIFY_SYSTEM_MESSAGE +
    `
  The user currently has given you the following data to work with:
  Cards:\n`;
  for (let card of getRelevantCards(history, aiBotUserId)) {
    systemMessage += `Full data: ${JSON.stringify(card)}`;
  }
  if (functions.length == 0) {
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

export function cleanContent(content: string) {
  content = content.trim();
  content = content.replace(/```json/g, '');
  content = content.replace(/`/g, '');
  if (content.endsWith('json')) {
    content = content.slice(0, -4);
  }
  return content.trim();
}
