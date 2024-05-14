import {
  Room,
  MatrixClient,
  type MatrixEvent,
  type IEventRelation,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import {
  type OpenAIPromptMessage,
  isPatchReactionEvent,
  isPatchCommandEvent,
} from '../helpers';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';

export async function setTitle(
  openai: OpenAI,
  client: MatrixClient,
  room: Room,
  history: DiscreteMatrixEvent[],
  userId: string,
  event?: MatrixEvent,
) {
  let startOfConversation: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: `You are a chat titling system, you must read the conversation and return a suggested title of no more than six words.
                Do NOT say talk or discussion or discussing or chat or chatting, this is implied by the context. 
                The user can optionally apply 'patchCard' by sending data about fields to update. 
                Explain the general actions and user intent.`,
    },
    ...getStartOfConversation(history, userId),
    ...getLatestPatchApplyMessage(history, event),
    {
      role: 'user',
      content: 'Create a short title for this chat, limited to 6 words.',
    },
  ];

  let result = await openai.chat.completions.create(
    {
      model: 'gpt-4o',
      messages: startOfConversation,
      stream: false,
    },
    {
      maxRetries: 5,
    },
  );
  let title = result.choices[0].message.content || 'no title';
  // strip leading and trailing quotes
  title = title.replace(/^"(.*)"$/, '$1');
  return await client.setRoomName(room.roomId, title);
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

export const getLatestPatchApplyMessage = (
  history: DiscreteMatrixEvent[],
  event?: MatrixEvent,
): OpenAIPromptMessage[] => {
  if (event) {
    let content = event.getContent();
    let messageRelation: IEventRelation | undefined = content['m.relates_to'];
    let eventId = messageRelation?.event_id;
    let commandEvent = history.find((e) => e.event_id === eventId);
    if (commandEvent === undefined) {
      return [];
    }
    if (isPatchCommandEvent(commandEvent)) {
      let patchString = JSON.stringify(commandEvent.content.data.command);
      return [
        {
          role: 'user',
          content: `Applying patch with the following data ${patchString}  
        `,
        },
      ];
    }
  }
  return [];
};

const roomTitleAlreadySet = (rawEventLog: DiscreteMatrixEvent[]) => {
  return (
    rawEventLog.filter((event) => event.type === 'm.room.name').length > 1 ??
    false
  );
};

const userAlreadyHasSentNMessages = (
  rawEventLog: DiscreteMatrixEvent[],
  botUserId: string,
  n = 5,
) => {
  return (
    rawEventLog.filter(
      (event) => event.sender !== botUserId && event.type === 'm.room.message',
    ).length >= n
  );
};

export function shouldSetRoomTitle(
  rawEventLog: DiscreteMatrixEvent[],
  aiBotUserId: string,
  event?: MatrixEvent,
) {
  return (
    (isPatchReactionEvent(event) ||
      userAlreadyHasSentNMessages(rawEventLog, aiBotUserId)) &&
    !roomTitleAlreadySet(rawEventLog)
  );
}
