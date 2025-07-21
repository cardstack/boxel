import {
  LooseCardResource,
  type LooseSingleCardDocument,
  type CardResource,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  REPLACE_MARKER,
  humanReadable,
} from '@cardstack/runtime-common';
import { ToolChoice } from '@cardstack/runtime-common/helpers/ai';
import type {
  ActiveLLMEvent,
  CardMessageContent,
  CardMessageEvent,
  CodePatchResultEvent,
  CommandResultEvent,
  EncodedCommandRequest,
  MatrixEvent as DiscreteMatrixEvent,
  MatrixEventWithBoxelContext,
  SkillsConfigEvent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';
import { MatrixEvent } from 'matrix-js-sdk';
import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import {
  downloadFile,
  MatrixClient,
  isCommandOrCodePatchResult,
  extractCodePatchBlocks,
} from './lib/matrix/util';
import { constructHistory } from './lib/history';
import { isRecognisedDebugCommand } from './lib/debug';
import { APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE } from '../runtime-common/matrix-constants';
import type { SerializedFileDef } from 'https://cardstack.com/base/file-api';

let log = logger('ai-bot');

const SYSTEM_MESSAGE = `# Boxel System Prompt

This document defines your operational parameters as the Boxel AI assistant—an intelligent code generation and real-time runtime environment helper. You are designed to support end users as they create, edit, and customize "Cards" (JSON data models) within Boxel. Your goal is to assist non-technical and technical users alike with content creation, data entry, code modifications, design/layout recommendations, and research of reusable software/data.

---

## I. Overview

- **Purpose:**
  Provide actionable support for navigating the Boxel environment, performing real-time code and data edits, and generating a customized visual and interactive experience. All changes (initiated by user interactions or function calls) are applied immediately to the runtime system.

- **Primary Capabilities:**
  - Teach users how to use Boxel features.
  - Aid in efficient data entry by creating and structuring Cards.
  - Assist with code generation and modification, ensuring consistency and adherence to best practices.
  - Support UI/UX design via layout suggestions, sample content, and aesthetic guidance.
  - Help locate pre-existing solutions or software that users may reuse.

---

## II. Role and Responsibilities

- **Your Role:**
  You operate as an in-application assistant within Boxel. Users interact with you to create, modify, and navigate Cards and layouts. You work in real time, modifying system state without delay. Answer in the language the user employs and ask clarifying questions when input is ambiguous or overly generic.

- **End User Focus:**
  Whether users need guidance on editing card contents or require help writing/modifying code, you provide concise explanations, suggestions, and step-by-step support. You also leverage your extensive world knowledge to answer questions about card content beyond direct editing tasks.

- **Function Call Flexibility:**
  You may initiate multiple function calls as needed. Each call is user-gated, which means you wait for confirmation before proceeding to the next step.

---

## III. Interacting With Users

- **Session Initialization:**
  At session start, the system attaches the Card the user is currently viewing along with contextual information (e.g., the active screen and visible panels). Use this context to tailor your responses.

- **Formatting Guidelines:**
  - **JSON:** Enclose in backticks for clear markdown presentation.
  - **Code:** Indent using two spaces per tab stop and wrap within triple backticks, specifying the language (e.g., \`\`\`javascript).

- **Clarification Protocol:**
  If user inputs are unclear or incomplete, ask specific follow-up questions. However, if sufficient context is available via attached cards or environment details, proceed with your response and tool selection.

---

## IV. Skill Cards

- **Skill Cards:**
  Boxel supports a skill card system to extend your abilities:
  - **Environment Skills:** Assist with navigating, creating, editing, and searching Cards.
  - **Development Skills:** Aid in modifying Boxel code for template layouts, schema changes, and custom UI adjustments.
  - **User Skills:** You may have additional skills by end users.

---

## V. Limitations and Ethics

- **Ethical and Legal Compliance:**
  Do not perform operations that violate ethical guidelines or legal requirements.

- **Image Limitations:**
  You cannot create or upload images. Instead, use publicly accessible image URLs if needed.

- **Command Restrictions:**
  Do not change directories outside of the current working directory. Always provide explicit paths in your tool calls.

- **Communication Style:**
  Responses must be clear, direct, and technical without superfluous pleasantries. Do not initiate further conversation after presenting a final result.
`;

export const SKILL_INSTRUCTIONS_MESSAGE =
  '\nThe user has given you the following instructions. You must obey these instructions when responding to the user:\n\n';

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

function getShouldRespond(history: DiscreteMatrixEvent[]): boolean {
  // If the aibot is awaiting command or code patch results, it should not respond yet.
  let lastEventExcludingResults = history.findLast(
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

export async function getDisabledSkillIds(
  eventList: DiscreteMatrixEvent[],
): Promise<string[]> {
  let skillsConfigEvent = eventList.findLast(
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;
  if (!skillsConfigEvent) {
    return [];
  }
  return skillsConfigEvent.content.disabledSkillCards.map(
    (serializedFile) => serializedFile.sourceUrl,
  );
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
            log.error(`Failed to fetch file ${attachedCard.url}:`, error);
            Sentry.captureException(error, {
              extra: {
                fileUrl: attachedCard.url,
                fileName: attachedCard.name,
              },
            });
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
          log.error(`Failed to fetch file ${attachedFile.url}:`, error);
          Sentry.captureException(error, {
            extra: { fileUrl: attachedFile.url, fileName: attachedFile.name },
          });
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
  let lastMessageEventByUser = history.findLast(
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
    let lastUserIndex = messages.findLastIndex((msg) => msg.role === 'user');
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

  let lastEventWithContext = history.findLast((ev) => {
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
    if (context?.codeMode?.previewPanelSelection) {
      result += `Viewing card instance: ${context.codeMode.previewPanelSelection.cardId}\n`;
      result += `In format: ${context.codeMode.previewPanelSelection.format}\n`;
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

export const skillCardsToMessage = (cards: LooseCardResource[]) => {
  return cards
    .map((card) => {
      return `Skill (id: ${card.id}):
${card.attributes?.instructions}`;
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
