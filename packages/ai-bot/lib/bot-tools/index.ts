import type {
  ChatCompletion,
  ChatCompletionMessageToolCall,
} from 'openai/resources';
import { readRealmFileBotTool } from './read-realm-file/index.ts';
import { readUrlBotTool } from './read-url/index.ts';
import { publishCanceledResult } from './results.ts';
import type {
  BotTool,
  BotToolCall,
  BotToolOutcome,
  BotToolRoom,
  BotToolRoomFacts,
  BotToolTarget,
  BotToolTurn,
} from './types.ts';

export type * from './types.ts';

// Every tool ai-bot runs itself, in the order their calls are fulfilled.
export const BOT_TOOLS: readonly BotTool[] = [
  readRealmFileBotTool,
  readUrlBotTool,
];

export function botToolNamed(name: string | undefined): BotTool | undefined {
  return BOT_TOOLS.find((tool) => tool.name === name);
}

export function offeredBotTools(room: BotToolRoomFacts): BotTool[] {
  return BOT_TOOLS.filter((tool) => tool.isOffered(room));
}

// Each offered tool's state for this handler run, by tool name.
export async function startBotToolTurns(
  tools: BotTool[],
  room: Omit<BotToolRoom, 'offeredToolNames'>,
): Promise<Map<string, BotToolTurn>> {
  let offeredToolNames = new Set(tools.map((tool) => tool.name));
  let turns = await Promise.all(
    tools.map(
      async (tool) =>
        [
          tool.name,
          await tool.startTurn({ ...room, offeredToolNames }),
        ] as const,
    ),
  );
  return new Map(turns);
}

// One bot-tool call to run: the call, the tool's turn that runs it, and
// where its result goes.
export interface BotToolCallEntry {
  call: BotToolCall;
  turn: BotToolTurn;
  target: BotToolTarget;
}

// Runs bot-tool calls and publishes each one's result, one at a time, in
// order. Sequential on purpose: every published result re-triggers the bot,
// and that handler decides whether the turn is complete from the room
// history it fetches; publishing in sequence means that by the time result N
// triggers its handler, results 1..N-1 are on the server.
//
// This is the one place a stop reaches bot-tool calls. `stopped` is asked
// before each call starts: a call already running finishes, and every call
// after it is answered as canceled, so no tool has to know about stops.
// Returns each call's outcome by its id.
export async function fulfillBotToolCalls(
  entries: BotToolCallEntry[],
  stopped: () => boolean,
): Promise<Map<string, BotToolOutcome>> {
  let outcomes = new Map<string, BotToolOutcome>();
  for (let { call, turn, target } of entries) {
    let outcome = stopped()
      ? await publishCanceledResult(call, target)
      : await turn.fulfill(call, target);
    outcomes.set(call.id, outcome);
  }
  return outcomes;
}

// The bot-tool calls an answer had streamed when it was canceled (a stop, or
// a newer message interrupting it). None of them runs, but each still needs
// a result: the next prompt carries the answer's calls, and the provider
// rejects a call with no result after it. Includes a call whose arguments
// were cut off mid-stream, and one that would have waited for approval.
export function abandonedBotToolCalls(
  toolCalls: {
    id?: string;
    function?: { name?: string; arguments?: string };
  }[],
): BotToolCall[] {
  let calls: BotToolCall[] = [];
  for (let toolCall of toolCalls) {
    let name = toolCall?.function?.name;
    if (toolCall?.id && name && botToolNamed(name)) {
      calls.push({
        id: toolCall.id,
        type: 'function',
        function: { name, arguments: toolCall.function?.arguments ?? '' },
      });
    }
  }
  return calls;
}

// Answers each call with a 'canceled' result, one at a time, in order (see
// fulfillBotToolCalls for why in sequence). Returns each call's outcome by id.
export async function cancelBotToolCalls(
  calls: BotToolCall[],
  target: BotToolTarget,
  reason: string,
): Promise<Map<string, BotToolOutcome>> {
  let outcomes = new Map<string, BotToolOutcome>();
  for (let call of calls) {
    outcomes.set(call.id, await publishCanceledResult(call, target, reason));
  }
  return outcomes;
}

export interface ClassifiedToolCalls {
  // Tool calls ai-bot runs itself (see BOT_TOOLS).
  botToolCalls: ChatCompletionMessageToolCall[];
  // Tool calls the host runs (everything else).
  hostToolCalls: ChatCompletionMessageToolCall[];
}

// Split a completion's tool calls into the ones ai-bot fulfills itself and
// the ones the host fulfills. Both kinds resolve the same way — as command
// requests answered by a command-result event on a later turn — so a single
// response may freely contain both; the caller fulfills the bot ones and
// leaves the rest to the host.
export function classifyToolCalls(
  assistantMessage: ChatCompletion.Choice['message'],
): ClassifiedToolCalls {
  let botToolCalls: ChatCompletionMessageToolCall[] = [];
  let hostToolCalls: ChatCompletionMessageToolCall[] = [];
  for (let call of assistantMessage.tool_calls ?? []) {
    if (call.type === 'function' && botToolNamed(call.function.name)) {
      botToolCalls.push(call);
    } else {
      hostToolCalls.push(call);
    }
  }
  return { botToolCalls, hostToolCalls };
}

// True when a cut-off response's tool calls include a bot-tool call that
// still names enough to run, so the bot carries on by itself.
export function hasRecoverableBotToolCall(
  toolCalls: { function?: { name?: string; arguments?: string } }[],
): boolean {
  return toolCalls.some(
    (toolCall) =>
      botToolNamed(toolCall?.function?.name)?.recoversFromCutOff?.(
        toolCall.function?.arguments ?? '',
      ) ?? false,
  );
}
