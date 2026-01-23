import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type {
  ChatCompletionMessageToolCall,
  OpenAIPromptMessage,
  PendingCodePatchCorrectnessCheck,
  CodePatchCorrectnessCard,
  CodePatchCorrectnessFile,
  PromptParts,
  TextContent,
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
  BoxelContext,
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
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_LLM,
} from '../matrix-constants';
import { decodeCommandRequest } from '../commands';
import type { CommandRequest } from '../commands';
import type { ReasoningEffort } from 'openai/resources/shared';
import type {
  CardResource,
  LooseCardResource,
  LooseSingleCardDocument,
} from '../index';
import type { ToolChoice } from '../helpers/ai';
import { logger } from '../log';

import { SKILL_INSTRUCTIONS_MESSAGE, SYSTEM_MESSAGE } from './constants';
import { MAX_CORRECTNESS_FIX_ATTEMPTS } from './correctness-constants';
import { humanReadable } from '../code-ref';
import { SEARCH_MARKER, REPLACE_MARKER, SEPARATOR_MARKER } from '../constants';

const CARD_PATCH_COMMAND_NAMES = new Set(['patchCardInstance', 'patchFields']);
const CHECK_CORRECTNESS_COMMAND_NAME = 'checkCorrectness';

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
  let pendingCodePatchCorrectnessChecks =
    collectPendingCodePatchCorrectnessCheck(history, aiBotUserId);
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
      pendingCodePatchCorrectnessChecks,
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
    pendingCodePatchCorrectnessChecks,
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
  if (!allCommandsHaveResults || !allCodePatchesHaveResults) {
    return false;
  }
  if (!allCheckCorrectnessCommandsHaveResults(history)) {
    return false;
  }
  return true;
}

function allCheckCorrectnessCommandsHaveResults(
  history: DiscreteMatrixEvent[],
): boolean {
  let lastEventWithCheckCorrectnessRequests = findLast(history, (event) => {
    return getCheckCorrectnessCommandRequests(event).length > 0;
  });

  if (!lastEventWithCheckCorrectnessRequests) {
    return true;
  }

  let checkCommandRequests = getCheckCorrectnessCommandRequests(
    lastEventWithCheckCorrectnessRequests,
  );
  if (checkCommandRequests.length === 0) {
    return true;
  }

  let startIndex = history.indexOf(lastEventWithCheckCorrectnessRequests);
  let subsequentEvents = history.slice(startIndex + 1);
  return checkCommandRequests.every((request) => {
    return subsequentEvents.some((event) =>
      isTerminalCommandResultEventFor(event, request.id!),
    );
  });
}

function shouldPromptCheckCorrectnessSummary(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
) {
  let lastEvent = history[history.length - 1];
  if (!isCommandResultEvent(lastEvent)) {
    return false;
  }
  if (!isCheckCorrectnessCommandResultEvent(lastEvent, history)) {
    return false;
  }
  let lastNonResultIndex = findLastIndex(
    history,
    (event) => !isCommandOrCodePatchResult(event),
  );
  if (lastNonResultIndex === -1) {
    return true;
  }
  let lastNonResultEvent = history[lastNonResultIndex];
  return lastNonResultEvent.sender === aiBotUserId;
}

