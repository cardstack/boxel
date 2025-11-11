import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type {
  ChatCompletionMessageToolCall,
  OpenAIPromptMessage,
  PromptParts,
} from './types';
import { constructHistory } from './history';
import {
  downloadFile,
  extractCodePatchBlocks,
  isCommandOrCodePatchResult,
} from './matrix-utils';
import { isRecognisedDebugCommand } from './debug';
import type {
  ActiveLLMEvent,
  CardMessageContent,
  CardMessageEvent,
  CodePatchResultEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  EncodedCommandRequest,
  MatrixEventWithBoxelContext,
  SkillsConfigEvent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';
import type { SerializedFileDef } from 'https://cardstack.com/base/file-api';
import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_LLM,
} from '../matrix-constants';
import type { ReasoningEffort } from 'openai/resources/shared';
import type {
  CardResource,
  LooseCardResource,
  LooseSingleCardDocument,
} from '../index';
import type { ToolChoice } from '../helpers/ai';
import { logger } from '../log';

import { SKILL_INSTRUCTIONS_MESSAGE, SYSTEM_MESSAGE } from './constants';
import { humanReadable } from '../code-ref';
import { SEARCH_MARKER, REPLACE_MARKER, SEPARATOR_MARKER } from '../constants';

function getLog() {
  return logger('ai-bot:prompt');
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
      history: [],
      toolChoice: undefined,
      toolsSupported: undefined,
      reasoningEffort: undefined,
    };
  }
  let skills = await getEnabledSkills(eventList, client);
  let disabledSkillIds = await getDisabledSkillIds(eventList);
  let tools = await getTools(eventList, skills, aiBotUserId, client);
  let toolChoice = getToolChoice(history, aiBotUserId);
  let messages = await buildPromptForModel(
    history,
    aiBotUserId,
    tools,
    skills,
    disabledSkillIds,
    client,
  );
  let { model, toolsSupported, reasoningEffort } =
    getActiveLLMDetails(eventList);
  return {
    shouldRespond,
    tools,
    messages,
    model,
    history,
    toolChoice: toolChoice,
    toolsSupported,
    reasoningEffort,
  };
}

function getShouldRespond(history: DiscreteMatrixEvent[]): boolean {
  // If the aibot is awaiting command or code patch results, it should not respond yet.
  let lastEventExcludingResults = findLast(
    history,
    (event) => !isCommandOrCodePatchResult(event),
  );

  if (!lastEventExcludingResults) {
    return false;
  }

  // if the last event is a debug command from the user, we should not respond
  if (
    lastEventExcludingResults.type == 'm.room.message' &&
    isRecognisedDebugCommand(lastEventExcludingResults.content.body)
  ) {
    return false;
  }

  let commandRequests =
    (lastEventExcludingResults.content as CardMessageContent)[
      APP_BOXEL_COMMAND_REQUESTS_KEY
    ] ?? [];
  let codePatchBlocks = extractCodePatchBlocks(
    (lastEventExcludingResults.content as CardMessageContent).body,
  );
  let lastEventIndex = history.indexOf(lastEventExcludingResults);
  let recentEventsToCheck = history.slice(lastEventIndex + 1);

  let allCommandsHaveResults =
    commandRequests.length === 0 ||
    commandRequests.every((commandRequest: Partial<EncodedCommandRequest>) => {
      return recentEventsToCheck.some((event) => {
        return (
          event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          (event.content.msgtype ===
            APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE ||
            event.content.msgtype ===
              APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE) &&
          event.content.commandRequestId === commandRequest.id
        );
      });
    });
  let allCodePatchesHaveResults =
    codePatchBlocks.length === 0 ||
    codePatchBlocks.every((_codePatchBlock: string, codePatchIndex: number) => {
      return recentEventsToCheck.some((event) => {
        return (
          isCodePatchResultEvent(event) &&
          event.content.codeBlockIndex === codePatchIndex
        );
      });
    });
  return allCommandsHaveResults && allCodePatchesHaveResults;
}

