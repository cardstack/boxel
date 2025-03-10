import {
  LooseCardResource,
  type LooseSingleCardDocument,
  type CardResource,
} from '@cardstack/runtime-common';
import { ToolChoice } from '@cardstack/runtime-common/helpers/ai';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CardFragmentContent,
  Tool,
  SkillsConfigEvent,
  ActiveLLMEvent,
  CardMessageEvent,
  CommandResultEvent,
  CommandDefinitionsEvent,
} from 'https://cardstack.com/base/matrix-event';
import { MatrixEvent, type IRoomEvent } from 'matrix-js-sdk';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_LLM,
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

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
): Promise<PromptParts> {
  let cardFragments: Map<string, CardFragmentContent> =
    extractCardFragmentsFromEvents(eventList);
  let history: DiscreteMatrixEvent[] = constructHistory(
    eventList,
    cardFragments,
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
  let skills = getEnabledSkills(eventList, cardFragments);
  let tools = getTools(history, skills, aiBotUserId);
  let toolChoice = getToolChoice(history, aiBotUserId);
  let messages = await getModifyPrompt(history, aiBotUserId, tools, skills);
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

export function extractCardFragmentsFromEvents(
  eventList: IRoomEvent[],
): Map<string, CardFragmentContent> {
  const fragments = new Map<string, CardFragmentContent>(); // eventId => fragment
  for (let event of eventList) {
    if (event.type === 'm.room.message') {
      if (event.content.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE) {
        fragments.set(event.event_id, event.content as CardFragmentContent);
      }
    }
  }
  return fragments;
}

export function constructHistory(
  eventlist: IRoomEvent[],
  cardFragments: Map<string, CardFragmentContent>,
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
      event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
      event.content.msgtype == APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
    ) {
      let { cardEventId } = event.content.data;
      event.content.data.card = serializedCardFromFragments(
        cardEventId,
        cardFragments,
      );
    }
    if (
      event.type !== 'm.room.message' &&
      event.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE
    ) {
      continue;
    }
    let eventId = event.event_id!;
    if (event.content.msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE) {
      continue;
    }
    if (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
      let { attachedCardsEventIds } = event.content.data ?? {};
      if (attachedCardsEventIds && attachedCardsEventIds.length > 0) {
        event.content.data.attachedCards = attachedCardsEventIds.map(
          (id: string) => serializedCardFromFragments(id, cardFragments),
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

function getShouldRespond(history: DiscreteMatrixEvent[]): boolean {
  // If the aibot is awaiting command results, it should not respond yet.
  let lastEventExcludingCommandResults = history.findLast(
    (event) => event.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  );
  let commandRequests =
    lastEventExcludingCommandResults.content[APP_BOXEL_COMMAND_REQUESTS_KEY];
  if (!commandRequests || commandRequests.length === 0) {
    return true;
  }
  let lastEventIndex = history.indexOf(lastEventExcludingCommandResults);
  let allCommandsHaveResults = commandRequests.every(
    (commandRequest: CommandRequest) => {
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

function getEnabledSkills(
  eventlist: DiscreteMatrixEvent[],
  cardFragments: Map<string, CardFragmentContent>,
): LooseCardResource[] {
  let skillsConfigEvent = eventlist.findLast(
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;
  if (!skillsConfigEvent) {
    return [];
  }
  let enabledEventIds = skillsConfigEvent.content.enabledEventIds;
  return enabledEventIds.map(
    (id: string) => serializedCardFromFragments(id, cardFragments).data,
  );
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
      if (content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) {
        setRelevantCards(attachedCardMap, content.data?.attachedCards);
        if (content.data?.attachedCards) {
          mostRecentlyAttachedCard = getMostRecentlyAttachedCard(
            content.data?.attachedCards,
          );
        }
      }
    }
  }
  // Return the cards in a consistent manner
  let sortedCards = Array.from(attachedCardMap.values()).sort((a, b) => {
    return a.id.localeCompare(b.id);
  });

  return {
    mostRecentlyAttachedCard: mostRecentlyAttachedCard,
    attachedCards: sortedCards,
  };
}

export async function loadCurrentlyAttachedFiles(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Promise<
  {
    url: string;
    name: string;
    contentType?: string;
    content: string | undefined;
    error: string | undefined;
  }[]
> {
  let lastMessageEventByUser = history.findLast(
    (event) => event.sender !== aiBotUserId,
  );

  let mostRecentUserMessageContent = lastMessageEventByUser?.content as {
    msgtype?: string;
    data?: {
      attachedFiles?: { url: string; name: string; contentType?: string }[];
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
    attachedFiles.map(
      async (attachedFile: {
        url: string;
        name: string;
        contentType?: string;
      }) => {
        try {
          let content: string | undefined;
          let error: string | undefined;
          if (attachedFile.contentType?.startsWith('text/')) {
            let response = await (globalThis as any).fetch(attachedFile.url);
            if (!response.ok) {
              throw new Error(`HTTP error. Status: ${response.status}`);
            }
            content = await response.text();
          } else {
            error = `Unsupported file type: ${attachedFile.contentType}. For now, only text files are supported.`;
          }

          return {
            url: attachedFile.url,
            name: attachedFile.name,
            contentType: attachedFile.contentType,
            content,
            error,
          };
        } catch (error) {
          log.error(`Failed to fetch file ${attachedFile.url}:`, error);
          Sentry.captureException(error, {
            extra: { fileUrl: attachedFile.url, fileName: attachedFile.name },
          });
          return {
            url: attachedFile.url,
            name: attachedFile.name,
            contentType: attachedFile.contentType,
            content: undefined,
            error: `Error loading attached file: ${(error as Error).message}`,
          };
        }
      },
    ),
  );
}

export function attachedFilesToPrompt(
  attachedFiles: {
    url: string;
    name: string;
    contentType?: string;
    content: string | undefined;
    error: string | undefined;
  }[],
): string {
  if (!attachedFiles.length) {
    return 'No attached files';
  }
  return attachedFiles
    .map((f) => {
      if (f.error) {
        return `${f.name}: ${f.error}`;
      }

      return `${f.name}: ${f.content}`;
    })
    .join('\n');
}

export function getTools(
  history: DiscreteMatrixEvent[],
  enabledSkills: LooseCardResource[],
  aiBotUserId: string,
): Tool[] {
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

  // Iterate over the command definitions, and add any tools that are in
  // enabled skills to the tool map
  let commandDefinitionEvents: CommandDefinitionsEvent[] = history.filter(
    (event) =>
      event.type === 'm.room.message' &&
      event.content.msgtype === APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
  ) as CommandDefinitionsEvent[];

  for (let event of commandDefinitionEvents) {
    let { content } = event;
    let { commandDefinitions } = content.data;
    for (let commandDefinition of commandDefinitions) {
      if (enabledCommandNames.has(commandDefinition.tool.function.name)) {
        toolMap.set(
          commandDefinition.tool.function.name,
          commandDefinition.tool,
        );
      }
    }
  }

  // Add in tools from the user's messages
  for (let event of history) {
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

export function getToolChoice(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): ToolChoice {
  const lastUserMessage = history.findLast(
    (event) => event.sender !== aiBotUserId,
  );

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
  return (event.content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
    (commandRequest: CommandRequest) => {
      return {
        id: commandRequest.id,
        function: {
          name: commandRequest.name,
          arguments: JSON.stringify(commandRequest.arguments),
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
  return (event.content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
    (commandRequest: CommandRequest) => {
      let content = 'pending';
      let commandResult = commandResults.find(
        (commandResult) =>
          commandResult.content.commandRequestId === commandRequest.id,
      );
      if (commandResult) {
        let status = commandResult.content['m.relates_to']?.key;
        if (
          commandResult.content.msgtype ===
          APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
        ) {
          content = `Command ${status}, with result card: ${JSON.stringify(
            commandResult.content.data.card,
          )}.\n`;
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
      continue; // we'll include these with the tool calls
    }
    if (
      'isStreamingFinished' in event.content &&
      event.content.isStreamingFinished === false
    ) {
      continue;
    }
    let body = event.content.body;
    if (event.sender === aiBotUserId) {
      let toolCalls = toToolCalls(event);
      let historicalMessage: OpenAIPromptMessage = {
        role: 'assistant',
        content: body,
      };
      if (toolCalls.length) {
        historicalMessage.tool_calls = toolCalls;
      }
      historicalMessages.push(historicalMessage);
      if (toolCalls.length) {
        toPromptMessageWithToolResults(event, history).forEach((message) =>
          historicalMessages.push(message),
        );
      }
    }
    if (body && event.sender !== aiBotUserId) {
      if (
        event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE &&
        event.content.data?.context?.openCardIds
      ) {
        body = `User message: ${body}
          Context: the user has the following cards open: ${JSON.stringify(
            event.content.data.context.openCardIds,
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

  let attachedFiles = await loadCurrentlyAttachedFiles(history, aiBotUserId);

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

  if (tools.length == 0) {
    systemMessage +=
      'You are unable to edit any cards, the user has not given you access, they need to open the card on the stack and let it be auto-attached.';
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
