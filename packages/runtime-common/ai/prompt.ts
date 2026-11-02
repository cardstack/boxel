import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type {
  ChatCompletionMessageToolCall,
  ContentPart,
  OpenAIPromptMessage,
  PendingCodePatchCorrectnessCheck,
  CodePatchCorrectnessCard,
  CodePatchCorrectnessFile,
  PromptParts,
  TextContent,
} from './types.ts';
import { chunk, uniqBy } from 'lodash-es';
import { constructHistory } from './history.ts';
import {
  canonicalizeMatrixMediaKey,
  downloadFile,
  downloadFileAsBase64DataUrl,
  isToolResult,
} from './matrix-utils.ts';
import { isRecognisedDebugCommand, sessionSkillFeatures } from './debug.ts';
import {
  isImageContentType,
  isPdfContentType,
  isAudioContentType,
  isVideoContentType,
  isTextBasedContentType,
  modalityLabel,
  requiredModality,
} from './modality.ts';
import type {
  ActiveLLMEvent,
  BoxelContext,
  CardMessageContent,
  CardMessageEvent,
  ToolResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  EncodedToolRequest,
  MatrixEventWithBoxelContext,
  SkillsConfigEvent,
  Tool,
} from '@cardstack/base/matrix-event';
import type {
  SerializedFile,
  SerializedFileDef,
} from '@cardstack/base/file-api';
import {
  getToolDefinitions,
  getToolRequests,
  isToolResultEventType,
  isToolResultWithNoOutputMsgtype,
  isToolResultWithOutputContent,
  isToolResultWithOutputMsgtype,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_FALLBACK_MODELS,
  DEFAULT_FALLBACK_MODEL_ID,
  CAPTURE_SOURCE_URL_PREFIX,
} from '../matrix-constants.ts';
import {
  buildToolFunctionNameFromResolvedRef,
  decodeToolRequest,
} from '../commands.ts';
import type { ToolRequest } from '../commands.ts';
import type { ReasoningEffort } from 'openai/resources/shared';
import type {
  CardResource,
  LooseCardResource,
  LooseSingleCardDocument,
} from '../index.ts';
import type { ToolChoice } from '../helpers/ai.ts';
import { logger } from '../log.ts';

import { parseFrontmatter } from '../frontmatter-parse.ts';
import { isMarkdownFile } from '../paths.ts';
import {
  READ_REALM_FILE_TOOL_NAME,
  SKILL_INSTRUCTIONS_MESSAGE,
  SYSTEM_MESSAGE,
} from './constants.ts';
import { MAX_CORRECTNESS_FIX_ATTEMPTS } from './correctness-constants.ts';
import {
  describeCheckTargetCount,
  isCardCheckTarget,
} from './correctness-targets.ts';
import { humanReadable } from '../code-ref.ts';
import { readStopState } from './stop.ts';
import {
  carriedSkillFilesMessage,
  compactionSummaryMessage,
  getLatestCompaction,
  historyAfterCompaction,
  isSkillFileUrl,
  MAX_CARRIED_SKILL_FILE_BYTES,
  MAX_CARRIED_SKILL_FILE_EVENTS,
  type CompactionContent,
} from './compaction.ts';

const CARD_PATCH_COMMAND_NAMES = new Set(['patchCardInstance', 'patchFields']);
const SOURCE_CODE_TOOL_NAME_PREFIX = 'run-realm-code_';
const CHECK_CORRECTNESS_TOOL_NAME = 'checkCorrectness';

// Leads the trailing context message. That message is the last user message
// of every prompt, so without this a model can take the context as the
// request and answer it instead of the user's message before it.
export const TRAILING_CONTEXT_PREAMBLE =
  'This message carries context for the conversation above. It is not a new request from the user. Respond to the latest user request above, or continue the work in progress.';

function getLog() {
  return logger('ai-bot:prompt');
}

/*
 * ── Attachment Context Policy ────────────────────────────────────────
 *
 * When building prompts for the model, file attachments are handled
 * according to the following rules:
 *
 * 1. **Byte-stable rendering**: A message's attachments are rendered from
 *    that message's own snapshot alone — content included at every age,
 *    never re-rendered because a newer version was attached later. Prompt
 *    caching is an exact prefix match, so rewriting an already-sent
 *    message re-bills the whole rest of the prompt at full input price on
 *    every later turn; carrying the superseded content forward costs only
 *    cached-read tokens. The model is told that a later attachment of the
 *    same card/file supersedes earlier ones.
 *
 * 3. **MIME type handling** (see `modality.ts` for classification):
 *    - Text-based types (text/*, application/vnd.card+json,
 *      application/vnd.card+source) → content downloaded and displayed
 *      with line numbers, in the history message that attached them.
 *    - Media types are listed in history as metadata ([contentType,
 *      contentSize bytes]); their bodies are embedded only for the
 *      current turn — the current human message's attachments and those
 *      of every tool result since it (see currentTurnToolResultMedia) — as
 *      native content parts on the volatile trailing message (after the
 *      history cache breakpoint):
 *      - Supported images (PNG, JPEG, WEBP, GIF) → `image_url` parts.
 *      - PDF (application/pdf) → `file` parts with base64 data URL in
 *        `file_data`.
 *      - Audio (audio/*) → `input_audio` parts with raw base64 and
 *        format string (data URL prefix stripped).
 *      - Video (video/*) → `video_url` parts with base64 data URL.
 *      Embedding media bodies in history would grow the request by every
 *      media file ever attached — re-downloaded and re-encoded on each
 *      turn, with nothing bounding it — while a "newest message" gate
 *      would rewrite an older message's bytes as history grows and reset
 *      the cache prefix. The trailing message is rebuilt every turn, so
 *      it can carry the current media without touching history bytes.
 *
 * 4. **Model capability gating**: When `inputModalities` is provided
 *    (from the active LLM's model configuration), the current turn's
 *    media parts are only included if the model supports the required
 *    modality. Gated files are named in a note on the trailing message
 *    that tells the model it cannot see them. When `inputModalities` is
 *    undefined, all modalities pass through.
 *
 * 5. **Read-file command scoping**: When the AI requests to read a file
 *    via a tool call, the file URL must match a sourceUrl previously
 *    attached by the user in the same room. Unrecognised URLs produce
 *    a rejection message in the tool result.
 * ─────────────────────────────────────────────────────────────────────
 */

// ── MIME / category helpers ──────────────────────────────────────────

const AUDIO_MIME_TO_FORMAT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
};

function audioFormatFromMime(contentType: string): string | undefined {
  return AUDIO_MIME_TO_FORMAT[contentType.split(';')[0].trim().toLowerCase()];
}

// ── Read-file command scope helpers ──────────────────────────────────

function isReadFileCommand(request?: ToolRequest): boolean {
  return !!request?.name?.startsWith('read-file-for-ai-assistant');
}

function getReadFileUrl(request?: ToolRequest): string | undefined {
  try {
    let args =
      typeof request?.arguments === 'string'
        ? JSON.parse(request.arguments)
        : request?.arguments;
    return args?.attributes?.fileIdentifier;
  } catch {
    return undefined;
  }
}

function isFileAttachedInRoom(
  fileUrl: string,
  history: DiscreteMatrixEvent[],
): boolean {
  return history.some((event) => {
    let attachedFiles = (event as MatrixEventWithBoxelContext).content?.data
      ?.attachedFiles;
    return attachedFiles?.some(
      (f: SerializedFileDef) => f.sourceUrl === fileUrl,
    );
  });
}

// ── Shared attachment helpers ────────────────────────────────────────

function toFileDefMetadata(file: SerializedFileDef): SerializedFileDef {
  return {
    url: file.url,
    sourceUrl: file.sourceUrl ?? '',
    name: file.name,
    contentType: file.contentType,
    contentSize: file.contentSize,
  };
}

