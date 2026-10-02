import type { MatrixEvent } from './matrix-api.ts';

// What a run looks like from the room's Matrix events, independent of the
// browser: one row of the results table.
export interface RoomAnalysis {
  turns: number;
  outputTokens: number;
  inputTokens: number;
  cachedTokens: number;
  costUsd: number;
  // Cache accounting starts after the initial skill load. Turn one has one
  // tool; the first skill read adds the host tools to the request, and tools
  // lead the cached prefix, so the turn right after that read is always billed
  // cold. That miss is structural and not the model's, so it is left out: the
  // window opens on the turn after it. Within the window the conversation only
  // grows, so a miss means history was rewritten, the cache expired between
  // turns, or the provider changed.
  cacheMisses: number;
  cacheWindowInputTokens: number;
  cacheWindowCachedTokens: number;
  cacheWindowTurns: number;
  toolCalls: Record<string, number>;
  failedToolCalls: { name: string; reason: string }[];
  // Requests the host never answered: the signature of a stuck host.
  unansweredToolCalls: number;
  // realm.fs writes in run-realm-code calls the host applied.
  realmCodeWrites: number;
  filesWritten: string[];
  showCardIds: string[];
  lastBotBody: string;
}

const BOT_MESSAGE_MSGTYPE = 'app.boxel.message';
const TOOL_REQUESTS_KEY = 'app.boxel.toolRequests';
// Every write call counts; the path is recorded only when it is a literal.
const REALM_CODE_WRITE =
  /realm\.fs\.(?:writeText|replace)\(\s*(?:(['"`])([^'"`]+)\1)?/g;

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
    cacheWindowInputTokens: 0,
    cacheWindowCachedTokens: 0,
    cacheWindowTurns: 0,
    toolCalls: {},
    failedToolCalls: [],
    unansweredToolCalls: 0,
    realmCodeWrites: 0,
    filesWritten: [],
    showCardIds: [],
    lastBotBody: '',
  };

  // Tool results are keyed by the request id they answer.
  let firstSkillReadTurn: number | undefined;
  // Turns that read files: a read can add a skill's tools, and tools lead the
  // cached prefix, so the turn after one is billed cold by design.
  let readTurns = new Set<number>();
  // Per-turn usage, in turn order. The cache window's first turn depends on
  // which turn first read a skill, and that is not known until the last turn
  // has been seen, so the window accounting runs after this pass rather than
  // inside it.
  let turnUsage: { promptTokens: number; cachedTokens: number }[] = [];
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
    let toolNames = (content[TOOL_REQUESTS_KEY] ?? []).map(
      (r: { name?: string }) => r.name ?? '',
    );
    if (
      firstSkillReadTurn === undefined &&
      toolNames.includes('readRealmFile')
    ) {
      firstSkillReadTurn = result.turns;
    }
    if (toolNames.includes('readRealmFile')) {
      readTurns.add(result.turns);
    }
    turnUsage.push({
      promptTokens: usage.promptTokens ?? 0,
      cachedTokens: usage.cachedTokens ?? 0,
    });
    result.outputTokens += usage.completionTokens ?? 0;
    result.inputTokens += usage.promptTokens ?? 0;
    result.cachedTokens += usage.cachedTokens ?? 0;
    result.costUsd += usage.costUsd ?? 0;

    let body: string = content.body ?? '';
    if (body) {
      result.lastBotBody = body;
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
      if (name.startsWith('run-realm-code') && outcome?.key === 'applied') {
        // The host nests top-level fields under `attributes` before it runs a
        // call, so a model's flat `code` is a real write too.
        let args = parseArguments(request.arguments);
        let code = args.attributes?.code ?? args.code;
        if (typeof code === 'string') {
          for (let match of code.matchAll(REALM_CODE_WRITE)) {
            result.realmCodeWrites++;
            if (match[2]) {
              result.filesWritten.push(match[2]);
            }
          }
        }
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

  // The window opens two turns after the first skill read (the turn after the
  // read pays the structural miss). With no skill read, from turn two. Turn
  // numbers are one-based, so turn n is `turnUsage[n - 1]`.
  let windowStart =
    firstSkillReadTurn === undefined ? 2 : firstSkillReadTurn + 2;
  for (let [index, usage] of turnUsage.entries()) {
    if (index + 1 < windowStart || readTurns.has(index)) {
      continue;
    }
    result.cacheWindowTurns++;
    result.cacheWindowInputTokens += usage.promptTokens;
    result.cacheWindowCachedTokens += usage.cachedTokens;
    // A turn's prompt is the previous turn's prompt plus what came back since
    // (a tool result, skill files just read). A working cache serves that
    // earlier prompt; the new part is billed fresh by design. So a miss is a
    // turn that reused less than half of the previous prompt — not one whose
    // new part happens to be large.
    let previousPrompt = turnUsage[index - 1]?.promptTokens ?? 0;
    if (usage.cachedTokens < 0.5 * previousPrompt) {
      result.cacheMisses++;
    }
  }

  result.filesWritten = [...new Set(result.filesWritten)];
  return result;
}
