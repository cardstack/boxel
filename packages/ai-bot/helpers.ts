import {
  LooseCardResource,
  type LooseSingleCardDocument,
  type CardResource,
} from '@cardstack/runtime-common';
import { ToolChoice } from '@cardstack/runtime-common/helpers/ai';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  CardFragmentContent,
  CommandEvent,
  Tool,
  SkillsConfigEvent,
  ActiveLLMEvent,
  CommandResultEvent,
} from 'https://cardstack.com/base/matrix-event';
import { MatrixEvent, type IRoomEvent } from 'matrix-js-sdk';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '../runtime-common/matrix-constants';
import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_LLM,
  APP_BOXEL_ACTIVE_LLM,
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
If you encounter JSON structures, please enclose them within backticks to ensure they are displayed stylishly in Markdown.';

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

export interface PromptParts {
  tools: Tool[];
  messages: OpenAIPromptMessage[];
  model: string;
  history: DiscreteMatrixEvent[];
  toolChoice: ToolChoice;
}

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
  let skills = getEnabledSkills(eventList, cardFragments);
  let tools = getTools(history, aiBotUserId);
  let toolChoice = getToolChoice(history, aiBotUserId);
  let messages = await getModifyPrompt(history, aiBotUserId, tools, skills);
  let model = getModel(eventList);
  return {
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
      let { attachedCardsEventIds } = event.content.data;
      if (attachedCardsEventIds && attachedCardsEventIds.length > 0) {
        event.content.data.attachedCards = attachedCardsEventIds.map((id) =>
          serializedCardFromFragments(id, cardFragments),
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
  if (!lastMessageEventByUser?.content.data.attachedFiles) {
    return [];
  }
  let attachedFiles = lastMessageEventByUser.content.data.attachedFiles;

  return Promise.all(
    attachedFiles.map(
      async (attachedFile: {
        url: string;
        name: string;
        contentType?: string;
      }) => {
        try {
          let response = await fetch(attachedFile.url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          let content: string;

          if (attachedFile.contentType?.startsWith('text/')) {
            content = await response.text();
          } else {
            const buffer = await response.arrayBuffer();
            content = Buffer.from(buffer).toString('base64');
          }
          return {
            url: attachedFile.url,
            name: attachedFile.name,
            contentType: attachedFile.contentType,
            content,
            error: undefined,
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
        return `${f.url}: ${f.error}`;
      }
      return `${f.url}: ${f.content || 'Content loading skipped'}`; // We didn't load the file because this wasn't the last message
    })
    .join('\n');
}

export function getTools(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Tool[] {
  // Build map directly from messages
  let toolMap = new Map<string, Tool>();
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

function getCommandResult(
  commandEvent: CommandEvent,
  history: DiscreteMatrixEvent[],
) {
  let commandResultEvent = history.find((e) => {
    if (
      isCommandResultEvent(e) &&
      e.content['m.relates_to']?.event_id === commandEvent.event_id
    ) {
      return true;
    }
    return false;
  }) as CommandResultEvent | undefined;
  return commandResultEvent;
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
  let commandResult = getCommandResult(event, history);
  let content = 'pending';
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
    content,
    tool_call_id: event.content.data.toolCall.id,
  };
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
      continue;
    }
    if (
      'isStreamingFinished' in event.content &&
      event.content.isStreamingFinished === false
    ) {
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
  }

  let { mostRecentlyAttachedCard, attachedCards } = getRelevantCards(
    history,
    aiBotUserId,
  );

  let attachedFiles = await loadCurrentlyAttachedFiles(history, aiBotUserId);

  let systemMessage =
    MODIFY_SYSTEM_MESSAGE +
    `
  The user currently has given you the following data to work with: \n
  Attached code files:\n
  ${attachedFilesToPrompt(attachedFiles)}
  \n Cards:\n`;
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

export function isCommandEvent(
  event: DiscreteMatrixEvent,
): event is CommandEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === APP_BOXEL_COMMAND_MSGTYPE &&
    event.content.format === 'org.matrix.custom.html' &&
    typeof event.content.data === 'object' &&
    typeof event.content.data.toolCall === 'object'
  );
}

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
    event.content['m.relates_to']?.rel_type === 'm.annotation'
  );
}

export function eventRequiresResponse(event: MatrixEvent) {
  // If it's a message, we should respond unless it's a card fragment
  if (event.getType() === 'm.room.message') {
    if (event.getContent().msgtype === APP_BOXEL_CARDFRAGMENT_MSGTYPE) {
      return false;
    }
    return true;
  }

  // If it's a command result with output, we should respond
  if (
    event.getType() === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
    event.getContent().msgtype === APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
  ) {
    return true;
  }

  // If it's a different type, or a command result without output, we should not respond
  return false;
}
