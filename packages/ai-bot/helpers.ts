import {
  LooseCardResource,
  type LooseSingleCardDocument,
  type CardResource,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  REPLACE_MARKER,
} from '@cardstack/runtime-common';
import { ToolChoice } from '@cardstack/runtime-common/helpers/ai';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
  SkillsConfigEvent,
  ActiveLLMEvent,
  CardMessageEvent,
  CommandResultEvent,
  CardMessageContent,
  EncodedCommandRequest,
} from 'https://cardstack.com/base/matrix-event';
import { MatrixEvent, type IRoomEvent } from 'matrix-js-sdk';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_LLM,
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_DEBUG_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import { SerializedFileDef, downloadFile, MatrixClient } from './lib/matrix';
import { isRecognisedDebugCommand } from './lib/debug';

let log = logger('ai-bot');

const MODIFY_SYSTEM_MESSAGE =
  '\
The user is using an application called Boxel, where they are working on editing "Cards" which are data models representable as JSON. \
The user may be non-technical and should not need to understand the inner workings of Boxel. \
The user may be asking questions about the contents of the cards rather than help editing them. Use your world knowledge to help them. \
If the user request is unclear, you may ask clarifying questions. \
You may make multiple function calls, all calls are gated by the user so multiple options can be explored.\
If a user asks you about things in the world, use your existing knowledge to help them. Only if necessary, add a *small* caveat at the end of your message to explain that you do not have live external data. \
\
If you need access to the cards the user can see, you can ask them to attach the cards. \
If you encounter JSON structures, please enclose them within backticks to ensure they are displayed stylishly in Markdown. \
If you encounter code, please indent code using 2 spaces per tab stop and enclose the code within triple backticks and indicate the language after the opening backticks so that the code is displayed stylishly in Markdown.';

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

export type PromptParts =
  | {
      shouldRespond: true;
      tools: Tool[];
      messages: OpenAIPromptMessage[];
      model: string;
      history: DiscreteMatrixEvent[];
      toolChoice: ToolChoice;
    }
  | {
      shouldRespond: false;
      tools: undefined;
      messages: undefined;
      model: undefined;
      history: undefined;
      toolChoice: undefined;
    };

export type Message = CommandMessage | TextMessage;

export class HistoryConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryConstructionError';
  }
}

export async function getPromptParts(
  eventList: DiscreteMatrixEvent[],
  aiBotUserId: string,
  client: MatrixClient,
): Promise<PromptParts> {
  let history: DiscreteMatrixEvent[] = await constructHistory(
    eventList,
    client,
  );
  let shouldRespond = getShouldRespond(history);
  if (!shouldRespond) {
    return {
      shouldRespond: false,
      tools: undefined,
      messages: undefined,
      model: undefined,
      history: undefined,
      toolChoice: undefined,
    };
  }
  let skills = await getEnabledSkills(eventList, client);
  let tools = await getTools(eventList, skills, aiBotUserId, client);
  let toolChoice = getToolChoice(history, aiBotUserId);
  let messages = await getModifyPrompt(
    history,
    aiBotUserId,
    tools,
    skills,
    client,
  );
  let model = getModel(eventList);
  return {
    shouldRespond,
    tools,
    messages,
    model,
    history,
    toolChoice: toolChoice,
  };
}

