import type { MatrixEvent } from './matrix-api.ts';

// What a run looks like from the room's Matrix events, independent of the
// browser: one row of the results table.
export interface RoomAnalysis {
  turns: number;
  outputTokens: number;
  inputTokens: number;
  cachedTokens: number;
  costUsd: number;
  // Turns after the first whose prompt was mostly not served from the cache.
  // The conversation only grows, so from turn two on nearly all of the prompt
  // should be a cache read; a miss means history was rewritten, the cache
  // expired between turns, or the provider changed.
  cacheMisses: number;
  toolCalls: Record<string, number>;
  failedToolCalls: { name: string; reason: string }[];
  // Requests the host never answered: the signature of a stuck host.
  unansweredToolCalls: number;
  patchBlocks: number;
  gitStyleBlocks: number;
  patchResults: { applied: number; failed: number };
  filesWritten: string[];
  showCardIds: string[];
  lastBotBody: string;
}

const BOT_MESSAGE_MSGTYPE = 'app.boxel.message';
const TOOL_REQUESTS_KEY = 'app.boxel.toolRequests';
const BOX_SEARCH_MARKER = '╔═══ SEARCH';
const FENCE_HEADER =
  /```[a-z]*\n(https?:\/\/[^\s]+|@[a-z0-9-]+\/[^\s]+)(?: \(new\))?\n╔═══ SEARCH/g;

function parseData(content: Record<string, any>): Record<string, any> {
  let data = content.data;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data ?? {};
}

function parseArguments(raw: unknown): Record<string, any> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return (raw as Record<string, any>) ?? {};
}

export function analyzeRoom(
  events: MatrixEvent[],
  botUserId: string,
): RoomAnalysis {
  let sorted = [...events].sort(
    (a, b) => a.origin_server_ts - b.origin_server_ts,
  );
  let result: RoomAnalysis = {
    turns: 0,
    outputTokens: 0,
    inputTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    cacheMisses: 0,
    toolCalls: {},
    failedToolCalls: [],
    unansweredToolCalls: 0,
    patchBlocks: 0,
    gitStyleBlocks: 0,
    patchResults: { applied: 0, failed: 0 },
    filesWritten: [],
    showCardIds: [],
    lastBotBody: '',
  };

  // Tool results are keyed by the request id they answer.
  let toolResults = new Map<string, { key: string; reason: string }>();
  for (let event of sorted) {
    if (event.type.startsWith('app.boxel.toolResult')) {
      let id = event.content.commandRequestId;
      if (id) {
        toolResults.set(id, {
          key: event.content['m.relates_to']?.key ?? 'unknown',
          reason: event.content.failureReason ?? '',
        });
      }
    }
    if (event.type.startsWith('app.boxel.codePatchResult')) {
      let key = event.content['m.relates_to']?.key;
      if (key === 'applied') {
        result.patchResults.applied++;
      } else {
        result.patchResults.failed++;
      }
    }
  }

  for (let event of sorted) {
    if (event.type !== 'm.room.message' || event.sender !== botUserId) {
      continue;
    }
    let content = event.content;
    if (
      content.msgtype !== BOT_MESSAGE_MSGTYPE ||
      content.isStreamingFinished !== true
    ) {
      continue;
    }
    let data = parseData(content);
    let usage = data.usage;
    if (!usage) {
      // Correctness-check messages and other bookkeeping carry no usage;
      // they are not turns.
      continue;
    }
    result.turns++;
    if (
      result.turns > 1 &&
      (usage.cachedTokens ?? 0) < 0.5 * (usage.promptTokens ?? 0)
    ) {
      result.cacheMisses++;
    }
    result.outputTokens += usage.completionTokens ?? 0;
    result.inputTokens += usage.promptTokens ?? 0;
    result.cachedTokens += usage.cachedTokens ?? 0;
    result.costUsd += usage.costUsd ?? 0;

    let body: string = content.body ?? '';
    if (body) {
      result.lastBotBody = body;
    }
    result.patchBlocks += body.split(BOX_SEARCH_MARKER).length - 1;
    result.gitStyleBlocks += body.split('<<<<<<< SEARCH').length - 1;
    for (let match of body.matchAll(FENCE_HEADER)) {
      result.filesWritten.push(match[1]);
    }

    for (let request of content[TOOL_REQUESTS_KEY] ?? []) {
      let name: string = request.name ?? 'unknown';
      result.toolCalls[name] = (result.toolCalls[name] ?? 0) + 1;
      let outcome = toolResults.get(request.id);
      if (!outcome) {
        result.unansweredToolCalls++;
      } else if (outcome.key !== 'applied') {
        result.failedToolCalls.push({ name, reason: outcome.reason });
      }
      if (name.startsWith('show-card')) {
        let args = parseArguments(request.arguments);
        let cardId = args.attributes?.cardId;
        if (typeof cardId === 'string') {
          result.showCardIds.push(cardId);
        }
      }
    }
  }
  result.filesWritten = [...new Set(result.filesWritten)];
  return result;
}