async function downloadTextContent(
  client: MatrixClient,
  file: SerializedFileDef,
): Promise<SerializedFileDef> {
  let result = toFileDefMetadata(file);
  try {
    result.content = await downloadFile(client, file);
  } catch (error) {
    getLog().error(`Failed to fetch file ${file.url}:`, error);
    result.error = `Error loading attached file: ${(error as Error).message}`;
  }
  return result;
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
  // A stop holds the whole loop, including the correctness check a code
  // patch would otherwise kick off; and the edits of a stopped answer are
  // never checked, not even once the user writes again. constructHistory
  // keeps only messages and tool results, so the stop is read from the raw
  // event list.
  let { inForce: stop, stoppedMessageIds } = readStopState(
    eventList,
    aiBotUserId,
  );
  let shouldRespond = !stop && getShouldRespond(history);
  let pendingCodePatchCorrectnessChecks = stop
    ? undefined
    : collectPendingCodePatchCorrectnessCheck(
        history,
        aiBotUserId,
        stoppedMessageIds,
      );
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
  let { model, toolsSupported, reasoningEffort, inputModalities } =
    getActiveLLMDetails(eventList);
  let messages = await buildPromptForModel(
    history,
    aiBotUserId,
    skills,
    disabledSkillIds,
    client,
    inputModalities,
    sessionSkillFeatures(eventList, aiBotUserId),
    getLatestCompaction(eventList, aiBotUserId),
  );
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

// A user's approval of a call ai-bot holds for approval. It is not the call's
// outcome: the call stays unanswered — no turn starts, and the prompt shows
// no result for it — until ai-bot publishes the real result.
export function isApprovalResult(event: {
  content?: { 'm.relates_to'?: { key?: string } };
}): boolean {
  return event.content?.['m.relates_to']?.key === 'approved';
}

function getShouldRespond(history: DiscreteMatrixEvent[]): boolean {
  // If the aibot is awaiting tool results, it should not respond yet.
  let lastEventExcludingResults = findLast(
    history,
    (event) => !isToolResult(event),
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

  let toolRequests =
    getToolRequests<Partial<EncodedToolRequest>>(
      lastEventExcludingResults.content as CardMessageContent,
    ) ?? [];
  let lastEventIndex = history.indexOf(lastEventExcludingResults);
  let recentEventsToCheck = history.slice(lastEventIndex + 1);

  let allToolsHaveResults =
    toolRequests.length === 0 ||
    toolRequests.every((toolRequest: Partial<EncodedToolRequest>) => {
      return recentEventsToCheck.some((event) => {
        return (
          isToolResultEvent(event) &&
          (isToolResultWithOutputMsgtype(event.content.msgtype) ||
            isToolResultWithNoOutputMsgtype(event.content.msgtype)) &&
          !isApprovalResult(event) &&
          event.content.commandRequestId === toolRequest.id
        );
      });
    });
  if (!allToolsHaveResults) {
    return false;
  }
  if (!allCheckCorrectnessToolsHaveResults(history)) {
    return false;
  }
  return true;
}

function allCheckCorrectnessToolsHaveResults(
  history: DiscreteMatrixEvent[],
): boolean {
  let lastEventWithCheckCorrectnessRequests = findLast(history, (event) => {
    return getCheckCorrectnessToolRequests(event).length > 0;
  });

  if (!lastEventWithCheckCorrectnessRequests) {
    return true;
  }

  // The checks of one reply's edits can span several events, and the host
  // runs them in any order, so every check in the group needs its result,
  // looked for from the group's first event on.
  let group = correctnessGroupOf(
    lastEventWithCheckCorrectnessRequests,
    history,
  );
  let checkToolRequests = group.flatMap((event) =>
    getCheckCorrectnessToolRequests(event),
  );
  if (checkToolRequests.length === 0) {
    return true;
  }

  let startIndex = history.indexOf(group[0]);
  let subsequentEvents = history.slice(startIndex + 1);
  return checkToolRequests.every((request) => {
    return subsequentEvents.some((event) =>
      isTerminalToolResultEventFor(event, request.id!),
    );
  });
}

function shouldPromptCheckCorrectnessSummary(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  followUpsByMessage: ReadonlyMap<string, CorrectnessFollowUp[]>,
) {
  let lastEvent = history[history.length - 1];
  if (!isToolResultEvent(lastEvent)) {
    return false;
  }
  let batch = checkCorrectnessBatchFor(lastEvent, history);
  if (!batch) {
    return false;
  }
  let followUps = followUpsByMessage.get(
    correctnessGroupKey(history[batch.sourceIndex]),
  );
  if (!followUps || !needsCheckCorrectnessSummary(followUps)) {
    return false;
  }
  let lastNonResultIndex = findLastIndex(
    history,
    (event) => !isToolResult(event),
  );
  if (lastNonResultIndex === -1) {
    return true;
  }
  let lastNonResultEvent = history[lastNonResultIndex];
  return lastNonResultEvent.sender === aiBotUserId;
}

// Whether a batch, given the follow-ups its checks produced in the history,
// still needs the trailing note. Only a check that did not come back clean
// and carries no instruction of its own calls for it. A batch whose checks
// passed already has the success note, and a second note about the same
// results would only repeat it. A batch with any instruction to act on (fix
// the errors, fix the warnings, stop at the attempt limit) leaves it out:
// the note asks the model to finish its answer, which read last competes with
// that instruction. A canceled check never ran, so there is nothing to note,
// and telling the model to carry on would work against the stop or the newer
// message that canceled it.
function needsCheckCorrectnessSummary(
  followUps: readonly CorrectnessFollowUp[],
): boolean {
  return (
    followUps.includes('unresolved') &&
    !followUps.some(
      (followUp) =>
        followUp === 'fix' || followUp === 'limit' || followUp === 'warnings',
    )
  );
}

// The checks one message asked for: the message a check result answers, and
// that message's checkCorrectness requests. Undefined when `toolResult` does
// not answer a checkCorrectness request.
interface CheckCorrectnessBatch {
  sourceIndex: number;
  requests: ToolRequest[];
}

function checkCorrectnessBatchFor(
  toolResult: ToolResultEvent,
  history: DiscreteMatrixEvent[],
): CheckCorrectnessBatch | undefined {
  let sourceEventId = toolResult.content['m.relates_to']?.event_id;
  if (!sourceEventId) {
    return undefined;
  }
  let sourceIndex = history.findIndex(
    (event) => event.event_id === sourceEventId,
  );
  if (sourceIndex === -1) {
    return undefined;
  }
  let requests = getCheckCorrectnessToolRequests(history[sourceIndex]);
  if (
    !requests.some(
      (request) => request.id === toolResult.content.commandRequestId,
    )
  ) {
    return undefined;
  }
  return { sourceIndex, requests };
}

function getCheckCorrectnessToolRequests(
  event: DiscreteMatrixEvent,
): ToolRequest[] {
  if (!event || event.type !== 'm.room.message') {
    return [];
  }
  let encodedRequests =
    getToolRequests<Partial<EncodedToolRequest>>(
      event.content as CardMessageContent,
    ) ?? [];
  if (!Array.isArray(encodedRequests)) {
    return [];
  }
  let toolRequests: ToolRequest[] = [];
  for (let encodedRequest of encodedRequests) {
    let decoded = decodeToolRequestSafe(
      encodedRequest as Partial<EncodedToolRequest>,
    );
    if (decoded?.id && decoded.name === CHECK_CORRECTNESS_TOOL_NAME) {
      toolRequests.push(decoded);
    }
  }
  return toolRequests;
}

function decodeToolRequestSafe(
  request: Partial<EncodedToolRequest>,
): ToolRequest | undefined {
  try {
    let decoded = decodeToolRequest(request);
    if (decoded.id && decoded.name && decoded.arguments !== undefined) {
      return decoded as ToolRequest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isTerminalToolResultEventFor(
  event: DiscreteMatrixEvent,
  commandRequestId: string,
): boolean {
  if (
    !isToolResultEvent(event) ||
    event.content.commandRequestId !== commandRequestId
  ) {
    return false;
  }
  let status = event.content['m.relates_to']?.key;
  return (
    status === 'applied' ||
    status === 'failed' ||
    status === 'invalid' ||
    status === 'canceled'
  );
}

async function getEnabledSkills(
  eventlist: DiscreteMatrixEvent[],
  client: MatrixClient,
): Promise<EnabledSkill[]> {
  let skillsConfigEvent = findLast(
    eventlist,
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;
  if (!skillsConfigEvent) {
    return [];
  }

  let enabledSkillCards = skillsConfigEvent.content.enabledSkillCards;
  if (enabledSkillCards?.length) {
    let skills = await Promise.all(
      enabledSkillCards?.map(
        async (
          cardFileDef: SerializedFileDef,
        ): Promise<EnabledSkill | undefined> => {
          let content = await downloadFile(client, cardFileDef);
          // Dual-path window: markdown skills, handled here, are the pull
          // model — a SKILL.md is a plain file whose body is the
          // instructions, and it only counts as a skill when its frontmatter
          // declares boxel.kind: skill (the host gates enabling on the same
          // rule; this is defense in depth). Other markdown files are
          // skipped rather than fed to the card path below, which would
          // choke on non-JSON. The JSON.parse fallthrough is the legacy
          // pushed-card path; it is removed when the push model is retired.
          if (isMarkdownSkillFile(cardFileDef)) {
            let { title, body, kind, tools } = parseMarkdownSkill(
              content,
              cardFileDef,
            );
            if (kind !== 'skill') {
              return undefined;
            }
            return {
              id: cardFileDef.sourceUrl,
              attributes: { title, instructions: body, tools },
            };
          }
          return (JSON.parse(content) as LooseSingleCardDocument)?.data;
        },
      ),
    );
    return skills.filter((skill): skill is EnabledSkill => Boolean(skill));
  }
  return [];
}

// The subset of a skill the prompt pipeline consumes — sourced either from a
// legacy Skill card document or from a markdown SKILL.md file.
export interface EnabledSkill {
  id?: string;
  attributes?: {
    title?: string;
    instructions?: string;
    tools?: { functionName: string }[];
    // Legacy Skill cards serialize their tools under the `commands` card
    // field; read via the fallback in getTools.
    commands?: { functionName: string }[];
    [key: string]: any;
  };
}

// A skill enabled as a markdown file (SKILL.md), rather than a Skill card.
export function isMarkdownSkillFile(fileDef: SerializedFileDef): boolean {
  return isMarkdownFile(fileDef.sourceUrl ?? fileDef.name ?? '');
}

// A command a markdown skill contributes via its `boxel.tools` frontmatter
// (or the pre-rename `boxel.commands` key), with the functionName the host
// derives for the same code ref — so getTools can match it against the room's
// uploaded command definitions.
export interface MarkdownSkillTool {
  codeRef: { module: string; name: string };
  functionName: string;
  requiresApproval: boolean;
}

// Splits a markdown skill into its instruction body, a title, its declared
// boxel.kind, and its frontmatter commands. The body is everything after the
// `--- frontmatter ---` block (the frontmatter is metadata, not
// instructions); the title is the frontmatter `name`, falling back to the
// file name. Invalid frontmatter YAML degrades to the raw content as body —
// prompt assembly must not crash on a malformed skill file.
export function parseMarkdownSkill(
  content: string,
  fileDef: SerializedFileDef,
): {
  title: string;
  body: string;
  kind?: string;
  tools: MarkdownSkillTool[];
} {
  let body = content;
  let title: string | undefined;
  let kind: string | undefined;
  let tools: MarkdownSkillTool[] = [];
  try {
    let { data, body: parsedBody } = parseFrontmatter(content);
    body = parsedBody;
    if (typeof data.name === 'string' && data.name.trim()) {
      title = data.name.trim();
    }
    let boxel =
      data.boxel && typeof data.boxel === 'object' && !Array.isArray(data.boxel)
        ? (data.boxel as Record<string, unknown>)
        : undefined;
    if (typeof boxel?.kind === 'string') {
      kind = boxel.kind;
    }
    tools = markdownSkillTools(data, fileDef.sourceUrl);
  } catch {
    // Malformed frontmatter: keep the full content as the body.
  }
  if (!title) {
    let path = fileDef.sourceUrl ?? fileDef.name ?? '';
    title = path.split('/').filter(Boolean).pop() ?? 'Skill';
  }
  return { title, body: body.trim(), kind, tools };
}

// Extracts `boxel.tools` (falling back to the pre-rename `boxel.commands`
// key; `tools` wins when both are present) from parsed frontmatter and
// computes each command's functionName the way the host does when it uploads
// the room's command definitions. Package specifiers (e.g.
// @cardstack/boxel-host/...) resolve verbatim on the host, so hashing the
// literal module gives the same name; relative modules resolve against the
// skill's own URL.
function markdownSkillTools(
  frontmatter: Record<string, unknown>,
  skillUrl: string | undefined,
): MarkdownSkillTool[] {
  let boxel =
    frontmatter.boxel &&
    typeof frontmatter.boxel === 'object' &&
    !Array.isArray(frontmatter.boxel)
      ? (frontmatter.boxel as Record<string, unknown>)
      : undefined;
  let entries = Array.isArray(boxel?.tools)
    ? boxel.tools
    : Array.isArray(boxel?.commands)
      ? boxel.commands
      : undefined;
  if (!entries) {
    return [];
  }
  let commands: MarkdownSkillTool[] = [];
  for (let entry of entries) {
    let codeRef = (entry as { codeRef?: { module?: string; name?: string } })
      ?.codeRef;
    if (
      typeof codeRef?.module !== 'string' ||
      typeof codeRef?.name !== 'string'
    ) {
      continue;
    }
    let module = codeRef.module;
    // Match the host's isUrlLike semantics: both `.`- and `/`-prefixed
    // modules resolve against the skill's own URL. Known limitation: for a
    // skill row the indexer has not yet enriched, the host hashes relative
    // refs against the skill's canonical document id, which in a prefix-form
    // realm differs from the room-state sourceUrl we resolve against — so
    // relative command modules in prefix-form realms may not match until the
    // skill reindexes (the index stamp resolves against the skill's file
    // URL, agreeing with this resolution). Package specifiers and absolute
    // URLs (all current skills) hash identically on both sides.
    if ((module.startsWith('.') || module.startsWith('/')) && skillUrl) {
      try {
        module = new URL(module, skillUrl).href;
      } catch {
        // keep the module as authored; a bad relative ref simply won't match
      }
    }
    let resolvedRef = { module, name: codeRef.name };
    commands.push({
      codeRef: resolvedRef,
      functionName: buildToolFunctionNameFromResolvedRef(resolvedRef),
      // Missing means approval required, matching how the host treats an
      // absent requiresApproval on a skill command.
      requiresApproval:
        (entry as { requiresApproval?: unknown }).requiresApproval !== false,
    });
  }
  return commands;
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

// A message's rendering must depend only on the message itself, never on
// later history. Prompt caching is an exact prefix match: re-rendering an
// already-sent message (e.g. dropping an attachment's content because a
// newer version was attached later) changes bytes mid-history and re-bills
// everything after them at the full input price on every subsequent turn.
// Carrying the superseded content forward instead costs only cached-read
// tokens — a fraction of that.
export async function getAttachedCards(
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext,
) {
  let attachedCards = matrixEvent.content?.data?.attachedCards ?? [];
  let results = await Promise.all(
    attachedCards.map(async (attachedCard: SerializedFileDef) => {
      let result: SerializedFileDef = {
        url: attachedCard.url,
        sourceUrl: attachedCard.sourceUrl ?? '',
        name: attachedCard.name,
        contentType: attachedCard.contentType,
      };
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
      return result;
    }),
  );
  results =
    results
      ?.filter((cardFileDef) => cardFileDef?.url) // Only include cards with valid urls
      ?.sort((a, b) => String(a!.url!).localeCompare(String(b!.url!))) ?? [];
  return results;
}

// Byte-stable for the same reason as getAttachedCards above: each message
// keeps its own snapshot's content forever, so history bytes never change
// after they are first sent.
export async function getAttachedFiles(
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext,
): Promise<SerializedFileDef[]> {
  let attachedFiles = matrixEvent.content?.data?.attachedFiles ?? [];
  return Promise.all(
    attachedFiles.map(async (file: SerializedFileDef) => {
      if (isTextBasedContentType(file.contentType)) {
        return downloadTextContent(client, file);
      }
      return toFileDefMetadata(file);
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
      } else if (!isTextBasedContentType(f.contentType) && f.contentType) {
        let meta = [
          f.contentType,
          f.contentSize ? `${f.contentSize} bytes` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return `${hyperlink}: [${meta}]`;
      } else {
        return `${hyperlink}`;
      }
    })
    .join('\n');
}

// The names a skill source declares, regardless of markdown or card shape.
function skillDeclaredToolNames(skill: {
  attributes?: {
    tools?: { functionName: string }[];
    commands?: { functionName: string }[];
  };
}): string[] {
  let skillTools = skill.attributes?.tools ?? skill.attributes?.commands;
  return (skillTools ?? []).map((tool) => tool.functionName);
}

// The tool names declared by the skills the user has disabled — the only
// sanctioned removal from the tools array. Downloaded and parsed exactly
// like enabled skills; a name an enabled skill still declares is not
// removable (two skills can declare the same command).
async function getDisabledSkillToolNames(
  eventList: DiscreteMatrixEvent[],
  enabledToolNames: Set<string>,
  client: MatrixClient,
): Promise<Set<string>> {
  let skillsConfigEvent = findLast(
    eventList,
    (event) => event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  ) as SkillsConfigEvent;
  let disabledSkillCards = skillsConfigEvent?.content?.disabledSkillCards;
  let names = new Set<string>();
  if (!disabledSkillCards?.length) {
    return names;
  }
  await Promise.all(
    disabledSkillCards.map(async (cardFileDef: SerializedFileDef) => {
      let content = await downloadFile(client, cardFileDef);
      if (isMarkdownSkillFile(cardFileDef)) {
        let { tools } = parseMarkdownSkill(content, cardFileDef);
        for (let tool of tools ?? []) {
          if (tool.functionName) {
            names.add(tool.functionName);
          }
        }
        return;
      }
      let skill = (JSON.parse(content) as LooseSingleCardDocument)?.data;
      for (let name of skillDeclaredToolNames(skill ?? {})) {
        names.add(name);
      }
    }),
  );
  for (let name of enabledToolNames) {
    names.delete(name);
  }
  return names;
}

// The tools array renders ahead of all message history in the request, so
// any byte change to it re-bills the entire conversation from the first
// changed byte. Tools are therefore accumulated first-definition-wins, in
// first-seen order, over one chronological pass of the room's history: once
// a function name has entered the array, no re-read of an edited skill
// file, re-uploaded definition, or same-named message-context tool can
// mutate its bytes or its position, and new names only ever append. The
// trade is deliberate: a tool whose definition changed mid-session keeps
// its original schema until a new room, matching how skill instructions
// are snapshotted at attach. Every definition listed in a state event was
// declared by a then-enabled skill when the host wrote it (the host
// rebuilds the list from enabled skills on every write), so admission
// needs no gate against current skill contents — gating on the *current*
// declarations would silently drop a tool when an enabled skill is edited
// to remove it, shrinking the array mid-session.
//
// The one sanctioned removal is the user disabling a skill: the names that
// skill declares drop out (state-event definitions through the
// disabled-names gate, discovered definitions through the disabled-skills
// list), costing one honest cache reset per user toggle. Re-enabling
// restores the exact prior bytes and order, because first-wins re-admits
// each definition from its original event.
export async function getTools(
  eventList: DiscreteMatrixEvent[],
  enabledSkills: EnabledSkill[],
  aiBotUserId: string,
  client: MatrixClient,
): Promise<Tool[]> {
  let enabledToolNames = new Set<string>();
  for (let skill of enabledSkills) {
    for (let name of skillDeclaredToolNames(skill)) {
      enabledToolNames.add(name);
    }
  }
  let disabledToolNames = await getDisabledSkillToolNames(
    eventList,
    enabledToolNames,
    client,
  );
  let disabledSkillIds = new Set(await getDisabledSkillIds(eventList));

  // Map insertion order is the emitted array order.
  let toolMap = new Map<string, Tool>();
  let add = (tool: Tool | undefined) => {
    let name = tool?.function?.name;
    if (!name) {
      return;
    }
    // Correctness commands should only be emitted by helper flows, not
    // directly via LLM tool calls.
    if (name === CHECK_CORRECTNESS_TOOL_NAME) {
      return;
    }
    if (!toolMap.has(name)) {
      toolMap.set(name, tool!);
    }
  };

  for (let event of eventList) {
    // Definitions the host uploaded and listed in a room-skills state
    // event. Every state event is scanned — not just the latest — so a
    // definition's bytes and position come from its first listing even
    // when the host re-uploads a changed version later. Only names not
    // already admitted are downloaded. A failed download throws rather
    // than silently dropping the definition: a dropped entry would change
    // the array's bytes between rebuilds, which is exactly what this
    // function exists to prevent.
    if (event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE) {
      let toolDefinitionFileDefs =
        getToolDefinitions<SerializedFile>(
          (event as SkillsConfigEvent).content,
        ) ?? [];
      for (let toolDefinitionFileDef of toolDefinitionFileDefs) {
        // A nameless entry (pre-rename rooms carry some) can't be deduped
        // or addressed; downloading it would also make the union depend on
        // an unfetchable upload.
        if (
          !toolDefinitionFileDef.name ||
          disabledToolNames.has(toolDefinitionFileDef.name) ||
          toolMap.has(toolDefinitionFileDef.name)
        ) {
          continue;
        }
        let definitionContent = await downloadFile(
          client,
          toolDefinitionFileDef,
        );
        add(JSON.parse(definitionContent).tool);
      }
      continue;
    }

    for (let { tool, sourceSkillUrl } of toolSourceTools(event, aiBotUserId)) {
      if (sourceSkillUrl && disabledSkillIds.has(sourceSkillUrl)) {
        continue;
      }
      add(tool);
    }
  }

  return Array.from(toolMap.values());
}

// The tools an event other than a room-skills state event contributes to
// `getTools`, with the skill each discovered one came from.
//
// Tools discovered by the bot reading a skill file (readRealmFile): each
// applied read's result event embeds the definitions in
// `data.discoveredTools`. Only the bot publishes these; a discoveredTools
// block on anyone else's result event is not a legitimate discovery, and a
// failed or invalid read is not evidence of anything. A user message can
// also carry tools in its context.
export function toolSourceTools(
  event: DiscreteMatrixEvent,
  aiBotUserId: string,
): { tool: Tool; sourceSkillUrl?: string }[] {
  if (isToolResultEvent(event) && event.sender === aiBotUserId) {
    let content = event.content;
    if (
      !isToolResultWithOutputContent(content) ||
      content['m.relates_to']?.key !== 'applied'
    ) {
      return [];
    }
    return (content.data?.discoveredTools ?? [])
      .filter(
        (def) =>
          def?.sourceSkillUrl &&
          def.definition?.type === 'function' &&
          def.definition.function?.name,
      )
      .map((def) => ({
        tool: def.definition as Tool,
        sourceSkillUrl: def.sourceSkillUrl,
      }));
  }
  if (
    event.type === 'm.room.message' &&
    event.sender !== aiBotUserId &&
    event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
  ) {
    return (event.content.data?.context?.tools ?? []).map((tool: Tool) => ({
      tool,
    }));
  }
  return [];
}

// The events a compaction carries forward for `getTools`: in order, each
// event that contributes a tool, from a given skill, that no earlier one
// does. The history before the compaction's cut is not loaded, and
// `getRoomEvents` fetches these back by id. A tool is told apart by its skill
// as well as its name: when two skills declare the same tool and the user
// disables the first, `getTools` takes it from the second.
export function toolSourceEventIdsToCarry(
  eventList: DiscreteMatrixEvent[],
  aiBotUserId: string,
): string[] {
  let seen = new Set<string>();
  let eventIds: string[] = [];
  for (let event of eventList) {
    let newKeys = toolSourceTools(event, aiBotUserId)
      .filter(({ tool }) => !!tool?.function?.name)
      .map(({ tool, sourceSkillUrl }) =>
        JSON.stringify([sourceSkillUrl ?? null, tool.function.name]),
      )
      .filter((key) => !seen.has(key));
    if (newKeys.length) {
      newKeys.forEach((key) => seen.add(key));
      eventIds.push(event.event_id);
    }
  }
  return eventIds.slice(0, MAX_CARRIED_TOOL_SOURCE_EVENTS);
}

// The most tool-source events a compaction event carries. The tools of the
// events past it leave the prompt once the history before the cut is no
// longer loaded, unless the compaction also lists the event in
// `skillFileEventIds`: `getRoomEvents` fetches it back for its skill files,
// and `getTools` takes the tools of every event it is given.
export const MAX_CARRIED_TOOL_SOURCE_EVENTS = 200;

// The skill files an applied result ai-bot published attached.
function attachedSkillFiles(
  event: DiscreteMatrixEvent,
  aiBotUserId: string,
): SerializedFileDef[] {
  if (!isToolResultEvent(event) || event.sender !== aiBotUserId) {
    return [];
  }
  let content = event.content;
  if (
    !isToolResultWithOutputContent(content) ||
    content['m.relates_to']?.key !== 'applied'
  ) {
    return [];
  }
  return (content.data?.attachedFiles ?? []).filter(
    (file: SerializedFileDef) =>
      isSkillFileUrl(file.sourceUrl) &&
      isTextBasedContentType(file.contentType),
  );
}

// The readRealmFile results in the history that attached skill files, in
// order. A result counts only when the request it answers is in the history
// too, so a file named like a skill file that came from anywhere else (a
// readUrl call, a host command) is never taken for one.
function skillFileReadEvents(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): DiscreteMatrixEvent[] {
  let readRequestIds = new Set<string>();
  for (let event of history) {
    if (event.type !== 'm.room.message' || event.sender !== aiBotUserId) {
      continue;
    }
    for (let request of getToolRequests<Partial<EncodedToolRequest>>(
      event.content as CardMessageContent,
    ) ?? []) {
      if (request.id && request.name === READ_REALM_FILE_TOOL_NAME) {
        readRequestIds.add(request.id);
      }
    }
  }
  return history.filter(
    (event) =>
      attachedSkillFiles(event, aiBotUserId).length > 0 &&
      readRequestIds.has((event as ToolResultEvent).content.commandRequestId),
  );
}

// The readRealmFile results with skill files that a prompt carries after a
// compaction's summary: the ones the compaction lists, or, for a compaction
// that lists none, every one in the history up to its cut point.
function carriedSkillFileEvents(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  compaction: CompactionContent,
): DiscreteMatrixEvent[] {
  let cutIndex = history.findIndex(
    (event) => event.event_id === compaction.upToEventId,
  );
  if (cutIndex === -1) {
    return [];
  }
  let covered = history.slice(0, cutIndex + 1);
  if (!compaction.skillFileEventIds) {
    return skillFileReadEvents(covered, aiBotUserId);
  }
  let listed = new Set(compaction.skillFileEventIds);
  return covered.filter(
    (event) =>
      listed.has(event.event_id) &&
      attachedSkillFiles(event, aiBotUserId).length > 0,
  );
}

// The readRealmFile results with skill files that a new compaction, cutting
// at `upToEventId`, lists: those the prompt carries after the current
// compaction, and those read since, up to the new cut point. Their history
// is not loaded once the new compaction is in place, so `getRoomEvents`
// fetches them back by id. The newest are kept past
// `MAX_CARRIED_SKILL_FILE_EVENTS`.
export function skillFileEventIdsToCarry(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  upToEventId: string,
  currentCompaction?: CompactionContent,
): string[] {
  let cutIndex = history.findIndex((event) => event.event_id === upToEventId);
  if (cutIndex === -1) {
    return [];
  }
  let covered = history.slice(0, cutIndex + 1);
  let carried = new Set(
    (currentCompaction
      ? carriedSkillFileEvents(history, aiBotUserId, currentCompaction)
      : []
    ).map((event) => event.event_id),
  );
  for (let event of skillFileReadEvents(covered, aiBotUserId)) {
    carried.add(event.event_id);
  }
  return covered
    .map((event) => event.event_id)
    .filter((eventId) => carried.has(eventId))
    .slice(-MAX_CARRIED_SKILL_FILE_EVENTS);
}

// Whether a skill file belongs to a skill the user disabled: the disabled
// skill's own file, or a file under the directory of a disabled `SKILL.md`.
function isDisabledSkillFile(url: string, disabledSkillIds: string[]) {
  return disabledSkillIds.some(
    (skillId) =>
      url === skillId ||
      (skillId.endsWith('/SKILL.md') &&
        url.startsWith(skillId.slice(0, -'SKILL.md'.length))),
  );
}

// How many carried skill files `carriedSkillFiles` downloads at once.
const SKILL_FILE_DOWNLOAD_CONCURRENCY = 10;

// The message that follows a compaction's summary with the skill files the
// model read in the history the summary replaces, or undefined when it read
// none. Each file appears once, as its newest read.
//
// Files are chosen newest first by the size their read recorded: each one
// that still fits in `MAX_CARRIED_SKILL_FILE_BYTES` is chosen, so an older,
// smaller file can be chosen after a newer one too large for what is left.
// Only the chosen files are downloaded, a few at a time. The message then
// carries them as rendered, line numbers and headings included, newest first
// up to the same limit. The files that don't fit, files with no recorded
// size, and files the media server no longer has or won't serve are named
// for the model to read again. Any other download failure throws, as it does
// for the room's tool definitions, so a transient failure never changes the
// message. Files of a skill the user disabled are left out, as its tools
// are.
//
// The message depends on the history up to the cut point, the files it
// names, and which skills are disabled. Its bytes stay the same on every
// prompt until the next compaction, the next time the user disables or
// enables a skill (which also changes the tools), or a carried file's media
// goes missing; a file read again after the cut point does not change it.
async function carriedSkillFiles(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  compaction: CompactionContent,
  disabledSkillIds: string[],
  client: MatrixClient,
): Promise<string | undefined> {
  let seenUrls = new Set<string>();
  let newestFirst: SerializedFileDef[] = [];
  for (let event of [
    ...carriedSkillFileEvents(history, aiBotUserId, compaction),
  ].reverse()) {
    for (let file of [...attachedSkillFiles(event, aiBotUserId)].reverse()) {
      let url = file.sourceUrl!;
      if (seenUrls.has(url) || isDisabledSkillFile(url, disabledSkillIds)) {
        continue;
      }
      seenUrls.add(url);
      newestFirst.push(file);
    }
  }
  if (!newestFirst.length) {
    return undefined;
  }

  let chosen: SerializedFileDef[] = [];
  let chosenBytes = 0;
  for (let file of newestFirst) {
    let size = file.contentSize;
    if (
      typeof size === 'number' &&
      Number.isFinite(size) &&
      size >= 0 &&
      chosenBytes + size <= MAX_CARRIED_SKILL_FILE_BYTES
    ) {
      chosenBytes += size;
      chosen.push(file);
    }
  }

  let downloaded: (SerializedFileDef | undefined)[] = [];
  for (let batch of chunk(chosen, SKILL_FILE_DOWNLOAD_CONCURRENCY)) {
    downloaded.push(
      ...(await Promise.all(
        batch.map(async (file) => {
          try {
            return {
              ...toFileDefMetadata(file),
              content: await downloadFile(client, file),
            };
          } catch (error: any) {
            if (error?.status === 404 || error?.status === 403) {
              getLog().warn(
                `Skill file ${file.sourceUrl} is no longer available to carry`,
                error,
              );
              return undefined;
            }
            throw new Error(
              `Could not download the skill file ${file.sourceUrl} that the compaction carries: ${error?.message ?? error}`,
              { cause: error },
            );
          }
        }),
      )),
    );
  }

  let carried: SerializedFileDef[] = [];
  let carriedBytes = 0;
  let encoder = new TextEncoder();
  for (let file of downloaded) {
    if (!file) {
      continue;
    }
    let bytes =
      encoder.encode(attachedFilesToMessage([file])).length +
      (carried.length ? 1 : 0);
    if (carriedBytes + bytes <= MAX_CARRIED_SKILL_FILE_BYTES) {
      carriedBytes += bytes;
      carried.push(file);
    }
  }
  let carriedUrls = new Set(carried.map((file) => file.sourceUrl));
  let reReadUrls = newestFirst
    .map((file) => file.sourceUrl!)
    .filter((url) => !carriedUrls.has(url))
    .reverse();
  carried.reverse();
  getLog().info(
    `Carrying ${carried.length} skill files (${carriedBytes} bytes rendered) after the compaction summary; ${reReadUrls.length} to read again: %j`,
    reReadUrls,
  );
  return carriedSkillFilesMessage(
    carried.length ? attachedFilesToMessage(carried) : undefined,
    reReadUrls,
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

function getToolResults(
  cardMessageEvent: CardMessageEvent,
  history: DiscreteMatrixEvent[],
) {
  // CS-11045: pair tool_results with the bot message by commandRequestId in
  // addition to m.relates_to.event_id. The host can emit a toolResult whose
  // m.relates_to.event_id is the streaming/original event_id while the matrix
  // server's /messages view normalizes the bot message to the latest m.replace
  // event_id. Without the commandRequestId fallback the result gets dropped,
  // leaving an orphan tool_use that Anthropic rejects.
  let requestIds = new Set(
    (
      getToolRequests<Partial<EncodedToolRequest>>(cardMessageEvent.content) ??
      []
    )
      .map((r) => r.id)
      .filter(Boolean) as string[],
  );
  let toolResultEvents = history.filter((e) => {
    if (!isToolResultEvent(e)) {
      return false;
    }
    if (e.content['m.relates_to']?.event_id === cardMessageEvent.event_id) {
      return true;
    }
    if (requestIds.has(e.content.commandRequestId)) {
      return true;
    }
    return false;
  }) as ToolResultEvent[];
  return toolResultEvents;
}

// The latest result that is a call's outcome. A request can accumulate
// several result events — a 'failed' from a first attempt and an 'applied'
// from a later retry — and an approval is not an outcome at all.
function findToolResultFor(
  toolResults: ToolResultEvent[],
  commandRequestId: string | undefined,
): ToolResultEvent | undefined {
  return findLast(
    toolResults,
    (toolResult) =>
      (isToolResultWithOutputMsgtype(toolResult.content.msgtype) ||
        isToolResultWithNoOutputMsgtype(toolResult.content.msgtype)) &&
      !isApprovalResult(toolResult) &&
      toolResult.content.commandRequestId === commandRequestId,
  );
}

// Whether a call finished streaming: it has a name, and arguments that parse.
function isCompleteToolRequest(request: Partial<EncodedToolRequest>): boolean {
  if (!request.name) {
    return false;
  }
  if (typeof request.arguments === 'object' && request.arguments !== null) {
    // older format, already decoded
    return true;
  }
  if (typeof request.arguments !== 'string') {
    return false;
  }
  try {
    JSON.parse(request.arguments);
    return true;
  } catch {
    return false;
  }
}

function isCanceledAnswer(event: CardMessageEvent): boolean {
  return Boolean(
    (event.content as CardMessageContent).isCanceled ||
    (event as { status?: string }).status === 'cancelled',
  );
}

// The calls of a bot message that go into the prompt. The provider rejects a
// prompt whose call has no tool message after it ("No tool output found for
// function call"), so every call carried here gets one from
// `toResultMessages`, even when nothing answered it in the room. A call cut
// off mid-stream, because its answer was stopped or interrupted, is not a
// request the model finished making: it is left out, with its canceled
// result, so the prompt never carries arguments that do not parse.
function promptToolRequests(
  event: CardMessageEvent,
  toolResults: ToolResultEvent[],
): Partial<EncodedToolRequest>[] {
  let canceled = isCanceledAnswer(event);
  return (
    getToolRequests<Partial<EncodedToolRequest>>(
      event.content as CardMessageContent,
    ) ?? []
  ).filter(
    (toolRequest) =>
      toolRequest.id &&
      (isCompleteToolRequest(toolRequest) ||
        (!canceled && findToolResultFor(toolResults, toolRequest.id))),
  );
}

// The tool message for a call nothing in the room answered: the answer that
// made it was canceled before the call ran, or its result never arrived (for
// example ai-bot restarted, or the user wrote again without running it).
function unansweredToolMessage(
  event: CardMessageEvent,
  toolCallId: string,
): OpenAIPromptMessage {
  let canceled = isCanceledAnswer(event);
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: canceled
      ? 'Tool call canceled: the answer that made this call was stopped before the call ran.\n'
      : 'Tool call not run: no result was recorded for this call.\n',
  };
}

function toToolCalls(
  event: CardMessageEvent,
  toolResults: ToolResultEvent[] = [],
): ChatCompletionMessageToolCall[] {
  return promptToolRequests(event, toolResults).map(
    (toolRequest: Partial<EncodedToolRequest>) => {
      return {
        id: toolRequest.id!,
        function: {
          name: toolRequest.name!,
          arguments: toolRequest.arguments!,
        },
        type: 'function',
      };
    },
  );
}

// The prompt messages for a bot message's tool results, the follow-up each
// of its correctness checks produced (empty when it asked for none), and the
// instructions those checks call for, which correctnessFollowUpMessages
// narrows once the whole correctness group is in.
async function toResultMessages(
  event: CardMessageEvent,
  toolResults: ToolResultEvent[] = [],
  client: MatrixClient,
  history: DiscreteMatrixEvent[],
): Promise<{
  toolMessages: OpenAIPromptMessage[];
  followUpMessages: OpenAIPromptMessage[];
  correctnessFollowUps: CorrectnessFollowUp[];
}> {
  let toolResultEntries = await Promise.all(
    promptToolRequests(event, toolResults).map(
      async (toolRequest: Partial<EncodedToolRequest>) => {
        let decodedToolRequest = decodeToolRequestSafe(toolRequest);
        let toolResult = findToolResultFor(toolResults, toolRequest.id);
        if (!toolResult) {
          return {
            toolMessage: unansweredToolMessage(event, toolRequest.id!),
            followUpMessage: undefined,
            correctnessFollowUp: undefined,
          };
        }
        let content: string;
        let followUpUserMessage: string | undefined;
        let correctnessFollowUp: CorrectnessFollowUp | undefined;
        let status = toolResult.content['m.relates_to']?.key;
        let isCheckCorrectnessRequest =
          decodedToolRequest?.name === CHECK_CORRECTNESS_TOOL_NAME;
        if (isCheckCorrectnessRequest) {
          let checkCorrectnessContent = buildCheckCorrectnessResultContent(
            decodedToolRequest,
            toolResult,
          );
          content = checkCorrectnessContent.toolMessage;
          followUpUserMessage = checkCorrectnessContent.followUpUserMessage;
          correctnessFollowUp = checkCorrectnessContent.followUp;
        } else if (isReadFileCommand(decodedToolRequest)) {
          let fileUrl = getReadFileUrl(decodedToolRequest);
          if (fileUrl && !isFileAttachedInRoom(fileUrl, history)) {
            content = `Tool call rejected: the file "${fileUrl}" was not previously attached in the room. Only files attached by the user can be read.\n`;
          } else {
            content = `Tool call ${status == 'applied' ? 'executed' : status}.\n`;
          }
        } else if (
          isToolResultWithOutputContent(toolResult.content) &&
          toolResult.content.data.card
        ) {
          let cardContent =
            toolResult.content.data.card.content ??
            toolResult.content.data.card.error;
          content = `Tool call ${status == 'applied' ? 'executed' : status}, with result card: ${cardContent}.\n`;
        } else {
          content = `Tool call ${status == 'applied' ? 'executed' : status}.\n`;
        }
        // Surface the failure reason to the model — without it a failed (or
        // partially fulfilled, e.g. a multi-file read where one file 404ed)
        // tool call reads as a bare status with nothing to act on.
        // Check-correctness results fold their reason in above.
        let failureReason = toolResult.content.failureReason;
        if (!isCheckCorrectnessRequest && failureReason) {
          content = `${content}${failureReason}\n`;
        }
        let attachmentText = await buildAttachmentsMessagePart(
          client,
          toolResult,
        );
        content = [content, attachmentText].filter(Boolean).join('\n\n');
        let toolMessage: OpenAIPromptMessage = {
          role: 'tool',
          tool_call_id: toolRequest.id,
          content,
        };
        let followUpMessage = followUpUserMessage
          ? ({
              role: 'user',
              content: followUpUserMessage,
            } as OpenAIPromptMessage)
          : undefined;
        return { toolMessage, followUpMessage, correctnessFollowUp };
      },
    ),
  );
  let toolMessages =
    toolResultEntries
      .map((entry) => entry?.toolMessage)
      .filter((message): message is OpenAIPromptMessage => Boolean(message)) ??
    [];
  let correctnessFollowUps = toolResultEntries
    .map((entry) => entry?.correctnessFollowUp)
    .filter((followUp): followUp is CorrectnessFollowUp => Boolean(followUp));
  let followUpMessages = toolResultEntries
    .map((entry) => entry?.followUpMessage)
    .filter((message): message is OpenAIPromptMessage => Boolean(message));
  return { toolMessages, followUpMessages, correctnessFollowUps };
}

// The checks of one correctness group get one instruction for the batch. If
// any of them did not pass, the success note is left out: it would tell the
// model the write passed and to finish, next to the instruction to fix it.
// A request to fix warnings displaces it the same way. Checks that end the
// same way share one note, so the model reads the same instruction once,
// not once per file.
function correctnessFollowUpMessages(
  followUpMessages: OpenAIPromptMessage[],
  correctnessFollowUps: CorrectnessFollowUp[],
): OpenAIPromptMessage[] {
  let anyCheckNotPassed = correctnessFollowUps.some(
    (followUp) => followUp !== 'success' && followUp !== 'pending',
  );
  return uniqBy(
    followUpMessages.filter(
      (message) =>
        !anyCheckNotPassed ||
        message.content !== CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION,
    ),
    (message) => message.content,
  );
}

function buildCheckCorrectnessResultContent(
  request?: ToolRequest,
  toolResult?: ToolResultEvent,
): CheckCorrectnessResultContent {
  let targetDescription = describeCheckCorrectnessTarget(request);
  if (!toolResult) {
    return {
      toolMessage: `Check correctness for ${targetDescription} is still pending.`,
      followUp: 'pending',
    };
  }
  let status = toolResult.content['m.relates_to']?.key ?? 'unknown';
  let read = readCorrectnessResult(toolResult);
  let batchTargets = batchTargetsOf(request);
  if (batchTargets && read.kind === 'card') {
    return batchCheckCorrectnessResultContent(
      batchTargets,
      read.summary,
      status,
    );
  }
  if (batchTargets && read.kind === 'no-card' && status === 'applied') {
    // A check of several targets always answers with a result card; without
    // one, nothing says which targets passed.
    return {
      toolMessage: `The correctness result for ${targetDescription} could not be read.`,
      followUp: 'unresolved',
    };
  }
  if (read.kind === 'card') {
    let formattedSummary = formatCorrectnessResultSummary(
      targetDescription,
      read.summary,
      status,
    );
    let attemptNumber = Math.max(
      1,
      getCorrectnessCheckAttemptFromRequest(request),
    );
    return toCheckCorrectnessResultContent(
      formattedSummary,
      correctnessCheckPassed(toolResult),
      attemptNumber,
      isCardCorrectnessTarget(request),
    );
  }
  if (read.kind === 'unreadable' && status === 'applied') {
    return {
      toolMessage: `The correctness result for ${targetDescription} could not be read${read.reason ? `: ${read.reason}` : ''}.`,
      followUp: 'unresolved',
    };
  }
  if (status === 'applied') {
    return {
      toolMessage: `Check correctness passed for ${targetDescription}.`,
      followUpUserMessage: CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION,
      followUp: 'success',
    };
  }
  let followUp: CorrectnessFollowUp =
    status === 'canceled' ? 'canceled' : 'unresolved';
  let failureReason = toolResult.content.failureReason;
  if (failureReason) {
    return {
      toolMessage: `Check correctness was marked as ${status} for ${targetDescription}: ${failureReason}`,
      followUp,
    };
  }
  return {
    toolMessage: `Check correctness was marked as ${status} for ${targetDescription}.`,
    followUp,
  };
}

// Card-instance checks report warnings about what was written (undeclared
// fields, invalid options, dangling links), so only those ask for a fix.
// A card can be written as its .json file, so that counts too.
function isCardCorrectnessTarget(request?: ToolRequest): boolean {
  let { targetType, targetRef } = extractCheckCorrectnessTargetParts(request);
  return isCardCheckTarget({ type: targetType, ref: targetRef });
}

function describeCheckCorrectnessTarget(request?: ToolRequest) {
  if (!request) {
    return 'the requested target';
  }
  let batchTargets = batchTargetsOf(request);
  if (batchTargets) {
    return describeCheckTargetCount(batchTargets);
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
  // A check of several targets: one entry per target that failed or warned.
  targetResults?: CorrectnessTargetResult[];
};

type CorrectnessTargetResult = {
  targetType?: string;
  targetRef?: string;
  errors: string[];
  warnings: string[];
};

// What a check's result asks of the model next: fix its errors, stop at the
// attempt limit, fix its warnings, note that it passed (`success`), nothing
// it can act on (`unresolved`: the card says incorrect without naming an
// error, the result could not be read, the check failed or was declined),
// nothing because the check never ran (`canceled`), or nothing yet
// (`pending`). The history's follow-up messages and the trailing note are
// both decided from it.
type CorrectnessFollowUp =
  | 'fix'
  | 'limit'
  | 'warnings'
  | 'success'
  | 'unresolved'
  | 'canceled'
  | 'pending';

type CheckCorrectnessResultContent = {
  toolMessage: string;
  followUpUserMessage?: string;
  followUp: CorrectnessFollowUp;
};

type FormattedCorrectnessSummary = {
  summary: string;
  hasErrors: boolean;
  hasWarnings: boolean;
};

// Sent after a correctness check fails. The runner can edit source immediately
// after a failed check, while instance-oriented tools still cannot reliably
// address a card that has not been indexed yet.
const CODE_FIX_INSTRUCTION = `1. Fix the errors above by re-reading the failing file(s), then use the run-realm-code tool. Make awaited realm.fs.replace calls with exact current text.
2. Keep all fixes in one tool call or one reply, and do not repeat a failed match without re-reading the file.`;

// Sent once, as a user-role message after the tool results, when every check
// in a batch passed (see correctnessCheckPassed); the trailing summary below
// is then left out, so this is the last instruction the model reads. A bare "summarize in one sentence"
// in that place replaces the answer the user asked for before the write (the
// question that came with the request, a skill's required closing line) with
// the sentence. The note therefore sizes itself at one line and sends the
// model back to the user's message to finish.
const CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION =
  'The write above passed its checks. Note that in at most one line of your reply, including any warnings listed above. Then finish your answer to the user: cover everything their last message asked for that you have not yet answered, any closing line your skills require, and any change you made that they did not ask for. If work you already described remains unfinished, carry straight on with it in the same reply. This is a note on what just landed, not a request to stop. Do not mention correctness, automated checks or tool calls.';

// Warnings never fail the check, but they often name a mistake in what was
// just written (a misnamed field, an invalid option, a dangling link) that
// left the card silently incomplete. Sent in place of the success note while
// attempts remain; these rounds count toward MAX_CORRECTNESS_FIX_ATTEMPTS, and
// at the cap the success note (which already asks the model to mention the
// warnings) takes over.
const CORRECTNESS_WARNINGS_FIX_INSTRUCTION =
  'The write above passed its checks, but the warnings above may point at mistakes in what you just wrote: a misnamed field, a value outside the allowed options, data written in the wrong place, or a link to a card that does not exist. Fix the ones that are mistakes now by re-reading the file and using the run-realm-code tool. If none are mistakes, note the warnings in at most one line and finish your answer to the user. Do not mention correctness, automated checks or tool calls.';

const CORRECTNESS_FAILURE_LIMIT_INSTRUCTION = `Automated correctness fixes have already been attempted ${MAX_CORRECTNESS_FIX_ATTEMPTS} times and the errors above remain. Stop proposing further automated patches; instead, summarize the remaining errors and ask the user how they want to proceed. Do not mention correctness or automated checks or tool calls.`;

// Rides the trailing context message after a batch with a check that did
// not come back clean and no instruction to act on: a card that says it is
// incorrect without naming an error, a result card that could not be read, or
// a check marked failed or invalid (see needsCheckCorrectnessSummary for the
// batches that leave it out).
// It is the last thing the model reads before replying, right after a file
// is written, so it sizes the note at one line and sends the model back to
// the user's message: an instruction that only asks for a summary reads as
// the end of the work, and nothing resumes a plan across turns.
export const CHECK_CORRECTNESS_SUMMARY_INSTRUCTION =
  'The automated correctness checks have finished, and at least one did not come back clean. Note the outcome in at most one line of your reply, based on the tool output above; if it leaves something open, say what. Then finish your answer to the user: cover everything their last message asked for that you have not yet answered, any closing line your skills require, and any change you made that they did not ask for. If work you already described remains unfinished, carry straight on with it in the same reply. This is a note on what just landed, not a request to stop. Do not mention correctness, automated checks or tool calls.';

// What a check result carries: no result card at all (a result with no
// output), a card whose content could not be read (its download failed, or
// it is not a correctness card), or the card's verdict.
type CorrectnessResultRead =
  | { kind: 'no-card' }
  | { kind: 'unreadable'; reason: string | undefined }
  | { kind: 'card'; summary: CorrectnessResultSummary };

function readCorrectnessResult(
  toolResult: ToolResultEvent,
): CorrectnessResultRead {
  if (!isToolResultWithOutputContent(toolResult.content)) {
    return { kind: 'no-card' };
  }
  let cardPayload = toolResult.content.data.card;
  if (!cardPayload) {
    return { kind: 'no-card' };
  }
  if (typeof cardPayload.content !== 'string') {
    return { kind: 'unreadable', reason: cardPayload.error };
  }
  let parsed:
    | {
        data?: {
          attributes?: {
            correct?: boolean;
            errors?: string[];
            warnings?: string[];
            targetResults?: Partial<CorrectnessTargetResult>[];
          };
        };
      }
    | undefined;
  try {
    parsed = JSON.parse(cardPayload.content);
  } catch (error) {
    getLog().error('Unable to parse correctness result card', error);
    return { kind: 'unreadable', reason: 'its content is not JSON' };
  }
  let attributes = parsed?.data?.attributes;
  if (!attributes) {
    return { kind: 'unreadable', reason: 'it is not a correctness result' };
  }
  return {
    kind: 'card',
    summary: {
      correct: Boolean(attributes.correct),
      errors: Array.isArray(attributes.errors) ? attributes.errors : [],
      warnings: Array.isArray(attributes.warnings) ? attributes.warnings : [],
      ...(Array.isArray(attributes.targetResults)
        ? {
            targetResults: attributes.targetResults.map((result) => ({
              targetType: result?.targetType,
              targetRef: result?.targetRef,
              errors: nonEmptyLines(result?.errors),
              warnings: nonEmptyLines(result?.warnings),
            })),
          }
        : {}),
    },
  };
}

function nonEmptyLines(entries: unknown): string[] {
  return Array.isArray(entries)
    ? entries.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
}

function correctnessErrorLines(summary: CorrectnessResultSummary): string[] {
  return summary.errors.filter(
    (entry) => typeof entry === 'string' && entry.trim().length > 0,
  );
}

// The one definition of a check that passed. It came back applied, and
// either carries no result card or a card that says it is correct and lists
// no errors. Everything else, including a card that could not be read, did
// not pass: the model is never told a write passed when nobody knows.
function correctnessCheckPassed(toolResult: ToolResultEvent): boolean {
  if (toolResult.content['m.relates_to']?.key !== 'applied') {
    return false;
  }
  let read = readCorrectnessResult(toolResult);
  if (read.kind === 'no-card') {
    return true;
  }
  return (
    read.kind === 'card' &&
    read.summary.correct &&
    correctnessErrorLines(read.summary).length === 0
  );
}

function correctnessCheckHasWarnings(toolResult: ToolResultEvent): boolean {
  let read = readCorrectnessResult(toolResult);
  return (
    read.kind === 'card' &&
    read.summary.warnings.some(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    )
  );
}

// One file or card a correctness check covers, from either request shape:
// one target per request (`targetType` and `targetRef`, the shape older rooms
// carry) or several (`targets`). `replyEventId` is the reply whose edits the
// check covers. `attempt` is 0 when a one-target request doesn't say; a
// target of several without one is on its first round.
interface CheckedTarget {
  type: string;
  ref: string;
  attempt: number;
  replyEventId?: string;
}

function checkCorrectnessAttributes(
  request?: Partial<ToolRequest>,
): Record<string, any> {
  return (
    (((request?.arguments as Record<string, any>) ?? {}).attributes as
      | Record<string, any>
      | undefined) ?? {}
  );
}

// The targets of a check of several targets, or undefined for a request in
// the one-target shape. A target's attempt is left out on its first round.
function batchTargetsOf(
  request?: Partial<ToolRequest>,
  sourceEvent?: DiscreteMatrixEvent,
): CheckedTarget[] | undefined {
  let { targets } = checkCorrectnessAttributes(request);
  if (!Array.isArray(targets)) {
    return undefined;
  }
  let replyEventId = correctnessReplyEventId(sourceEvent);
  return targets
    .filter((target) => typeof target?.ref === 'string' && target.ref)
    .map((target) => ({
      type: typeof target.type === 'string' ? target.type : 'target',
      ref: target.ref,
      attempt:
        typeof target.attempt === 'number' && Number.isFinite(target.attempt)
          ? target.attempt
          : 1,
      replyEventId,
    }));
}

function checkedTargetsOf(
  request: Partial<ToolRequest>,
  sourceEvent: DiscreteMatrixEvent,
): CheckedTarget[] {
  let batchTargets = batchTargetsOf(request, sourceEvent);
  if (batchTargets) {
    return batchTargets;
  }
  let { targetRef, targetType, targetEventId } =
    extractCheckCorrectnessTargetParts(request as ToolRequest);
  if (!targetRef) {
    return [];
  }
  return [
    {
      type: targetType ?? 'target',
      ref: String(targetRef),
      attempt: getCorrectnessCheckAttemptFromRequest(request as ToolRequest),
      replyEventId: targetEventId,
    },
  ];
}

// Added to the fix instruction when some failing targets are under the
// attempt limit and others are at it. The checks will not run on the ones at
// the limit again, so an edit to them would never be confirmed.
const CORRECTNESS_AT_LIMIT_NOTE =
  'Leave the targets marked as at the attempt limit unchanged: report their remaining errors to the user instead.';

// The result of a check of several targets: each failing target with its
// errors and its attempt, the warnings, and how many passed. The instruction
// that follows is decided across the targets: fix while any failing target
// has attempts left, stop at the limit when none has.
function batchCheckCorrectnessResultContent(
  targets: CheckedTarget[],
  summary: CorrectnessResultSummary,
  status: string,
): CheckCorrectnessResultContent {
  let results = summary.targetResults ?? [];
  let resultFor = (target: CheckedTarget) =>
    results.find(
      (result) =>
        result.targetRef === target.ref && result.targetType === target.type,
    );
  let attemptOf = (target: CheckedTarget) => Math.max(1, target.attempt);
  let failing = targets.filter((target) => resultFor(target)?.errors.length);
  let warned = targets.filter(
    (target) =>
      !resultFor(target)?.errors.length && resultFor(target)?.warnings.length,
  );
  let description = describeCheckTargetCount(targets);
  let sections: string[] = [];
  if (status !== 'applied') {
    sections.push(
      `Check correctness was marked as ${status} for ${description}.`,
    );
  } else if (failing.length) {
    sections.push(
      `Check correctness found errors in ${failing.length} of ${description}; the other ${targets.length - failing.length} passed.`,
    );
  } else if (!summary.correct) {
    sections.push(`Check correctness was marked as failed for ${description}.`);
  } else {
    sections.push(`Check correctness passed for ${description}.`);
  }
  if (failing.length) {
    sections.push(
      `Errors:\n${failing
        .map((target) => {
          let attempt = attemptOf(target);
          let attemptNote = `automated fix attempts so far: ${Math.min(attempt, MAX_CORRECTNESS_FIX_ATTEMPTS)} of ${MAX_CORRECTNESS_FIX_ATTEMPTS}`;
          if (attempt >= MAX_CORRECTNESS_FIX_ATTEMPTS) {
            attemptNote = `${attemptNote}, at the attempt limit`;
          }
          return [
            `- ${target.type} "${target.ref}" (${attemptNote}):`,
            ...resultFor(target)!.errors.map((line) => `  - ${line}`),
          ].join('\n');
        })
        .join('\n')}`,
    );
  }
  let warningLines = targets.flatMap(
    (target) => resultFor(target)?.warnings ?? [],
  );
  if (warningLines.length) {
    sections.push(
      `Warnings:\n${warningLines.map((line) => `- ${line}`).join('\n')}`,
    );
  }
  let toolMessage = sections.join('\n\n');

  if (failing.length) {
    let withAttemptsLeft = failing.filter(
      (target) => attemptOf(target) < MAX_CORRECTNESS_FIX_ATTEMPTS,
    );
    if (!withAttemptsLeft.length) {
      return {
        toolMessage,
        followUpUserMessage: CORRECTNESS_FAILURE_LIMIT_INSTRUCTION,
        followUp: 'limit',
      };
    }
    return {
      toolMessage,
      followUpUserMessage:
        withAttemptsLeft.length < failing.length
          ? `${CODE_FIX_INSTRUCTION}\n3. ${CORRECTNESS_AT_LIMIT_NOTE}`
          : CODE_FIX_INSTRUCTION,
      followUp: 'fix',
    };
  }
  if (status !== 'applied' || !summary.correct) {
    return { toolMessage, followUp: 'unresolved' };
  }
  if (
    warned.some(
      (target) =>
        isCardCheckTarget(target) &&
        attemptOf(target) < MAX_CORRECTNESS_FIX_ATTEMPTS,
    )
  ) {
    return {
      toolMessage,
      followUpUserMessage: CORRECTNESS_WARNINGS_FIX_INSTRUCTION,
      followUp: 'warnings',
    };
  }
  return {
    toolMessage,
    followUpUserMessage: CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION,
    followUp: 'success',
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
  let errorLines = correctnessErrorLines(result);
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
    hasWarnings: warningLines.length > 0,
  };
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
  request?: ToolRequest,
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

function getCorrectnessCheckAttemptFromRequest(request?: ToolRequest): number {
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

// One target's outcome in one check result, in history order.
interface CorrectnessCheckRecord {
  type: string;
  ref: string;
  replyEventId?: string;
  attempt: number;
  succeeded: boolean;
  historyIndex: number;
}

// Every target outcome of the check results in the history, read once so
// the attempts of a bulk edit's hundreds of targets are each a lookup.
function collectCorrectnessCheckRecords(
  history: DiscreteMatrixEvent[],
): CorrectnessCheckRecord[] {
  let requestsById = new Map<
    string,
    { request: ToolRequest; event: DiscreteMatrixEvent }
  >();
  for (let event of history) {
    for (let request of getCheckCorrectnessToolRequests(event)) {
      if (!requestsById.has(request.id)) {
        requestsById.set(request.id, { request, event });
      }
    }
  }
  let records: CorrectnessCheckRecord[] = [];
  history.forEach((event, historyIndex) => {
    if (!isToolResultEventType(event.type)) {
      return;
    }
    let toolResult = event as ToolResultEvent;
    let source = requestsById.get(toolResult.content.commandRequestId);
    if (
      !source ||
      toolResult.content['m.relates_to']?.event_id !== source.event.event_id
    ) {
      return;
    }
    let isBatch = batchTargetsOf(source.request) !== undefined;
    for (let target of checkedTargetsOf(source.request, source.event)) {
      records.push({
        ...target,
        attempt: Math.max(1, target.attempt),
        succeeded: isBatch
          ? batchTargetSucceeded(toolResult, target)
          : // A pass that still carries warnings asks for a fix, so it keeps
            // the attempt count running rather than resetting it.
            correctnessCheckPassed(toolResult) &&
            !correctnessCheckHasWarnings(toolResult),
        historyIndex,
      });
    }
  });
  return records;
}

// A target of a check of several targets passed clean when the check ran and
// its result names no error or warning for it. A check that failed, timed
// out, was canceled or can't be read says nothing about any of its targets.
function batchTargetSucceeded(
  toolResult: ToolResultEvent,
  target: CheckedTarget,
): boolean {
  if (toolResult.content['m.relates_to']?.key !== 'applied') {
    return false;
  }
  let read = readCorrectnessResult(toolResult);
  if (read.kind !== 'card') {
    return false;
  }
  let results = read.summary.targetResults ?? [];
  let result = results.find(
    (candidate) =>
      candidate.targetRef === target.ref &&
      candidate.targetType === target.type,
  );
  if (result) {
    return !result.errors.length && !result.warnings.length;
  }
  // Not named: it passed, unless the check failed without naming a target.
  return (
    read.summary.correct || results.some((candidate) => candidate.errors.length)
  );
}

// Attempts count consecutive automated rounds on one target. Each fix the AI
// sends arrives in a new message, so a target with no check yet under this
// patch event continues the count from its last check under an earlier
// event — unless the user has spoken since, which starts a fresh run.
function getNextCorrectnessCheckAttempt(
  records: CorrectnessCheckRecord[],
  { type, ref }: { type: string; ref: string },
  replyEventId: string | undefined,
  lastUserMessageIndex: number,
): number {
  let sameTarget = (record: CorrectnessCheckRecord) =>
    record.type === type && record.ref === ref;
  let latest =
    (replyEventId
      ? findLast(
          records,
          (record) =>
            sameTarget(record) && record.replyEventId === replyEventId,
        )
      : undefined) ??
    findLast(
      records,
      (record) =>
        sameTarget(record) && record.historyIndex > lastUserMessageIndex,
    );
  if (!latest || latest.succeeded) {
    return 1;
  }
  return latest.attempt + 1;
}

function toCheckCorrectnessResultContent(
  formattedSummary: FormattedCorrectnessSummary,
  passed: boolean,
  attemptNumber = 0,
  isCardTarget = false,
): CheckCorrectnessResultContent {
  let attemptNote =
    formattedSummary.hasErrors && attemptNumber > 0
      ? `Automated fix attempts so far: ${Math.min(attemptNumber, MAX_CORRECTNESS_FIX_ATTEMPTS)} of ${MAX_CORRECTNESS_FIX_ATTEMPTS}.`
      : undefined;
  let toolMessage = [formattedSummary.summary, attemptNote]
    .filter(Boolean)
    .join('\n\n');

  if (passed) {
    if (
      isCardTarget &&
      formattedSummary.hasWarnings &&
      attemptNumber < MAX_CORRECTNESS_FIX_ATTEMPTS
    ) {
      return {
        toolMessage,
        followUpUserMessage: CORRECTNESS_WARNINGS_FIX_INSTRUCTION,
        followUp: 'warnings',
      };
    }
    return {
      toolMessage,
      followUpUserMessage: CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION,
      followUp: 'success',
    };
  }
  // Not passed, but nothing listed to fix (the card says incorrect without
  // naming an error): no note, and the trailing summary covers it.
  if (!formattedSummary.hasErrors) {
    return { toolMessage, followUp: 'unresolved' };
  }

  if (attemptNumber >= MAX_CORRECTNESS_FIX_ATTEMPTS) {
    return {
      toolMessage,
      followUpUserMessage: CORRECTNESS_FAILURE_LIMIT_INSTRUCTION,
      followUp: 'limit',
    };
  }

  return {
    toolMessage,
    followUpUserMessage: CODE_FIX_INSTRUCTION,
    followUp: 'fix',
  };
}

export async function buildPromptForModel(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  skillCards: EnabledSkill[] = [],
  disabledSkillIds: string[] = [],
  client: MatrixClient,
  inputModalities?: string[],
  enabledSkillFeatures: string[] = [],
  compaction?: CompactionContent,
) {
  // Need to make sure the passed in username is a full id
  if (
    aiBotUserId.indexOf(':') === -1 ||
    aiBotUserId.startsWith('@') === false
  ) {
    throw new Error("Username must be a full id, e.g. '@aibot:localhost'");
  }
  let historicalMessages: OpenAIPromptMessage[] = [];
  // The follow-up each correctness check produced, by correctness group
  // (correctnessGroupKey), so the trailing note is decided from the same
  // results the history carries.
  let correctnessFollowUpsByMessage = new Map<string, CorrectnessFollowUp[]>();
  // The instructions a group's checks called for so far. A group's events
  // each carry their own results, and the group's one instruction follows
  // the results of its last event.
  let groupFollowUps = new Map<
    string,
    { messages: OpenAIPromptMessage[]; followUps: CorrectnessFollowUp[] }
  >();
  // History through the compaction's cut point is replaced by its summary,
  // which leads the history. Single messages are never shortened or edited.
  let visibleHistory = historyAfterCompaction(history, compaction);
  for (let event of visibleHistory) {
    // Tool results have their own event types, so this also skips them;
    // they ride in with the tool calls they answer.
    if (event.type !== 'm.room.message') {
      continue;
    }
    if (
      'isStreamingFinished' in event.content &&
      event.content.isStreamingFinished === false
    ) {
      continue;
    }
    let body = event.content.body;

    if (event.sender === aiBotUserId) {
      // Past assistant messages ride in history verbatim, code blocks
      // included. Rewriting or eliding already-sent messages breaks the
      // prompt-cache prefix, and models imitate an elision placeholder in
      // place of real code.
      let content = body;
      let toolResults = getToolResults(event as CardMessageEvent, history);
      let toolCalls = toToolCalls(event as CardMessageEvent, toolResults);
      if (content || toolCalls.length) {
        let historicalMessage: OpenAIPromptMessage = {
          role: 'assistant',
          content,
        };
        if (toolCalls.length) {
          historicalMessage.tool_calls = toolCalls;
        }
        historicalMessages.push(historicalMessage);
      }
      let { toolMessages, followUpMessages, correctnessFollowUps } =
        await toResultMessages(
          event as CardMessageEvent,
          toolResults,
          client,
          history,
        );
      historicalMessages.push(...toolMessages);
      let groupKey = correctnessGroupKey(event);
      if (followUpMessages.length || correctnessFollowUps.length) {
        let collected = groupFollowUps.get(groupKey) ?? {
          messages: [],
          followUps: [],
        };
        collected.messages.push(...followUpMessages);
        collected.followUps.push(...correctnessFollowUps);
        groupFollowUps.set(groupKey, collected);
      }
      let group = correctnessGroupOf(event, visibleHistory);
      let collected = groupFollowUps.get(groupKey);
      if (collected && group[group.length - 1] === event) {
        historicalMessages.push(
          ...correctnessFollowUpMessages(
            collected.messages,
            collected.followUps,
          ),
        );
        if (collected.followUps.length) {
          correctnessFollowUpsByMessage.set(groupKey, collected.followUps);
        }
        groupFollowUps.delete(groupKey);
      }
    }
    if (
      event.sender !== aiBotUserId &&
      !(event.type === 'm.room.message' && isRecognisedDebugCommand(body))
    ) {
      let attachmentText = await buildAttachmentsMessagePart(
        client,
        event as CardMessageEvent,
      );
      let content = [body, attachmentText].filter(Boolean).join('\n\n');
      if (content) {
        historicalMessages.push({
          role: 'user',
          content,
        });
      }
    }
  }
  let systemMessageParts = [SYSTEM_MESSAGE];

  systemMessageParts.push(
    'Never call the checkCorrectness tool on your own; follow-up correctness checks are handled automatically by the system.',
  );
  if (skillCards.length) {
    systemMessageParts.push(SKILL_INSTRUCTIONS_MESSAGE);
    systemMessageParts = systemMessageParts.concat(
      skillCardsToMessages(skillCards, enabledSkillFeatures),
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
  if (compaction) {
    // A user message, not part of the system message: the summary is a
    // record of the conversation, not instructions.
    messages.push({
      role: 'user',
      content: compactionSummaryMessage(compaction.summary),
    });
    let skillFilesMessage = await carriedSkillFiles(
      history,
      aiBotUserId,
      compaction,
      disabledSkillIds,
      client,
    );
    if (skillFilesMessage) {
      messages.push({ role: 'user', content: skillFilesMessage });
    }
  }
  messages = messages.concat(historicalMessages);
  let contextContent = await buildContextMessage(
    history,
    aiBotUserId,
    disabledSkillIds,
  );
  // The context carries the current time, so its bytes change on every
  // request. Prompt caching is an exact prefix match, so it trails the
  // conversation as its own message, after the cache marker — never folded
  // into a history message, whose bytes must stay stable across requests.
  // Its role must be `user`: OpenRouter hoists non-leading `system`
  // messages into the top-level system parameter, which would put this
  // volatile content in front of the whole conversation and defeat the
  // cache.
  normalizeHistoryContentShape(messages);
  addHistoryCacheBreakpoint(messages, messages.length - 1);
  // The correctness-summary instruction applies to this request only, so it
  // rides the volatile trailing message; a history entry that vanishes on
  // the next request would both churn the history and waste the marker.
  let currentUserMessageEvent = findLast(history, (event) =>
    isHumanMessage(event, aiBotUserId),
  ) as MatrixEventWithBoxelContext | undefined;
  let { mediaParts, unsupportedNote } = await buildCurrentTurnMediaParts(
    client,
    currentUserMessageEvent,
    inputModalities,
    currentTurnToolResultMedia(history, aiBotUserId, inputModalities),
  );
  let trailingContent = [
    TRAILING_CONTEXT_PREAMBLE,
    contextContent,
    unsupportedNote,
    shouldPromptCheckCorrectnessSummary(
      history,
      aiBotUserId,
      correctnessFollowUpsByMessage,
    )
      ? CHECK_CORRECTNESS_SUMMARY_INSTRUCTION
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  // The current message's media parts ride here too — see
  // buildCurrentTurnMediaParts for why they never ride in history.
  messages.push(
    mediaParts.length
      ? {
          role: 'user',
          content: [{ type: 'text', text: trailingContent }, ...mediaParts],
        }
      : { role: 'user', content: trailingContent },
  );

  return messages;
}

// Serializes every history message in the parts-array form, every turn.
// The cache marker needs the parts form and moves forward each turn; if
// only the marked message were converted, messages would flip between the
// string and parts shapes as the marker passes through — different bytes on
// the wire, so each flip is a cache miss at that position. Empty contents
// stay untouched: an empty text part would be rejected.
function normalizeHistoryContentShape(messages: OpenAIPromptMessage[]) {
  for (let i = 1; i < messages.length; i++) {
    let message = messages[i];
    if (typeof message.content === 'string' && message.content) {
      message.content = [{ type: 'text', text: message.content }];
    }
  }
}

// Marks the end of the stable history as cacheable — the second of the
// prompt's two breakpoints (the first sits on the system message). This is
// what keeps pulled skill files (readRealmFile results) from being
// re-billed at full price on every later request. Walks backward past
// unmarkable messages (empty content); never marks messages[0], the system
// message.
function addHistoryCacheBreakpoint(
  messages: OpenAIPromptMessage[],
  index: number,
) {
  for (let i = Math.min(index, messages.length - 1); i >= 1; i--) {
    // Contents were normalized to the parts form before this runs; anything
    // still a string is empty and cannot carry a marker.
    let { content } = messages[i];
    if (Array.isArray(content) && content.length > 0) {
      content[content.length - 1] = {
        ...content[content.length - 1],
        cache_control: { type: 'ephemeral' },
      };
      return;
    }
  }
}

function collectPendingCodePatchCorrectnessCheck(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  // The answers the user stopped (see readStopState); their edits are never
  // checked. Edits that landed before the stop are ones the user walked
  // away from, and checking them later would only delay the answer to
  // whatever they write next.
  stoppedMessageIds: ReadonlySet<string> = new Set(),
): PendingCodePatchCorrectnessCheck | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    let event = history[index];
    if (
      event.type !== 'm.room.message' ||
      event.sender !== aiBotUserId ||
      event.content.msgtype !== APP_BOXEL_MESSAGE_MSGTYPE ||
      stoppedMessageIds.has(event.event_id)
    ) {
      continue;
    }
    let edits = resolveCodeEdits(event as CardMessageEvent, history);
    // Only messages with source or card edits count, and a cancelled one
    // counts only if some of its edits landed.
    if (!edits || edits.cancelledWithoutChanges) {
      continue;
    }
    // Wait for the most recent message with edits to finish before checking
    // it, and do not walk back to older messages meanwhile.
    if (!edits.allResolved) {
      return undefined;
    }
    let correctnessCheck = buildCodePatchCorrectnessMessage(
      event as CardMessageEvent,
      edits,
      history,
      aiBotUserId,
    );
    if (correctnessCheck) {
      return correctnessCheck;
    }
  }
  return undefined;
}

interface ResolvedCodeEdits {
  content: CardMessageContent;
  relevantTools: ReturnType<typeof decodeToolRequest>[];
  toolResults: ReturnType<typeof getToolResults>;
  cancelledWithoutChanges: boolean;
  allResolved: boolean;
}

// The source and card edits a bot message requested, with their results.
// Undefined when the message requested none.
function resolveCodeEdits(
  messageEvent: CardMessageEvent,
  history: DiscreteMatrixEvent[],
): ResolvedCodeEdits | undefined {
  let content = messageEvent.content as CardMessageContent;
  let relevantTools = (
    getToolRequests<Partial<EncodedToolRequest>>(content) ?? []
  )
    .map((request) => decodeToolRequest(request))
    .filter((request) => isCodeEditingTool(request.name));
  if (relevantTools.length === 0) {
    return undefined;
  }
  let toolResults = getToolResults(messageEvent, history);
  let isCancelled =
    content.isCanceled || (messageEvent as any).status === 'cancelled';
  return {
    content,
    relevantTools,
    toolResults,
    cancelledWithoutChanges:
      isCancelled && !hasAppliedChanges(relevantTools, toolResults),
    allResolved: relevantTools.every((request) =>
      toolResults.some(
        (result) => result.content.commandRequestId === request.id,
      ),
    ),
  };
}

// The checks still to send for a reply's edits. A reply's checks go out as a
// correctness group, in one event or, when they don't fit, several. A group
// that is still the latest thing in the room may be missing targets: the
// sending stopped partway, or the user retried a failed edit and it landed.
// So the targets the group already asked for are left out, and so are the
// targets past the attempt limit. Once anything else is said in the room the
// group is complete, and nothing more is sent for it. Undefined when nothing
// is left.
function buildCodePatchCorrectnessMessage(
  messageEvent: CardMessageEvent,
  { content, relevantTools, toolResults }: ResolvedCodeEdits,
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): PendingCodePatchCorrectnessCheck | undefined {
  let group = history.filter((event) =>
    isCodePatchCorrectnessEventForMessage(event, messageEvent.event_id!),
  );
  let requested = new Set<string>();
  if (group.length) {
    let lastNonResultEvent = findLast(history, (event) => !isToolResult(event));
    if (!lastNonResultEvent || !group.includes(lastNonResultEvent)) {
      return undefined;
    }
    for (let event of group) {
      for (let request of getCheckCorrectnessToolRequests(event)) {
        for (let target of checkedTargetsOf(request, event)) {
          requested.add(`${target.type}:${target.ref}`);
        }
      }
    }
  }
  let notRequested = (type: string, ref: string) =>
    !requested.has(`${type}:${ref}`);

  let files = gatherPatchedFiles(relevantTools, toolResults).filter((file) =>
    notRequested('file', file.sourceUrl || file.displayName),
  );
  let cards = gatherPatchedCards(relevantTools, toolResults).filter((card) =>
    notRequested('card', card.cardId),
  );

  let attemptsByTargetKey = buildCorrectnessCheckAttemptMap(
    history,
    files,
    cards,
    aiBotUserId,
    messageEvent.event_id,
  );
  let withinLimit = (type: string, ref: string) =>
    (attemptsByTargetKey[
      formatCorrectnessTargetKeyWithEvent(type, ref, messageEvent.event_id)!
    ] ?? 1) <= MAX_CORRECTNESS_FIX_ATTEMPTS;
  files = files.filter((file) =>
    withinLimit('file', file.sourceUrl || file.displayName),
  );
  cards = cards.filter((card) => withinLimit('card', card.cardId));

  if (files.length === 0 && cards.length === 0) {
    return undefined;
  }

  return {
    targetEventId: messageEvent.event_id!,
    roomId: messageEvent.room_id!,
    context: content.data?.context as BoxelContext | undefined,
    files,
    cards,
    attemptsByTargetKey,
  };
}

function isCodeEditingTool(name?: string) {
  if (!name) {
    return false;
  }
  return (
    CARD_PATCH_COMMAND_NAMES.has(name) ||
    name.startsWith(SOURCE_CODE_TOOL_NAME_PREFIX)
  );
}

function gatherPatchedFiles(
  relevantTools: Partial<ToolRequest>[],
  toolResults: ToolResultEvent[],
): CodePatchCorrectnessFile[] {
  let filesByKey = new Map<string, CodePatchCorrectnessFile>();
  for (let request of relevantTools) {
    if (!request.name?.startsWith(SOURCE_CODE_TOOL_NAME_PREFIX)) {
      continue;
    }
    let result = findLast(
      toolResults,
      (toolResult) => toolResult.content.commandRequestId === request.id,
    );
    if (result?.content['m.relates_to']?.key !== 'applied') {
      continue;
    }
    for (let file of result.content.data?.attachedFiles ?? []) {
      let sourceUrl = file.sourceUrl ?? file.url ?? file.name ?? '';
      if (
        !sourceUrl ||
        filesByKey.has(sourceUrl) ||
        sourceUrl.startsWith(CAPTURE_SOURCE_URL_PREFIX) ||
        !hasCheckableSource(file.contentType)
      ) {
        continue;
      }
      filesByKey.set(sourceUrl, {
        sourceUrl,
        displayName: formatFileDisplayName(sourceUrl),
      });
    }
  }
  return Array.from(filesByKey.values());
}

// Correctness validation reads a file's source. A binary file a script saved,
// such as an image, has none to check.
function hasCheckableSource(contentType?: string): boolean {
  if (!contentType) {
    return true;
  }
  return (
    requiredModality(contentType) === undefined &&
    !/^(image|audio|video|font)\//.test(contentType) &&
    contentType !== 'application/octet-stream'
  );
}

function gatherPatchedCards(
  toolRequests: Partial<ToolRequest>[],
  toolResults: ToolResultEvent[],
): CodePatchCorrectnessCard[] {
  let cards: CodePatchCorrectnessCard[] = [];
  let seen = new Set<string>();
  for (let request of toolRequests) {
    // Latest result wins: a retry that succeeds supersedes an earlier
    // 'failed' event for the same request.
    let result = findLast(
      toolResults,
      (toolResult) => toolResult.content.commandRequestId === request.id,
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
  aiBotUserId: string,
  targetEventId?: string,
): Record<string, number> {
  let attempts: Record<string, number> = {};
  let records = collectCorrectnessCheckRecords(history);
  let lastUserMessageIndex = findLastIndex(history, (event) =>
    isUserChatMessage(event, aiBotUserId),
  );
  let targets = [
    ...files.map((file) => ({
      type: 'file',
      ref: file.sourceUrl || file.displayName,
    })),
    ...cards.map((card) => ({ type: 'card', ref: card.cardId })),
  ];
  for (let { type, ref } of targets) {
    let targetKey = formatCorrectnessTargetKeyWithEvent(
      type,
      ref,
      targetEventId,
    );
    if (!targetKey) {
      continue;
    }
    attempts[targetKey] = getNextCorrectnessCheckAttempt(
      records,
      { type, ref },
      targetEventId,
      lastUserMessageIndex,
    );
  }
  return attempts;
}

function isUserChatMessage(event: DiscreteMatrixEvent, aiBotUserId: string) {
  return (
    event.type === 'm.room.message' &&
    event.sender !== aiBotUserId &&
    event.content?.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
  );
}

function extractCardIdFromCommandRequest(
  request: Partial<ToolRequest>,
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
  return correctnessReplyEventId(event) === targetEventId;
}

// The reply whose edits a correctness event checks; undefined for any other
// event.
function correctnessReplyEventId(
  event: DiscreteMatrixEvent | undefined,
): string | undefined {
  if (
    event?.type !== 'm.room.message' ||
    event.content?.msgtype !== APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE
  ) {
    return undefined;
  }
  let relatesTo = event.content?.['m.relates_to'];
  if (relatesTo?.rel_type !== APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE) {
    return undefined;
  }
  return relatesTo.event_id;
}

// A correctness group: the events that check one reply's edits, in history
// order. They are one event unless the checks did not fit in one. Any other
// event is a group of its own.
function correctnessGroupOf(
  event: DiscreteMatrixEvent,
  history: DiscreteMatrixEvent[],
): DiscreteMatrixEvent[] {
  let replyEventId = correctnessReplyEventId(event);
  if (!replyEventId) {
    return [event];
  }
  return history.filter((candidate) =>
    isCodePatchCorrectnessEventForMessage(candidate, replyEventId),
  );
}

// Correctness follow-ups are collected per group: by the reply a group
// checks, or by the event itself for any other event.
function correctnessGroupKey(event: DiscreteMatrixEvent): string {
  return correctnessReplyEventId(event) ?? event.event_id;
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
  relevantTools: Partial<ToolRequest>[],
  toolResults: ToolResultEvent[],
): boolean {
  return relevantTools.some((request) =>
    toolResults.some(
      (result) =>
        result.content.commandRequestId === request.id &&
        result.content['m.relates_to']?.key === 'applied',
    ),
  );
}

// Renders a message's attachments from that message's own snapshot alone,
// as text: text-based content in full, media as metadata lines. Nothing
// here may depend on later history, the active model, or whether the
// message is the current one: the rendering becomes part of the cached
// prompt prefix, and any retroactive change re-bills everything after it
// (see getAttachedCards). Media bodies are handled separately, by
// buildCurrentTurnMediaParts.
export const buildAttachmentsMessagePart = async (
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext,
): Promise<string> => {
  let attachedCards = await getAttachedCards(client, matrixEvent);
  let text = '';
  if (attachedCards.length > 0) {
    text += `Attached Cards (each shows its content as of this message; a later attachment of the same card supersedes it):\n${JSON.stringify(attachedCards, null, 2)}\n`;
  }
  let attachedFiles = await getAttachedFiles(client, matrixEvent);
  if (attachedFiles.length > 0) {
    text += `Attached Files (each shows its content as of this message; a later attachment of the same file supersedes it):\n${attachedFilesToMessage(
      attachedFiles,
    )}\n`;
  }
  return text;
};

// A message a human sent — the event that starts a turn. Tool results are
// not messages (they have their own event types), so a human's client that
// publishes one does not start a turn: it continues the turn the bot's tool
// calls belong to.
function isHumanMessage(
  event: DiscreteMatrixEvent,
  aiBotUserId: string,
): boolean {
  return event.sender !== aiBotUserId && event.type === 'm.room.message';
}

// Limits on the tool-result media one turn embeds. Every request of the turn
// re-downloads and re-encodes each embedded file, so both the count and the
// bytes must stay bounded however many results a tool loop produces:
// - at most MAX_CURRENT_TURN_TOOL_RESULT_MEDIA files, the newest kept;
// - no single file over MAX_TOOL_RESULT_MEDIA_FILE_BYTES. Anthropic, the
//   strictest provider the bot routes to, rejects an image whose base64
//   encoding exceeds 5 MiB, failing the whole request; base64 grows bytes by
//   a third, so the raw limit is three quarters of that;
// - at most MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES across the turn, which
//   base64 grows to about 21 MiB, leaving the rest of a 32 MB provider
//   request limit for the conversation itself.
export const MAX_CURRENT_TURN_TOOL_RESULT_MEDIA = 8;
export const MAX_TOOL_RESULT_MEDIA_FILE_BYTES = Math.floor(
  (5 * 1024 * 1024 * 3) / 4,
);
export const MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES = 16 * 1024 * 1024;

export interface CurrentTurnToolResultMedia {
  // The files to embed, oldest first.
  included: SerializedFileDef[];
  // Media files the limits left out, each with the reason, so the model can
  // be told it cannot see them.
  omitted: { file: SerializedFileDef; reason: string }[];
}

// The media files (images, PDFs, audio, video) attached to the tool results
// of the current turn — every tool-result event after the last message a
// human sent, whoever published it: results the bot fulfilled itself and
// results a client ran and sent alike. A multi-step tool loop therefore keeps
// the media it collected earlier in the same turn. Only the latest result for
// each tool call counts (a retry supersedes an earlier attempt, matching how
// the call's outcome is chosen for the tool message), and a retried call
// takes the position of its latest result. Files the active model cannot
// take (per `inputModalities`, when given) are left out before the limits
// apply, so they never use up a slot or budget a sendable file could have.
// The rest are chosen newest first within the limits above; a file with no recorded size is left out, since
// its bytes cannot be counted against the budget. Text-based attachments are
// excluded: their content rides in the tool message itself.
export function currentTurnToolResultMedia(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  inputModalities?: string[],
): CurrentTurnToolResultMedia {
  let lastHumanMessageIndex = findLastIndex(history, (event) =>
    isHumanMessage(event, aiBotUserId),
  );
  let latestResultByRequestId = new Map<string, DiscreteMatrixEvent>();
  for (let event of history.slice(lastHumanMessageIndex + 1)) {
    if (!isToolResultEventType(event.type)) {
      continue;
    }
    let requestId =
      (event.content as { commandRequestId?: string }).commandRequestId ??
      event.event_id;
    // Re-inserting moves a retried call to its latest position.
    latestResultByRequestId.delete(requestId);
    latestResultByRequestId.set(requestId, event);
  }
  let candidates: SerializedFileDef[] = [];
  for (let event of latestResultByRequestId.values()) {
    let attachedFiles: SerializedFileDef[] =
      (event as MatrixEventWithBoxelContext).content?.data?.attachedFiles ?? [];
    for (let file of attachedFiles) {
      if (file.url && requiredModality(file.contentType)) {
        candidates.push(toFileDefMetadata(file));
      }
    }
  }
  let included: SerializedFileDef[] = [];
  let omitted: CurrentTurnToolResultMedia['omitted'] = [];
  let totalBytes = 0;
  for (let file of [...candidates].reverse()) {
    let size = file.contentSize;
    let modality = requiredModality(file.contentType);
    let reason: string | undefined;
    if (inputModalities && modality && !inputModalities.includes(modality)) {
      reason = `the active model does not accept ${modalityLabel(modality)}`;
    } else if (typeof size !== 'number') {
      reason = 'its size is unknown';
    } else if (size > MAX_TOOL_RESULT_MEDIA_FILE_BYTES) {
      reason = `it is larger than ${formatMiB(MAX_TOOL_RESULT_MEDIA_FILE_BYTES)}`;
    } else if (included.length >= MAX_CURRENT_TURN_TOOL_RESULT_MEDIA) {
      reason = `only the newest ${MAX_CURRENT_TURN_TOOL_RESULT_MEDIA} tool-result media files are sent`;
    } else if (totalBytes + size > MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES) {
      reason = `newer tool-result media already fill the ${formatMiB(MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES)} sent per turn`;
    }
    if (reason) {
      omitted.unshift({ file, reason });
    } else {
      included.unshift(file);
      totalBytes += size!;
    }
  }
  return { included, omitted };
}

function formatMiB(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MiB`;
}

// The homeserver media URL a tool-result attachment is downloaded from. The
// download carries the bot's Matrix access token, and a tool result's file
// URL can come from a tool's own output, so the URL is never fetched as
// given: it must name a Matrix media item, and the item is fetched from the
// homeserver's own media endpoint. Undefined when the URL names no media
// item.
function toolResultMediaDownloadUrl(
  client: MatrixClient,
  url: string,
): string | undefined {
  let key = canonicalizeMatrixMediaKey(url);
  if (!key?.startsWith('mxc://')) {
    return undefined;
  }
  return (
    client.mxcUrlToHttp(
      key,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    ) ?? undefined
  );
}

// Downloads the current turn's media attachments (images, PDFs, audio,
// video) and renders them as native content parts for the volatile trailing
// message: the media attached to the current human message, then the media
// attached to the current turn's tool results (see
// currentTurnToolResultMedia), each of the latter preceded by a text part
// naming the file so the model can tell which result an image came from.
// Tool-result media the limits left out are named in the returned note, as
// are files the model's input modalities exclude.
// Media bodies never ride in history: embedding them there would grow the
// request by every media file ever attached — re-downloaded and re-encoded
// on each turn, with nothing bounding it — while gating on "is this the
// newest message" would rewrite an older message's bytes as history grows
// and reset the cache prefix. The trailing message is rebuilt every turn
// anyway (it carries the current time), so the current media can ride there
// without touching a single history byte; history lists the same files as
// stable metadata (see buildAttachmentsMessagePart).
export const buildCurrentTurnMediaParts = async (
  client: MatrixClient,
  matrixEvent: MatrixEventWithBoxelContext | undefined,
  inputModalities?: string[],
  toolResultMedia: CurrentTurnToolResultMedia = { included: [], omitted: [] },
): Promise<{ mediaParts: ContentPart[]; unsupportedNote?: string }> => {
  let mediaParts: ContentPart[] = [];
  let messageFiles = matrixEvent
    ? await getAttachedFiles(client, matrixEvent)
    : [];
  let unsupportedFiles: { name: string; contentType: string }[] = [];
  let files = [
    ...messageFiles.map((file) => ({ file, fromToolResult: false })),
    // Newest first, so the per-turn byte budget keeps the newest media;
    // their parts are put back in chronological order below.
    ...[...toolResultMedia.included].reverse().map((file) => ({
      file,
      fromToolResult: true,
    })),
  ];
  let toolResultPartGroups: ContentPart[][] = [];
  let omittedAtDownload: CurrentTurnToolResultMedia['omitted'] = [];
  // The bytes tool-result media actually downloaded this turn; declared
  // sizes chose the files, but the budget holds on what arrives.
  let toolResultBytes = 0;
  for (let { file: f, fromToolResult } of files) {
    if (!f.url) {
      continue;
    }
    let downloadUrl = f.url;
    if (fromToolResult) {
      let mediaUrl = toolResultMediaDownloadUrl(client, f.url);
      if (!mediaUrl) {
        omittedAtDownload.push({
          file: f,
          reason: 'it is not a file stored in this conversation',
        });
        continue;
      }
      downloadUrl = mediaUrl;
    }
    // Check model capability before downloading
    let modality = requiredModality(f.contentType);
    if (!modality) {
      continue; // not a multimodal type — its content rides in history
    }
    if (inputModalities && !inputModalities.includes(modality)) {
      unsupportedFiles.push({
        name: f.name ?? 'unknown',
        contentType: f.contentType ?? 'unknown',
      });
      continue;
    }
    let partCountBefore = mediaParts.length;
    // A tool result's declared size is the tool's word for it, so the bytes
    // actually downloaded are held to the per-file limit too.
    let download = async () => {
      let dataUrl = await downloadFileAsBase64DataUrl(
        client,
        downloadUrl,
        f.contentType!,
      );
      if (fromToolResult) {
        let bytes = base64DataUrlByteLength(dataUrl);
        if (bytes > MAX_TOOL_RESULT_MEDIA_FILE_BYTES) {
          throw new OversizedToolResultMediaError(
            `it is larger than ${formatMiB(MAX_TOOL_RESULT_MEDIA_FILE_BYTES)}`,
          );
        }
        if (
          toolResultBytes + bytes >
          MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES
        ) {
          throw new OversizedToolResultMediaError(
            `newer tool-result media already fill the ${formatMiB(MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES)} sent per turn`,
          );
        }
        toolResultBytes += bytes;
      }
      return dataUrl;
    };
    try {
      if (isImageContentType(f.contentType)) {
        let dataUrl = await download();
        mediaParts.push({
          type: 'image_url',
          image_url: { url: dataUrl },
        });
      } else if (isPdfContentType(f.contentType)) {
        let dataUrl = await download();
        mediaParts.push({
          type: 'file',
          file: {
            filename: f.name ?? 'document.pdf',
            file_data: dataUrl,
          },
        });
      } else if (isAudioContentType(f.contentType)) {
        let format = audioFormatFromMime(f.contentType!);
        if (!format) {
          getLog().error(`Unsupported audio format: ${f.contentType}`);
          continue;
        }
        let dataUrl = await download();
        // Strip data URL prefix — OpenRouter expects raw base64 for audio
        let base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
        mediaParts.push({
          type: 'input_audio',
          input_audio: { data: base64, format },
        });
      } else if (isVideoContentType(f.contentType)) {
        let dataUrl = await download();
        mediaParts.push({
          type: 'video_url',
          video_url: { url: dataUrl },
        });
      }
    } catch (e) {
      if (e instanceof OversizedToolResultMediaError) {
        omittedAtDownload.push({ file: f, reason: e.message });
        continue;
      }
      // A failed download only affects this turn's volatile message; the
      // file's metadata is still in history, so nothing byte-stable drifts.
      getLog().error(`Failed to download media file ${f.url}:`, e);
    }
    if (fromToolResult && mediaParts.length > partCountBefore) {
      mediaParts.splice(partCountBefore, 0, {
        type: 'text',
        text: `Attached to a tool result: ${mediaFileLabel(f)}`,
      });
    }
    if (fromToolResult) {
      toolResultPartGroups.unshift(mediaParts.splice(partCountBefore));
    }
  }
  mediaParts.push(...toolResultPartGroups.flat());
  omittedAtDownload.reverse();
  let notes: string[] = [];
  if (unsupportedFiles.length > 0) {
    let fileList = unsupportedFiles
      .map((f) => `${f.name} (${f.contentType})`)
      .join(', ');
    notes.push(
      `Note: The following files were not sent to the model because it does not support their input type, so you cannot see them: ${fileList}. Do not guess at their contents; tell the user you cannot view them with the current model.`,
    );
  }
  let omitted = [...toolResultMedia.omitted, ...omittedAtDownload];
  if (omitted.length > 0) {
    let fileList = omitted
      .map(({ file, reason }) => `${mediaFileLabel(file)}: ${reason}`)
      .join('; ');
    notes.push(
      `Note: The following files attached to tool results were not sent to the model, so you cannot see them: ${fileList}. Do not guess at their contents; tell the user you cannot view them.`,
    );
  }
  let unsupportedNote = notes.length ? notes.join('\n\n') : undefined;
  return { mediaParts, unsupportedNote };
};

class OversizedToolResultMediaError extends Error {}

// The number of bytes a base64 data URL encodes.
function base64DataUrlByteLength(dataUrl: string): number {
  let base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  let padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function mediaFileLabel(file: SerializedFileDef): string {
  let name = file.name ?? 'unnamed file';
  return file.sourceUrl ? `${name} (${file.sourceUrl})` : name;
}

export const buildContextMessage = async (
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
  disabledSkillIds: string[],
): Promise<string> => {
  let result = '';

  let lastEventWithContext = findLast(history, (ev) => {
    if (ev.sender === aiBotUserId) {
      return false;
    }
    return (
      (ev.type === 'm.room.message' &&
        ev.content.msgtype == APP_BOXEL_MESSAGE_MSGTYPE) ||
      isToolResultEventType(ev.type)
    );
  }) as CardMessageEvent | ToolResultEvent | undefined;
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
      if (context?.realmPermissions?.canWrite === false) {
        result += `This workspace is read-only for the user: edits to its cards and files will be rejected.\n`;
      }
    }
    if (context?.workspaces) {
      result += `Available workspaces:\n`;
      context.workspaces.forEach((workspace) => {
        result += ` - ${workspace.name} (${workspace.url})${workspace.type === 'catalog-workspace' ? ' - Catalog' : ''}\n`;
      });
      result += `\n`;
    }
    let realmPrefixes = Object.entries(context?.realmPrefixes ?? {});
    if (realmPrefixes.length > 0) {
      result += `Realm prefixes (an identifier that starts with one names a file in that realm; replace the prefix with the realm's URL to get the file's URL):\n`;
      for (let [prefix, url] of realmPrefixes) {
        result += ` - ${prefix} = ${url}\n`;
      }
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

// Skill bodies (a SKILL.md, the skills index) are authored with links relative
// to the file's own location, so the same source resolves on the coding
// harness's filesystem. The ai-bot has no filesystem: it reads referenced
// files over HTTP via `readRealmFile`, which needs a full URL — a relative
// path gives the model nothing reliable to resolve it against. Resolving
// every relative markdown link against the skill's own URL up front hands the
// model a copy-ready absolute URL, so one relative-authored document works
// for both agents.
export function absolutizeSkillLinks(
  markdown: string,
  baseUrl: string | undefined,
): string {
  if (!baseUrl) {
    return markdown;
  }
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    // A non-absolute id (e.g. an unresolved `@cardstack/skills/…` ref) can't
    // anchor resolution; leave the body untouched.
    return markdown;
  }
  return markdown.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (whole, text, destination) => {
      let trimmed = destination.trim();
      let spaceIndex = trimmed.search(/\s/);
      let target = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
      let title = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex);
      let bare = target.replace(/^<|>$/g, '');
      if (!isRelativeLink(bare)) {
        return whole;
      }
      let resolved: string;
      try {
        resolved = new URL(bare, base).href;
      } catch {
        return whole;
      }
      return `[${text}](${resolved}${title})`;
    },
  );
}

// A markdown link destination we resolve — document-relative paths only.
// Absolute URLs, protocol- and root-relative refs, bare fragments, and
// non-navigational schemes (mailto:, etc.) are left as authored.
function isRelativeLink(target: string): boolean {
  if (!target) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return false; // has a scheme
  }
  return !(
    target.startsWith('//') ||
    target.startsWith('/') ||
    target.startsWith('#')
  );
}

// A skill body can mark a section as belonging to a feature that is off by
// default:
//
//   <!-- feature:catalog-reuse -->
//   ...text the model only sees when the feature is enabled...
//   <!-- /feature:catalog-reuse -->
//
// The markers are HTML comments, so the same file renders unchanged anywhere
// else (the coding harness reads it from disk and sees every section). Here, a
// section whose feature is not in `enabledFeatures` is removed together with
// its markers; an enabled section keeps its text and loses only the markers.
const FEATURE_SECTION_RE =
  /[ \t]*<!--\s*feature:([\w-]+)\s*-->[ \t]*\n?([\s\S]*?)[ \t]*<!--\s*\/feature:\1\s*-->[ \t]*\n?/g;

export function applySkillFeatureFlags(
  markdown: string,
  enabledFeatures: string[],
): string {
  return markdown.replace(FEATURE_SECTION_RE, (_whole, feature, body) =>
    enabledFeatures.includes(feature) ? body : '',
  );
}

export const skillCardsToMessages = (
  cards: EnabledSkill[],
  enabledFeatures: string[] = [],
) => {
  return cards.map((card) => {
    let headerParts = [`id: ${card.id}`];
    if (card.attributes?.title) {
      headerParts.push(`title: ${card.attributes.title}`);
    }

    let header = `Skill (${headerParts.join(', ')}):`;
    let instructions =
      card.attributes?.instructions?.trim() ?? 'No instructions provided.';
    instructions = applySkillFeatureFlags(instructions, enabledFeatures).trim();

    return `${header}\n${absolutizeSkillLinks(instructions, card.id)}`;
  });
};

export function cleanContent(content: string) {
  content = content.trim();
  if (content.endsWith('json')) {
    content = content.slice(0, -4);
  }
  return content.trim();
}

export const isToolResultStatusApplied = (event?: MatrixEvent) => {
  if (event === undefined) {
    return false;
  }
  return (
    isToolResultEvent(event.event as DiscreteMatrixEvent) &&
    event.getContent()['m.relates_to']?.key === 'applied'
  );
};

function getActiveLLMDetails(eventlist: DiscreteMatrixEvent[]): {
  model: string;
  toolsSupported?: boolean;
  reasoningEffort?: ReasoningEffort;
  inputModalities?: string[];
} {
  let activeLLMEvent = findLast(
    eventlist,
    (event) => event.type === APP_BOXEL_ACTIVE_LLM,
  ) as ActiveLLMEvent | undefined;

  // Older rooms have APP_BOXEL_ACTIVE_LLM events without `toolsSupported`
  // / `inputModalities`. Fill them from DEFAULT_FALLBACK_MODELS keyed by
  // model id when missing (strict `undefined` check, so an explicit
  // `false` is respected). Non-curated models are not in the constant
  // and stay undefined. `reasoningEffort` is a user choice, never
  // auto-filled.
  let model = activeLLMEvent?.content.model ?? DEFAULT_FALLBACK_MODEL_ID;
  let eventToolsSupported = activeLLMEvent?.content.toolsSupported;
  let eventInputModalities = activeLLMEvent?.content.inputModalities;
  let fallback = DEFAULT_FALLBACK_MODELS.find((m) => m.modelId === model);

  return {
    model,
    toolsSupported:
      eventToolsSupported === undefined
        ? fallback?.toolsSupported
        : eventToolsSupported,
    reasoningEffort: normalizeReasoningEffort(
      activeLLMEvent?.content.reasoningEffort,
    ),
    inputModalities:
      eventInputModalities === undefined
        ? fallback?.inputModalities
        : eventInputModalities,
  };
}

const VALID_REASONING_EFFORTS: (ReasoningEffort | 'xhigh')[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
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

export function isToolResultEvent(
  event?: DiscreteMatrixEvent,
): event is ToolResultEvent {
  return event !== undefined && isToolResult(event);
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