export async function constructHistory(
  eventlist: IRoomEvent[],
  client: MatrixClient,
) {
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
  const latestEventsMap = new Map<string, DiscreteMatrixEvent>();
  for (let rawEvent of eventlist) {
    if (rawEvent.content.data) {
      try {
        rawEvent.content.data = JSON.parse(rawEvent.content.data);
      } catch (e) {
        Sentry.captureException(e, {
          attachments: [
            {
              data: rawEvent.content.data,
              filename: 'rawEventContentData.txt',
            },
          ],
        });
        log.error('Error parsing JSON', e);
        throw new HistoryConstructionError((e as Error).message);
      }
    }
    let event = { ...rawEvent } as DiscreteMatrixEvent;
    if (
      event.type !== 'm.room.message' &&
      event.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE
    ) {
      continue;
    }
    let eventId = event.event_id!;
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      let { attachedCards } = event.content.data ?? {};
      if (attachedCards && attachedCards.length > 0) {
        event.content.data.attachedCards = await Promise.all(
          attachedCards.map(async (attachedCard: SerializedFileDef) => {
            try {
              return {
                ...attachedCard,
                content: await downloadFile(client, attachedCard),
              };
            } catch (e) {
              return {
                ...attachedCard,
                error: `Error loading attached card: ${e}`,
              };
            }
          }),
        );
      }
    } else if (
      event.content.msgtype === APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE &&
      event.content.data.card
    ) {
      try {
        event.content.data.card = {
          ...event.content.data.card,
          content: await downloadFile(client, event.content.data.card),
        };
      } catch (e) {
        event.content.data.card = {
          ...event.content.data.card,
          error: `Error loading attached card: ${e}`,
        };
      }
    }

    // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
    if (event.content['m.relates_to']?.rel_type === 'm.replace') {
      // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
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

function getShouldRespond(history: DiscreteMatrixEvent[]): boolean {
  // If the aibot is awaiting command results, it should not respond yet.
  let lastEventExcludingCommandResults = history.findLast(
    (event) => event.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  );

  if (!lastEventExcludingCommandResults) {
    return false;
  }

  // if the last event is a debug command from the user, we should not respond
  if (
    lastEventExcludingCommandResults.type == 'm.room.message' &&
    isRecognisedDebugCommand(lastEventExcludingCommandResults.content.body)
  ) {
    return false;
  }

  let commandRequests = (
    lastEventExcludingCommandResults.content as CardMessageContent
  )[APP_BOXEL_COMMAND_REQUESTS_KEY];
  if (!commandRequests || commandRequests.length === 0) {
    return true;
  }
  let lastEventIndex = history.indexOf(lastEventExcludingCommandResults);
  let allCommandsHaveResults = commandRequests.every(
    (commandRequest: Partial<EncodedCommandRequest>) => {
      return history.slice(lastEventIndex).some((event) => {
        return (
          event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          event.content.commandRequestId === commandRequest.id
        );
      });
    },
  );
  return allCommandsHaveResults;
}

async function getEnabledSkills(
  eventlist: DiscreteMatrixEvent[],
  client: MatrixClient,
): Promise<LooseCardResource[]> {
  let skillsConfigEvent = eventlist.findLast(
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;
  if (!skillsConfigEvent) {
    return [];
  }

  let enabledSkillCards = skillsConfigEvent.content.enabledSkillCards;
  if (enabledSkillCards?.length) {
    return await Promise.all(
      enabledSkillCards?.map(async (cardFileDef: SerializedFileDef) => {
        let cardContent = await downloadFile(client, cardFileDef);
        return (JSON.parse(cardContent) as LooseSingleCardDocument)?.data;
      }),
    );
  }
  return [];
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
  for (let event of history) {
    if (event.type !== 'm.room.message') {
      continue;
    }

    if (event.sender !== aiBotUserId) {
      let { content } = event;
      let attachedCards = (content as CardMessageContent).data?.attachedCards
        ?.map((attachedCard: SerializedFileDef) =>
          attachedCard.content
            ? (JSON.parse(attachedCard.content) as LooseSingleCardDocument)
            : undefined,
        )
        .filter((card) => card !== undefined);
      if (content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE && attachedCards) {
        setRelevantCards(attachedCardMap, attachedCards);
        mostRecentlyAttachedCard = getMostRecentlyAttachedCard(attachedCards);
      }
    }
  }
  // Return the cards in a consistent manner
  let sortedCards = Array.from(attachedCardMap.values())
    .filter((card) => card.id) // Only include cards with valid IDs
    .sort((a, b) => String(a.id!).localeCompare(String(b.id!)));

  return {
    mostRecentlyAttachedCard: mostRecentlyAttachedCard,
    attachedCards: sortedCards,
  };
}

export async function loadCurrentlySerializedFileDefs(
  client: MatrixClient,
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Promise<SerializedFileDef[]> {
  let lastMessageEventByUser = history.findLast(
    (event) => event.sender !== aiBotUserId,
  );

  let mostRecentUserMessageContent = lastMessageEventByUser?.content as {
    msgtype?: string;
    data?: {
      attachedFiles?: SerializedFileDef[];
    };
  };

  if (
    !mostRecentUserMessageContent ||
    mostRecentUserMessageContent.msgtype !== APP_BOXEL_MESSAGE_MSGTYPE
  ) {
    return [];
  }

  // We are only interested in downloading the most recently attached files -
  // downloading older ones is not needed since the prompt that is being constructed
  // should operate on fresh data
  if (!mostRecentUserMessageContent.data?.attachedFiles?.length) {
    return [];
  }

  let attachedFiles = mostRecentUserMessageContent.data.attachedFiles;

  return Promise.all(
    attachedFiles.map(async (attachedFile: SerializedFileDef) => {
      try {
        let content = await downloadFile(client, attachedFile);

        return {
          url: attachedFile.url,
          sourceUrl: attachedFile.sourceUrl ?? '',
          name: attachedFile.name,
          contentType: attachedFile.contentType,
          content,
        };
      } catch (error) {
        log.error(`Failed to fetch file ${attachedFile.url}:`, error);
        Sentry.captureException(error, {
          extra: { fileUrl: attachedFile.url, fileName: attachedFile.name },
        });
        return {
          sourceUrl: attachedFile.sourceUrl ?? '',
          url: attachedFile.url,
          name: attachedFile.name,
          contentType: attachedFile.contentType,
          content: undefined,
          error: `Error loading attached file: ${(error as Error).message}`,
        };
      }
    }),
  );
}

export function attachedFilesToPrompt(
  attachedFiles: SerializedFileDef[],
): string {
  if (!attachedFiles.length) {
    return 'No attached files';
  }
  return attachedFiles
    .map((f) => {
      let hyperlink = f.sourceUrl ? `[${f.name}](${f.sourceUrl})` : f.name;
      if (f.error) {
        return `${hyperlink}: ${f.error}`;
      }

      return `${hyperlink}: ${f.content}`;
    })
    .join('\n');
}

export async function getTools(
  eventList: DiscreteMatrixEvent[],
  enabledSkills: LooseCardResource[],
  aiBotUserId: string,
  client: MatrixClient,
): Promise<Tool[]> {
  // Build map directly from messages
  let enabledCommandNames = new Set<string>();
  let toolMap = new Map<string, Tool>();

  // Get the list of all names from enabled skills
  for (let skill of enabledSkills) {
    if (skill.attributes?.commands) {
      let { commands } = skill.attributes;
      for (let command of commands) {
        enabledCommandNames.add(command.functionName);
      }
    }
  }

  let skillsConfigEvent = eventList.findLast(
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;

  let commandDefinitions = skillsConfigEvent?.content?.commandDefinitions ?? [];
  for (let commandDefinition of commandDefinitions) {
    if (enabledCommandNames.has(commandDefinition.name)) {
      let commandDefinitionContent = await downloadFile(
        client,
        commandDefinition,
      );
      let commandDefinitionObject = JSON.parse(commandDefinitionContent);
      toolMap.set(commandDefinition.name, commandDefinitionObject.tool);
    }
  }

  // Add in tools from the user's messages
  for (let event of eventList) {
    if (event.type !== 'm.room.message' || event.sender == aiBotUserId) {
      continue;
    }
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      let eventTools = event.content.data.context.tools;
      if (eventTools?.length) {
        for (let tool of eventTools) {
          toolMap.set(tool.function.name, tool);
        }
      }
    }
  }
  return Array.from(toolMap.values()).sort((a, b) =>
    a.function.name.localeCompare(b.function.name),
  );
}

export function getLastUserMessage(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): DiscreteMatrixEvent | undefined {
  return history.findLast((event) => event.sender !== aiBotUserId);
}

export function getToolChoice(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): ToolChoice {
  const lastUserMessage = getLastUserMessage(history, aiBotUserId);

  if (
    !lastUserMessage ||
    lastUserMessage.type !== 'm.room.message' ||
    lastUserMessage.content.msgtype !== APP_BOXEL_MESSAGE_MSGTYPE
  ) {
    // If the last message is not a user message, auto is safe
    return 'auto';
  }

  const messageContext = lastUserMessage.content.data.context;
  if (messageContext?.requireToolCall) {
    let tools = messageContext.tools || [];
    if (tools.length != 1) {
      throw new Error('Forced tool calls only work with a single tool');
    }
    return {
      type: 'function',
      function: {
        name: tools[0].function.name,
      },
    };
  }
  return 'auto';
}

function getCommandResults(
  cardMessageEvent: CardMessageEvent,
  history: DiscreteMatrixEvent[],
) {
  let commandResultEvents = history.filter((e) => {
    if (
      isCommandResultEvent(e) &&
      e.content['m.relates_to']?.event_id === cardMessageEvent.event_id
    ) {
      return true;
    }
    return false;
  }) as CommandResultEvent[];
  return commandResultEvents;
}

function toToolCalls(event: CardMessageEvent): ChatCompletionMessageToolCall[] {
  const content = event.content as CardMessageContent;
  return (content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
    (commandRequest: Partial<EncodedCommandRequest>) => {
      return {
        id: commandRequest.id!,
        function: {
          name: commandRequest.name!,
          arguments: commandRequest.arguments!,
        },
        type: 'function',
      };
    },
  );
}

function toPromptMessageWithToolResults(
  event: CardMessageEvent,
  history: DiscreteMatrixEvent[],
): OpenAIPromptMessage[] {
  let commandResults = getCommandResults(event, history);
  const messageContent = event.content as CardMessageContent;
  return (messageContent[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
    (commandRequest: Partial<EncodedCommandRequest>) => {
      let content = 'pending';
      let commandResult = commandResults.find(
        (commandResult) =>
          commandResult.content.commandRequestId === commandRequest.id,
      );
      if (commandResult) {
        let status = commandResult.content['m.relates_to']?.key;
        if (
          commandResult.content.msgtype ===
            APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE &&
          commandResult.content.data.card
        ) {
          let cardContent =
            commandResult.content.data.card.content ??
            commandResult.content.data.card.error;
          content = `Command ${status}, with result card: ${cardContent}.\n`;
        } else {
          content = `Command ${status}.\n`;
        }
      }
      return {
        role: 'tool',
        tool_call_id: commandRequest.id,
        content,
      };
    },
  );
}

export async function getModifyPrompt(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  tools: Tool[] = [],
  skillCards: LooseCardResource[] = [],
  client: MatrixClient,
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
    if (event.content.msgtype === APP_BOXEL_DEBUG_MESSAGE_MSGTYPE) {
      continue;
    }
    if (isCommandResultEvent(event)) {
      continue; // we'll include these with the tool calls
    }
    let content;
    if (event.unsigned?.['m.relations']?.['m.replace']) {
      content = event.unsigned['m.relations']['m.replace'].content;
    } else {
      content = event.content;
    }
    if (
      'isStreamingFinished' in content &&
      content.isStreamingFinished === false
    ) {
      continue;
    }
    let body = content.body;

    if (event.sender === aiBotUserId) {
      let toolCalls = toToolCalls(event as CardMessageEvent);
      let historicalMessage: OpenAIPromptMessage = {
        role: 'assistant',
        content: elideCodeBlocks(body),
      };
      if (toolCalls.length) {
        historicalMessage.tool_calls = toolCalls;
      }
      historicalMessages.push(historicalMessage);
      if (toolCalls.length) {
        toPromptMessageWithToolResults(
          event as CardMessageEvent,
          history,
        ).forEach((message) => historicalMessages.push(message));
      }
    }
    if (body && event.sender !== aiBotUserId) {
      if (
        content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE &&
        content.data?.context?.openCardIds
      ) {
        body = `User message: ${body}
          Context: the user has the following cards open: ${JSON.stringify(
            content.data.context.openCardIds,
          )}`;
      } else {
        body = `User message: ${body}
          Context: the user has no open cards.`;
      }
      historicalMessages.push({
        role: 'user',
        content: body,
      });
    }
  }

  let { mostRecentlyAttachedCard, attachedCards } = getRelevantCards(
    history,
    aiBotUserId,
  );

  let attachedFiles = await loadCurrentlySerializedFileDefs(
    client,
    history,
    aiBotUserId,
  );

  let systemMessage = `${MODIFY_SYSTEM_MESSAGE}
The user currently has given you the following data to work with:

Cards: ${attachedCardsToMessage(mostRecentlyAttachedCard, attachedCards)}

Attached files:
${attachedFilesToPrompt(attachedFiles)}
`;

  if (skillCards.length) {
    systemMessage += SKILL_INSTRUCTIONS_MESSAGE;
    systemMessage += skillCardsToMessage(skillCards);
    systemMessage += '\n';
  }

  let cardPatchTool = tools.find(
    (tool) => tool.function.name === 'patchCardInstance',
  );

  if (attachedFiles.length == 0 && attachedCards.length > 0 && !cardPatchTool) {
    systemMessage +=
      'You are unable to edit any cards, the user has not given you access, they need to open the card and let it be auto-attached.';
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

export const skillCardsToMessage = (cards: LooseCardResource[]) => {
  return cards.map((card) => card.attributes?.instructions).join('\n');
};

export function cleanContent(content: string) {
  content = content.trim();
  if (content.endsWith('json')) {
    content = content.slice(0, -4);
  }
  return content.trim();
}

export const isCommandResultStatusApplied = (event?: MatrixEvent) => {
  if (event === undefined) {
    return false;
  }
  return (
    isCommandResultEvent(event.event as DiscreteMatrixEvent) &&
    event.getContent()['m.relates_to']?.key === 'applied'
  );
};

function getModel(eventlist: DiscreteMatrixEvent[]): string {
  let activeLLMEvent = eventlist.findLast(
    (event) => event.type === APP_BOXEL_ACTIVE_LLM,
  ) as ActiveLLMEvent;
  if (!activeLLMEvent) {
    return DEFAULT_LLM;
  }
  return activeLLMEvent.content.model;
}

export function isCommandResultEvent(
  event?: DiscreteMatrixEvent,
): event is CommandResultEvent {
  if (event === undefined) {
    return false;
  }
  return (
    event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
    event.content['m.relates_to']?.rel_type ===
      APP_BOXEL_COMMAND_RESULT_REL_TYPE
  );
}

function elideCodeBlocks(content: string) {
  const PLACEHOLDER: string = '[Proposed code change]';

  while (
    content.includes(SEARCH_MARKER) &&
    content.includes(SEPARATOR_MARKER) &&
    content.includes(REPLACE_MARKER)
  ) {
    const searchStartIndex: number = content.indexOf(SEARCH_MARKER);
    const separatorIndex: number = content.indexOf(
      SEPARATOR_MARKER,
      searchStartIndex,
    );
    const replaceEndIndex: number = content.indexOf(
      REPLACE_MARKER,
      separatorIndex,
    );

    // replace the content between the markers with a placeholder
    content =
      content.substring(0, searchStartIndex) +
      PLACEHOLDER +
      content.substring(replaceEndIndex + REPLACE_MARKER.length);
  }
  return content;
}

export function mxcUrlToHttp(mxc: string, baseUrl: string): string {
  if (mxc.indexOf('mxc://') !== 0) {
    throw new Error('Invalid MXC URL ' + mxc);
  }
  let serverAndMediaId = mxc.slice(6); // strips mxc://
  let prefix = '/_matrix/client/v1/media/download/';

  return baseUrl + prefix + serverAndMediaId;
}

export function isInDebugMode(
  eventList: DiscreteMatrixEvent[],
  aiBotUserId: string,
): boolean {
  let lastUserMessage = getLastUserMessage(eventList, aiBotUserId);
  console.log('lastUserMessage', lastUserMessage);
  console.log('lastUserMessage.content', lastUserMessage?.content);
  console.log(
    'lastUserMessage.content.context',
    lastUserMessage?.content?.context,
  );
  if (
    !lastUserMessage ||
    !lastUserMessage.content ||
    typeof lastUserMessage.content !== 'object'
  ) {
    return false;
  }
  return (lastUserMessage.content as any).data?.context?.debug ?? false;
}