function getCheckCorrectnessCommandRequests(
  event: DiscreteMatrixEvent,
): CommandRequest[] {
  if (!event || event.type !== 'm.room.message') {
    return [];
  }
  let encodedRequests =
    (event.content as CardMessageContent)[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? [];
  if (!Array.isArray(encodedRequests)) {
    return [];
  }
  let commandRequests: CommandRequest[] = [];
  for (let encodedRequest of encodedRequests) {
    let decoded = decodeCommandRequestSafe(
      encodedRequest as Partial<EncodedCommandRequest>,
    );
    if (decoded?.id && decoded.name === CHECK_CORRECTNESS_COMMAND_NAME) {
      commandRequests.push(decoded);
    }
  }
  return commandRequests;
}

function decodeCommandRequestSafe(
  request: Partial<EncodedCommandRequest>,
): CommandRequest | undefined {
  try {
    let decoded = decodeCommandRequest(request);
    if (decoded.id && decoded.name && decoded.arguments !== undefined) {
      return decoded as CommandRequest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isTerminalCommandResultEventFor(
  event: DiscreteMatrixEvent,
  commandRequestId: string,
): boolean {
  if (
    event.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE ||
    event.content.commandRequestId !== commandRequestId
  ) {
    return false;
  }
  let status = event.content['m.relates_to']?.key;
  return status === 'applied' || status === 'failed' || status === 'invalid';
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

  // Correctness commands should only be emitted by helper flows, not
  // directly via LLM tool calls.
  toolMap.delete(CHECK_CORRECTNESS_COMMAND_NAME);

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

function isCheckCorrectnessCommandResultEvent(
  commandResultEvent: CommandResultEvent,
  history: DiscreteMatrixEvent[],
) {
  let sourceEventId = commandResultEvent.content['m.relates_to']?.event_id;
  if (!sourceEventId) {
    return false;
  }
  let sourceEvent = history.find((event) => event.event_id === sourceEventId);
  if (!sourceEvent) {
    return false;
  }
  let checkRequests = getCheckCorrectnessCommandRequests(sourceEvent);
  if (checkRequests.length === 0) {
    return false;
  }
  return checkRequests.some(
    (request) => request.id === commandResultEvent.content.commandRequestId,
  );
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
  client: MatrixClient,
  history: DiscreteMatrixEvent[],
): Promise<OpenAIPromptMessage[]> {
  const messageContent = event.content as CardMessageContent;
  let commandResultEntries = await Promise.all(
    (messageContent[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
      async (commandRequest: Partial<EncodedCommandRequest>) => {
        let decodedCommandRequest = decodeCommandRequestSafe(commandRequest);
        let commandResult = commandResults.find(
          (commandResult) =>
            (commandResult.content.msgtype ===
              APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE ||
              commandResult.content.msgtype ===
                APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE) &&
            commandResult.content.commandRequestId === commandRequest.id,
        );
        if (!commandResult) {
          return undefined;
        }
        let content: string;
        let followUpUserMessage: string | undefined;
        let status = commandResult.content['m.relates_to']?.key;
        let isCheckCorrectnessRequest =
          decodedCommandRequest?.name === CHECK_CORRECTNESS_COMMAND_NAME;
        if (isCheckCorrectnessRequest) {
          let checkCorrectnessContent = buildCheckCorrectnessResultContent(
            decodedCommandRequest,
            commandResult,
          );
          content = checkCorrectnessContent.toolMessage;
          followUpUserMessage = checkCorrectnessContent.followUpUserMessage;
        } else if (
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
        let toolMessage: OpenAIPromptMessage = {
          role: 'tool',
          tool_call_id: commandRequest.id,
          content,
        };
        let followUpMessage = followUpUserMessage
          ? ({
              role: 'user',
              content: followUpUserMessage,
            } as OpenAIPromptMessage)
          : undefined;
        return { toolMessage, followUpMessage };
      },
    ),
  );
  let toolMessages =
    commandResultEntries
      .map((entry) => entry?.toolMessage)
      .filter((message): message is OpenAIPromptMessage => Boolean(message)) ??
    [];
  let followUpMessages =
    commandResultEntries
      .map((entry) => entry?.followUpMessage)
      .filter((message): message is OpenAIPromptMessage => Boolean(message)) ??
    [];
  return [...toolMessages, ...followUpMessages];
}

function buildCheckCorrectnessResultContent(
  request?: CommandRequest,
  commandResult?: CommandResultEvent,
): CheckCorrectnessResultContent {
  let targetDescription = describeCheckCorrectnessTarget(request);
  if (!commandResult) {
    return {
      toolMessage: `Check correctness for ${targetDescription} is still pending.`,
    };
  }
  let status = commandResult.content['m.relates_to']?.key ?? 'unknown';
  let resultCard = extractCorrectnessResultCard(commandResult);
  if (resultCard) {
    let formattedSummary = formatCorrectnessResultSummary(
      targetDescription,
      resultCard,
      status,
    );
    let attemptNumber = Math.max(
      1,
      getCorrectnessCheckAttemptFromRequest(request),
    );
    return toCheckCorrectnessResultContent(formattedSummary, attemptNumber);
  }
  if (status === 'applied') {
    return {
      toolMessage: `Check correctness passed for ${targetDescription}.`,
    };
  }
  let failureReason = commandResult.content.failureReason;
  if (failureReason) {
    return {
      toolMessage: `Check correctness was marked as ${status} for ${targetDescription}: ${failureReason}`,
    };
  }
  return {
    toolMessage: `Check correctness was marked as ${status} for ${targetDescription}.`,
  };
}

function describeCheckCorrectnessTarget(request?: CommandRequest) {
  if (!request) {
    return 'the requested target';
  }
  let attributes =
    (((request.arguments as Record<string, any>) ?? {}).attributes as
      | Record<string, any>
      | undefined) ?? {};
  let targetType = attributes.targetType;
  let targetRef = attributes.targetRef;
  if (targetType && targetRef) {
    return `${targetType} "${targetRef}"`;
  }
  return 'the requested target';
}

type CorrectnessResultSummary = {
  correct: boolean;
  errors: string[];
  warnings: string[];
};

type CheckCorrectnessResultContent = {
  toolMessage: string;
  followUpUserMessage?: string;
};

type FormattedCorrectnessSummary = {
  summary: string;
  hasErrors: boolean;
};

const SEARCH_REPLACE_FIX_INSTRUCTION = `1. Propose fixes for the above errors by using one or more SEARCH/REPLACE blocks (DO NOT use the patchCardInstance tool function, because it will not work for broken cards).
2. You MUST re-fetch the files that have errors so that you can see their updated content before proposing fixes.
3. Respond very briefly that there is an issue with the file(s) (1 sentence max) that you will attempt to fix and do not mention SEARCH/REPLACE blocks in your prose.`;

const CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION =
  'Summarize the results above in one short sentence confirming that the target is now auto-corrected. Mention any warnings if they exist. Do not mention correctness or automated checks or tool calls.';

const CORRECTNESS_FAILURE_LIMIT_INSTRUCTION = `Automated correctness fixes have already been attempted ${MAX_CORRECTNESS_FIX_ATTEMPTS} times and the target is still failing validation. Stop proposing further automated patches; instead, summarize the remaining errors and ask the user how they want to proceed. Do not mention correctness or automated checks or tool calls.`;

function extractCorrectnessResultCard(
  commandResult?: CommandResultEvent,
): CorrectnessResultSummary | undefined {
  if (
    !commandResult ||
    commandResult.content.msgtype !==
      APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
  ) {
    return undefined;
  }
  let cardPayload = commandResult.content.data.card;
  if (!cardPayload) {
    return undefined;
  }
  let cardContent = cardPayload.content ?? cardPayload;
  let parsed:
    | {
        data?: {
          attributes?: {
            correct?: boolean;
            errors?: string[];
            warnings?: string[];
          };
        };
      }
    | undefined;
  try {
    parsed =
      typeof cardContent === 'string' ? JSON.parse(cardContent) : cardContent;
  } catch (error) {
    getLog().error('Unable to parse correctness result card', error);
    return undefined;
  }
  let attributes = parsed?.data?.attributes ?? {};
  return {
    correct: Boolean(attributes.correct),
    errors: Array.isArray(attributes.errors) ? attributes.errors : [],
    warnings: Array.isArray(attributes.warnings) ? attributes.warnings : [],
  };
}

function formatCorrectnessResultSummary(
  targetDescription: string,
  result: CorrectnessResultSummary,
  status: string = 'applied',
): FormattedCorrectnessSummary {
  let sections: string[] = [];
  sections.push(
    result.correct && status === 'applied'
      ? `Check correctness passed for ${targetDescription}.`
      : `Check correctness was marked as ${status} for ${targetDescription}.`,
  );
  let errorLines = result.errors.filter(
    (entry) => typeof entry === 'string' && entry.trim().length,
  );
  if (errorLines.length) {
    sections.push(
      `Errors:\n${errorLines.map((line) => `- ${line}`).join('\n')}`,
    );
  }
  let warningLines = result.warnings.filter(
    (entry) => typeof entry === 'string' && entry.trim().length,
  );
  if (warningLines.length) {
    sections.push(
      `Warnings:\n${warningLines.map((line) => `- ${line}`).join('\n')}`,
    );
  }
  let summary = sections.join('\n\n');
  return {
    summary,
    hasErrors: errorLines.length > 0,
  };
}

function findCheckCorrectnessCommandRequest(
  history: DiscreteMatrixEvent[],
  commandRequestId: string,
): CommandRequest | undefined {
  for (let event of history) {
    let requests = getCheckCorrectnessCommandRequests(event);
    let match = requests.find((request) => request.id === commandRequestId);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function formatCorrectnessTargetKeyWithEvent(
  targetType?: string,
  targetRef?: string,
  targetEventId?: string,
): string | undefined {
  if (!targetRef) {
    return undefined;
  }
  let normalizedType = targetType ?? 'target';
  let eventPart = targetEventId ? `|event:${targetEventId}` : '';
  return `${normalizedType}:${String(targetRef)}${eventPart}`;
}

type CheckCorrectnessTargetParts = {
  targetType?: string;
  targetRef?: string;
  targetEventId?: string;
};

function extractCheckCorrectnessTargetParts(
  request?: CommandRequest,
): CheckCorrectnessTargetParts {
  if (!request) {
    return {};
  }
  let attributes =
    (((request.arguments as Record<string, any>) ?? {}).attributes as
      | Record<string, any>
      | undefined) ?? {};
  let targetRef = attributes.targetRef;
  if (!targetRef) {
    return {};
  }
  let targetType = attributes.targetType;
  let targetEventId = attributes.targetEventId;
  return { targetRef, targetType, targetEventId };
}

function getCheckCorrectnessTargetKey(
  request?: CommandRequest,
): string | undefined {
  let { targetRef, targetType, targetEventId } =
    extractCheckCorrectnessTargetParts(request);
  if (!targetRef) {
    return undefined;
  }
  return formatCorrectnessTargetKeyWithEvent(
    targetType,
    targetRef,
    targetEventId,
  );
}

function getCorrectnessCheckAttemptFromRequest(
  request?: CommandRequest,
): number {
  if (!request) {
    return 0;
  }
  let attributes =
    (((request.arguments as Record<string, any>) ?? {}).attributes as
      | Record<string, any>
      | undefined) ?? {};
  let attempt = attributes.correctnessCheckAttempt;
  if (typeof attempt === 'number' && Number.isFinite(attempt)) {
    return attempt;
  }
  return 0;
}

type CorrectnessCheckAttemptInfo = { attempt: number; succeeded: boolean };

function getLatestCorrectnessCheckAttemptInfo(
  history: DiscreteMatrixEvent[],
  targetKey: string,
): CorrectnessCheckAttemptInfo | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    let event = history[index];
    if (event.type !== APP_BOXEL_COMMAND_RESULT_EVENT_TYPE) {
      continue;
    }
    let commandResult = event as CommandResultEvent;
    if (!isCheckCorrectnessCommandResultEvent(commandResult, history)) {
      continue;
    }
    let sourceRequest = findCheckCorrectnessCommandRequest(
      history,
      commandResult.content.commandRequestId,
    );
    if (!sourceRequest) {
      continue;
    }
    if (getCheckCorrectnessTargetKey(sourceRequest) !== targetKey) {
      continue;
    }
    let attempt = Math.max(
      1,
      getCorrectnessCheckAttemptFromRequest(sourceRequest),
    );
    let resultCard = extractCorrectnessResultCard(commandResult);
    let status = commandResult.content['m.relates_to']?.key;
    let succeeded =
      status === 'applied' &&
      Boolean(resultCard) &&
      resultCard!.correct === true &&
      resultCard!.errors.filter(
        (entry) => typeof entry === 'string' && entry.trim().length,
      ).length === 0;
    return { attempt, succeeded };
  }
  return undefined;
}

function getNextCorrectnessCheckAttempt(
  history: DiscreteMatrixEvent[],
  targetKey: string,
): number {
  let latest = getLatestCorrectnessCheckAttemptInfo(history, targetKey);
  if (!latest) {
    return 1;
  }
  if (latest.succeeded) {
    return 1;
  }
  return Math.max(1, latest.attempt + 1);
}

function toCheckCorrectnessResultContent(
  formattedSummary: FormattedCorrectnessSummary,
  attemptNumber = 0,
): CheckCorrectnessResultContent {
  let attemptNote =
    formattedSummary.hasErrors && attemptNumber > 0
      ? `Automated fix attempts so far: ${Math.min(attemptNumber, MAX_CORRECTNESS_FIX_ATTEMPTS)} of ${MAX_CORRECTNESS_FIX_ATTEMPTS}.`
      : undefined;
  let toolMessage = [formattedSummary.summary, attemptNote]
    .filter(Boolean)
    .join('\n\n');

  if (!formattedSummary.hasErrors) {
    return {
      toolMessage,
      followUpUserMessage: CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION,
    };
  }

  if (attemptNumber >= MAX_CORRECTNESS_FIX_ATTEMPTS) {
    return {
      toolMessage,
      followUpUserMessage: CORRECTNESS_FAILURE_LIMIT_INSTRUCTION,
    };
  }

  return {
    toolMessage,
    followUpUserMessage: SEARCH_REPLACE_FIX_INSTRUCTION,
  };
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
  if (shouldPromptCheckCorrectnessSummary(history, aiBotUserId)) {
    historicalMessages.push({
      role: 'user',
      content:
        'The automated correctness checks have finished. Summarize the results based on the tool output above in one short sentence. Do not mention: correctness, automated correctness checks, tool calls.',
    });
  }
  let systemMessageParts = [SYSTEM_MESSAGE];

  systemMessageParts.push(
    'Never call the checkCorrectness tool on your own; follow-up correctness checks are handled automatically by the system.',
  );
  if (skillCards.length) {
    systemMessageParts.push(SKILL_INSTRUCTIONS_MESSAGE);
    systemMessageParts = systemMessageParts.concat(
      skillCardsToMessages(skillCards),
    );
  }

  let messages: OpenAIPromptMessage[] = [
    {
      role: 'system',
      content: systemMessageParts.map((part, i) => {
        let result: TextContent = {
          type: 'text',
          text: part,
        };
        if (i === systemMessageParts.length - 1) {
          result = {
            ...result,
            cache_control: {
              type: 'ephemeral',
            },
          };
        }
        return result;
      }),
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

function collectPendingCodePatchCorrectnessCheck(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): PendingCodePatchCorrectnessCheck | undefined {
  // If any bot message has unresolved code patches or card patch commands,
  // defer correctness entirely until all are applied/failed.
  if (hasUnresolvedCodePatches(history, aiBotUserId)) {
    return undefined;
  }

  for (let index = history.length - 1; index >= 0; index--) {
    let event = history[index];
    if (
      event.type !== 'm.room.message' ||
      event.sender !== aiBotUserId ||
      event.content.msgtype !== APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      continue;
    }

    // Only consider messages that contain code patches or card patch commands.
    let content = event.content as CardMessageContent;
    let codePatchBlocks = extractCodePatchBlocks(content.body || '');
    let commandRequests = (content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
      (request) => decodeCommandRequest(request),
    );
    let relevantCommands = commandRequests.filter((request) =>
      isCardPatchCommand(request.name),
    );
    let hasRelevantChanges =
      codePatchBlocks.length > 0 || relevantCommands.length > 0;
    if (!hasRelevantChanges) {
      continue;
    }

    let codePatchResults = getCodePatchResults(
      event as CardMessageEvent,
      history,
    );
    let commandResults = getCommandResults(event as CardMessageEvent, history);
    let isCancelled =
      content.isCanceled || (event as any).status === 'cancelled';
    let appliedChanges = hasAppliedChanges(
      codePatchResults,
      relevantCommands,
      commandResults,
    );
    if (isCancelled && !appliedChanges) {
      continue;
    }

    let appliedCodePatchResults = codePatchResults.filter(
      (result) => result.content['m.relates_to']?.key === 'applied',
    );
    let allCodePatchesResolved =
      codePatchBlocks.length === 0 ||
      codePatchBlocks.every((_block, index) =>
        appliedCodePatchResults.some(
          (result) => result.content.codeBlockIndex === index,
        ),
      );
    let allRelevantCommandsResolved =
      relevantCommands.length === 0 ||
      relevantCommands.every((request) =>
        commandResults.some(
          (result) => result.content.commandRequestId === request.id,
        ),
      );

    // If the most recent message with patches/commands isn't resolved yet,
    // don't walk back to earlier messages—wait for the current one to finish.
    if (!allCodePatchesResolved || !allRelevantCommandsResolved) {
      return undefined;
    }

    let correctnessCheck = buildCodePatchCorrectnessMessage(
      event as CardMessageEvent,
      history,
    );
    if (correctnessCheck) {
      return correctnessCheck;
    }
  }
  return undefined;
}

function hasUnresolvedCodePatches(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): boolean {
  // Consider only the most recent relevant bot message; older unresolved
  // commands should not block correctness for newer changes.
  for (let index = history.length - 1; index >= 0; index--) {
    let event = history[index];
    if (
      event.type !== 'm.room.message' ||
      event.sender !== aiBotUserId ||
      event.content.msgtype !== APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      continue;
    }
    let content = event.content as CardMessageContent;
    let codePatchBlocks = extractCodePatchBlocks(content.body || '');
    let commandRequests = (content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
      (request) => decodeCommandRequest(request),
    );
    let relevantCommands = commandRequests.filter((request) =>
      isCardPatchCommand(request.name),
    );
    let hasRelevantChanges =
      codePatchBlocks.length > 0 || relevantCommands.length > 0;
    if (!hasRelevantChanges) {
      continue;
    }

    let codePatchResults = getCodePatchResults(
      event as CardMessageEvent,
      history,
    );
    let commandResults = getCommandResults(event as CardMessageEvent, history);
    let isCancelled =
      content.isCanceled || (event as any).status === 'cancelled';
    let appliedChanges = hasAppliedChanges(
      codePatchResults,
      relevantCommands,
      commandResults,
    );
    if (isCancelled && !appliedChanges) {
      return false;
    }
    let allCodePatchesResolved =
      codePatchBlocks.length === 0 ||
      codePatchBlocks.every((_block, index) =>
        codePatchResults.some(
          (result) =>
            result.content['m.relates_to']?.key === 'applied' &&
            result.content.codeBlockIndex === index,
        ),
      );
    let allRelevantCommandsResolved =
      relevantCommands.length === 0 ||
      relevantCommands.every((request) =>
        commandResults.some(
          (result) => result.content.commandRequestId === request.id,
        ),
      );

    return !(allCodePatchesResolved && allRelevantCommandsResolved);
  }
  return false;
}

function buildCodePatchCorrectnessMessage(
  messageEvent: CardMessageEvent,
  history: DiscreteMatrixEvent[],
): PendingCodePatchCorrectnessCheck | undefined {
  let content = messageEvent.content as CardMessageContent;
  let codePatchBlocks = extractCodePatchBlocks(content.body || '');
  let commandRequests = (content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? []).map(
    (request) => decodeCommandRequest(request),
  );
  let relevantCommands = commandRequests.filter((request) =>
    isCardPatchCommand(request.name),
  );

  if (codePatchBlocks.length === 0 && relevantCommands.length === 0) {
    return undefined;
  }

  if (
    history.some((event) =>
      isCodePatchCorrectnessEventForMessage(event, messageEvent.event_id!),
    )
  ) {
    return undefined;
  }

  let codePatchResults = getCodePatchResults(messageEvent, history);
  let commandResults = getCommandResults(messageEvent, history);
  let isCancelled =
    content.isCanceled || (messageEvent as any).status === 'cancelled';
  let appliedChanges = hasAppliedChanges(
    codePatchResults,
    relevantCommands,
    commandResults,
  );
  if (isCancelled && !appliedChanges) {
    return undefined;
  }

  let appliedCodePatchResults = codePatchResults.filter(
    (result) => result.content['m.relates_to']?.key === 'applied',
  );
  let allCodePatchesResolved =
    codePatchBlocks.length === 0 ||
    codePatchBlocks.every((_block, index) =>
      appliedCodePatchResults.some(
        (result) => result.content.codeBlockIndex === index,
      ),
    );
  let allRelevantCommandsResolved =
    relevantCommands.length === 0 ||
    relevantCommands.every((request) =>
      commandResults.some(
        (result) => result.content.commandRequestId === request.id,
      ),
    );

  if (!allCodePatchesResolved || !allRelevantCommandsResolved) {
    return undefined;
  }

  let files = gatherPatchedFiles(codePatchResults);
  let cards = gatherPatchedCards(relevantCommands, commandResults);

  if (files.length === 0 && cards.length === 0) {
    return undefined;
  }

  let attemptsByTargetKey = buildCorrectnessCheckAttemptMap(
    history,
    files,
    cards,
    messageEvent.event_id,
  );

  return {
    targetEventId: messageEvent.event_id!,
    roomId: messageEvent.room_id!,
    context: content.data?.context as BoxelContext | undefined,
    files,
    cards,
    attemptsByTargetKey,
  };
}

function isCardPatchCommand(name?: string) {
  if (!name) {
    return false;
  }
  return CARD_PATCH_COMMAND_NAMES.has(name);
}

function gatherPatchedFiles(
  codePatchResults: CodePatchResultEvent[],
): CodePatchCorrectnessFile[] {
  let seen = new Set<string>();
  let files: CodePatchCorrectnessFile[] = [];
  for (let result of codePatchResults) {
    let status = result.content['m.relates_to']?.key;
    if (status !== 'applied') {
      continue;
    }
    let attachments = result.content.data?.attachedFiles ?? [];
    if (attachments.length === 0) {
      let fallback = result.content.data?.context?.codeMode?.currentFile;
      if (fallback && !seen.has(fallback)) {
        seen.add(fallback);
        files.push({
          sourceUrl: fallback,
          displayName: formatFileDisplayName(fallback),
        });
      }
      continue;
    }
    for (let file of attachments) {
      let sourceUrl = file.sourceUrl ?? file.url ?? file.name ?? '';
      let key = sourceUrl || file.name || `${result.event_id}-${file.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      let labelSource = sourceUrl || file.name || '';
      files.push({
        sourceUrl: sourceUrl || labelSource,
        displayName: formatFileDisplayName(labelSource),
      });
    }
  }
  return files;
}

function gatherPatchedCards(
  commandRequests: Partial<CommandRequest>[],
  commandResults: CommandResultEvent[],
): CodePatchCorrectnessCard[] {
  let cards: CodePatchCorrectnessCard[] = [];
  let seen = new Set<string>();
  for (let request of commandRequests) {
    let result = commandResults.find(
      (commandResult) => commandResult.content.commandRequestId === request.id,
    );
    if (!result) {
      continue;
    }
    if (result.content['m.relates_to']?.key !== 'applied') {
      continue;
    }
    let cardId = extractCardIdFromCommandRequest(request);
    if (!cardId || seen.has(cardId)) {
      continue;
    }
    seen.add(cardId);
    cards.push({ cardId });
  }
  return cards;
}

function buildCorrectnessCheckAttemptMap(
  history: DiscreteMatrixEvent[],
  files: CodePatchCorrectnessFile[],
  cards: CodePatchCorrectnessCard[],
  targetEventId?: string,
): Record<string, number> {
  let attempts: Record<string, number> = {};
  for (let file of files) {
    let targetKey = formatCorrectnessTargetKeyWithEvent(
      'file',
      file.sourceUrl || file.displayName,
      targetEventId,
    );
    if (!targetKey) {
      continue;
    }
    attempts[targetKey] = getNextCorrectnessCheckAttempt(history, targetKey);
  }
  for (let card of cards) {
    let targetKey = formatCorrectnessTargetKeyWithEvent(
      'card',
      card.cardId,
      targetEventId,
    );
    if (!targetKey) {
      continue;
    }
    attempts[targetKey] = getNextCorrectnessCheckAttempt(history, targetKey);
  }
  return attempts;
}

function extractCardIdFromCommandRequest(
  request: Partial<CommandRequest>,
): string | undefined {
  let args = request.arguments as Record<string, any> | undefined;
  if (!args) {
    return undefined;
  }
  if (typeof args.cardId === 'string') {
    return args.cardId;
  }
  if (typeof args.attributes?.cardId === 'string') {
    return args.attributes.cardId;
  }
  if (typeof args.attributes?.patch?.cardId === 'string') {
    return args.attributes.patch.cardId;
  }
  if (typeof args.attributes?.patch?.attributes?.cardId === 'string') {
    return args.attributes.patch.attributes.cardId;
  }
  return undefined;
}

function isCodePatchCorrectnessEventForMessage(
  event: DiscreteMatrixEvent,
  targetEventId: string,
) {
  if (
    event.type !== 'm.room.message' ||
    event.content?.msgtype !== APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
  ) {
    return false;
  }
  let relatesTo = event.content?.['m.relates_to'];
  if (!relatesTo) {
    return false;
  }
  return (
    relatesTo.rel_type === APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE &&
    relatesTo.event_id === targetEventId
  );
}

function formatFileDisplayName(identifier?: string) {
  if (!identifier) {
    return 'Updated file';
  }
  try {
    let url = new URL(identifier);
    let pathname = url.pathname.replace(/^\/+/, '');
    return pathname || identifier;
  } catch {
    return identifier;
  }
}

function hasAppliedChanges(
  codePatchResults: CodePatchResultEvent[],
  relevantCommands: Partial<CommandRequest>[],
  commandResults: CommandResultEvent[],
): boolean {
  if (
    codePatchResults.some(
      (result) => result.content['m.relates_to']?.key === 'applied',
    )
  ) {
    return true;
  }

  return relevantCommands.some((request) =>
    commandResults.some(
      (result) =>
        result.content.commandRequestId === request.id &&
        result.content['m.relates_to']?.key === 'applied',
    ),
  );
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

export const skillCardsToMessages = (
  cards: Omit<LooseCardResource, 'meta'>[],
) => {
  return cards.map((card) => {
    let headerParts = [`id: ${card.id}`];
    if (card.attributes?.title) {
      headerParts.push(`title: ${card.attributes.title}`);
    }

    let header = `Skill (${headerParts.join(', ')}):`;
    let instructions =
      card.attributes?.instructions?.trim() ?? 'No instructions provided.';

    return `${header}\n${instructions}`;
  });
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
