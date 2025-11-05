import type { MatrixEvent, IEventRelation } from 'matrix-js-sdk';
import type OpenAI from 'openai';
import type { MatrixClient, IRoomEvent } from 'matrix-js-sdk';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CommandResultWithOutputContent,
  CommandResultWithNoOutputContent,
  EncodedCommandRequest,
  CodePatchResultContent,
  CardMessageContent,
} from 'https://cardstack.com/base/matrix-event';
import type { ChatCompletionMessageParam } from 'openai/resources';
import {
  type OpenAIPromptMessage,
  isCodePatchResultStatusApplied,
  isCommandResultStatusApplied,
  attachedCardsToMessage,
  getRelevantCards,
} from '@cardstack/runtime-common/ai';
import { APP_BOXEL_COMMAND_REQUESTS_KEY } from '@cardstack/runtime-common/matrix-constants';

const SET_TITLE_SYSTEM_MESSAGE = `You are a chat titling system, you must read the conversation and return a suggested title of no more than six words.
Do NOT say talk or discussion or discussing or chat or chatting, this is implied by the context.
The user can optionally apply 'patchCardInstance' by sending data about fields to update.
Explain the general actions and user intent. If 'patchCardInstance' was used, express the title in an active sentence. Do NOT use the word "patch" in the title.`;

export async function setTitle(
  openai: OpenAI,
  client: MatrixClient,
  roomId: string,
  history: DiscreteMatrixEvent[],
  userId: string,
  event?: MatrixEvent,
) {
  let startOfConversation: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: SET_TITLE_SYSTEM_MESSAGE,
    },
    ...getStartOfConversation(history, userId),
    ...getLatestResultMessage(history, userId, event),
    {
      role: 'user',
      content: 'Create a short title for this chat, limited to 6 words.',
    },
  ];

  let result = await openai.chat.completions.create(
    {
      model: 'gpt-4o',
      messages: startOfConversation as ChatCompletionMessageParam[],
      stream: false,
    },
    {
      maxRetries: 5,
    },
  );
  let title = result.choices[0].message.content || 'no title';
  // strip leading and trailing quotes
  title = title.replace(/^"(.*)"$/, '$1');
  return await client.setRoomName(roomId, title);
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

export const getLatestResultMessage = (
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  event?: MatrixEvent,
): OpenAIPromptMessage[] => {
  if (!event) {
    return [];
  }
  let eventContent = event.getContent() as
    | CommandResultWithOutputContent
    | CommandResultWithNoOutputContent
    | CodePatchResultContent;
  let messageRelation: IEventRelation | undefined =
    eventContent['m.relates_to'];
  let eventId = messageRelation?.event_id;
  let resultSourceEvent = history.find((e) => e.event_id === eventId);
  if (resultSourceEvent === undefined) {
    return [];
  }
  let { mostRecentlyAttachedCard, attachedCards } = getRelevantCards(
    history,
    aiBotUserId,
  );

  let commandRequestId = (
    eventContent as
      | CommandResultWithOutputContent
      | CommandResultWithNoOutputContent
  ).commandRequestId;
  if (commandRequestId) {
    let commandRequests = (resultSourceEvent.content as CardMessageContent)[
      APP_BOXEL_COMMAND_REQUESTS_KEY
    ];
    if (commandRequests) {
      let commandRequest = commandRequests.find(
        (cr: Partial<EncodedCommandRequest>) => {
          return cr.id === commandRequestId;
        },
      );
      if (!commandRequest) {
        return [];
      }
      return [
        {
          role: 'user',
          content: `Applying tool call ${commandRequest.name} with args ${commandRequest.arguments}. Cards shared are: ${attachedCardsToMessage(
            mostRecentlyAttachedCard,
            attachedCards,
          )}`,
        },
      ];
    }
  }

  if (isCodePatchResultStatusApplied(event)) {
    return [
      {
        role: 'user',
        content: `File(s) updated via code patch. Cards shared are: ${attachedCardsToMessage(
          mostRecentlyAttachedCard,
          attachedCards,
        )}`,
      },
    ];
  }
  return [];
};

export const roomTitleAlreadySet = (rawEventLog: IRoomEvent[]) => {
  return (
    rawEventLog.filter((event) => event.type === 'm.room.name').length > 1 ||
    false
  );
};

const userAlreadyHasSentNMessages = (
  rawEventLog: IRoomEvent[],
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
  rawEventLog: IRoomEvent[],
  aiBotUserId: string,
  event?: MatrixEvent,
) {
  return (
    (isCommandResultStatusApplied(event) ||
      isCodePatchResultStatusApplied(event) ||
      userAlreadyHasSentNMessages(rawEventLog, aiBotUserId)) &&
    !roomTitleAlreadySet(rawEventLog)
  );
}
