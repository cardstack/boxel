import { IRoomEvent } from 'matrix-js-sdk';

const MODIFY_SYSTEM_MESSAGE =
  '\
The user is using an application called Boxel, where they are working on editing "Cards" which are data models representable as JSON. \
The user may be non-technical and should not need to understand the inner workings of Boxel. \
The user may be asking questions about the contents of the cards rather than help editing them. Use your world knowledge to help them. \
If the user wants the data they see edited, you MUST use the "patchCard" function to make the change. \
NEVER tell the user to use patchCard, you should always do it for them. \
If the user request is unclear, you may ask clarifying questions. \
You may make multiple function calls, all calls are gated by the user so multiple options can be explored.\
If a user asks you about things in the world, use your existing knowledge to help them. Only if necessary, add a *small* caveat at the end of your message to explain that you do not have live external data. \
\
If you need access to the cards the user can see, you can ask them to "send their open cards" to you.';

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
  const latestEventsMap = new Map<string, IRoomEvent>();
  for (let event of history) {
    let content = event.content;
    if (event.type == 'm.room.message') {
      let eventId = event.event_id!;
      if (content['m.relates_to']?.rel_type === 'm.replace') {
        eventId = content['m.relates_to']!.event_id!;
        event.event_id = eventId;
      }
      const existingEvent = latestEventsMap.get(eventId);
      if (
        !existingEvent ||
        existingEvent.origin_server_ts < event.origin_server_ts
      ) {
        latestEventsMap.set(eventId, event);
      }
    }
  }
  let latestEvents = Array.from(latestEventsMap.values());
  latestEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  return latestEvents;
}

interface OpenAIPromptMessage {
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

export function getRelevantCards(history: IRoomEvent[], aiBotUserId: string) {
  let cards = [];
  for (let event of history) {
    if (event.sender !== aiBotUserId) {
      let content = event.content;
      // If a user has uploaded a card, add it to the context
      // It's the best we have
      if (content.msgtype === 'org.boxel.card') {
        cards.push(content.instance);
      } else if (content.msgtype === 'org.boxel.message') {
        // If a user has switched to sharing their current context
        // and they have open cards then use those
        if (content.context.openCards.length > 0) {
          cards = content.context.openCards.map(
            (card: { data: any }) => card.data,
          );
        }
      } else {
        cards = [];
      }
    }
  }
  return cards;
}

export function getFunctions(history: IRoomEvent[], aiBotUserId: string) {
  let functions: { name: string; description: string; parameters: any }[] = [];
  for (let event of history) {
    if (event.sender !== aiBotUserId) {
      let content = event.content;
      if (content.msgtype === 'org.boxel.message') {
        // If a user has switched to sharing their current context
        // and they have open cards then use those
        if (content.context.cardSpec) {
          functions = [
            {
              name: 'patchCard',
              description: `Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. Ensure the description explains what change you are making`,
              parameters: {
                type: 'object',
                properties: {
                  description: {
                    type: 'string',
                  },
                  card_id: {
                    type: 'string',
                  },
                  attributes: content.context.cardSpec,
                },
                required: ['card_id', 'attributes', 'description'],
              },
            },
          ];
          console.log('Set functions', functions);
        }
      } else {
        console.log('Blanking out functions');
        functions = [];
      }
    }
  }
  return functions;
}

export function getModifyPrompt(history: IRoomEvent[], aiBotUserId: string) {
  // Need to make sure the passed in username is a full id
  if (
    aiBotUserId.indexOf(':') === -1 ||
    aiBotUserId.startsWith('@') === false
  ) {
    throw new Error("Username must be a full id, e.g. '@ai-bot:localhost'");
  }
  let historicalMessages: OpenAIPromptMessage[] = [];
  for (let event of history) {
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