async function getEnabledSkills(
  eventlist: DiscreteMatrixEvent[],
  client: MatrixClient,
): Promise<LooseCardResource[]> {
  let skillsConfigEvent = findLast(
    eventlist,
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

export async function getDisabledSkillIds(
  eventList: DiscreteMatrixEvent[],
): Promise<string[]> {
  let skillsConfigEvent = findLast(
    eventList,
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;
  if (!skillsConfigEvent) {
    return [];
  }
  return skillsConfigEvent.content.disabledSkillCards.map(
    (serializedFile) => serializedFile.sourceUrl,
  );
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
      let attachedCards: LooseSingleCardDocument[] =
        (content as CardMessageContent).data?.attachedCards
          ?.map((attachedCard: SerializedFileDef) =>
            attachedCard.content
              ? (JSON.parse(attachedCard.content) as LooseSingleCardDocument)
              : undefined,
          )
          .filter(
            (card): card is LooseSingleCardDocument => card !== undefined,
          ) || [];
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

export function hasSomeAttachedCards(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): boolean {
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
      if (attachedCards?.length) {
        return true;
      }
    }
  }

  return false;
}

export async function getAttachedCards(
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext,
  history: DiscreteMatrixEvent[],
) {
  let attachedCards = matrixEvent.content?.data?.attachedCards ?? [];
  let results = await Promise.all(
    attachedCards.map(async (attachedCard: SerializedFileDef) => {
      // If the file is attached later in the history, we should not include the content here
      let shouldIncludeContent = !history
        .slice(history.indexOf(matrixEvent) + 1)
        .some((event) => {
          // event is not always MatrixEventWithBoxelContext but casting lets us safely check attachedCards
          return (
            event as MatrixEventWithBoxelContext
          ).content?.data?.attachedCards?.some(
            (cardAttachment: SerializedFileDef) =>
              cardAttachment.sourceUrl === attachedCard.sourceUrl,
          );
        });
      let result: SerializedFileDef = {
        url: attachedCard.url,
        sourceUrl: attachedCard.sourceUrl ?? '',
        name: attachedCard.name,
        contentType: attachedCard.contentType,
      };
      if (shouldIncludeContent) {
        if (attachedCard.content) {
          result.content = JSON.parse(attachedCard.content);
        } else {
          try {
            result.content = await downloadFile(client, attachedCard);
          } catch (error) {
            getLog().error(`Failed to fetch file ${attachedCard.url}:`, error);
            result.error = `Error loading attached card: ${(error as Error).message}`;
            result.content = undefined;
          }
        }
      }
      return result;
    }),
  );
  results =
    results
      ?.filter((cardFileDef) => cardFileDef?.url) // Only include cards with valid urls
      ?.sort((a, b) => String(a!.url!).localeCompare(String(b!.url!))) ?? [];
  return results;
}

export async function getAttachedFiles(
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext,
  history: DiscreteMatrixEvent[],
): Promise<SerializedFileDef[]> {
  let attachedFiles = matrixEvent.content?.data?.attachedFiles ?? [];
  return Promise.all(
    attachedFiles.map(async (attachedFile: SerializedFileDef) => {
      // If the file is attached later in the history, we should not include the content here
      let shouldIncludeContent = !history
        .slice(history.indexOf(matrixEvent) + 1)
        .some((event) => {
          // event is not always MatrixEventWithBoxelContext but casting lets us safely check attachedFiles
          return (
            event as MatrixEventWithBoxelContext
          ).content?.data?.attachedFiles?.some(
            (file: SerializedFileDef) =>
              file.sourceUrl === attachedFile.sourceUrl,
          );
        });

      let result: SerializedFileDef = {
        url: attachedFile.url,
        sourceUrl: attachedFile.sourceUrl ?? '',
        name: attachedFile.name,
        contentType: attachedFile.contentType,
      };
      if (shouldIncludeContent) {
        try {
          result.content = await downloadFile(client, attachedFile);
        } catch (error) {
          getLog().error(`Failed to fetch file ${attachedFile.url}:`, error);
          result.error = `Error loading attached file: ${(error as Error).message}`;
          result.content = undefined;
        }
      }
      return result;
    }),
  );
}

export async function loadCurrentlySerializedFileDefs(
  client: MatrixClient,
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): Promise<SerializedFileDef[]> {
  let lastMessageEventByUser = findLast(
    history,
    (event) =>
      event.sender !== aiBotUserId &&
      ((event.type === 'm.room.message' &&
        event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE) ||
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE ||
        event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE),
  );

  let mostRecentUserMessageContent = lastMessageEventByUser?.content as {
    msgtype?: string;
    data?: {
      attachedFiles?: SerializedFileDef[];
    };
  };

  if (!mostRecentUserMessageContent) {
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
        getLog().error(`Failed to fetch file ${attachedFile.url}:`, error);
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

export function attachedFilesToMessage(
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

      if (f.content) {
        // Add line numbers to file content to make selection ranges clearer
        let lines = f.content.split('\n');
        let numberedContent = lines
          .map(
            (line, index) =>
              `${(index + 1).toString().padStart(3, ' ')}: ${line}`,
          )
          .join('\n');
        return `${hyperlink}:\n${numberedContent}`;
      } else {
        return `${hyperlink}`;
      }
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

  let skillsConfigEvent = findLast(
    eventList,
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
      let eventTools = event.content.data?.context?.tools;
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
  return findLast(history, (event) => event.sender !== aiBotUserId);
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

function getCodePatchResults(
  cardMessageEvent: CardMessageEvent,
  history: DiscreteMatrixEvent[],
) {
  let codePatchResultEvents = history.filter((e) => {
    if (
      isCodePatchResultEvent(e) &&
      e.content['m.relates_to']?.event_id === cardMessageEvent.event_id
    ) {
      return true;
    }
    return false;
  }) as CodePatchResultEvent[];
  return codePatchResultEvents;
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

async function toResultMessages(
  event: CardMessageEvent,
  commandResults: CommandResultEvent[] = [],
  codePatchResults: CodePatchResultEvent[] = [],
  client: MatrixClient,
  history: DiscreteMatrixEvent[],
): Promise<OpenAIPromptMessage[]> {
  const messageContent = event.content as CardMessageContent;
  let commandResultMessages = await Promise.all(
    (messageContent[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
      async (commandRequest: Partial<EncodedCommandRequest>) => {
        let content = 'pending';
        let commandResult = commandResults.find(
          (commandResult) =>
            (commandResult.content.msgtype ===
              APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE ||
              commandResult.content.msgtype ===
                APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE) &&
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
            content = `Tool call ${status == 'applied' ? 'executed' : status}, with result card: ${cardContent}.\n`;
          } else {
            content = `Tool call ${status == 'applied' ? 'executed' : status}.\n`;
          }
          let attachments = await buildAttachmentsMessagePart(
            client,
            commandResult,
            history,
          );
          content = [content, attachments].filter(Boolean).join('\n\n');
        }
        return {
          role: 'tool',
          tool_call_id: commandRequest.id,
          content,
        } as OpenAIPromptMessage;
      },
    ),
  );
  let codePatchBlocks = extractCodePatchBlocks(messageContent.body);
  let codePatchResultMessages: OpenAIPromptMessage[] = [];
  if (codePatchBlocks.length) {
    let codePatchResultsContent = (
      await Promise.all(
        codePatchBlocks.map(async (_codePatchBlock, codeBlockIndex) => {
          let codePatchResultEvent = codePatchResults.find(
            (codePatchResultEvent) =>
              codePatchResultEvent.content.codeBlockIndex === codeBlockIndex,
          );
          let content = `(The user has not applied code patch ${codeBlockIndex + 1}/.)`;
          if (codePatchResultEvent) {
            let status = codePatchResultEvent.content['m.relates_to']?.key;
            if (status === 'applied') {
              content = `(The user has successfully applied code patch ${codeBlockIndex + 1}.)`;
            } else if (status === 'failed') {
              content = `(The user tried to apply code patch ${codeBlockIndex + 1} but there was an error: ${codePatchResultEvent.content.failureReason})`;
            }
            let attachments = await buildAttachmentsMessagePart(
              client,
              codePatchResultEvent,
              history,
            );
            content = [content, attachments].filter(Boolean).join('\n\n');
          }
          return content;
        }),
      )
    ).join('\n');
    codePatchResultMessages.push({
      role: 'user',
      content: codePatchResultsContent,
    });
  }
  return [...commandResultMessages, ...codePatchResultMessages];
}

export async function buildPromptForModel(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  tools: Tool[] = [],
  skillCards: LooseCardResource[] = [],
  disabledSkillIds: string[] = [],
  client: MatrixClient,
) {
  // Need to make sure the passed in username is a full id
  if (
    aiBotUserId.indexOf(':') === -1 ||
    aiBotUserId.startsWith('@') === false
  ) {
    throw new Error("Username must be a full id, e.g. '@aibot:localhost'");
  }
  let historicalMessages: OpenAIPromptMessage[] = [];
  for (let event of history) {
    if (event.type !== 'm.room.message') {
      continue;
    }
    if (isCommandOrCodePatchResult(event)) {
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
      let codePatchResults = getCodePatchResults(
        event as CardMessageEvent,
        history,
      );
      let historicalMessage: OpenAIPromptMessage = {
        role: 'assistant',
        content: elideCodeBlocks(body, codePatchResults),
      };
      let toolCalls = toToolCalls(event as CardMessageEvent);
      if (toolCalls.length) {
        historicalMessage.tool_calls = toolCalls;
      }
      historicalMessages.push(historicalMessage);
      let commandResults = getCommandResults(
        event as CardMessageEvent,
        history,
      );
      (
        await toResultMessages(
          event as CardMessageEvent,
          commandResults,
          codePatchResults,
          client,
          history,
        )
      ).forEach((message) => historicalMessages.push(message));
    }
    if (event.sender !== aiBotUserId) {
      let attachments = await buildAttachmentsMessagePart(
        client,
        event as CardMessageEvent,
        history,
      );
      let content = [body, attachments].filter(Boolean).join('\n\n');
      if (content) {
        historicalMessages.push({
          role: 'user',
          content,
        });
      }
    }
  }
  let systemMessage = `${SYSTEM_MESSAGE}\n`;
  if (skillCards.length) {
    systemMessage += SKILL_INSTRUCTIONS_MESSAGE;
    systemMessage += skillCardsToMessage(skillCards);
    systemMessage += '\n';
  }

  let messages: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: systemMessage,
    },
  ];

  messages = messages.concat(historicalMessages);
  let contextContent = await buildContextMessage(
    client,
    history,
    aiBotUserId,
    tools,
    disabledSkillIds,
  );
  // The context should be placed where it explains the state of the host.
  // This is either:
  // * After the last tool call message, if the last message was a tool call
  // * Before the last user message otherwise
  // OpenAI will error if you put the system message between the
  // assistant and tool messages.
  let contextMessage: OpenAIPromptMessage = {
    role: 'system',
    content: contextContent,
  };
  let lastMessage = messages[messages.length - 1];
  if (lastMessage.role === 'tool') {
    messages.push(contextMessage);
  } else {
    // Find the last user message and insert context before it
    let lastUserIndex = findLastIndex(messages, (msg) => msg.role === 'user');
    if (lastUserIndex !== -1) {
      messages.splice(lastUserIndex, 0, contextMessage);
    }
  }

  return messages;
}

export const buildAttachmentsMessagePart = async (
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext,
  history: DiscreteMatrixEvent[],
) => {
  let attachedCards = await getAttachedCards(client, matrixEvent, history);
  let result = '';
  if (attachedCards.length > 0) {
    result += `Attached Cards (cards with newer versions don't show their content):\n${JSON.stringify(attachedCards, null, 2)}\n`;
  }
  let attachedFiles = await getAttachedFiles(client, matrixEvent, history);
  if (attachedFiles.length > 0) {
    result += `Attached Files (files with newer versions don't show their content):\n${attachedFilesToMessage(attachedFiles)}\n`;
  }
  return result;
};

export const buildContextMessage = async (
  client: MatrixClient,
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  tools: Tool[],
  disabledSkillIds: string[],
): Promise<string> => {
  let result = '';

  let attachedFiles = await loadCurrentlySerializedFileDefs(
    client,
    history,
    aiBotUserId,
  );

  let lastEventWithContext = findLast(history, (ev) => {
    if (ev.sender === aiBotUserId) {
      return false;
    }
    return (
      (ev.type === 'm.room.message' &&
        ev.content.msgtype == APP_BOXEL_MESSAGE_MSGTYPE) ||
      ev.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE ||
      ev.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE
    );
  }) as
    | CardMessageEvent
    | CommandResultEvent
    | CodePatchResultEvent
    | undefined;
  let context = lastEventWithContext?.content.data?.context;

  // Extract room ID from any event in history
  let roomId = history.find((event) => event.room_id)?.room_id;

  if (context) {
    result += `The user is currently viewing the following user interface:\n`;
    if (roomId) {
      result += `Room ID: ${roomId}\n`;
    }
    if (context?.submode) {
      result += `Submode: ${context.submode}\n`;
    }
    if (context?.realmUrl) {
      result += `Workspace: ${context.realmUrl}\n`;
    }
    if (context?.workspaces) {
      result += `Available workspaces:\n`;
      context.workspaces.forEach((workspace) => {
        result += ` - ${workspace.name} (${workspace.url})${workspace.type === 'catalog-workspace' ? ' - Catalog' : ''}\n`;
      });
      result += `\n`;
    }
    if (context?.openCardIds && context.openCardIds.length > 0) {
      result += `Open cards:\n${context.openCardIds.map((id) => ` - ${id}\n`)}`;
    } else {
      result += `The user has no open cards.\n`;
    }
    if (disabledSkillIds.length > 0) {
      result += `Disabled skills: ${disabledSkillIds.join(', ')}\n`;
    }
    if (context?.codeMode?.currentFile) {
      result += `File open in code editor: ${context.codeMode.currentFile}\n`;
      if (context?.codeMode?.selectedCodeRef) {
        result += `  Selected declaration: ${humanReadable(context.codeMode.selectedCodeRef)}\n`;

        // Add inheritance chain information if available
        if (
          context?.codeMode?.inheritanceChain &&
          context.codeMode.inheritanceChain.length > 0
        ) {
          result += `  Inheritance chain:\n`;
          context.codeMode.inheritanceChain.forEach((item, index) => {
            const indent = index === 0 ? '    ' : '      ';
            result += `${indent}${index + 1}. ${humanReadable(item.codeRef)}\n`;
            if (item.fields && item.fields.length > 0) {
              result += `${indent}   Fields: ${item.fields.join(', ')}\n`;
            }
          });
        }
      }
      if (context?.codeMode?.selectionRange) {
        const { startLine, startColumn, endLine, endColumn } =
          context.codeMode.selectionRange;
        if (startLine === endLine) {
          result += `  Selected text: line ${startLine} (1-based), columns ${startColumn}-${endColumn} (1-based)\n`;
        } else {
          result += `  Selected text: lines ${startLine}-${endLine} (1-based), columns ${startColumn}-${endColumn} (1-based)\n`;
        }
        result += `  Note: Line numbers in selection refer to the original file. Attached file contents below show line numbers for reference.\n`;
      }
    }
    if (context?.codeMode?.moduleInspectorPanel) {
      result += `Module inspector panel: ${context.codeMode.moduleInspectorPanel}\n`;
    }
    if (context?.codeMode?.activeSpecId) {
      result += `Active spec card: ${context.codeMode.activeSpecId}\n`;
    }
    if (context?.codeMode?.previewPanelSelection) {
      result += `Viewing card instance: ${context.codeMode.previewPanelSelection.cardId}\n`;
      result += `In format: ${context.codeMode.previewPanelSelection.format}\n`;
    }
    if (context.errorsDisplayed?.length) {
      result += `Errors display:\n`;
      context.errorsDisplayed.forEach((error) => {
        result += `  - ${error.message}\n`;
        if (error.stack) {
          result += `    Stack trace: ${error.stack}\n`;
        }
        if (error.sourceUrl) {
          result += `    Source URL: ${error.sourceUrl}\n`;
        }
      });
    }
  } else {
    result += `The user has no open cards.\n`;
  }
  result += `\nCurrent date and time: ${new Date().toISOString()}\n`;

  let cardPatchTool = tools.find(
    (tool) => tool.function.name === 'patchCardInstance',
  );

  if (
    attachedFiles.length == 0 &&
    !cardPatchTool &&
    hasSomeAttachedCards(history, aiBotUserId)
  ) {
    result +=
      'You are unable to edit any cards, the user has not given you access, they need to open the card and let it be auto-attached.';
  }

  return result;
};

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

export const skillCardsToMessage = (
  cards: Omit<LooseCardResource, 'meta'>[],
) => {
  return cards
    .map((card) => {
      let headerParts = [`id: ${card.id}`];
      if (card.attributes?.title) {
        headerParts.push(`title: ${card.attributes.title}`);
      }

      let header = `Skill (${headerParts.join(', ')}):`;
      let instructions =
        card.attributes?.instructions?.trim() ?? 'No instructions provided.';

      return `${header}\n${instructions}`;
    })
    .join('\n\n');
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

export const isCodePatchResultStatusApplied = (event?: MatrixEvent) => {
  if (event === undefined) {
    return false;
  }
  return (
    isCodePatchResultEvent(event.event as DiscreteMatrixEvent) &&
    event.getContent()['m.relates_to']?.key === 'applied'
  );
};

function getActiveLLMDetails(eventlist: DiscreteMatrixEvent[]): {
  model: string;
  toolsSupported?: boolean;
  reasoningEffort?: ReasoningEffort;
} {
  let activeLLMEvent = findLast(
    eventlist,
    (event) => event.type === APP_BOXEL_ACTIVE_LLM,
  ) as ActiveLLMEvent | undefined;
  if (!activeLLMEvent) {
    return {
      model: DEFAULT_LLM,
      toolsSupported: undefined,
      reasoningEffort: undefined,
    };
  }
  return {
    model: activeLLMEvent.content.model,
    toolsSupported: activeLLMEvent.content.toolsSupported,
    reasoningEffort: normalizeReasoningEffort(
      activeLLMEvent.content.reasoningEffort,
    ),
  };
}

const VALID_REASONING_EFFORTS: ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  null,
];

function normalizeReasoningEffort(
  value?: string | null,
): ReasoningEffort | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (
    VALID_REASONING_EFFORTS.includes(value as ReasoningEffort) &&
    value !== null
  ) {
    return value as ReasoningEffort;
  }
  return undefined;
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

export function isCodePatchResultEvent(
  event?: DiscreteMatrixEvent,
): event is CodePatchResultEvent {
  if (event === undefined) {
    return false;
  }
  return (
    event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
    event.content['m.relates_to']?.rel_type ===
      APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE
  );
}

function elideCodeBlocks(
  content: string,
  codePatchResults: CodePatchResultEvent[],
) {
  const DEFAULT_PLACEHOLDER: string =
    '[Omitting previously suggested code change]';
  const PLACEHOLDERS = {
    applied: '[Omitting previously suggested and applied code change]',
    failed: '[Omitting previously suggested code change that failed to apply]',
  };

  function getPlaceholder(codeBlockIndex: number) {
    let codePatchResult = codePatchResults.find((codePatchResult) => {
      return codePatchResult.content.codeBlockIndex === codeBlockIndex;
    });
    if (codePatchResult) {
      return (
        PLACEHOLDERS[codePatchResult.content['m.relates_to'].key] ??
        DEFAULT_PLACEHOLDER
      );
    }
    return DEFAULT_PLACEHOLDER;
  }

  let codeBlockIndex = 0;

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
      getPlaceholder(codeBlockIndex) +
      content.substring(replaceEndIndex + REPLACE_MARKER.length);

    codeBlockIndex++;
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
  if (
    !lastUserMessage ||
    !lastUserMessage.content ||
    typeof lastUserMessage.content !== 'object'
  ) {
    return false;
  }
  return (lastUserMessage.content as any).data?.context?.debug ?? false;
}

function findLast<T>(
  arr: T[],
  predicate: (value: T, index: number) => boolean,
): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i], i)) return arr[i];
  }
  return undefined;
}

function findLastIndex<T>(
  arr: T[],
  predicate: (value: T, index: number) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i], i)) return i;
  }
  return -1;
}
